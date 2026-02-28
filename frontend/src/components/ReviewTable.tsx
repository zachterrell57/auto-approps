import { useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FieldMapping } from "@/lib/types";

interface ReviewTableProps {
  mappings: FieldMapping[];
  unmappedFields: string[];
  loading: boolean;
  onUpdate: (index: number, updates: Partial<FieldMapping>) => void;
  onRemap: () => void;
  onGenerateAnswers: () => void;
}

const confidenceColors: Record<string, string> = {
  high: "bg-green-100 text-green-800 hover:bg-green-100",
  medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  low: "bg-red-100 text-red-800 hover:bg-red-100",
};

export function ReviewTable({
  mappings,
  unmappedFields,
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

  const activeCount = mappings.filter((m) => !m.skip && m.proposed_answer).length;

  return (
    <Card className="w-full max-w-5xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl">Review Mappings</CardTitle>
            <CardDescription>
              {activeCount} fields have answers. Click any answer to edit it.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onRemap} disabled={loading}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Re-map
            </Button>
            <Button onClick={onGenerateAnswers} disabled={loading || activeCount === 0}>
              Generate Answer Sheet ({activeCount})
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {unmappedFields.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <strong>Unmapped fields:</strong> {unmappedFields.join(", ")}
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">Skip</TableHead>
                <TableHead className="w-1/4">Form Field</TableHead>
                <TableHead className="w-1/3">Proposed Answer</TableHead>
                <TableHead className="w-1/4">Source Citation</TableHead>
                <TableHead className="w-20">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((m, i) => (
                <TableRow
                  key={m.field_id}
                  className={m.skip ? "opacity-50" : ""}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={m.skip}
                      onChange={(e) =>
                        onUpdate(i, { skip: e.target.checked })
                      }
                      className="h-4 w-4"
                    />
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {m.field_label}
                  </TableCell>
                  <TableCell>
                    {editingIndex === i ? (
                      <div className="flex items-start gap-1">
                        {m.proposed_answer.length > 80 ? (
                          <Textarea
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="text-sm min-h-[60px]"
                            autoFocus
                          />
                        ) : (
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(i);
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          onClick={() => saveEdit(i)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          onClick={cancelEdit}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="text-sm cursor-pointer hover:bg-gray-50 rounded p-1 -m-1"
                        onClick={() => startEdit(i)}
                        title="Click to edit"
                      >
                        {m.proposed_answer || (
                          <span className="text-gray-400 italic">
                            No answer — click to add
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600">
                    {m.source_citation}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={confidenceColors[m.confidence] || ""}
                    >
                      {m.confidence}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
