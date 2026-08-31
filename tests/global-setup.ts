// Compiles src/** once per test run into a scratch directory so that the
// multi-process fencing and append tests can spawn the real compiled shell
// (dist/shell/gateway-cli.js) as separate Node processes. The compiled tree is
// the same code the tests import in-process; nothing is re-implemented here.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    compiledDist: string;
  }
}

export default function setup(project: TestProject): () => void {
  const outDir = mkdtempSync(path.join(tmpdir(), "gbt-compiled-"));
  const require = createRequire(import.meta.url);
  const tsc = require.resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json", "--outDir", outDir, "--declaration", "false", "--sourceMap", "false"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`global setup could not compile src/** for the process tests:\n${result.stdout}${result.stderr}`);
  }
  project.provide("compiledDist", outDir);
  return () => { rmSync(outDir, { recursive: true, force: true }); };
}
