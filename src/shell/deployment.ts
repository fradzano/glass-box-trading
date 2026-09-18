// Where this deployment's state directories are, read from one declared place.
//
// They used to be derived: the activation climbed from the repository's own
// location to the state tree with two `dirname` calls where three were needed,
// which put every long-run read one directory beside the truth. Because the host
// ports map a missing directory to a *known empty* listing rather than to
// unknown, the contamination assertion of spec step 2 then passed over a
// directory that does not exist, and the wrapper-log reads that gate condition
// "step 9 satisfied" depends on could never see a firing. A path to data is a
// fact about the host; deriving it from where the code sits is what allowed the
// two to disagree without anyone noticing, and the test fixtures could not catch
// it because they supplied the correct path themselves.
//
// `config/*.json` is runtime-digest material, so the certificate binds which
// directories this deployment defends, and they cannot change afterwards
// without invalidating it — the same argument that put D-11.1's exception list
// inside the architecture gate rather than in a file beside it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { isCanonicalLocalRoot } from "./physical-path.js";

export interface DeploymentStateDirs {
  /** The competition long run's state directory: the one no certificate command may touch. */
  readonly longRunStateDir: string;
  /** The dev sandbox every certificate command runs against instead. */
  readonly devStateDir: string;
  /** Where the dev runtime's bootstrap diagnostics land. */
  readonly devDiagnosticSink: string;
}

const REQUIRED = ["longRunStateDir", "devStateDir", "devDiagnosticSink"] as const;

export function parseDeployment(raw: unknown, platform: NodeJS.Platform): DeploymentStateDirs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("config/deployment.json is not an object");
  const record = raw as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const key of REQUIRED) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) throw new Error(`config/deployment.json: ${key} must be a non-empty string`);
    if (!path.isAbsolute(value)) throw new Error(`config/deployment.json: ${key} must be an absolute path literal`);
    // The same rule the state root itself is held to, applied where the path is
    // declared rather than where it is first used: a network spelling names one
    // directory under more than one identity.
    if (!isCanonicalLocalRoot(value, platform)) throw new Error(`config/deployment.json: ${key} must be a drive-rooted local path`);
    values[key] = value;
  }
  const declared = values["longRunStateDir"] ?? "";
  const dev = values["devStateDir"] ?? "";
  // The whole point of the file is to tell these two apart. If a careless edit
  // ever made them equal, every certificate command would be refused and the
  // long run would be seeded by the dev runtime — so it is refused here instead.
  if (path.resolve(declared).toLowerCase() === path.resolve(dev).toLowerCase()) {
    throw new Error("config/deployment.json: longRunStateDir and devStateDir name the same directory");
  }
  return { longRunStateDir: declared, devStateDir: dev, devDiagnosticSink: values["devDiagnosticSink"] ?? "" };
}

export function loadDeployment(repoRoot: string, platform: NodeJS.Platform = process.platform): DeploymentStateDirs {
  return parseDeployment(JSON.parse(readFileSync(path.join(repoRoot, "config", "deployment.json"), "utf8")) as unknown, platform);
}
