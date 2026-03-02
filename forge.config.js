const path = require("path");
const { VitePlugin } = require("@electron-forge/plugin-vite");
const { MakerDMG } = require("@electron-forge/maker-dmg");
const { MakerZIP } = require("@electron-forge/maker-zip");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: {
      unpack: "**/{better-sqlite3,bindings,file-uri-to-path}/**",
    },
    name: "AutoApprops",
    icon: "assets/icon",
    appBundleId: "com.autoapprops.app",
    extraResource: ["./playwright-browsers"],
    ignore: [
      /^\/backend/,
      /^\/\.git/,
      /^\/scripts/,
      /^\/playwright-browsers/,
    ],
    osxSign: {
      optionsForFile: (filePath) => {
        const isApp = filePath.endsWith(".app");
        return {
          entitlements: path.resolve(
            __dirname,
            isApp ? "entitlements.plist" : "entitlements.child.plist"
          ),
          "entitlements-inherit": path.resolve(
            __dirname,
            "entitlements.child.plist"
          ),
        };
      },
    },
    ...(process.env.APPLE_ID && {
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      },
    }),
  },
  makers: [new MakerDMG({}), new MakerZIP({})],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "frontend/vite.config.ts",
        },
      ],
    }),
  ],
};
