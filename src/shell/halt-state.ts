// The persisted halt flag (S-G12-05): a file in STATE_DIR, written only as
// the projection of a halt or un-halt entry that passed the gateway, and read by
// the shell into the snapshot the core receives. The core never reads it.
// An unreadable or malformed flag counts as halted (fail closed).
import { readFileSync } from "node:fs";
import { notHalted } from "../core/journal.js";
import type { HaltState } from "../core/journal.js";
import { writeJsonAtomically } from "./epoch-store.js";
import type { StatePaths } from "./state-dir.js";

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
