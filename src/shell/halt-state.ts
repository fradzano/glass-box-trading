// The persisted halt flag (S-G12-05): a file in STATE_DIR, written only as
// the projection of a halt or un-halt entry that passed the gateway, and read by
// the shell into the snapshot the core receives. The core never reads it.
// An unreadable or malformed flag counts as halted (fail closed).
import { readFileSync } from "node:fs";
import { notHalted } from "../core/journal.js";
import type { HaltState } from "../core/journal.js";
import { writeJsonAtomically } from "./epoch-store.js";
import type { StatePaths } from "./state-dir.js";
import { readEpochStore } from "./epoch-store.js";

const UNREADABLE: HaltState = { halted: true, reason: "HALT_FLAG_UNREADABLE", sticky: false };

export function readHaltState(paths: StatePaths): HaltState {
  let text: string;
  try {
    text = readFileSync(paths.halt, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return notHalted();
    return UNREADABLE;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return UNREADABLE;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return UNREADABLE;
  const record = value as Record<string, unknown>;
  const halted = record["halted"];
  const reason = record["reason"];
  const sticky = record["sticky"];
  if (typeof halted !== "boolean" || (reason !== null && typeof reason !== "string") || typeof sticky !== "boolean") return UNREADABLE;
  return { halted, reason, sticky };
}

export function writeHaltState(paths: StatePaths, state: HaltState): void {
  writeJsonAtomically(paths.halt, state);
}

/**
 * S-G14-05 / A31: the standing impediment every process must report, whichever
 * process it is. A gate found the deadline one-shots sending a readiness
 * SUCCESS while a halt and an unreleased fence stood (R43-B5), which is exactly
 * the "another process heals a standing halt" case the axiom forbids. Reading
 * it in one place keeps the three runtimes from drifting apart again.
 */
export function standingImpediment(paths: StatePaths): { readonly reason: string; readonly fencePending: boolean } | null {
  const store = readEpochStore(paths);
  const fencePending = store.kind === "present" && store.fencePending;
  const persisted = readHaltState(paths);
  if (!persisted.halted && !fencePending) return null;
  return { reason: persisted.halted ? (persisted.reason ?? "UNKNOWN") : "AUTH_FAILURE", fencePending };
}
