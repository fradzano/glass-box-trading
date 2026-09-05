// STATE_DIR resolution (§0, S-G12-07, S-CYC-11): an absolute, existing,
// writable directory that every instance on the host resolves identically.
// All durable P2 state lives here: the journal, the halt flag, the epoch
// store, the writer holder record, and the quarantine. The kernel mutex is
// named from `root` but is deliberately not a durable file.
import { accessSync, closeSync, constants, existsSync, mkdirSync, openSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface StatePaths {
  readonly root: string;
  readonly journal: string;
  readonly halt: string;
  readonly epoch: string;
  readonly holder: string;
  readonly quarantineDir: string;
}

export type StateDirResolution = { readonly ok: true; readonly value: StatePaths } | { readonly ok: false; readonly reason: "CONFIG_INVALID_STATE_DIR"; readonly detail: string };

/**
 * S-G12-08 / R43-B1: can this deployment still record what it decides?
 *
 * `resolveStateDir` checks the DIRECTORY at startup, which does not catch a
 * journal or epoch file that is itself read-only or locked — and that is the
 * state in which a credential fence cannot be recorded at all. A gate found
 * the consequence: with both files read-only, an already-acquired writer kept
 * its authority, a 403 left no mark anywhere, and once the files became
 * writable again the next cycle traded with no human release.
 *
 * The answer is to refuse before the broker is touched rather than to invent a
 * fourth place to write. A cycle that cannot durably record a halt has no
 * business opening a position: it is checked once, at the start, and a failure
 * ends the invocation before any broker read or mutation.
 *
 * It writes nothing and truncates nothing: it opens each existing file
 * read-write and closes it again, which is what distinguishes a writable file
 * from a read-only one on Windows without changing a byte.
 */
export function probeStateDurability(paths: StatePaths): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  for (const [label, file] of [["journal", paths.journal], ["epoch store", paths.epoch], ["halt projection", paths.halt]] as const) {
    if (!existsSync(file)) continue;
    try {
      accessSync(file, constants.W_OK);
      // Opened read-write, never appended to and never truncated: this module
      // writes no file contents, which is what the S-G12-07 boundary asserts.
      closeSync(openSync(file, "r+"));
    } catch (error) {
      return { ok: false, reason: `${label} is not writable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  // The directory itself is checked at resolution time (`accessSync` below);
  // this probe writes nothing, which keeps state-dir.ts outside the set of
  // modules that may touch disk contents (S-G12-07's boundary test).
  try {
    accessSync(paths.root, constants.W_OK);
  } catch (error) {
    return { ok: false, reason: `state directory is not writable: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true };
}

export function resolveStateDir(raw: string): StateDirResolution {
  if (typeof raw !== "string" || raw.trim().length === 0 || !path.isAbsolute(raw)) {
    return { ok: false, reason: "CONFIG_INVALID_STATE_DIR", detail: "STATE_DIR must be an absolute path literal" };
  }
  const resolved = path.resolve(raw);
  try {
    if (!statSync(resolved).isDirectory()) return { ok: false, reason: "CONFIG_INVALID_STATE_DIR", detail: "STATE_DIR is not a directory" };
    // Durable paths and the mutex use physical filesystem identity, not an
    // accepted alias spelling (for example C:\x versus \\?\C:\x).
    const root = realpathSync.native(resolved);
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
        quarantineDir,
      },
    };
  } catch (error) {
    return { ok: false, reason: "CONFIG_INVALID_STATE_DIR", detail: error instanceof Error ? error.message : String(error) };
  }
}
