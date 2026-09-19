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
    // A large part of this suite is not unit tests: it spawns real PowerShell and real
    // node processes, takes a real file lock, and kills processes on purpose. Vitest's
    // 5 s default is a unit test's budget, and under load it was the *suite* that went
    // red rather than the code -- measured by a gate on 2026-09-20 as four of four
    // concurrent runs failing, every failure a 5 s timeout, across three files. A suite
    // that is red for reasons unrelated to the artefact makes every later red ambiguous,
    // and this suite is the only instrument this code has.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
