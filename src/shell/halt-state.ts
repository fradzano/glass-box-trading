// The persisted halt flag (S-G12-05): a file in STATE_DIR, written only as
// the projection of a halt or un-halt entry that passed the gateway, and read by
// the shell into the snapshot the core receives. The core never reads it.
// An unreadable or malformed flag counts as halted (fail closed).
import { readFileSync } from "node:fs";
import { haltStateFrom, notHalted } from "../core/journal.js";
import type { HaltState } from "../core/journal.js";
import { writeJsonAtomically } from "./epoch-store.js";
import type { StatePaths } from "./state-dir.js";
import { readEpochStore } from "./epoch-store.js";
import { readJournalFile } from "./journal-store.js";

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
  // R46-A3: the journal is the authority and the projection is a cache of it.
  // Reading only the cache reported readiness SUCCESS over a real, journaled
  // `HALT KILL` whose projection write had failed -- and repeated success
  // pings suppress the external silence alarm too, so the one signal that
  // would have carried the stop was the one that said all-clear. The journal
  // is consulted first; the projection then only adds what the journal cannot
  // contradict.
  // R47: the journal is read ONCE. The halt state and the corruption check
  // each used to open and parse it, so every call paid for two full reads of a
  // file that reaches ~150 MiB by the end of a three-month run -- a gate
  // measured the pair at 1.5 s and 1.2 GiB of transient memory.
  const journal = journalState(paths);
  if (journal.halt !== null && journal.halt.halted) return { reason: journal.halt.reason ?? "UNKNOWN", fencePending };
  // Most specific first, so the operator is told the thing they must act on
  // rather than a symptom of it.
  if (persisted.halted) return { reason: persisted.reason ?? "UNKNOWN", fencePending };
  // fencePending can only be true for a present store, so the reason it
  // carries is readable here without another narrowing.
  if (fencePending) return { reason: store.fenceReason ?? "AUTH_FAILURE", fencePending: true };
  // R44-B6: an unreadable authority state used to read as "no fence", so a
  // corrupt epoch.json reported readiness SUCCESS while every acquisition
  // returned EPOCH_UNREADABLE. An ABSENT store is a different thing entirely
  // -- a virgin deployment -- and stays clear.
  if (store.kind === "unreadable") return { reason: "AUTHORITY_STATE_UNREADABLE", fencePending: false };
  // R44-B6: likewise a journal whose lines no longer parse. Every writer
  // refuses it with JOURNAL_CORRUPT, so reporting readiness over it would
  // report the opposite of the truth. This module only ever READS the journal;
  // appending stays inside the gateway (asserted in tests/g12-fencing).
  return journal.corruption === null ? null : { reason: `JOURNAL_CORRUPT:${journal.corruption}`, fencePending: false };
}

/**
 * What the JOURNAL says, from a single read: the halt state it asserts (null
 * when it does not parse) and the first line that does not parse (null when it
 * reads cleanly, or cannot be read at all -- an unreadable file is the
 * durability probe's finding, not this one). This module only ever reads the
 * journal; appending stays inside the gateway.
 */
function journalState(paths: StatePaths): { readonly halt: HaltState | null; readonly corruption: string | null } {
  try {
    const file = readJournalFile(paths);
    const first = file.parsed.corrupt[0];
    if (first !== undefined) return { halt: null, corruption: `line ${String(first.line)}` };
    return { halt: haltStateFrom(file.parsed.entries), corruption: null };
  } catch {
    return { halt: null, corruption: null };
  }
}
