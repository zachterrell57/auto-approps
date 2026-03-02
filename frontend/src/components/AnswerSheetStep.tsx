import { useMemo, useState } from "react";
import { Check, Copy, FileText, RotateCcw } from "lucide-react";
import { DocumentViewer } from "@/components/DocumentViewer";
import type { FieldMapping, FieldType, FormField, FormSchema } from "@/lib/types";

interface AnswerSheetStepProps {
  formSchema: FormSchema;
  mappings: FieldMapping[];
  loading: boolean;
  apiKeyConfigured?: boolean;
  debugDocBlobUrl?: string | null;
  isHistorical?: boolean;
  onUpdate: (index: number, updates: Partial<FieldMapping>) => void;
  onRemap: () => void;
}

interface AnswerRow {
  field: FormField;
  mapping: FieldMapping | null;
  mappingIndex: number | null;
}

const confidenceColors: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-600",
  medium: "bg-amber-50 text-amber-600",
  low: "bg-rose-50 text-rose-600",
};

function actionHint(type: FieldType, answer: string): string {
  if (type === "radio" || type === "dropdown" || type === "linear_scale") {
    return answer
      ? `Select this option: ${answer}`
      : "Select the matching option in the form.";
  }
  if (type === "checkbox") {
    return answer
      ? `Check these option(s): ${answer}`
      : "Check the matching option(s) in the form.";
  }
  return "Paste this response into the form field.";
}

function shouldUseTextarea(type: FieldType, value: string): boolean {
  return type === "long_text" || value.length > 120 || value.includes("\n");
}

