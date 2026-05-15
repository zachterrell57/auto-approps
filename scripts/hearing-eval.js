#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { command: argv[2] ?? "run", dataset: "golden-hearings", mode: "full" };
  for (let idx = 3; idx < argv.length; idx++) {
    if (argv[idx] === "--dataset") args.dataset = argv[++idx];
    if (argv[idx] === "--mode") args.mode = argv[++idx];
  }
  return args;
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^\w\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function billVariants(value) {
  const match = String(value).match(
    /\b(H\.?\s*R\.?|S\.|H\.?\s*Res\.?|S\.?\s*Res\.?|H\.?\s*J\.?\s*Res\.?|S\.?\s*J\.?\s*Res\.?)\s*(\d{1,5})\b/i,
  );
  if (!match) return [];
  const prefix = match[1].toUpperCase().replace(/\s+/g, "").replace(/\./g, "");
  const number = match[2];
  return [match[0], `${prefix} ${number}`, `${prefix}${number}`].map(normalize);
}

function matches(text, item) {
  const normalizedText = normalize(text);
  const terms = [item.label, ...(item.aliases ?? [])];
  for (const term of terms) {
    const normalizedTerm = normalize(term);
    const variants = [normalizedTerm, ...billVariants(term)];
    if (variants.some((variant) => variant && normalizedText.includes(variant))) {
      return true;
    }
    if (item.match_mode === "semantic" || item.match_mode === "hybrid") {
      const words = normalizedTerm.split(" ").filter((word) => word.length > 3);
      if (words.length >= 2) {
        const overlap = words.filter((word) => normalizedText.includes(word)).length / words.length;
        if (overlap >= 0.75) return true;
      }
    }
  }
  return false;
}

function detect(caseData) {
  const hits = [];
  for (const item of caseData.watch_items) {
    for (const segment of caseData.transcript_segments) {
      const negative = (item.negative_filters ?? []).some((filter) =>
        normalize(segment.text).includes(normalize(filter)),
      );
      if (!negative && matches(segment.text, item)) {
        hits.push({
          watch_item_id: item.id,
          segment_id: segment.id,
        });
      }
    }
  }
  return hits;
}

function f1(precision, recall) {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function evaluate(dataset, mode) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let billCorrect = 0;
  let billTotal = 0;
  let citationFailures = 0;
  let exportTemplateFailures = 0;

  for (const caseData of dataset.cases) {
    if (mode !== "full" && caseData.modes && !caseData.modes.includes(mode)) continue;
    const detected = detect(caseData);
    const expected = new Set(
      caseData.expected_hits.map((hit) => `${hit.watch_item_id}:${hit.segment_id}`),
    );
    const actual = new Set(detected.map((hit) => `${hit.watch_item_id}:${hit.segment_id}`));
    for (const hit of actual) {
      if (expected.has(hit)) tp += 1;
      else fp += 1;
    }
    for (const hit of expected) {
      if (!actual.has(hit)) fn += 1;
    }
    for (const bill of caseData.expected_bill_normalizations ?? []) {
      billTotal += 1;
      const variants = billVariants(bill.raw);
      if (variants.includes(normalize(bill.normalized))) billCorrect += 1;
    }
    for (const claim of caseData.expected_claims ?? []) {
      if (!claim.supporting_segment_ids || claim.supporting_segment_ids.length === 0) {
        citationFailures += 1;
      }
    }
    for (const format of ["markdown", "docx", "pdf", "csv", "json"]) {
      if (!(caseData.expected_exports ?? []).includes(format)) {
        exportTemplateFailures += 1;
      }
    }
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const billAccuracy = billTotal === 0 ? 1 : billCorrect / billTotal;
  const metrics = {
    cases: dataset.cases.length,
    precision,
    recall,
    f1: f1(precision, recall),
    bill_normalization_accuracy: billAccuracy,
    citation_failures: citationFailures,
    export_template_failures: exportTemplateFailures,
  };
  const pass =
    recall >= 0.95 &&
    precision >= 0.9 &&
    billAccuracy >= 0.95 &&
    citationFailures === 0 &&
    exportTemplateFailures === 0;
  return { pass, metrics };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.command !== "run") {
    console.error(`Unsupported command: ${args.command}`);
    process.exit(2);
  }
  const datasetPath = path.join(ROOT, "docs", args.dataset, "dataset.json");
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    process.exit(2);
  }
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const report = evaluate(dataset, args.mode);
  const reportsDir = path.join(ROOT, "out", "hearing-eval");
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${args.dataset}-${args.mode}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
  if (!report.pass) process.exit(1);
}

main();
