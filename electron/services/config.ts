// ---------------------------------------------------------------------------
// config.ts — Application settings and userData path management
//
// Port of backend/src/auto_approps/config.py.
// Instead of reading from .env via pydantic-settings, this module exposes a
// plain mutable settings object with the same defaults and a pair of functions
// to set / get the Electron userData path at runtime.
// ---------------------------------------------------------------------------

let _userDataPath: string | null = null;

/**
 * Store the Electron `app.getPath('userData')` value so that other service
 * modules can derive file paths from it (settings.json, knowledge_profile.json,
 * the SQLite database, etc.).
 *
 * This MUST be called once during app startup (before any store module is used).
 */
export function setUserDataPath(p: string): void {
  _userDataPath = p;
}

/**
 * Return the previously stored userData path.
 *
 * @throws {Error} if `setUserDataPath` has not been called yet.
 */
export function getUserDataPath(): string {
  if (_userDataPath === null) {
    throw new Error(
      "getUserDataPath() called before setUserDataPath(). " +
        "Call setUserDataPath(app.getPath('userData')) during app startup.",
    );
  }
  return _userDataPath;
}

// ---------------------------------------------------------------------------
// Settings object — mirrors the Python Settings(BaseSettings) class.
// Values here are sensible defaults; the API key is typically loaded from
// settings.json via the settings-store module.
// ---------------------------------------------------------------------------

export interface Settings {
  anthropic_api_key: string;
  model_name: string;
  browser_slow_mo: number;
  ms_playwright_headless: boolean;
  ms_nav_ai_retries: number;
  mapping_ai_retries: number;
  ms_nav_transition_timeout_ms: number;
  ms_nav_max_pages: number;
  generic_playwright_headless: boolean;
  generic_nav_max_pages: number;
  generic_page_load_timeout_ms: number;
  google_form_fetch_timeout_ms: number;
}

export const settings: Settings = {
  anthropic_api_key: "",
  model_name: "claude-sonnet-4-6",
  browser_slow_mo: 100,
  ms_playwright_headless: true,
  ms_nav_ai_retries: 1,
  mapping_ai_retries: 1,
  ms_nav_transition_timeout_ms: 8000,
  ms_nav_max_pages: 40,
  generic_playwright_headless: true,
  generic_nav_max_pages: 10,
  generic_page_load_timeout_ms: 15000,
  google_form_fetch_timeout_ms: 15000,
};
