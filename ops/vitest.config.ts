// The activation's own test run. It lives beside the code rather than in the
// root configuration because nothing under ops/ may enter the certified runtime
// digest, and the root vitest.config.ts and package.json are digest material.
// It borrows the root's guard against live endpoints: no activation test may
// reach the operator's real checks either.
import path from "node:path";
import { defineConfig } from "vitest/config";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: REPO_ROOT,
  test: {
    include: ["ops/**/*.spec.ts"],
    setupFiles: ["tests/setup-no-live-endpoints.ts"],
  },
});
