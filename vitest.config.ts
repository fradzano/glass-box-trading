import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    include: ["tests/**/*.spec.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Runs in every test file: no test may reach the operator's live checks.
    setupFiles: ["tests/setup-no-live-endpoints.ts"],
  },
});
