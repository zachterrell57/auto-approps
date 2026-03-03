import { useMemo, useState } from "react";
import { Check, ClipboardList, Copy, FileText, RotateCcw } from "lucide-react";
import { DocumentViewer } from "@/components/DocumentViewer";
import type { FieldMapping, FieldType, FormField, FormSchema } from "@/lib/types";

interface AnswerSheetStepProps {
  workflowId: string;
  formSchema: FormSchema;
  mappings: FieldMapping[];
  loading: boolean;
  apiKeyConfigured?: boolean;
  hasDocument: boolean;
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
  workflowId,
  formSchema,
  mappings,
  loading,
  apiKeyConfigured = true,
  hasDocument,
  debugDocBlobUrl,
  isHistorical,
  onUpdate,
  onRemap,
}: AnswerSheetStepProps) {
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const activeCount = mappings.filter((m) => m.proposed_answer.trim()).length;

  const confidenceCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const m of mappings) {
      if (m.confidence in counts) {
        counts[m.confidence as keyof typeof counts]++;
      }
    }
    return counts;
  }, [mappings]);

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
      1200,
    );
  };

  const handleCopyAll = async () => {
    const lines = mappings
      .filter((m) => m.proposed_answer.trim())
      .map((m) => `${m.field_label}: ${m.proposed_answer}`)
      .join("\n\n");
    if (!lines) return;
    const copied = await copyToClipboard(lines);
    if (!copied) return;
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="p-6 space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground leading-none">
                Review + Answer Sheet
              </h1>
              <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed max-w-lg">
                Edit mappings, then copy each response into the form manually.
                {hasDocument
                  ? " Click a field to see its source in the document."
                  : " Source citations are based on selected knowledge context."}
              </p>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-sm text-foreground/35">
                <span>{activeCount} field{activeCount !== 1 ? "s" : ""} ready to copy</span>
                <span className="text-foreground/15">|</span>
                <span className="text-emerald-600">{confidenceCounts.high} high</span>
                <span className="text-amber-600">{confidenceCounts.medium} med</span>
                <span className="text-rose-600">{confidenceCounts.low} low</span>
              </div>
              {!apiKeyConfigured && (
                <p className="mt-2 text-sm text-amber-700/90">
                  Re-map is unavailable until an Anthropic API key is set in Settings.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopyAll}
                disabled={activeCount === 0}
                className="h-10 px-4 rounded-xl border border-foreground/10 text-sm font-medium text-foreground/50 hover:text-foreground hover:border-foreground/20 transition-all duration-200 flex items-center gap-2 disabled:opacity-20 disabled:cursor-not-allowed"
              >
                {copiedAll ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-emerald-600">Copied All</span>
                  </>
                ) : (
                  <>
                    <ClipboardList className="h-3.5 w-3.5" />
                    Copy All
                  </>
                )}
              </button>
              <button
                onClick={onRemap}
                disabled={loading || !apiKeyConfigured}
                title={
                  !apiKeyConfigured
                    ? "Add API key in Settings to re-map"
                    : isHistorical
                      ? "Re-maps with current knowledge profile and client context"
                      : undefined
                }
                className="h-10 px-4 rounded-xl border border-foreground/10 text-sm font-medium text-foreground/50 hover:text-foreground hover:border-foreground/20 transition-all duration-200 flex items-center gap-2 disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Re-map
              </button>
            </div>
          </div>


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

                      <p className="text-[12px] text-foreground/30">
                        {actionHint(field.field_type, answer)}
                      </p>

                      {mapping?.source_citation && (
                        <p className="text-[12px] text-foreground/40">
                          Source: {mapping.source_citation}
                        </p>
                      )}

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

      <div className="hidden lg:flex w-1/2 shrink-0 border-l border-foreground/8 flex-col">
        <div className="px-5 py-4 border-b border-foreground/8 shrink-0">
          <h2 className="font-heading text-lg text-foreground leading-tight">
            Document Source
          </h2>
          <p className="text-xs text-foreground/35 mt-1">
            {hasDocument
              ? "The uploaded source document."
              : "No document uploaded. Answers came from client and/or profile knowledge."}
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {hasDocument ? (
            <DocumentViewer
              workflowId={workflowId}
              blobUrl={debugDocBlobUrl}
              sourceChunks={selectedSourceChunks}
            />
          ) : (
            <div className="h-full flex items-center justify-center px-6 text-center text-sm text-foreground/40 bg-foreground/[0.02]">
              No document uploaded; answers sourced from knowledge context.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
