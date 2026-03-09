import type { TargetSchema } from "./models.js";
import { detectProvider } from "./provider.js";
import { scrapeForm } from "./form-scraper.js";
import { scrapeGenericForm } from "./generic-form-scraper.js";
import { scrapeMsForm } from "./ms-form-scraper.js";
import { parseDocxQuestionnaire } from "./docx-questionnaire.js";
import { parsePdfQuestionnaire } from "./pdf-questionnaire.js";

function addTargetMetadata(schema: TargetSchema): TargetSchema {
  return {
    ...schema,
    target_title: schema.target_title || schema.title,
    target_provider: schema.target_provider || schema.provider,
    target_url: schema.target_url || schema.url,
    parse_warnings:
      schema.parse_warnings.length > 0
        ? schema.parse_warnings
        : schema.scrape_warnings,
    fields: schema.fields.map((field) => ({
      ...field,
      target_locator: field.target_locator ?? null,
      exportable: field.exportable ?? false,
      export_issue: field.export_issue ?? "",
    })),
  };
}

export async function prepareWebTarget(url: string): Promise<TargetSchema> {
  const provider = detectProvider(url);
  let schema: TargetSchema;
  if (provider === "microsoft") {
    schema = await scrapeMsForm(url);
  } else if (provider === "generic") {
    schema = await scrapeGenericForm(url);
  } else {
    schema = await scrapeForm(url);
    schema.provider = "google";
  }

  return addTargetMetadata({
    ...schema,
    target_kind: "web_form",
    target_url: schema.url || url,
    target_filename: null,
    target_title: schema.title,
    target_provider: schema.provider || provider,
    parse_warnings: schema.scrape_warnings ?? [],
    fields: schema.fields.map((field) => ({
      ...field,
      target_locator: null,
      exportable: false,
      export_issue: "",
    })),
  });
}

export async function prepareFileTarget(
  buffer: Buffer,
  filename: string,
): Promise<TargetSchema> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) {
    return addTargetMetadata(await parseDocxQuestionnaire(buffer, filename));
  }
  if (lower.endsWith(".pdf")) {
    return addTargetMetadata(await parsePdfQuestionnaire(buffer, filename));
  }
  throw new Error("Only .docx and .pdf questionnaire files are supported.");
}
