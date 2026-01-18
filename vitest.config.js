import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.ts"],
    exclude: ["tests/setup.ts", "tests/clarigen-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    singleThread: true,
    hookTimeout: 120000,
    testTimeout: 120000,
    isolate: false,
    coverage: {
      enabled: false, // Enable with --coverage flag
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["tests/**/*.ts"],
      exclude: [
        "tests/setup.ts",
        "tests/clarigen-setup.ts",
        "node_modules/**",
        "**/*.config.*",
      ],
      reportsDirectory: "./coverage",
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
});
