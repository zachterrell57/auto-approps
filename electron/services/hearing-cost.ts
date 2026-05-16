export interface ProviderCostComponent {
  provider: string;
  service: string;
  model: string;
  cost_usd: number | null;
  usage: unknown;
  unavailable_reason?: string;
}

export interface ProviderUsageRecord extends ProviderCostComponent {
  provider_cost_fields?: Record<string, unknown>;
  recorded_at?: string;
}

export interface HearingProviderCostSummary {
  cost_source: "provider_usage";
  estimated: false;
  known_total_usd: number | null;
  currency: "USD";
  components: ProviderCostComponent[];
  has_unknown_components: boolean;
}

const DIRECT_COST_KEYS = [
  "cost_usd",
  "total_cost_usd",
  "amount_usd",
  "usd",
] as const;

const PRESERVED_COST_KEYS = [
  "cost",
  "costs",
  "cost_usd",
  "total_cost_usd",
  "amount_usd",
  "billing",
] as const;

const PRESERVED_USAGE_KEYS = [
  "usage",
  "duration",
  "duration_seconds",
  "input_tokens",
  "output_tokens",
  "total_tokens",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteUsd(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function currencyIsUsd(value: unknown): boolean {
  return typeof value !== "string" || value.trim().toUpperCase() === "USD";
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function providerReportedCostUsd(fields: Record<string, unknown>): number | null {
  for (const key of DIRECT_COST_KEYS) {
    const cost = finiteUsd(fields[key]);
    if (cost !== null) return cost;
  }

  for (const key of ["cost", "billing"] as const) {
    const nested = asRecord(fields[key]);
    if (!nested || !currencyIsUsd(nested.currency)) continue;
    for (const nestedKey of ["amount_usd", "cost_usd", "total_cost_usd", "amount"] as const) {
      const cost = finiteUsd(nested[nestedKey]);
      if (cost !== null) return cost;
    }
  }

  if (Array.isArray(fields.costs)) {
    const costs = fields.costs
      .map((entry) => {
        const record = asRecord(entry);
        if (!record || !currencyIsUsd(record.currency)) return null;
        return providerReportedCostUsd(record);
      })
      .filter((cost): cost is number => cost !== null);
    if (costs.length > 0) {
      return roundUsd(costs.reduce((sum, cost) => sum + cost, 0));
    }
  }

  return null;
}

export function providerUsageAndCostFields(raw: Record<string, unknown>): {
  usage: unknown;
  costFields: Record<string, unknown>;
  costUsd: number | null;
} {
  const usageFields: Record<string, unknown> = {};
  for (const key of PRESERVED_USAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      usageFields[key] = raw[key];
    }
  }

  const costFields: Record<string, unknown> = {};
  for (const key of PRESERVED_COST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      costFields[key] = raw[key];
    }
  }

  return {
    usage:
      Object.keys(usageFields).length === 1 &&
      Object.prototype.hasOwnProperty.call(usageFields, "usage")
        ? usageFields.usage
        : Object.keys(usageFields).length > 0
          ? usageFields
          : null,
    costFields,
    costUsd: providerReportedCostUsd(raw),
  };
}

function componentFromRecord(value: unknown): ProviderUsageRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const provider = typeof record.provider === "string" ? record.provider : "";
  const service = typeof record.service === "string" ? record.service : "";
  const model = typeof record.model === "string" ? record.model : "";
  if (!provider || !service || !model) return null;
  const unavailableReason =
    typeof record.unavailable_reason === "string" ? record.unavailable_reason : undefined;
  const providerCostFields = asRecord(record.provider_cost_fields) ?? undefined;
  return {
    provider,
    service,
    model,
    cost_usd: finiteUsd(record.cost_usd),
    usage: record.usage ?? null,
    ...(unavailableReason ? { unavailable_reason: unavailableReason } : {}),
    ...(providerCostFields ? { provider_cost_fields: providerCostFields } : {}),
    ...(typeof record.recorded_at === "string" ? { recorded_at: record.recorded_at } : {}),
  };
}

export function transcriptionComponentFromMetadata(
  metadata: Record<string, unknown>,
): ProviderCostComponent | null {
  const providerUsage = asRecord(metadata.provider_usage);
  const transcription = asRecord(providerUsage?.transcription);
  const records = Array.isArray(transcription?.records)
    ? transcription.records
        .map((record) => componentFromRecord(record))
        .filter((record): record is ProviderUsageRecord => Boolean(record))
    : [];
  if (records.length === 0) return null;

  const knownCosts = records
    .map((record) => finiteUsd(record.cost_usd))
    .filter((cost): cost is number => cost !== null);
  const hasUnknownCost = knownCosts.length < records.length;
  const models = Array.from(new Set(records.map((record) => record.model)));
  return {
    provider: records[0]?.provider ?? "openai",
    service: "transcription",
    model: models.length === 1 ? models[0] : "multiple",
    cost_usd:
      knownCosts.length > 0
        ? roundUsd(knownCosts.reduce((sum, cost) => sum + cost, 0))
        : null,
    usage: {
      chunk_count: records.length,
      records: records.map((record) => ({
        model: record.model,
        usage: record.usage,
        cost_usd: record.cost_usd,
        ...(record.provider_cost_fields
          ? { provider_cost_fields: record.provider_cost_fields }
          : {}),
        ...(record.recorded_at ? { recorded_at: record.recorded_at } : {}),
      })),
    },
    ...(hasUnknownCost ? { unavailable_reason: "transcription unavailable" } : {}),
  };
}

export function buildProviderCostSummary(
  components: Array<ProviderCostComponent | null | undefined>,
): HearingProviderCostSummary {
  const normalized = components
    .filter((component): component is ProviderCostComponent => Boolean(component))
    .map((component) => ({
      ...component,
      cost_usd: finiteUsd(component.cost_usd),
    }));
  const knownCosts = normalized
    .map((component) => finiteUsd(component.cost_usd))
    .filter((cost): cost is number => cost !== null);

  return {
    cost_source: "provider_usage",
    estimated: false,
    known_total_usd:
      knownCosts.length > 0
        ? roundUsd(knownCosts.reduce((sum, cost) => sum + cost, 0))
        : null,
    currency: "USD",
    components: normalized,
    has_unknown_components: normalized.some(
      (component) => component.cost_usd === null || Boolean(component.unavailable_reason),
    ),
  };
}
