// The only module that touches the journal file. It is imported by the
// mutation gateway alone (checked by tests/g12-fencing.spec.ts); every append
// therefore passes the gateway's authorization first. Appends are fsynced.
// A torn tail (unterminated last line) is copied byte-for-byte into the
// quarantine directory and the file is cut back to the last complete line —
// the torn fragment was never an entry, complete history is never rewritten.
import { closeSync, fsyncSync, openSync, readFileSync, truncateSync, writeSync } from "node:fs";
import path from "node:path";
import { parseJournalText } from "../core/journal.js";
import type { ParsedJournal } from "../core/journal.js";
import type { StatePaths } from "./state-dir.js";

export interface JournalFile {
  readonly parsed: ParsedJournal;
  /** Bytes after the last newline, or null when the file ends on a line boundary. */
  readonly tornBytes: Buffer | null;
  readonly completeByteLength: number;
}

export function readJournalFile(paths: StatePaths): JournalFile {
  let bytes: Buffer;
  try {
    bytes = readFileSync(paths.journal);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { parsed: { entries: [], torn: null, corrupt: [] }, tornBytes: null, completeByteLength: 0 };
    }
    throw error;
  }
  const lastNewline = bytes.lastIndexOf(0x0a);
  const completeByteLength = lastNewline + 1;
  const complete = bytes.subarray(0, completeByteLength);
  const torn = bytes.subarray(completeByteLength);
  return {
    parsed: parseJournalText(complete.toString("utf8")),
    tornBytes: torn.length === 0 ? null : Buffer.from(torn),
    completeByteLength,
  };
}

/** Preserves the torn bytes in quarantine, then cuts the journal back to its last complete line. Returns the quarantine file. */
export function quarantineTornTail(paths: StatePaths, file: JournalFile, nowMs: number): string | null {
  if (file.tornBytes === null) return null;
  const target = path.join(paths.quarantineDir, `torn-${String(nowMs)}-${String(file.parsed.entries.length + 1)}.bin`);
  const descriptor = openSync(target, "wx");
  try {
    writeSync(descriptor, file.tornBytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  truncateSync(paths.journal, file.completeByteLength);
  return target;
}

export function appendJournalLine(paths: StatePaths, line: string): void {
  const descriptor = openSync(paths.journal, "a");
  try {
    writeSync(descriptor, line, null, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
