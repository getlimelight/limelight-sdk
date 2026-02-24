import { defineConfig } from "tsup";
import { config } from "dotenv";
import pkg from "./package.json";

config();

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["http", "https", "node:http", "node:https"],
  banner: {
    js: [
      "// Bridge Node CJS require to globalThis so runtime dynamic requires work",
      "// in environments like ts-node where require is module-scoped only.",
      "// In ESM or browser contexts typeof require is 'undefined', so this is a no-op.",
      'if (typeof require === "function" && typeof globalThis !== "undefined" && typeof globalThis.require === "undefined" && typeof process !== "undefined" && process.versions && process.versions.node) { Object.defineProperty(globalThis, "require", { value: require, configurable: true, writable: true, enumerable: false }); }',
    ].join("\n"),
  },
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
    __POSTHOG_API_KEY__: JSON.stringify(process.env.POSTHOG_API_KEY || ""),
    __POSTHOG_HOST__: JSON.stringify(process.env.POSTHOG_HOST || ""),
  },
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
