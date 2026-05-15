const fs = require("fs");
const path = require("path");

function copyExecutable(source, target) {
  if (!source || !fs.existsSync(source)) {
    throw new Error(`Missing media tool binary: ${source || "(empty)"}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  if (process.platform !== "win32") {
    fs.chmodSync(target, 0o755);
  }
  console.log(`Prepared ${path.basename(target)} from ${source}`);
}

const root = path.resolve(__dirname, "..");
const targetDir = path.join(root, "media-tools");
const ytDlpConstants = require("yt-dlp-exec/src/constants");
const ffmpegPath = require("ffmpeg-static");

const ytDlpName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const ffmpegName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

console.log("Preparing bundled media tools into ./media-tools/ ...");
copyExecutable(ytDlpConstants.YOUTUBE_DL_PATH, path.join(targetDir, ytDlpName));
copyExecutable(ffmpegPath, path.join(targetDir, ffmpegName));
console.log("Media tools ready.");
