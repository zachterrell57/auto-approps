import { useMemo, useState } from "react";
import { Check, Copy, FileText, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DocumentViewer } from "@/components/DocumentViewer";
import type { FieldMapping, FieldType, FormField, FormSchema } from "@/lib/types";

interface AnswerSheetStepProps {
  formSchema: FormSchema;
  mappings: FieldMapping[];
  loading: boolean;
  debugDocBlobUrl?: string | null;
  onUpdate: (index: number, updates: Partial<FieldMapping>) => void;
  onRemap: () => void;
  onReset: () => void;
}

interface AnswerRow {
  field: FormField;
  mapping: FieldMapping | null;
  mappingIndex: number | null;
}

const confidenceColors: Record<string, string> = {
  high: "bg-green-100 text-green-800 hover:bg-green-100",
  medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  low: "bg-red-100 text-red-800 hover:bg-red-100",
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
  debugDocBlobUrl,
  onUpdate,
  onRemap,
  onReset,
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
    setTimeout(() => setCopiedFieldId((current) => (current === fieldId ? null : current)), 1200);
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Review + Answer Sheet</h2>
          <span className="text-sm text-gray-500">{activeCount} fields ready to copy</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRemap} disabled={loading}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Re-map
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} disabled={loading}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Start Over
          </Button>
        </div>
      </div>

      {/* Side-by-side layout */}
      <div className="flex gap-4 items-start">
        {/* Left panel: Answer cards */}
        <div className="flex-1 min-w-0 space-y-6">
          {groupedRows.map(([pageIndex, rows]) => (
            <section key={pageIndex} className="border rounded-lg p-4 space-y-4 bg-white">
              <h3 className="text-sm font-semibold text-gray-700">Page {pageIndex + 1}</h3>
              <div className="space-y-4">
                {rows.map(({ field, mapping, mappingIndex }) => {
                  const answer = mapping?.proposed_answer ?? "";
                  const editable = mappingIndex !== null;
                  const useTextarea = shouldUseTextarea(field.field_type, answer);
                  const isSelected = selectedFieldId === field.field_id;
                  const hasSource = (mapping?.source_chunks?.length ?? 0) > 0;

                  return (
                    <div
                      key={field.field_id}
                      className={`rounded-md border p-3 space-y-2 cursor-pointer transition-colors ${
                        isSelected
                          ? "ring-2 ring-amber-400 border-amber-300 bg-amber-50/30"
                          : "bg-white hover:border-gray-300"
                      }`}
                      onClick={() => setSelectedFieldId(isSelected ? null : field.field_id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{field.label || field.field_id}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline">{copyFieldType(field.field_type)}</Badge>
                            {field.required && <Badge variant="secondary">Required</Badge>}
                            {mapping?.confidence && (
                              <Badge
                                variant="secondary"
                                className={confidenceColors[mapping.confidence] || ""}
                              >
                                {mapping.confidence}
                              </Badge>
                            )}
                            {hasSource && (
                              <Badge variant="outline" className="text-amber-700 border-amber-300">
                                <FileText className="h-3 w-3 mr-1" />
                                {mapping!.source_chunks.length} source{mapping!.source_chunks.length !== 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopy(field.field_id, answer)}
                            disabled={!answer.trim()}
                          >
                            {copiedFieldId === field.field_id ? (
                              <>
                                <Check className="h-4 w-4 mr-2" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      <p className="text-xs text-gray-500">
                        {actionHint(field.field_type, answer)}
                      </p>
                      {mapping?.source_citation && (
                        <p className="text-xs text-gray-600">Source: {mapping.source_citation}</p>
                      )}

                      <div onClick={(e) => e.stopPropagation()}>
                        {useTextarea ? (
                          <Textarea
                            value={answer}
                            disabled={!editable}
                            onChange={(event) =>
                              mappingIndex !== null &&
                              onUpdate(mappingIndex, { proposed_answer: event.target.value })
                            }
                            className="text-sm min-h-[88px]"
                          />
                        ) : (
                          <Input
                            value={answer}
                            disabled={!editable}
                            onChange={(event) =>
                              mappingIndex !== null &&
                              onUpdate(mappingIndex, { proposed_answer: event.target.value })
                            }
                            className="text-sm"
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

        {/* Right panel: Document viewer */}
        <div className="w-[45%] shrink-0 sticky top-4 h-[calc(100vh-2rem)]">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle className="text-lg">Document Source</CardTitle>
              <CardDescription>
                The uploaded source document.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0 overflow-hidden">
              <DocumentViewer blobUrl={debugDocBlobUrl} sourceChunks={selectedSourceChunks} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
