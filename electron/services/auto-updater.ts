import { app, autoUpdater, BrowserWindow } from "electron";
import http from "node:http";
import type { AddressInfo } from "node:net";
import packageJson from "../../package.json";
import { UPDATE_STATUS } from "../ipc-channels.js";

export type UpdateStatusPayload = {
  status: "checking" | "available" | "downloaded" | "not-available" | "error";
  releaseName?: string;
  error?: string;
};

type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GithubRelease = {
  name?: string;
  tag_name: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: GithubReleaseAsset[];
};

type JsonFeedResponse = {
  name: string;
  notes?: string;
  pub_date?: string;
  url: string;
};

const DARWIN_ZIP_PATTERN = /.*-(mac|darwin|osx).*\.zip$/i;
const DARWIN_ARM64_PATTERN = /-arm64/i;
const DARWIN_UNIVERSAL_PATTERN = /-universal/i;
const STARTUP_UPDATE_DELAY_MS = 5_000;
const BACKGROUND_UPDATE_INTERVAL_MS = 10 * 60 * 1_000;

const updaterState: {
  feedServer: http.Server | null;
  feedUrl: string | null;
  latestReleaseName?: string;
  startupCheckTimer: ReturnType<typeof setTimeout> | null;
  periodicCheckTimer: ReturnType<typeof setInterval> | null;
} = {
  feedServer: null,
  feedUrl: null,
  startupCheckTimer: null,
  periodicCheckTimer: null,
};

const broadcast = (payload: UpdateStatusPayload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(UPDATE_STATUS, payload);
    }
  }
};

/**
 * Initialise the auto-updater. Call once after the app is ready.
 * In dev mode (`!app.isPackaged`) we keep the handlers wired but skip feed setup.
 */
export async function initAutoUpdater(): Promise<void> {
  autoUpdater.on("checking-for-update", () => {
    broadcast({ status: "checking" });
  });

  autoUpdater.on("update-available", () => {
    broadcast({
      status: "available",
      releaseName: updaterState.latestReleaseName,
    });
  });

  autoUpdater.on("update-not-available", () => {
    broadcast({ status: "not-available" });
  });

  autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
    broadcast({
      status: "downloaded",
      releaseName: releaseName || updaterState.latestReleaseName,
    });
  });

  autoUpdater.on("error", (err) => {
    broadcast({ status: "error", error: err?.message });
  });

  if (!app.isPackaged || process.platform !== "darwin") {
    return;
  }

  const feedUrl = await ensureLocalUpdateFeed();
  autoUpdater.setFeedURL({
    url: feedUrl,
    serverType: "json",
  });

  scheduleBackgroundUpdateChecks();
}

async function ensureLocalUpdateFeed(): Promise<string> {
  if (updaterState.feedUrl) {
    return updaterState.feedUrl;
  }

  const server = http.createServer((req, res) => {
    void handleUpdateFeedRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  server.unref();
  updaterState.feedServer = server;

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local update feed did not expose a TCP port");
  }

  updaterState.feedUrl = `http://127.0.0.1:${(address as AddressInfo).port}/update`;
  app.once("will-quit", () => {
    updaterState.feedServer?.close();
    updaterState.feedServer = null;
    updaterState.feedUrl = null;
    if (updaterState.startupCheckTimer) {
      clearTimeout(updaterState.startupCheckTimer);
      updaterState.startupCheckTimer = null;
    }
    if (updaterState.periodicCheckTimer) {
      clearInterval(updaterState.periodicCheckTimer);
      updaterState.periodicCheckTimer = null;
    }
  });

  return updaterState.feedUrl;
}

async function handleUpdateFeedRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname !== "/update") {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  try {
    const latest = await getLatestReleaseForCurrentPlatform();
    if (!latest) {
      updaterState.latestReleaseName = undefined;
      res.statusCode = 204;
      res.end();
      return;
    }

    updaterState.latestReleaseName = latest.name;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(latest));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.statusCode = 500;
    res.end(message);
  }
}

