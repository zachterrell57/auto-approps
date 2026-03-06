import { app, BrowserWindow, nativeTheme } from "electron";
import path from "node:path";
import { setUserDataPath } from "./services/config.js";
import { readApiKey } from "./services/settings-store.js";
import { settings } from "./services/config.js";
import { initAutoUpdater } from "./services/auto-updater.js";

// When running as a packaged app, point Playwright at the bundled Chromium
// in Contents/Resources/playwright-browsers (macOS).
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    process.resourcesPath,
    "playwright-browsers",
  );
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

app.whenReady().then(async () => {
  // Initialize userData path before any store module is used
  setUserDataPath(app.getPath("userData"));

  // Load persisted API key into in-memory settings
  const savedKey = readApiKey();
  if (savedKey) {
    settings.anthropic_api_key = savedKey;
  }

  // Register all IPC handlers
  // Import lazily so Playwright resolves browser path after env is configured.
  const { registerIpcHandlers } = await import("./ipc-handlers.js");
  registerIpcHandlers();

  nativeTheme.themeSource = "light";

  createWindow();

  // Start auto-updater (no-ops in dev mode internally)
  initAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
