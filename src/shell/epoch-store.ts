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

const RENAME_RETRY_LIMIT = 40;
const RENAME_RETRY_PAUSE_MS = 5;

function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  // On Windows a rename over a file that another process is reading at that instant fails with EPERM/EBUSY/EACCES
  // (observed once by a blind reviewer in the five-process append test). The replacement is retried briefly; the
  // temp file is complete and fsynced, so a retry never exposes a partial record. Persistent failure still throws.
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temporary, file);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt >= RENAME_RETRY_LIMIT) throw error;
      pauseSync(RENAME_RETRY_PAUSE_MS);
    }
  }
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
  const resetPending = record["resetPending"];
  if (!Number.isSafeInteger(epoch) || (epoch as number) < 1 || typeof holderId !== "string" || typeof acquiredAt !== "string"
    || (seedPending !== undefined && typeof seedPending !== "boolean") || (resetPending !== undefined && typeof resetPending !== "boolean")) {
    return { kind: "unreadable", detail: "epoch store record is malformed" };
  }
  return { kind: "present", epoch: epoch as number, holderId, acquiredAt, seedPending: seedPending === true, resetPending: resetPending === true };
}

export function writeEpochStore(paths: StatePaths, record: { readonly epoch: number; readonly holderId: string; readonly acquiredAt: string; readonly seedPending: boolean; readonly resetPending: boolean }): void {
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

/** Release only the caller's lease; a stale predecessor must never delete a successor's holder record. */
export async function releaseHolder(paths: StatePaths, holderId: string): Promise<boolean> {
  return withMutex(paths, () => {
    const current = readHolder(paths);
    if (current === null || current.holderId !== holderId) return false;
    removeHolder(paths);
    return true;
  });
}

const MUTEX_STALE_MS = 15_000;
const MUTEX_TIMEOUT_MS = 75_000;
let mutexSequence = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Exclusive-create mutex (`wx`): the OS guarantees that of concurrent
 * creators exactly one succeeds. Age alone never proves abandonment: an old
 * mutex is removed only when its recorded process is no longer alive. The
 * token also prevents an earlier holder from deleting a successor's mutex.
 * The mutex is held only for one gateway operation and is never authority.
 */
export async function withMutex<T>(paths: StatePaths, work: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  const token = `${String(process.pid)}:${String(startedAt)}:${String(mutexSequence += 1)}`;
  for (;;) {
    let descriptor: number;
    try {
      descriptor = openSync(paths.mutex, "wx");
    } catch (error) {
      // EEXIST is the normal contention signal; on Windows a concurrent creator can also surface EPERM/EBUSY/EACCES
      // for the same file. All of them mean "held right now" and are retried until the timeout.
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      try {
        const age = Date.now() - statSync(paths.mutex).mtimeMs;
        if (age > MUTEX_STALE_MS) {
          const observed = readFileSync(paths.mutex, "utf8");
          const owner = mutexOwnerPid(observed);
          // A readable live owner is never fenced by elapsed time, even if its
          // broker I/O outlives the mtime. An unreadable abandoned record is
          // eligible only after the same stale-age bound.
          if ((owner === null || !processIsAlive(owner)) && readFileSync(paths.mutex, "utf8") === observed) unlinkSync(paths.mutex);
        }
      } catch {
        // The mutex vanished between the checks; retry.
      }
      if (Date.now() - startedAt > MUTEX_TIMEOUT_MS) throw new Error("writer mutex timeout", { cause: error });
      await sleep(2 + Math.floor(Math.random() * 6));
      continue;
    }
    try {
      writeSync(descriptor, JSON.stringify({ pid: process.pid, token }), null, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      return await work();
    } finally {
      try {
        const current = readFileSync(paths.mutex, "utf8");
        const parsed = JSON.parse(current) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && (parsed as Record<string, unknown>)["token"] === token) rmSync(paths.mutex, { force: true });
      } catch {
        // Missing/replaced mutex: never remove a path we can no longer prove is ours.
      }
    }
  }
}

function mutexOwnerPid(text: string): number | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const pid = (value as Record<string, unknown>)["pid"];
    return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    // Backward compatibility with the original plain-PID lock file.
    const pid = Number(text.trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "EPERM" || code === "EACCES";
  }
}
