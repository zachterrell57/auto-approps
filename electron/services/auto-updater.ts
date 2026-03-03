import { autoUpdater, BrowserWindow } from "electron";
import { updateElectronApp } from "update-electron-app";
import { UPDATE_STATUS } from "../ipc-channels.js";

export type UpdateStatusPayload = {
  status: "checking" | "available" | "downloaded" | "not-available" | "error";
  releaseName?: string;
  error?: string;
};

/**
 * Initialise the auto-updater.  Call once after the app is ready.
 * In dev mode (`!app.isPackaged`) `updateElectronApp` no-ops internally.
 */
export function initAutoUpdater(): void {
  // Configure update-electron-app to check update.electronjs.org every
  // 10 minutes.  Disable its built-in native dialog — we push status to the
  // renderer and show an in-app banner instead.
  updateElectronApp({
    updateInterval: "10 minutes",
    notifyUser: false,
  });

  // Forward autoUpdater events to every open renderer via IPC.
  // We resolve the window list at send-time so that windows reopened via
  // app.on("activate") on macOS still receive events.
  const broadcast = (payload: UpdateStatusPayload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(UPDATE_STATUS, payload);
      }
    }
  };

  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", () => {
    broadcast({ status: "available" });
  });

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "not-available" });
  });

  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    broadcast({ status: "downloaded", releaseName: releaseName || undefined });
  });

  autoUpdater.on("error", (err) => {
    broadcast({ status: "error", error: err?.message });
  });
}
