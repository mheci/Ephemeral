import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/core/**/*.ts", "src/background/**/*.ts"],
      exclude: [
        "src/background/index.ts",
        "src/background/firefox-adapter.ts",
        "src/background/browser-adapter.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
    restoreMocks: true,
  },
});
