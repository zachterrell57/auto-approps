import { autoUpdater, type BrowserWindow } from "electron";
import { updateElectronApp } from "update-electron-app";
import { UPDATE_STATUS } from "../ipc-channels.js";

export type UpdateStatusPayload = {
  status: "checking" | "available" | "downloaded" | "not-available" | "error";
  releaseName?: string;
  error?: string;
};

/**
 * Initialise the auto-updater.  Call once after the main BrowserWindow is
 * created.  In dev mode (`!app.isPackaged`) `updateElectronApp` noops
 * internally so no guard is needed here.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Configure update-electron-app to check update.electronjs.org every
  // 10 minutes.  Disable its built-in native dialog — we push status to the
  // renderer and show an in-app banner instead.
  updateElectronApp({
    updateInterval: "10 minutes",
    notifyUser: false,
  });

  // Forward autoUpdater events to the renderer via IPC.
  const send = (payload: UpdateStatusPayload) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(UPDATE_STATUS, payload);
    }
  };

  autoUpdater.on("checking-for-update", () => {
    send({ status: "checking" });
  });

  autoUpdater.on("update-available", () => {
    send({ status: "available" });
  });

  autoUpdater.on("update-not-available", () => {
    send({ status: "not-available" });
  });

  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    send({ status: "downloaded", releaseName: releaseName || undefined });
  });

  autoUpdater.on("error", (err) => {
    send({ status: "error", error: err?.message });
  });
}
