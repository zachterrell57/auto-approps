interface ProviderCostComponent {
  provider: string;
  service: string;
  model: string;
  cost_usd: number | null;
  usage: unknown;
  unavailable_reason?: string;
}

interface ProviderCostSummary {
  cost_source: "provider_usage";
  estimated: false;
  known_total_usd: number | null;
  currency: "USD";
  components: ProviderCostComponent[];
  has_unknown_components: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteUsd(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readComponent(value: unknown): ProviderCostComponent | null {
  const record = asRecord(value);
  if (!record) return null;
  const provider = typeof record.provider === "string" ? record.provider : "";
  const service = typeof record.service === "string" ? record.service : "";
  const model = typeof record.model === "string" ? record.model : "";
  if (!provider || !service || !model) return null;
  const unavailableReason =
    typeof record.unavailable_reason === "string"
      ? record.unavailable_reason
      : undefined;
  return {
    provider,
    service,
    model,
    cost_usd: finiteUsd(record.cost_usd),
    usage: record.usage ?? null,
    ...(unavailableReason ? { unavailable_reason: unavailableReason } : {}),
  };
}

export function readProviderCostSummary(
  metadata: Record<string, unknown> | null | undefined,
): ProviderCostSummary | null {
  const summary = asRecord(metadata?.cost_summary);
  if (!summary || summary.cost_source !== "provider_usage") return null;
  const components = Array.isArray(summary.components)
    ? summary.components
        .map((component) => readComponent(component))
        .filter((component): component is ProviderCostComponent => Boolean(component))
    : [];
  return {
    cost_source: "provider_usage",
    estimated: false,
    known_total_usd:
      summary.known_total_usd === null ? null : finiteUsd(summary.known_total_usd),
    currency: "USD",
    components,
    has_unknown_components:
      typeof summary.has_unknown_components === "boolean"
        ? summary.has_unknown_components
        : components.some(
            (component) =>
              component.cost_usd === null || Boolean(component.unavailable_reason),
          ),
  };
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function unavailableLabel(component: ProviderCostComponent): string {
  if (component.unavailable_reason) return component.unavailable_reason;
  if (component.service === "transcription") return "transcription unavailable";
  if (component.service === "ai_generation") return "AI generation unavailable";
  return `${component.service.replaceAll("_", " ")} unavailable`;
}

export function hearingOutputCostLabel(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const summary = readProviderCostSummary(metadata);
  if (!summary || summary.known_total_usd === null) {
    return "Cost unavailable from providers";
  }
  if (!summary.has_unknown_components) {
    return `Cost: ${formatUsd(summary.known_total_usd)}`;
  }
  const unavailable = Array.from(
    new Set(
      summary.components
        .filter(
          (component) =>
            component.cost_usd === null || Boolean(component.unavailable_reason),
        )
        .map((component) => unavailableLabel(component)),
    ),
  );
  return `Known cost: ${formatUsd(summary.known_total_usd)}${
    unavailable.length > 0 ? ` · ${unavailable.join(" · ")}` : ""
  }`;
}
