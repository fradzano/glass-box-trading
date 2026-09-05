// Persisted epoch store, writer holder record, and the short-lived OS mutex
// (S-G12-07). The mutex only serializes local gateway and acquisition work;
// authority is decided by the pure core against the epoch the store holds.
// Writes are atomic: temp file, fsync, rename.
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import type { Server } from "node:net";
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
  const fencePending = record["fencePending"];
  const fenceReason = record["fenceReason"];
  if (!Number.isSafeInteger(epoch) || (epoch as number) < 1 || typeof holderId !== "string" || typeof acquiredAt !== "string"
    || (seedPending !== undefined && typeof seedPending !== "boolean") || (resetPending !== undefined && typeof resetPending !== "boolean")
    || (fencePending !== undefined && typeof fencePending !== "boolean")
    || (fenceReason !== undefined && fenceReason !== null && typeof fenceReason !== "string")) {
    return { kind: "unreadable", detail: "epoch store record is malformed" };
  }
  return { kind: "present", epoch: epoch as number, holderId, acquiredAt, seedPending: seedPending === true, resetPending: resetPending === true, fencePending: fencePending === true, fenceReason: typeof fenceReason === "string" ? fenceReason : null };
}

/**
 * S-G12-08 / R43-B2: an omitted `fencePending` is **inherited from the store on
 * disk**, never defaulted to false. Three call sites wrote the store for their
 * own reasons — acquisition, bootstrap promotion, reset completion — and any
 * one of them forgetting the field silently freed a fenced deployment; the
 * bootstrap path did exactly that, and a real cycle then opened a position with
 * no human release. Preservation belongs here, once, rather than in every
 * caller's memory. Clearing it is possible only by passing `false` explicitly,
 * which one function does: `setFencePending`.
 */
export function writeEpochStore(paths: StatePaths, record: { readonly epoch: number; readonly holderId: string; readonly acquiredAt: string; readonly seedPending: boolean; readonly resetPending: boolean; readonly fencePending?: boolean; readonly fenceReason?: string | null }): void {
  const inherited = record.fencePending === undefined || record.fenceReason === undefined ? readEpochStore(paths) : null;
  const standing = inherited !== null && inherited.kind === "present" ? inherited : null;
  const fencePending = record.fencePending === undefined ? (standing?.fencePending ?? false) : record.fencePending;
  // The reason travels with the mark: inherited when omitted, and dropped when
  // the mark itself is cleared, so a released deployment carries no stale
  // explanation of why it once stopped.
  const fenceReason = !fencePending ? null : (record.fenceReason === undefined ? (standing?.fenceReason ?? null) : record.fenceReason);
  writeJsonAtomically(paths.epoch, { ...record, fencePending, fenceReason });
}

/**
 * S-G12-08 / A30: set or clear the fence mark while preserving everything else
 * the store holds. The caller holds the gateway mutex; the write is atomic, and
 * a failure throws so the caller can treat an unrecordable fence as what it is.
 * An absent or unreadable store is NOT quietly created here — a deployment
 * without a readable epoch store has no authority anyway, which is the other
 * half of the guarantee.
 */
export function setFencePending(paths: StatePaths, pending: boolean, reason?: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const store = readEpochStore(paths);
  if (store.kind !== "present") return { ok: false, reason: `EPOCH_STORE_${store.kind.toUpperCase()}` };
  try {
    writeEpochStore(paths, { epoch: store.epoch, holderId: store.holderId, acquiredAt: store.acquiredAt, seedPending: store.seedPending, resetPending: store.resetPending, fencePending: pending, ...(reason === undefined ? {} : { fenceReason: reason }) });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/**
 * R44-B3: prove that bytes can actually be written and flushed into STATE_DIR.
 * `accessSync` and `open(file, "r+")` answer "are the permissions right",
 * which is a different question from "is there room": on a full volume both
 * succeed and the first real append fails with ENOSPC. The gate executed
 * exactly that -- metadata and open succeeded while `writeFileSync` threw
 * ENOSPC, and the probe returned ok.
 *
 * It lives here rather than in state-dir.ts because this module is one of the
 * declared writers (S-G12-07's boundary test); it writes a small sidecar next
 * to the durable state, fsyncs it -- an unflushed write can succeed against a
 * full disk and fail only at flush -- and removes it again. It never opens the
 * journal, the epoch store or the halt projection.
 */
export function probeDurableWrite(root: string): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const file = path.join(root, ".durability-probe");
  let handle: number;
  try {
    handle = openSync(file, "w");
  } catch (error) {
    return { ok: false, reason: `state directory does not accept a new file: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    writeSync(handle, "durability-probe");
    fsyncSync(handle);
  } catch (error) {
    return { ok: false, reason: `state directory does not accept written bytes: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    try { closeSync(handle); } catch { /* the write result is the finding, not the close */ }
    try { rmSync(file, { force: true }); } catch { /* a leftover probe file is harmless */ }
  }
  return { ok: true };
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Kernel-owned, single-host mutex. Windows named-pipe names and Linux abstract
 * sockets are exclusive while their server process lives and are released by
 * the OS on close or crash. There is therefore no stale-file deletion, lease
 * timeout, or recovery CAS window. The mutex serializes one gateway operation;
 * epoch fencing, not holding this endpoint, grants mutation authority.
 */
export async function withMutex<T>(paths: StatePaths, work: () => Promise<T> | T): Promise<T> {
  const endpoint = mutexEndpoint(paths);
  let server: Server;
  for (;;) {
    try {
      server = await listenMutex(endpoint);
      break;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "EADDRINUSE") throw error;
      await sleep(2 + Math.floor(Math.random() * 6));
    }
  }
  try {
    return await work();
  } finally {
    await closeMutex(server);
  }
}

function mutexEndpoint(paths: StatePaths): string {
  const identity = process.platform === "win32" ? paths.root.toLowerCase() : paths.root;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\glass-box-trading-${digest}`;
  if (process.platform === "linux") return `\0glass-box-trading-${digest}`;
  throw new Error(`writer mutex unsupported on ${process.platform}; production requires Windows or Linux`);
}

function listenMutex(endpoint: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => { socket.destroy(); });
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function closeMutex(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error); });
  });
}
