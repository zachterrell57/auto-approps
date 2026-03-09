import path from "node:path";
import type { FieldType, FormField } from "./models.js";

export interface FieldSeed {
  label: string;
  fieldType?: FieldType;
  required?: boolean;
  options?: string[];
  pageIndex?: number;
  exportable?: boolean;
  exportIssue?: string;
  locator?: Record<string, unknown> | null;
}

export function stripExtension(filename: string): string {
  return path.basename(filename).replace(/\.[^.]+$/, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function slugify(value: string): string {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "field";
}

export function inferFieldType(label: string, fallback: FieldType = "short_text"): FieldType {
  const normalized = normalizeWhitespace(label).toLowerCase();
  if (!normalized) return fallback;
  if (/\bdate\b/.test(normalized)) return "date";
  if (/\btime\b/.test(normalized)) return "time";
  if (
    /\b(describe|explain|details|comment|comments|narrative|why|summary|background)\b/.test(
      normalized,
    ) || normalized.length > 100
  ) {
    return "long_text";
  }
  return fallback;
}

export function buildField(seed: FieldSeed, index: number): FormField {
  const label = normalizeWhitespace(seed.label);
  return {
    field_id: `${slugify(label)}-${String(index + 1).padStart(3, "0")}`,
    label,
    field_type: seed.fieldType ?? inferFieldType(label),
    required: seed.required ?? false,
    options: seed.options ?? [],
    page_index: seed.pageIndex ?? 0,
    target_locator: seed.locator ?? null,
    exportable: seed.exportable ?? false,
    export_issue: seed.exportIssue ?? "",
  };
}

export function dedupeFields(fields: FormField[]): FormField[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.page_index}:${field.label.toLowerCase()}:${field.field_type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function splitMultiSelectAnswer(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}
