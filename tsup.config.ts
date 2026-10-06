import { defineConfig } from "tsup";
import { getBasePath } from "./src/server/base-path.js";

const define = { __SILICONCODE_BASE_PATH__: JSON.stringify(getBasePath()) };

export default defineConfig([
  {
    define,
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
  },
  {
    define,
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist/cli",
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }",
    },
    platform: "node",
    noExternal: [/.*/],
    esbuildOptions(opts) {
      opts.external = [...(opts.external ?? []), "react-devtools-core"];
    },
  },
  {
    define,
    entry: { app: "dashboard/app.js", workbench: "dashboard/src/workbench.ts" },
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    target: "es2022",
    platform: "browser",
    outDir: "dashboard/dist",
    noExternal: [/.*/],
    splitting: false,
  },
]);
