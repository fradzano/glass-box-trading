// The activation's reader for `config/deployment.json`, the one place that says
// where this deployment's state directories are.
//
// It is a second reader rather than a shared import on purpose: `ops/` compiles
// and runs on its own and never imports from `src/`, and that boundary is worth
// more than the four lines it costs here. What must not diverge is the *fact*,
// and the fact now lives in one file that both sides read; the test in
// `tests/deployment-state.spec.ts` holds the two readers to the same answer.
//
// Before this existed the activation derived the path from the repository's own
// location and landed one directory beside the truth on every invocation.
import { readFileSync } from "node:fs";
import path from "node:path";

export interface DeploymentStateDirs {
  readonly longRunStateDir: string;
  readonly devStateDir: string;
  readonly devDiagnosticSink: string;
}

const REQUIRED = ["longRunStateDir", "devStateDir", "devDiagnosticSink"] as const;

export function parseDeploymentStateDirs(raw: unknown): DeploymentStateDirs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("config/deployment.json is not an object");
  const record = raw as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const key of REQUIRED) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) throw new Error(`config/deployment.json: ${key} must be a non-empty string`);
    if (!path.isAbsolute(value)) throw new Error(`config/deployment.json: ${key} must be an absolute path literal`);
    values[key] = value;
  }
  const longRun = values["longRunStateDir"] ?? "";
  const dev = values["devStateDir"] ?? "";
  if (path.resolve(longRun).toLowerCase() === path.resolve(dev).toLowerCase()) {
    throw new Error("config/deployment.json: longRunStateDir and devStateDir name the same directory");
  }
  return { longRunStateDir: longRun, devStateDir: dev, devDiagnosticSink: values["devDiagnosticSink"] ?? "" };
}

export function readDeploymentStateDirs(repoRoot: string): DeploymentStateDirs {
  return parseDeploymentStateDirs(JSON.parse(readFileSync(path.join(repoRoot, "config", "deployment.json"), "utf8")) as unknown);
}

export type DeploymentStateRead =
  | { readonly ok: true; readonly dirs: DeploymentStateDirs }
  | { readonly ok: false; readonly reason: string };

/**
 * The same read, as a value instead of a throw.
 *
 * `readDeploymentStateDirs` keeps throwing, because `parseDeploymentStateDirs` is tested
 * through it and a thrown message is the clearest thing to assert. But the CLI cannot use
 * a throw: it ran at module scope, above `main`'s reach, so a missing or malformed file
 * ended the process with a raw stack trace and **exit 1** — the code this CLI reserves for
 * "the attempt is over, teardown ran, the ledger says why", none of which had happened.
 * The caller needs to decide per command whether the fact is even required, and it cannot
 * decide anything about an exception that has already left the building.
 */
export function readDeploymentState(repoRoot: string): DeploymentStateRead {
  try {
    return { ok: true, dirs: readDeploymentStateDirs(repoRoot) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.replace(/^config\/deployment\.json: /u, "") : "could not be read" };
  }
}