async function getLatestReleaseForCurrentPlatform(): Promise<JsonFeedResponse | null> {
  const repository = resolveRepository();
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/releases?per_page=20`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `${packageJson.name}/${packageJson.version}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub releases request failed (${response.status})`);
  }

  const releases = (await response.json()) as GithubRelease[];
  const currentVersion = parseVersion(app.getVersion());
  if (!currentVersion) {
    throw new Error(`Invalid app version: ${app.getVersion()}`);
  }

  const nextRelease = releases
    .filter((release) => !release.draft && !release.prerelease)
    .filter((release) => parseVersion(release.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
    .find((release) => {
      const releaseVersion = parseVersion(release.tag_name);
      return (
        !!releaseVersion &&
        compareParsedVersions(releaseVersion, currentVersion) > 0 &&
        !!getAssetForCurrentPlatform(release.assets)
      );
    });

  if (!nextRelease) {
    return null;
  }

  const asset = getAssetForCurrentPlatform(nextRelease.assets);
  if (!asset) {
    return null;
  }

  return {
    name: nextRelease.name || nextRelease.tag_name,
    notes: nextRelease.body,
    url: asset.browser_download_url,
  };
}

function resolveRepository(): { owner: string; repo: string } {
  const repositoryField = packageJson.repository as
    | string
    | { url?: string }
    | undefined;
  const repositoryUrl =
    typeof repositoryField === "string"
      ? repositoryField
      : repositoryField?.url;

  if (!repositoryUrl) {
    throw new Error("package.json is missing a repository URL");
  }

  const normalized = repositoryUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  const match =
    normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i) ??
    normalized.match(/^git@github\.com:([^/]+)\/([^/]+)$/i) ??
    normalized.match(/^([^/]+)\/([^/]+)$/i);

  if (!match) {
    throw new Error(`Unsupported repository URL: ${repositoryUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function scheduleBackgroundUpdateChecks(): void {
  if (!updaterState.startupCheckTimer) {
    updaterState.startupCheckTimer = setTimeout(() => {
      updaterState.startupCheckTimer = null;
      void runBackgroundUpdateCheck();
    }, STARTUP_UPDATE_DELAY_MS);
    updaterState.startupCheckTimer.unref();
  }

  if (!updaterState.periodicCheckTimer) {
    updaterState.periodicCheckTimer = setInterval(() => {
      void runBackgroundUpdateCheck();
    }, BACKGROUND_UPDATE_INTERVAL_MS);
    updaterState.periodicCheckTimer.unref();
  }
}

async function runBackgroundUpdateCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("Background update check failed", error);
  }
}

function getAssetForCurrentPlatform(
  assets: GithubReleaseAsset[],
): GithubReleaseAsset | null {
  if (process.platform !== "darwin") {
    return null;
  }

  const darwinAssets = assets.filter((asset) => DARWIN_ZIP_PATTERN.test(asset.name));
  if (process.arch === "arm64") {
    return (
      darwinAssets.find((asset) => DARWIN_ARM64_PATTERN.test(asset.name)) ??
      darwinAssets.find((asset) => DARWIN_UNIVERSAL_PATTERN.test(asset.name)) ??
      null
    );
  }

  if (process.arch === "x64") {
    return (
      darwinAssets.find(
        (asset) =>
          !DARWIN_ARM64_PATTERN.test(asset.name) &&
          !DARWIN_UNIVERSAL_PATTERN.test(asset.name),
      ) ??
      darwinAssets.find((asset) => DARWIN_UNIVERSAL_PATTERN.test(asset.name)) ??
      null
    );
  }

  return null;
}

function compareVersions(left: string, right: string): number {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);

  if (!leftParsed && !rightParsed) return 0;
  if (!leftParsed) return -1;
  if (!rightParsed) return 1;

  return compareParsedVersions(leftParsed, rightParsed);
}

function compareParsedVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }

  return 0;
}

function parseVersion(
  input: string,
): readonly [number, number, number] | null {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ] as const;
}
