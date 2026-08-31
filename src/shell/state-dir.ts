// STATE_DIR resolution (§0, S-G12-07, S-CYC-11): an absolute, existing,
// writable directory that every instance on the host resolves identically.
// All durable P2 state lives here: the journal, the halt flag, the epoch
// store, the writer holder record, the short-lived mutex, and the quarantine.
import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import path from "node:path";

export interface StatePaths {
  readonly root: string;
  readonly journal: string;
  readonly halt: string;
  readonly epoch: string;
  readonly holder: string;
  readonly mutex: string;
  readonly quarantineDir: string;
}

export type StateDirResolution = { readonly ok: true; readonly value: StatePaths } | { readonly ok: false; readonly reason: "CONFIG_INVALID_STATE_DIR"; readonly detail: string };

export function resolveStateDir(raw: string): StateDirResolution {
  if (typeof raw !== "string" || raw.trim().length === 0 || !path.isAbsolute(raw)) {
    return { ok: false, reason: "CONFIG_INVALID_STATE_DIR", detail: "STATE_DIR must be an absolute path literal" };
  }
  const root = path.resolve(raw);
  try {
    if (!statSync(root).isDirectory()) return { ok: false, reason: "CONFIG_INVALID_STATE_DIR", detail: "STATE_DIR is not a directory" };
    accessSync(root, constants.W_OK | constants.R_OK);
    const quarantineDir = path.join(root, "quarantine");
    mkdirSync(quarantineDir, { recursive: true });
    return {
      ok: true,
      value: {
        root,
        journal: path.join(root, "journal.jsonl"),
        halt: path.join(root, "halt.json"),
        epoch: path.join(root, "epoch.json"),
        holder: path.join(root, "holder.json"),
        mutex: path.join(root, "writer.mutex"),
        quarantineDir,
      },
    };
  } catch (error) {
    return { ok: false, reason: "CONFIG_INVALID_STATE_DIR", detail: error instanceof Error ? error.message : String(error) };
  }
}