function copyFieldType(type: FieldType): string {
  return type.replace(/_/g, " ");
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function AnswerSheetStep({
  formSchema,
  mappings,
  loading,
  apiKeyConfigured = true,
  debugDocBlobUrl,
  isHistorical,
  onUpdate,
  onRemap,
}: AnswerSheetStepProps) {
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const activeCount = mappings.filter((m) => m.proposed_answer.trim()).length;

  const selectedSourceChunks = useMemo(() => {
    if (!selectedFieldId) return [];
    const mapping = mappings.find((m) => m.field_id === selectedFieldId);
    return mapping?.source_chunks ?? [];
  }, [selectedFieldId, mappings]);

  const groupedRows = useMemo(() => {
    const mappingById = new Map<string, { mapping: FieldMapping; index: number }>();
    mappings.forEach((mapping, index) => {
      mappingById.set(mapping.field_id, { mapping, index });
    });

    const byPage = new Map<number, AnswerRow[]>();
    for (const field of formSchema.fields) {
      const match = mappingById.get(field.field_id);
      const row: AnswerRow = {
        field,
        mapping: match?.mapping ?? null,
        mappingIndex: match?.index ?? null,
      };
      const pageRows = byPage.get(field.page_index) ?? [];
      pageRows.push(row);
      byPage.set(field.page_index, pageRows);
    }

    return [...byPage.entries()].sort(([a], [b]) => a - b);
  }, [formSchema.fields, mappings]);

  const handleCopy = async (fieldId: string, value: string) => {
    if (!value.trim()) return;
    const copied = await copyToClipboard(value);
    if (!copied) return;
    setCopiedFieldId(fieldId);
    setTimeout(
      () => setCopiedFieldId((current) => (current === fieldId ? null : current)),
      1200
    );
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      {/* Left panel: Answer cards */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 space-y-8">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground leading-none">
                Review + Answer Sheet
              </h1>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed max-w-lg">
                Edit mappings, then copy each response into the form manually.
                Click a field to see its source in the document.
              </p>
              <p className="mt-2 text-sm text-foreground/35">
                {activeCount} field{activeCount !== 1 ? "s" : ""} ready to copy.
              </p>
              {!apiKeyConfigured && (
                <p className="mt-2 text-sm text-amber-700/90">
                  Re-map is unavailable until an Anthropic API key is set in Settings.
                </p>
              )}
              {formSchema.scrape_warnings.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-50/30 px-3 py-2">
                  <p className="text-[11px] font-semibold tracking-[0.06em] uppercase text-amber-700/80">
                    Form scrape notes
                  </p>
                  <div className="mt-1 space-y-1">
                    {formSchema.scrape_warnings.slice(0, 5).map((warning, index) => (
                      <p key={`${warning}-${index}`} className="text-[12px] leading-relaxed text-amber-700/75">
                        {warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={onRemap}
              disabled={loading || isHistorical || !apiKeyConfigured}
              title={
                isHistorical
                  ? "Only available for current session"
                  : !apiKeyConfigured
                  ? "Add API key in Settings to re-map"
                  : undefined
              }
              className="h-10 px-4 rounded-xl border border-foreground/10 text-sm font-medium text-foreground/50 hover:text-foreground hover:border-foreground/20 transition-all duration-200 flex items-center gap-2 shrink-0 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Re-map
            </button>
          </div>

          {/* Answer cards by page */}
          {groupedRows.map(([pageIndex, rows]) => (
            <section key={pageIndex} className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold bg-foreground/[0.06] text-foreground/40">
                  {pageIndex + 1}
                </span>
                <span className="text-xs font-semibold tracking-[0.08em] uppercase text-foreground/40">
                  Page {pageIndex + 1}
                </span>
              </div>

              <div className="space-y-3">
                {rows.map(({ field, mapping, mappingIndex }) => {
                  const answer = mapping?.proposed_answer ?? "";
                  const editable = mappingIndex !== null;
                  const useTextarea = shouldUseTextarea(field.field_type, answer);
                  const isSelected = selectedFieldId === field.field_id;
                  const hasSource = (mapping?.source_chunks?.length ?? 0) > 0;

                  return (
                    <div
                      key={field.field_id}
                      className={`rounded-xl border p-4 space-y-3 cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "ring-2 ring-amber-400/60 border-amber-300/40 bg-amber-50/20"
                          : "border-foreground/8 hover:border-foreground/15"
                      }`}
                      onClick={() =>
                        setSelectedFieldId(isSelected ? null : field.field_id)
                      }
                    >
                      {/* Field header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-foreground leading-tight">
                            {field.label || field.field_id}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-foreground/8 text-[11px] font-medium text-foreground/35">
                              {copyFieldType(field.field_type)}
                            </span>
                            {field.required && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-foreground/[0.04] text-[11px] font-medium text-foreground/35">
                                Required
                              </span>
                            )}
                            {mapping?.confidence && (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                                  confidenceColors[mapping.confidence] || ""
                                }`}
                              >
                                {mapping.confidence}
                              </span>
                            )}
                            {hasSource && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-300/50 text-[11px] font-medium text-amber-600">
                                <FileText className="h-3 w-3" />
                                {mapping!.source_chunks.length} source
                                {mapping!.source_chunks.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Copy button */}
                        <div
                          className="flex items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleCopy(field.field_id, answer)}
                            disabled={!answer.trim()}
                            className="h-8 px-3 rounded-lg border border-foreground/8 text-xs font-medium text-foreground/40 hover:text-foreground hover:border-foreground/15 transition-all duration-200 flex items-center gap-1.5 disabled:opacity-20 disabled:cursor-not-allowed"
                          >
                            {copiedFieldId === field.field_id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-emerald-600">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Action hint */}
                      <p className="text-[12px] text-foreground/30">
                        {actionHint(field.field_type, answer)}
                      </p>

                      {mapping?.source_citation && (
                        <p className="text-[12px] text-foreground/40">
                          Source: {mapping.source_citation}
                        </p>
                      )}

                      {/* Editable answer */}
                      <div onClick={(e) => e.stopPropagation()}>
                        {useTextarea ? (
                          <textarea
                            value={answer}
                            disabled={!editable}
                            onChange={(event) =>
                              mappingIndex !== null &&
                              onUpdate(mappingIndex, {
                                proposed_answer: event.target.value,
                              })
                            }
                            className="w-full min-h-[88px] p-3 rounded-xl border border-foreground/8 bg-transparent text-sm text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 resize-y disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        ) : (
                          <input
                            value={answer}
                            disabled={!editable}
                            onChange={(event) =>
                              mappingIndex !== null &&
                              onUpdate(mappingIndex, {
                                proposed_answer: event.target.value,
                              })
                            }
                            className="w-full h-10 px-3 rounded-xl border border-foreground/8 bg-transparent text-sm text-foreground focus:outline-none focus:border-amber-400 focus:ring-[3px] focus:ring-amber-400/10 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Right panel: Document viewer — full height */}
      <div className="w-1/2 shrink-0 border-l border-foreground/8 flex flex-col">
        <div className="px-5 py-4 border-b border-foreground/8 shrink-0">
          <h2 className="font-heading text-lg text-foreground leading-tight">
            Document Source
          </h2>
          <p className="text-xs text-foreground/35 mt-1">
            The uploaded source document.
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <DocumentViewer blobUrl={debugDocBlobUrl} sourceChunks={selectedSourceChunks} />
        </div>
      </div>
    </div>
  );
}
