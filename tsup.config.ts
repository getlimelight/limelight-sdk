import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [],
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
