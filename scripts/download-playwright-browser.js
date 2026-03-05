const { execSync } = require("child_process");

const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "./playwright-browsers" };

console.log("Downloading Playwright Chromium into ./playwright-browsers/ ...");
execSync("npx playwright install chromium", { stdio: "inherit", env });

console.log("Downloading Playwright chrome-headless-shell into ./playwright-browsers/ ...");
execSync("npx playwright install chrome-headless-shell", { stdio: "inherit", env });

console.log("Playwright browser downloads complete.");
