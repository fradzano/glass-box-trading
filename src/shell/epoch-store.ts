// Persisted epoch store, writer holder record, and the short-lived OS mutex
// (S-G12-07). The mutex only serializes local gateway and acquisition work;
// authority is decided by the pure core against the epoch the store holds.
// Writes are atomic: temp file, fsync, rename.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import type { EpochStoreState } from "../core/authority.js";
import type { StatePaths } from "./state-dir.js";

export interface HolderRecord {
  readonly holderId: string;
  readonly heartbeatAt: number;
}

function readJsonFile(file: string): { readonly kind: "absent" } | { readonly kind: "unreadable"; readonly detail: string } | { readonly kind: "value"; readonly value: unknown } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", detail: error instanceof Error ? error.message : String(error) };
  }
  try {
    return { kind: "value", value: JSON.parse(text) };
  } catch (error) {
    return { kind: "unreadable", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function writeJsonAtomically(file: string, value: unknown): void {
  const temporary = `${file}.${String(process.pid)}.tmp`;
  const descriptor = openSync(temporary, "w");
  try {
    writeSync(descriptor, JSON.stringify(value), null, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
}

export function readEpochStore(paths: StatePaths): EpochStoreState {
  const read = readJsonFile(paths.epoch);
  if (read.kind === "absent") return { kind: "absent" };
  if (read.kind === "unreadable") return { kind: "unreadable", detail: read.detail };
  const value = read.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "unreadable", detail: "epoch store is not a record" };
  const record = value as Record<string, unknown>;
  const epoch = record["epoch"];
  const holderId = record["holderId"];
  const acquiredAt = record["acquiredAt"];
  const seedPending = record["seedPending"];
  if (!Number.isSafeInteger(epoch) || (epoch as number) < 1 || typeof holderId !== "string" || typeof acquiredAt !== "string" || (seedPending !== undefined && typeof seedPending !== "boolean")) {
    return { kind: "unreadable", detail: "epoch store record is malformed" };
  }
  return { kind: "present", epoch: epoch as number, holderId, acquiredAt, seedPending: seedPending === true };
}

export function writeEpochStore(paths: StatePaths, record: { readonly epoch: number; readonly holderId: string; readonly acquiredAt: string; readonly seedPending: boolean }): void {
  writeJsonAtomically(paths.epoch, record);
}

export function readHolder(paths: StatePaths): HolderRecord | null {
  const read = readJsonFile(paths.holder);
  if (read.kind !== "value") return null;
  const value = read.value;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const holderId = record["holderId"];
  const heartbeatAt = record["heartbeatAt"];
  if (typeof holderId !== "string" || typeof heartbeatAt !== "number" || !Number.isFinite(heartbeatAt)) return null;
  return { holderId, heartbeatAt };
}

export function writeHolder(paths: StatePaths, record: HolderRecord): void {
  writeJsonAtomically(paths.holder, record);
}

export function removeHolder(paths: StatePaths): void {
  rmSync(paths.holder, { force: true });
}

const MUTEX_STALE_MS = 15_000;
const MUTEX_TIMEOUT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Exclusive-create mutex (`wx`): the OS guarantees that of concurrent
 * creators exactly one succeeds. A mutex older than MUTEX_STALE_MS belongs to
 * a crashed holder and is removed; the mutex is held only for the duration of
 * one gateway operation and is never an authority.
 */
export async function withMutex<T>(paths: StatePaths, work: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    let descriptor: number;
    try {
      descriptor = openSync(paths.mutex, "wx");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      try {
        const age = Date.now() - statSync(paths.mutex).mtimeMs;
        if (age > MUTEX_STALE_MS) unlinkSync(paths.mutex);
      } catch {
        // The mutex vanished between the checks; retry.
      }
      if (Date.now() - startedAt > MUTEX_TIMEOUT_MS) throw new Error("writer mutex timeout", { cause: error });
      await sleep(2 + Math.floor(Math.random() * 6));
      continue;
    }
    try {
      writeSync(descriptor, String(process.pid), null, "utf8");
    } finally {
      closeSync(descriptor);
    }
    try {
      return await work();
    } finally {
      rmSync(paths.mutex, { force: true });
    }
  }
}
