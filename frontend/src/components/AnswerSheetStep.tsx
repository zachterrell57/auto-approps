import { useMemo, useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
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
import type { FieldMapping, FieldType, FormField, FormSchema } from "@/lib/types";

interface AnswerSheetStepProps {
  formSchema: FormSchema;
  mappings: FieldMapping[];
  unmappedFields: string[];
  loading: boolean;
  useProfileContext: boolean;
  onUpdate: (index: number, updates: Partial<FieldMapping>) => void;
  onUseProfileContextChange: (useProfileContext: boolean) => void;
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
  unmappedFields,
  loading,
  useProfileContext,
  onUpdate,
  onUseProfileContextChange,
  onRemap,
  onReset,
}: AnswerSheetStepProps) {
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);
  const activeCount = mappings.filter((m) => !m.skip && m.proposed_answer.trim()).length;

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
    <Card className="w-full max-w-5xl mx-auto">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-2xl">Review + Answer Sheet</CardTitle>
            <CardDescription>
              Edit mappings, mark skips, then copy each response into the form manually.
            </CardDescription>
            <p className="mt-2 text-sm text-gray-600">{activeCount} fields are ready to copy.</p>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 mr-2">
              <input
                type="checkbox"
                checked={useProfileContext}
                onChange={(event) => onUseProfileContextChange(event.target.checked)}
                className="h-4 w-4"
              />
              Use saved profile for re-map
            </label>
            <Button variant="outline" onClick={onRemap} disabled={loading}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Re-map
            </Button>
            <Button variant="outline" onClick={onReset} disabled={loading}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Start Over
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {unmappedFields.length > 0 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <strong>Unmapped fields:</strong> {unmappedFields.join(", ")}
          </div>
        )}

        {formSchema.scrape_warnings.length > 0 && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800 space-y-1">
            {formSchema.scrape_warnings.map((warning, index) => (
              <p key={index}>{warning}</p>
            ))}
          </div>
        )}

        {groupedRows.map(([pageIndex, rows]) => (
          <section key={pageIndex} className="border rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">Page {pageIndex + 1}</h3>
            <div className="space-y-4">
              {rows.map(({ field, mapping, mappingIndex }) => {
                const answer = mapping?.proposed_answer ?? "";
                const skipped = Boolean(mapping?.skip);
                const editable = mappingIndex !== null;
                const useTextarea = shouldUseTextarea(field.field_type, answer);

                return (
                  <div
                    key={field.field_id}
                    className={`rounded-md border p-3 space-y-2 ${
                      skipped ? "bg-gray-50 opacity-70" : "bg-white"
                    }`}
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
                          {skipped && <Badge variant="secondary">Skipped</Badge>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {editable && (
                          <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={skipped}
                              onChange={(event) =>
                                mappingIndex !== null &&
                                onUpdate(mappingIndex, { skip: event.target.checked })
                              }
                              className="h-4 w-4"
                            />
                            Skip
                          </label>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopy(field.field_id, answer)}
                          disabled={!answer.trim() || skipped}
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
                      {skipped ? "Skipped during review." : actionHint(field.field_type, answer)}
                    </p>
                    {mapping?.source_citation && (
                      <p className="text-xs text-gray-600">Source: {mapping.source_citation}</p>
                    )}

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
                );
              })}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
