import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [],
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
