// ---------------------------------------------------------------------------
// nav-engine.ts — AI-guided page navigation engine for Microsoft Forms
//
// Orchestrates forward navigation through multi-page forms by filtering
// candidate controls, delegating to the AI decision maker, clicking the
// chosen element, and waiting for a page transition.
// ---------------------------------------------------------------------------

import { type Page } from "playwright";

import {
  chooseNextWithAI,
  type NavigationAIDecision,
} from "./browser-ai";
import { settings } from "./config";
import {
  clickNavigationByDomIndex,
  getPageSnapshot,
  type NavigationElement,
  type PageSnapshot,
} from "./page-model";

// ---------------------------------------------------------------------------
// Token lists for classifying navigation controls
// ---------------------------------------------------------------------------

const FORWARD_TOKENS = ["next", "continue", "proceed", "review", "ok"];
const STOP_TOKENS = ["back", "previous", "cancel"];
const SUBMIT_TOKENS = ["submit", "send", "done", "finish"];

const WORD_BOUNDARY = "(^|[^a-z0-9])";
const WORD_BOUNDARY_END = "($|[^a-z0-9])";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NavigationContext {
  form_url: string;
  max_pages: number;
}

export interface NavigationOutcome {
  moved: boolean;
  snapshot: PageSnapshot;
  source: string;
  should_stop: boolean;
  reason_code: string;
  reason_detail: string;
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

export function newNavigationContext(formUrl: string): NavigationContext {
  return {
    form_url: formUrl,
    max_pages: Math.max(1, settings.ms_nav_max_pages),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _candidateBlob(item: NavigationElement): string {
  return [
    item.text,
    item.aria_label,
    item.title_attr,
    item.data_automation_id,
    item.role,
    item.tag,
  ]
    .join(" ")
    .toLowerCase();
}

function _containsToken(value: string, token: string): boolean {
  if (!value) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${WORD_BOUNDARY}${escaped}${WORD_BOUNDARY_END}`,
    "i",
  );
  return re.test(value);
}

function _fieldHasForwardToken(value: string): boolean {
  return FORWARD_TOKENS.some((token) => _containsToken(value, token));
}

function _isStopOrSubmitCandidate(item: NavigationElement): boolean {
  const blob = _candidateBlob(item);
  const allTokens = [...STOP_TOKENS, ...SUBMIT_TOKENS];
  return allTokens.some((token) => blob.includes(token));
}

function _hasDisabledForwardControl(snapshot: PageSnapshot): boolean {
  for (const item of snapshot.navigation) {
    if (!item.visible || !item.disabled) continue;
    const blob = _candidateBlob(item);
    if (FORWARD_TOKENS.some((token) => blob.includes(token))) {
      return true;
    }
  }
  return false;
}

function _hasSubmitControl(snapshot: PageSnapshot): boolean {
  for (const item of snapshot.navigation) {
    if (!item.visible) continue;
    const blob = _candidateBlob(item);
    if (SUBMIT_TOKENS.some((token) => blob.includes(token))) {
      return true;
    }
  }
  return false;
}

function _actionableCandidates(
  snapshot: PageSnapshot,
): NavigationElement[] {
  return snapshot.navigation.filter(
    (item) =>
      item.visible && !item.disabled && !_isStopOrSubmitCandidate(item),
  );
}

function _forwardScore(item: NavigationElement): number {
  const text = item.text.toLowerCase();
  const aria = item.aria_label.toLowerCase();
  const title = item.title_attr.toLowerCase();
  const dataId = item.data_automation_id.toLowerCase();

  let score = 0;
  if (dataId === "nextbutton") score += 150;
  if (_fieldHasForwardToken(dataId)) score += 120;
  if (FORWARD_TOKENS.some((token) => text === token)) score += 100;
  if (FORWARD_TOKENS.some((token) => aria === token)) score += 100;
  if (FORWARD_TOKENS.some((token) => title === token)) score += 80;
  if (_fieldHasForwardToken(text)) score += 70;
  if (_fieldHasForwardToken(aria)) score += 70;
  if (_fieldHasForwardToken(title)) score += 50;

  if (item.tag === "button" || item.role === "button") score += 12;
  if (item.tag === "a" && item.role !== "button") score -= 20;

  return score;
}

function _pickDeterministicForward(
  candidates: NavigationElement[],
): NavigationElement | null {
  const scored = candidates
    .map((item) => ({ item, score: _forwardScore(item) }))
    .filter((rec) => rec.score >= 70)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.item.y !== b.item.y) return b.item.y - a.item.y;
      if (a.item.x !== b.item.x) return b.item.x - a.item.x;
      return a.item.index - b.item.index;
    });
  return scored[0]?.item ?? null;
}

function _likelyForwardCandidates(
  candidates: NavigationElement[],
): NavigationElement[] {
  return candidates.filter((item) => _forwardScore(item) >= 70);
}

async function _waitForTransition(
  page: Page,
  previousSignature: string,
): Promise<PageSnapshot | null> {
  let elapsed = 0;
  const timeoutMs = settings.ms_nav_transition_timeout_ms;
  while (elapsed <= timeoutMs) {
    await page.waitForTimeout(250);
    elapsed += 250;
    const snapshot = await getPageSnapshot(page);
    if (snapshot.signature !== previousSignature) {
      return snapshot;
    }
  }
  return null;
}

function _invalidOutcome(
  current: PageSnapshot,
  decision: NavigationAIDecision,
): NavigationOutcome {
  return {
    moved: false,
    snapshot: current,
    source: "ai",
    should_stop: true,
    reason_code: decision.error_code || "ai_invalid_response",
    reason_detail: decision.error_detail || "AI response was invalid.",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to navigate to the next page of the form.
 *
 * Filters visible, enabled, non-stop/submit navigation candidates, asks the
 * AI to pick the forward control, clicks it, and waits for a page transition.
 * Retries on invalid AI responses up to `settings.ms_nav_ai_retries` times.
 */
export async function navigateToNextPage(
  page: Page,
  context: NavigationContext,
  snapshot?: PageSnapshot | null,
): Promise<NavigationOutcome> {
  void context; // reserved for future provider- or form-specific behavior
  const current = snapshot ?? (await getPageSnapshot(page));
  const candidates = _actionableCandidates(current);
  const forwardCandidates = _likelyForwardCandidates(candidates);

  if (candidates.length === 0) {
    if (_hasDisabledForwardControl(current)) {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: false,
        reason_code: "forward_control_disabled",
        reason_detail:
          "Forward navigation appears disabled by required unanswered fields.",
      };
    }
    if (_hasSubmitControl(current)) {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: true,
        reason_code: "no_forward_control",
        reason_detail:
          "Submit control detected and no forward navigation is available.",
      };
    }
    return {
      moved: false,
      snapshot: current,
      source: "ai",
      should_stop: false,
      reason_code: "no_actionable_candidates",
      reason_detail:
        "No visible enabled forward navigation candidates were found.",
    };
  }

  if (forwardCandidates.length === 0) {
    if (_hasDisabledForwardControl(current)) {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: false,
        reason_code: "forward_control_disabled",
        reason_detail:
          "Forward navigation appears disabled by required unanswered fields.",
      };
    }
    if (_hasSubmitControl(current)) {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: true,
        reason_code: "no_forward_control",
        reason_detail:
          "Submit control detected and no forward navigation is available.",
      };
    }
    return {
      moved: false,
      snapshot: current,
      source: "ai",
      should_stop: false,
      reason_code: "no_forward_candidates",
      reason_detail:
        "No navigation controls looked like forward actions.",
    };
  }

  const heuristicCandidate = _pickDeterministicForward(forwardCandidates);
  if (heuristicCandidate) {
    try {
      const clicked = await clickNavigationByDomIndex(
        page,
        heuristicCandidate.dom_index,
      );
      if (clicked) {
        const transitioned = await _waitForTransition(
          page,
          current.signature,
        );
        if (transitioned) {
          return {
            moved: true,
            snapshot: transitioned,
            source: "heuristic",
            should_stop: false,
            reason_code: "",
            reason_detail: "",
          };
        }
      }
    } catch {
      // If deterministic click fails, continue to AI selection.
    }
  }

  if (!settings.anthropic_api_key) {
    return {
      moved: false,
      snapshot: current,
      source: "heuristic",
      should_stop: false,
      reason_code: heuristicCandidate
        ? "forward_click_no_transition"
        : "ai_unavailable",
      reason_detail: heuristicCandidate
        ? "Clicked likely forward navigation but page did not transition."
        : "AI navigation unavailable because ANTHROPIC_API_KEY is not configured.",
    };
  }

  const maxAttempts = Math.max(1, settings.ms_nav_ai_retries + 1);
  let retryContext = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let decision = await chooseNextWithAI(
      current,
      forwardCandidates,
      retryContext,
    );

    if (decision.action === "NONE") {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: true,
        reason_code: "no_forward_control",
        reason_detail:
          decision.reason || "AI reported no forward control.",
      };
    }

    if (decision.action !== "CLICK" || decision.index === null) {
      retryContext = decision.error_code || "invalid_ai_response";
      if (attempt < maxAttempts - 1) {
        console.warn(
          `MS nav AI invalid response on attempt ${attempt + 1}/${maxAttempts}: ` +
            `code=${decision.error_code} detail=${decision.error_detail}`,
        );
        continue;
      }
      return _invalidOutcome(current, decision);
    }

    const candidate = forwardCandidates.find(
      (item) => item.index === decision.index,
    );
    if (!candidate) {
      decision = {
        action: "INVALID",
        index: null,
        reason: "",
        error_code: "candidate_not_found",
        error_detail: `Chosen index ${decision.index} was not in actionable candidates.`,
      };
      retryContext = decision.error_code;
      if (attempt < maxAttempts - 1) {
        console.warn(
          `MS nav AI chose stale candidate on attempt ${attempt + 1}/${maxAttempts}: ${decision.error_detail}`,
        );
        continue;
      }
      return _invalidOutcome(current, decision);
    }

    let clicked: boolean;
    try {
      clicked = await clickNavigationByDomIndex(
        page,
        candidate.dom_index,
      );
    } catch (exc) {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: false,
        reason_code: "click_failed",
        reason_detail: String(exc),
      };
    }

    if (!clicked) {
      return {
        moved: false,
        snapshot: current,
        source: "ai",
        should_stop: false,
        reason_code: "click_target_missing",
        reason_detail: `Candidate dom index ${candidate.dom_index} no longer exists.`,
      };
    }

    const transitioned = await _waitForTransition(
      page,
      current.signature,
    );
    if (transitioned) {
      return {
        moved: true,
        snapshot: transitioned,
        source: "ai",
        should_stop: false,
        reason_code: "",
        reason_detail: "",
      };
    }

    return {
      moved: false,
      snapshot: current,
      source: "ai",
      should_stop: false,
      reason_code: "no_transition_after_click",
      reason_detail:
        `Clicked candidate index ${candidate.index} (dom ${candidate.dom_index}) ` +
        "but page signature did not change.",
    };
  }

  return {
    moved: false,
    snapshot: current,
    source: "ai",
    should_stop: true,
    reason_code: "ai_navigation_exhausted",
    reason_detail:
      "AI navigation exhausted retry budget without a valid click.",
  };
}
