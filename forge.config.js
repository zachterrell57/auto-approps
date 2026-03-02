const { VitePlugin } = require("@electron-forge/plugin-vite");
const { MakerZIP } = require("@electron-forge/maker-zip");

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    asar: true,
    name: "AutoApprops",
  },
  makers: [new MakerZIP({})],
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
