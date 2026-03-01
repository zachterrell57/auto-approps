import { useCallback, useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { ChevronUp, ChevronDown } from "lucide-react";
import { fetchDocumentBlob } from "@/lib/api";
import { findChunkElements, type MatchResult } from "@/lib/docTextMatcher";
import type { DocChunk } from "@/lib/types";

const HIGHLIGHT_CLASS = "source-highlight";
const ACTIVE_HIGHLIGHT_CLASS = "source-highlight-active";

interface DocumentViewerProps {
  /** When set, fetch the .docx from this URL instead of the backend API. */
  blobUrl?: string | null;
  /** Source chunks to highlight and navigate in the rendered document. */
  sourceChunks?: DocChunk[];
}

export function DocumentViewer({
  blobUrl,
  sourceChunks = [],
}: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renderComplete, setRenderComplete] = useState(false);

  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Render the document
  useEffect(() => {
    let cancelled = false;
    setRenderComplete(false);

    async function render() {
      try {
        setLoading(true);
        setError(null);
        const buffer = blobUrl
          ? await fetch(blobUrl).then((r) => r.arrayBuffer())
          : await fetchDocumentBlob();
        if (cancelled || !containerRef.current) return;
        await renderAsync(buffer, containerRef.current, undefined, {
          className: "docx-viewer",
          inWrapper: true,
          ignoreWidth: true,
          ignoreHeight: true,
        });
        if (!cancelled) setRenderComplete(true);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to render document"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [blobUrl]);

  // Match source chunks to DOM elements and highlight
  useEffect(() => {
    if (!renderComplete || !containerRef.current) return;

    // Clear all previous highlights
    containerRef.current
      .querySelectorAll(`.${HIGHLIGHT_CLASS}, .${ACTIVE_HIGHLIGHT_CLASS}`)
      .forEach((el) => {
        el.classList.remove(HIGHLIGHT_CLASS, ACTIVE_HIGHLIGHT_CLASS);
      });

    if (sourceChunks.length === 0) {
      setMatchResults([]);
      setActiveMatchIndex(0);
      return;
    }

    const results = findChunkElements(containerRef.current, sourceChunks);
    const validResults = results.filter((r) => r.elements.length > 0);
    setMatchResults(validResults);
    setActiveMatchIndex(0);

    // Apply highlight class to all matched elements
    for (const result of validResults) {
      for (const el of result.elements) {
        el.classList.add(HIGHLIGHT_CLASS);
      }
    }

    // Scroll to first match
    if (validResults.length > 0 && validResults[0].elements.length > 0) {
      const firstEl = validResults[0].elements[0];
      firstEl.classList.add(ACTIVE_HIGHLIGHT_CLASS);
      requestAnimationFrame(() => {
        firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [sourceChunks, renderComplete]);

  const navigateToMatch = useCallback(
    (index: number) => {
      if (matchResults.length === 0) return;

      // Remove active highlight from previous
      const prev = matchResults[activeMatchIndex];
      if (prev) {
        for (const el of prev.elements) {
          el.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
        }
      }

      // Add active highlight to new
      const next = matchResults[index];
      if (next && next.elements.length > 0) {
        for (const el of next.elements) {
          el.classList.add(ACTIVE_HIGHLIGHT_CLASS);
        }
        next.elements[0].scrollIntoView({ behavior: "smooth", block: "center" });
      }

      setActiveMatchIndex(index);
    },
    [matchResults, activeMatchIndex]
  );

  const goToPrev = useCallback(() => {
    const newIndex =
      activeMatchIndex > 0 ? activeMatchIndex - 1 : matchResults.length - 1;
    navigateToMatch(newIndex);
  }, [activeMatchIndex, matchResults.length, navigateToMatch]);

  const goToNext = useCallback(() => {
    const newIndex =
      activeMatchIndex < matchResults.length - 1 ? activeMatchIndex + 1 : 0;
    navigateToMatch(newIndex);
  }, [activeMatchIndex, matchResults.length, navigateToMatch]);

  if (error) {
    return (
      <div className="text-sm text-rose-500 p-4">{error}</div>
    );
  }

  return (
    <div className="bg-foreground/[0.03] h-full flex flex-col">
      {/* Source navigation bar */}
      {matchResults.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200/60 shrink-0">
          <span className="text-xs font-semibold text-amber-700">
            Source {activeMatchIndex + 1} of {matchResults.length}
          </span>
          <div className="flex items-center gap-0.5">
            <button
              onClick={goToPrev}
              className="p-1 rounded-lg hover:bg-amber-100 text-amber-600 transition-colors"
              aria-label="Previous source"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={goToNext}
              className="p-1 rounded-lg hover:bg-amber-100 text-amber-600 transition-colors"
              aria-label="Next source"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Document content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="text-sm text-foreground/30 p-4">
            Loading document...
          </div>
        )}
        <div ref={containerRef} className="docx-container" />
      </div>
    </div>
  );
}
