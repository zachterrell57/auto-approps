const os = require("os");
const path = require("path");
const fs = require("fs");

// Electron derives userData from the "name" field in package.json.
const appName = require("../package.json").name;

let userDataDir;
switch (process.platform) {
  case "darwin":
    userDataDir = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      appName,
    );
    break;
  case "win32":
    userDataDir = path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      appName,
    );
    break;
  default:
    // Linux / other
    userDataDir = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      appName,
    );
    break;
}

const dbFiles = ["sessions.db", "sessions.db-wal", "sessions.db-shm"];
let cleaned = false;

for (const file of dbFiles) {
  const filePath = path.join(userDataDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Cleaned: ${filePath}`);
    cleaned = true;
  }
}

if (cleaned) {
  console.log("Database cleaned for fresh build.");
} else {
  console.log("No database files found — already clean.");
}
