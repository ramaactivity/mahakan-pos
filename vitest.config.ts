import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/features/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/types.ts", "**/*.d.ts", "**/index.ts"],
      // Global thresholds deferred to M18 testing pass (per docs/99-EXECUTION-PLAN.md §3).
      // Phase 1 target: 80% lines, 70% branches (per docs/09-TESTING-STRATEGY.md §1.2).
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
