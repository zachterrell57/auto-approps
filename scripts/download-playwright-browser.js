const { execSync } = require("child_process");

console.log("Downloading Playwright Chromium into ./playwright-browsers/ ...");
execSync("npx playwright install chromium", {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "./playwright-browsers" },
});
console.log("Playwright Chromium download complete.");
