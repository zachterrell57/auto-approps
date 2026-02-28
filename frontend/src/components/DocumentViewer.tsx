import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { fetchDocumentBlob } from "@/lib/api";

export function DocumentViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        setLoading(true);
        setError(null);
        const buffer = await fetchDocumentBlob();
        if (cancelled || !containerRef.current) return;
        await renderAsync(buffer, containerRef.current, undefined, {
          className: "docx-viewer",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: true,
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render document");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="text-sm text-red-500 italic p-4">
        {error}
      </div>
    );
  }

  return (
    <div className="bg-gray-200 h-full overflow-y-auto">
      {loading && (
        <div className="text-sm text-gray-500 italic p-4">
          Loading document...
        </div>
      )}
      <div ref={containerRef} className="docx-container" />
    </div>
  );
}
