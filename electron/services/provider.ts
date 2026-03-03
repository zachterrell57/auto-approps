// ---------------------------------------------------------------------------
// Form Provider detection
// ---------------------------------------------------------------------------

export type FormProvider = "google" | "microsoft" | "generic";

function isMicrosoftFormsHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "forms.office.com" ||
    normalized.endsWith(".forms.office.com") ||
    normalized === "forms.microsoft.com" ||
    normalized.endsWith(".forms.microsoft.com") ||
    normalized === "forms.cloud.microsoft" ||
    normalized.endsWith(".forms.cloud.microsoft")
  );
}

/**
 * Detect the form provider from a URL.
 * Falls back to "generic" for unrecognised domains.
 */
export function detectProvider(url: string): FormProvider {
  let host = "";
  let pathname = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    const lower = url.toLowerCase();
    if (
      lower.includes("google.com/forms") ||
      lower.includes("forms.gle")
    ) {
      return "google";
    }
    if (
      lower.includes("forms.office.com") ||
      lower.includes("forms.microsoft.com") ||
      lower.includes("forms.cloud.microsoft")
    ) {
      return "microsoft";
    }
    return "generic";
  }

  if (
    host === "forms.gle" ||
    host === "docs.google.com" ||
    host.endsWith(".google.com")
  ) {
    if (host === "forms.gle") {
      return "google";
    }
    if (pathname.includes("/forms")) {
      return "google";
    }
  }

  if (host === "google.com" && pathname.includes("/forms")) {
    return "google";
  }

  if (isMicrosoftFormsHost(host)) {
    return "microsoft";
  }
  return "generic";
}
