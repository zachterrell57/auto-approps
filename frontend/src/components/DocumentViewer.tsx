import { useEffect, useRef } from "react";
import type { DocChunk } from "@/lib/types";

interface DocumentViewerProps {
  chunks: DocChunk[];
  highlightedIndices: Set<number>;
}

export function DocumentViewer({ chunks, highlightedIndices }: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (highlightedIndices.size === 0) return;
    const firstIndex = Math.min(...highlightedIndices);
    const el = highlightRefs.current.get(firstIndex);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedIndices]);

  if (chunks.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic p-4">
        No document content available.
      </div>
    );
  }

  // Group chunks by heading context for visual structure
  const sections: { heading: string; chunks: DocChunk[] }[] = [];
  let currentHeading = "";
  let currentGroup: DocChunk[] = [];

  for (const chunk of chunks) {
    const heading = chunk.heading_context || "";
    if (heading !== currentHeading && chunk.chunk_type === "heading") {
      if (currentGroup.length > 0) {
        sections.push({ heading: currentHeading, chunks: currentGroup });
      }
      currentHeading = heading;
      currentGroup = [chunk];
    } else {
      if (heading !== currentHeading && currentGroup.length > 0) {
        sections.push({ heading: currentHeading, chunks: currentGroup });
        currentHeading = heading;
        currentGroup = [];
      }
      currentGroup.push(chunk);
    }
  }
  if (currentGroup.length > 0) {
    sections.push({ heading: currentHeading, chunks: currentGroup });
  }

  return (
    <div ref={containerRef} className="space-y-1 text-sm">
      {sections.map((section, sIdx) => (
        <div key={sIdx}>
          {section.chunks.map((chunk) => {
            const isHighlighted = highlightedIndices.has(chunk.index);
            return (
              <div
                key={chunk.index}
                ref={(el) => {
                  if (el && isHighlighted) {
                    highlightRefs.current.set(chunk.index, el);
                  } else {
                    highlightRefs.current.delete(chunk.index);
                  }
                }}
                className={`px-3 py-1.5 rounded transition-colors ${
                  isHighlighted
                    ? "bg-amber-100 border-l-4 border-amber-400"
                    : "text-gray-700"
                } ${chunk.chunk_type === "heading" ? "font-semibold text-gray-900 mt-3 text-base" : ""} ${
                  chunk.chunk_type === "table_row" ? "font-mono text-xs" : ""
                }`}
              >
                {chunk.text}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
