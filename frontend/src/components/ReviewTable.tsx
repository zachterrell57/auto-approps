import { useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import type { FieldMapping } from "@/lib/types";

interface ReviewTableProps {
  mappings: FieldMapping[];
  loading: boolean;
  onUpdate: (index: number, updates: Partial<FieldMapping>) => void;
  onRemap: () => void;
  onGenerateAnswers: () => void;
}

const confidenceColors: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-600",
  medium: "bg-amber-50 text-amber-600",
  low: "bg-rose-50 text-rose-600",
};

export function ReviewTable({
  mappings,
  loading,
  onUpdate,
  onRemap,
  onGenerateAnswers,
}: ReviewTableProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(mappings[index].proposed_answer);
  };

  const saveEdit = (index: number) => {
    onUpdate(index, { proposed_answer: editValue });
    setEditingIndex(null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
  };

  const activeCount = mappings.filter((m) => m.proposed_answer).length;

  return (
    <div className="w-full max-w-5xl mx-auto pt-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground leading-none">
              Review Mappings
            </h1>
            <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
              {activeCount} fields have answers. Click any answer to edit it.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onRemap}
              disabled={loading}
              className="h-10 px-4 rounded-xl border border-foreground/10 text-sm font-medium text-foreground/50 hover:text-foreground hover:border-foreground/20 transition-all duration-200 flex items-center gap-2 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Re-map
            </button>
            <button
              onClick={onGenerateAnswers}
              disabled={loading || activeCount === 0}
              className="h-10 px-5 rounded-xl bg-foreground text-background text-sm font-medium tracking-wide transition-all duration-200 hover:shadow-lg hover:shadow-foreground/10 active:scale-[0.995] disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              Generate Answer Sheet ({activeCount})
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-foreground/10 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-foreground/8 bg-foreground/[0.02]">
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/35 w-1/4">
                Form Field
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/35 w-1/3">
                Proposed Answer
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/35 w-1/4">
                Source Citation
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.08em] uppercase text-foreground/35 w-20">
                Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => (
              <tr
                key={m.field_id}
                className="border-b border-foreground/5 last:border-0 hover:bg-foreground/[0.01] transition-colors"
              >
                <td className="px-4 py-3 text-sm font-medium text-foreground">
                  {m.field_label}
                </td>
                <td className="px-4 py-3">
                  {editingIndex === i ? (
                    <div className="flex items-start gap-1.5">
                      {m.proposed_answer.length > 80 ? (
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 min-h-[60px] p-2 rounded-lg border border-foreground/10 bg-transparent text-sm text-foreground focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 resize-y"
                          autoFocus
                        />
                      ) : (
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 h-9 px-2 rounded-lg border border-foreground/10 bg-transparent text-sm text-foreground focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(i);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                      )}
                      <button
                        className="p-1.5 rounded-lg text-foreground/30 hover:text-emerald-500 hover:bg-emerald-50 transition-colors shrink-0"
                        onClick={() => saveEdit(i)}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        className="p-1.5 rounded-lg text-foreground/30 hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0"
                        onClick={cancelEdit}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="text-sm cursor-pointer hover:bg-foreground/[0.03] rounded-lg p-1.5 -m-1.5 transition-colors"
                      onClick={() => startEdit(i)}
                      title="Click to edit"
                    >
                      {m.proposed_answer || (
                        <span className="text-foreground/25 italic">
                          No answer — click to add
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-foreground/40">
                  {m.source_citation}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                      confidenceColors[m.confidence] || ""
                    }`}
                  >
                    {m.confidence}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
