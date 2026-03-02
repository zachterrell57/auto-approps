// ---------------------------------------------------------------------------
// Form Provider detection
// ---------------------------------------------------------------------------

export type FormProvider = "google" | "microsoft" | "generic";

/**
 * Detect the form provider from a URL.
 * Falls back to "generic" for unrecognised domains.
 */
export function detectProvider(url: string): FormProvider {
  if (url.includes("google.com/forms")) {
    return "google";
  }
  if (url.includes("forms.office.com") || url.includes("forms.microsoft.com")) {
    return "microsoft";
  }
  return "generic";
}
