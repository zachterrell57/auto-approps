// ---------------------------------------------------------------------------
// playwright-env.ts — Set PLAYWRIGHT_BROWSERS_PATH before Playwright loads
//
// Playwright's internal Registry reads PLAYWRIGHT_BROWSERS_PATH at import
// time and caches resolved browser paths.  This module MUST be imported
// before any module that transitively imports `playwright` (e.g. the IPC
// handlers / form scrapers) so that the env-var is already present when
// Playwright initialises its registry.
// ---------------------------------------------------------------------------

import { app } from "electron";
import path from "node:path";

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    process.resourcesPath,
    "playwright-browsers",
  );
}
