import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom", // or 'happy-dom' for faster tests
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "__tests__/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/dist/**",
        "**/*.d.ts",
        "tsup.config.ts",
        "vitest.config.ts",
      ],
    },
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
