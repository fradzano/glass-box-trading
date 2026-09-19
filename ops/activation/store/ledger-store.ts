// Unit 9: the durable shell around the closed ledger codec.
//
// The file lock serializes the read/plan/write/fsync critical section. A torn
// segment is immutable: continuation moves to a numbered recovery segment, so
// the damaged bytes stay at their original path and the aggregate history stays
// visibly `torn` forever. Terminated corruption is never continued.
import { open as openFile, readFile, readdir, rename, unlink } from "node:fs/promises";
import { realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { createConnection, createServer } from "node:net";
import type { Server } from "node:net";
import path from "node:path";
import { TextDecoder } from "node:util";
import { ledgerTail, parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { LedgerDraft, LedgerTail } from "../core/ledger.ts";
import type { LedgerEntry } from "../core/types.ts";

export interface LedgerLockOwner {
  readonly pid: number;
  readonly startedAtUtcMs: number;
}

/** The exact identity a production invocation must place in its lock record. */
export function currentLedgerLockOwner(): LedgerLockOwner {
  return { pid: process.pid, startedAtUtcMs: Math.trunc(performance.timeOrigin) };
}

export type LedgerSystemEvent =
  | { readonly kind: "live-lock"; readonly owner: LedgerLockOwner; readonly contender: LedgerLockOwner; readonly claimId: string }
  | { readonly kind: "stale-lock"; readonly owner: LedgerLockOwner }
  | { readonly kind: "torn-tail"; readonly segment: number; readonly damagedSeq: number };

export interface LedgerStoreHandle {
  readonly write: (bytes: Buffer) => Promise<{ readonly bytesWritten: number }>;
  readonly sync: () => Promise<void>;
  readonly stat: () => Promise<{ readonly size: number }>;
  readonly close: () => Promise<void>;
}

export interface LedgerStoreIo {
  readonly readDirectory: (directory: string) => Promise<readonly string[]>;
  readonly readFile: (file: string) => Promise<Buffer>;
  readonly open: (file: string, flags: string, mode?: number) => Promise<LedgerStoreHandle>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly unlink: (file: string) => Promise<void>;
  readonly processState: (owner: LedgerLockOwner, paths: LedgerStorePaths) => Promise<"alive" | "dead" | "unknown">;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export const nodeLedgerStoreIo: LedgerStoreIo = {
  async readDirectory(directory) { return readdir(directory); },
  async readFile(file) { return readFile(file); },
  async open(file, flags, mode) {
    const handle = await openFile(file, flags, mode);
    return {
      async write(bytes) {
        const result = await handle.write(bytes, 0, bytes.length, null);
        return { bytesWritten: result.bytesWritten };
      },
      async sync() { await handle.sync(); },
      async stat() { const value = await handle.stat(); return { size: value.size }; },
      async close() { await handle.close(); },
    };
  },
  async rename(from, to) { await rename(from, to); },
  async unlink(file) { await unlink(file); },
  processState(owner, paths) { return probeOwnerIdentity(paths, owner); },
  async sleep(milliseconds) { await new Promise(resolve => { setTimeout(resolve, milliseconds); }); },
};

export type LedgerStoreStage =
  | "read-directory" | "read-ledger" | "acquire-lock" | "read-lock" | "write-lock" | "sync-lock"
  | "close-lock" | "takeover-lock" | "open-ledger" | "write-ledger" | "sync-ledger" | "close-ledger"
  | "release-lock" | "encode-ledger" | "callback";

export class LedgerStoreError extends Error {
  readonly stage: LedgerStoreStage;
  readonly reason: string;

  constructor(stage: LedgerStoreStage, reason: string, options?: ErrorOptions) {
    super(`LEDGER_APPEND_FAILED:${stage}:${reason}`, options);
    this.name = "LedgerStoreError";
    this.stage = stage;
    this.reason = reason;
  }
}

export interface LedgerStorePaths {
  readonly root: string;
  readonly ledger: string;
  readonly lock: string;
  readonly identity: string;
}

export function ledgerStorePaths(root: string): LedgerStorePaths {
  let canonicalRoot: string;
  let device: bigint;
  let inode: bigint;
  try {
    canonicalRoot = realpathSync.native(path.resolve(root));
    const stats = statSync(canonicalRoot, { bigint: true });
    device = stats.dev;
    inode = stats.ino;
  } catch (error) {
    fail("read-directory", closedReason(error));
  }
  const rootIdentity = process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot;
  const identity = `${rootIdentity}\0${String(device)}\0${String(inode)}`;
  return { root: canonicalRoot, ledger: path.join(canonicalRoot, "ledger.jsonl"), lock: path.join(canonicalRoot, "ledger.lock"), identity };
}

function assertRootIdentity(paths: LedgerStorePaths): void {
  let current: LedgerStorePaths;
  try { current = ledgerStorePaths(paths.root); } catch { fail("read-directory", "ROOT_IDENTITY_CHANGED"); }
  if (current.identity !== paths.identity) fail("read-directory", "ROOT_IDENTITY_CHANGED");
}

export interface LedgerDamage {
  readonly segment: number;
  readonly damagedSeq: number;
  readonly bytes: Buffer;
}

export interface LedgerCorruption {
  readonly segment: number;
  readonly line: number | null;
  readonly reason: string;
}

export interface ActivationLedgerSnapshot {
  readonly state: "absent" | "empty" | "intact" | "torn" | "corrupt";
  readonly entries: readonly LedgerEntry[];
  readonly damage: readonly LedgerDamage[];
  readonly corrupt: readonly LedgerCorruption[];
}

interface SegmentSnapshot {
  readonly segment: number;
  readonly file: string;
  readonly exists: boolean;
  readonly size: number;
  readonly state: "empty" | "intact" | "torn" | "corrupt";
  readonly entries: readonly LedgerEntry[];
  readonly tornBytes: Buffer | null;
  readonly corrupt: readonly LedgerCorruption[];
  readonly tail: LedgerTail;
}

interface InternalSnapshot extends ActivationLedgerSnapshot {
  readonly segments: readonly SegmentSnapshot[];
  readonly active: SegmentSnapshot | null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function closedReason(error: unknown): string {
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM") return "ACCESS_DENIED";
  if (code === "ENOSPC" || code === "EDQUOT") return "NO_SPACE";
  if (code === "EMFILE" || code === "ENFILE") return "HANDLE_LIMIT";
  return "IO_ERROR";
}

function fail(stage: LedgerStoreStage, reason: string): never {
  throw new LedgerStoreError(stage, reason);
}

function rethrowClosed(error: unknown, stage: LedgerStoreStage): never {
  if (error instanceof LedgerStoreError) throw error;
  fail(stage, "IO_ERROR");
}

function recoveryFile(paths: LedgerStorePaths, segment: number): string {
  return `${paths.ledger}.recovery-${String(segment).padStart(6, "0")}`;
}

function recoveryIndex(name: string): number | null {
  const match = /^ledger\.jsonl\.recovery-(\d{6})$/.exec(name);
  if (match === null) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function readBytes(io: LedgerStoreIo, file: string): Promise<{ readonly exists: boolean; readonly bytes: Buffer }> {
  try {
    return { exists: true, bytes: await io.readFile(file) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { exists: false, bytes: Buffer.alloc(0) };
    fail("read-ledger", closedReason(error));
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

async function readSegment(io: LedgerStoreIo, file: string, segment: number, initialTail: LedgerTail): Promise<SegmentSnapshot> {
  const read = await readBytes(io, file);
  if (!read.exists) {
    return { segment, file, exists: false, size: 0, state: "empty", entries: [], tornBytes: null, corrupt: [], tail: initialTail };
  }
  if (read.bytes.length === 0) {
    if (segment > 0) {
      return { segment, file, exists: true, size: 0, state: "torn", entries: [], tornBytes: Buffer.alloc(0), corrupt: [], tail: initialTail };
    }
    return { segment, file, exists: true, size: 0, state: "empty", entries: [], tornBytes: null, corrupt: [], tail: initialTail };
  }
  if (read.bytes.length >= 3 && read.bytes[0] === 0xef && read.bytes[1] === 0xbb && read.bytes[2] === 0xbf) {
    const corruption = [{ segment, line: 1, reason: "NON_CANONICAL_UTF8" }] as const;
    return { segment, file, exists: true, size: read.bytes.length, state: "corrupt", entries: [], tornBytes: null, corrupt: corruption, tail: initialTail };
  }
  const lastLf = read.bytes.lastIndexOf(0x0a);
  const completeBytes = read.bytes.subarray(0, lastLf + 1);
  const tornBytes = read.bytes.subarray(lastLf + 1);
  let text: string;
  try {
    text = utf8.decode(completeBytes);
  } catch {
    const corruption = [{ segment, line: null, reason: "INVALID_UTF8" }] as const;
    return { segment, file, exists: true, size: read.bytes.length, state: "corrupt", entries: [], tornBytes: null, corrupt: corruption, tail: initialTail };
  }
  const parsed = parseLedgerText(text, initialTail);
  const corruption = parsed.corrupt.map(item => ({ segment, line: item.line, reason: item.reason }));
  const tail = parsed.entries.length === 0 ? initialTail : ledgerTail(parsed);
  if (corruption.length > 0) {
    return { segment, file, exists: true, size: read.bytes.length, state: "corrupt", entries: parsed.entries, tornBytes: null, corrupt: corruption, tail };
  }
  if (tornBytes.length > 0) {
    return { segment, file, exists: true, size: read.bytes.length, state: "torn", entries: parsed.entries, tornBytes: Buffer.from(tornBytes), corrupt: [], tail };
  }
  return { segment, file, exists: true, size: read.bytes.length, state: "intact", entries: parsed.entries, tornBytes: null, corrupt: [], tail };
}

async function readInternalAt(paths: LedgerStorePaths, io: LedgerStoreIo): Promise<InternalSnapshot> {
  assertRootIdentity(paths);
  let names: readonly string[];
  try {
    names = await io.readDirectory(paths.root);
  } catch (error) {
    fail("read-directory", closedReason(error));
  }
  const indices = names.map(recoveryIndex).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const corrupt: LedgerCorruption[] = [];
  for (const [offset, value] of indices.entries()) {
    if (value !== offset + 1) corrupt.push({ segment: value, line: null, reason: "RECOVERY_SEQUENCE_GAP" });
  }

  const primary = await readSegment(io, paths.ledger, 0, { lastSeq: 0, lastAtUtcMs: null });
  const segments: SegmentSnapshot[] = [primary];
  const entries: LedgerEntry[] = [...primary.entries];
  const damage: LedgerDamage[] = [];
  corrupt.push(...primary.corrupt);
  if (!primary.exists && indices.length > 0) corrupt.push({ segment: indices[0] ?? 1, line: null, reason: "RECOVERY_WITHOUT_PRIMARY" });
  if (primary.tornBytes !== null) damage.push({ segment: 0, damagedSeq: primary.tail.lastSeq + 1, bytes: primary.tornBytes });

  let previous = primary;
  for (const index of indices) {
    if (previous.state !== "torn") corrupt.push({ segment: index, line: null, reason: "UNEXPECTED_RECOVERY_SEGMENT" });
    const segment = await readSegment(io, recoveryFile(paths, index), index, previous.tail);
    if (segment.entries.length > 0) {
      const marker = segment.entries[0];
      const evidence = marker?.evidence;
      if (marker?.kind !== "correction" || marker.step !== null || marker.outcome !== null
        || evidence?.["kind"] !== "torn-tail" || evidence["segment"] !== previous.segment
        || evidence["damagedSeq"] !== previous.tail.lastSeq + 1) {
        corrupt.push({ segment: index, line: 1, reason: "RECOVERY_MARKER_MISSING" });
      }
    }
    segments.push(segment);
    entries.push(...segment.entries);
    corrupt.push(...segment.corrupt);
    if (segment.tornBytes !== null) damage.push({ segment: index, damagedSeq: segment.tail.lastSeq + 1, bytes: segment.tornBytes });
    previous = segment;
  }

  if (corrupt.length > 0) return { state: "corrupt", entries, damage, corrupt, segments, active: previous };
  if (!primary.exists) return { state: "absent", entries: [], damage: [], corrupt: [], segments, active: null };
  if (primary.size === 0 && indices.length === 0) return { state: "empty", entries: [], damage: [], corrupt: [], segments, active: primary };
  if (damage.length > 0) return { state: "torn", entries, damage, corrupt: [], segments, active: previous };
  return { state: "intact", entries, damage: [], corrupt: [], segments, active: previous };
}

export async function readActivationLedger(root: string, io: LedgerStoreIo = nodeLedgerStoreIo): Promise<ActivationLedgerSnapshot> {
  const paths = ledgerStorePaths(root);
  const snapshot = await withLockTransition(paths, io, 5_000, 10, () => readInternalAt(paths, io));
  return { state: snapshot.state, entries: snapshot.entries, damage: snapshot.damage, corrupt: snapshot.corrupt };
}

function parseLock(bytes: Buffer): LedgerLockOwner | null {
  let text: string;
  try { text = utf8.decode(bytes); } catch { return null; }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) return null;
  let value: unknown;
  try { value = JSON.parse(text.slice(0, -1)); } catch { return null; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !("pid" in record) || !("startedAtUtcMs" in record)) return null;
  if (!Number.isSafeInteger(record["pid"]) || (record["pid"] as number) <= 0) return null;
  if (!Number.isSafeInteger(record["startedAtUtcMs"]) || (record["startedAtUtcMs"] as number) < 0) return null;
  return { pid: record["pid"] as number, startedAtUtcMs: record["startedAtUtcMs"] as number };
}

async function createLock(paths: LedgerStorePaths, owner: LedgerLockOwner, io: LedgerStoreIo): Promise<"created" | "exists"> {
  let handle: LedgerStoreHandle;
  try {
    handle = await io.open(paths.lock, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return "exists";
    // Windows reports an existing file opened with `wx` as EACCES/EPERM.
    // A readable ownership record proves a collision; otherwise the original
    // closed error remains authoritative.
    try {
      await io.readFile(paths.lock);
      return "exists";
    } catch { /* preserve the original closed error */ }
    fail("acquire-lock", closedReason(error));
  }
  let failure: LedgerStoreError | null = null;
  try {
    const bytes = Buffer.from(`${JSON.stringify(owner)}\n`, "utf8");
    let written: { readonly bytesWritten: number };
    try { written = await handle.write(bytes); } catch (error) { fail("write-lock", closedReason(error)); }
    if (written.bytesWritten !== bytes.length) fail("write-lock", "PARTIAL_WRITE");
    try { await handle.sync(); } catch (error) { fail("sync-lock", closedReason(error)); }
  } catch (error) {
    failure = error instanceof LedgerStoreError ? error : new LedgerStoreError("write-lock", "IO_ERROR");
  }
  try { await handle.close(); } catch (error) { if (failure === null) failure = new LedgerStoreError("close-lock", closedReason(error)); }
  if (failure !== null) {
    try { await io.unlink(paths.lock); } catch { /* the original failure remains authoritative */ }
    throw failure;
  }
  return "created";
}

interface LockAcquisition {
  readonly held: boolean;
  readonly liveOwner: LedgerLockOwner | null;
  readonly staleOwners: readonly LedgerLockOwner[];
  readonly tombstones: readonly string[];
  readonly ownerServer: Server | null;
}

function transitionEndpoint(paths: LedgerStorePaths): string {
  const digest = createHash("sha256").update(paths.identity, "utf8").digest("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\glass-box-activation-ledger-${digest}`;
  if (process.platform === "linux") return `\0glass-box-activation-ledger-${digest}`;
  fail("acquire-lock", "PLATFORM_UNSUPPORTED");
}

function ownerEndpoint(paths: LedgerStorePaths, owner: LedgerLockOwner): string {
  const digest = createHash("sha256")
    .update(paths.identity, "utf8")
    .update("\0", "utf8")
    .update(String(owner.pid), "utf8")
    .update("\0", "utf8")
    .update(String(owner.startedAtUtcMs), "utf8")
    .digest("hex");
  if (process.platform === "win32") return `\\\\.\\pipe\\glass-box-activation-owner-${digest}`;
  if (process.platform === "linux") return `\0glass-box-activation-owner-${digest}`;
  fail("read-lock", "PLATFORM_UNSUPPORTED");
}

function probeOwnerIdentity(paths: LedgerStorePaths, owner: LedgerLockOwner): Promise<"alive" | "dead" | "unknown"> {
  const endpoint = ownerEndpoint(paths, owner);
  return new Promise(resolve => {
    const socket = createConnection(endpoint);
    let settled = false;
    const finish = (state: "alive" | "dead" | "unknown"): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };
    socket.once("connect", () => { finish("alive"); });
    socket.once("error", error => {
      const code = errorCode(error);
      finish(code === "ENOENT" || code === "ECONNREFUSED" ? "dead" : "unknown");
    });
    socket.setTimeout(1_000, () => { finish("unknown"); });
  });
}

async function holdOwnerIdentity(paths: LedgerStorePaths, owner: LedgerLockOwner): Promise<Server> {
  try { return await listenTransition(ownerEndpoint(paths, owner)); } catch (error) { fail("acquire-lock", closedReason(error)); }
}

function listenTransition(endpoint: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(socket => { socket.destroy(); });
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function closeTransition(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error); });
  });
}

/**
 * A bounded, kernel-owned mutex protects only lock-file transitions. The durable
 * ownership record remains the pid/start-time file; this tiny guard prevents two
 * stale-lock takers from renaming each other's successor. Unlike the runtime's
 * `withMutex`, waiting is bounded and a crash releases the endpoint in the OS.
 */
async function withLockTransition<T>(
  paths: LedgerStorePaths,
  io: LedgerStoreIo,
  timeoutMs: number,
  pollMs: number,
  work: () => Promise<T>,
): Promise<T> {
  assertRootIdentity(paths);
  const endpoint = transitionEndpoint(paths);
  let waited = 0;
  let server: Server;
  for (;;) {
    try {
      server = await listenTransition(endpoint);
      break;
    } catch (error) {
      if (errorCode(error) !== "EADDRINUSE") fail("acquire-lock", closedReason(error));
      if (waited >= timeoutMs) fail("acquire-lock", "LOCK_TRANSITION_TIMEOUT");
      const pause = Math.min(pollMs, timeoutMs - waited);
      try { await io.sleep(pause); } catch (sleepError) { fail("acquire-lock", closedReason(sleepError)); }
      waited += pause;
    }
  }
  let value: T | undefined;
  let workError: unknown = null;
  try { value = await work(); } catch (error) { workError = error; }
  try { await closeTransition(server); } catch (error) {
    if (workError === null) fail("acquire-lock", closedReason(error));
  }
  if (workError !== null) rethrowClosed(workError, "acquire-lock");
  return value as T;
}

async function createHeldLock(
  paths: LedgerStorePaths,
  owner: LedgerLockOwner,
  io: LedgerStoreIo,
): Promise<{ readonly kind: "created"; readonly ownerServer: Server } | { readonly kind: "exists" }> {
  if (await createLock(paths, owner, io) === "exists") return { kind: "exists" };
  try {
    return { kind: "created", ownerServer: await holdOwnerIdentity(paths, owner) };
  } catch (error) {
    try { await io.unlink(paths.lock); } catch { /* an ownerless lock remains visibly stale */ }
    throw error;
  }
}

function knownProcessState(state: "alive" | "dead" | "unknown"): "alive" | "dead" {
  if (state === "unknown") fail("read-lock", "LOCK_OWNER_UNKNOWN");
  return state;
}

async function nextTombstonePath(paths: LedgerStorePaths, owner: LedgerLockOwner, io: LedgerStoreIo): Promise<string> {
  let names: readonly string[];
  try { names = await io.readDirectory(paths.root); } catch (error) { fail("read-directory", closedReason(error)); }
  const prefix = `${path.basename(paths.lock)}.stale-${String(owner.pid)}-${String(owner.startedAtUtcMs)}-`;
  let suffix = 1;
  while (names.includes(`${prefix}${String(suffix)}`)) suffix += 1;
  return path.join(paths.root, `${prefix}${String(suffix)}`);
}

async function acquireLock(
  paths: LedgerStorePaths,
  owner: LedgerLockOwner,
  io: LedgerStoreIo,
  timeoutMs: number,
  pollMs: number,
): Promise<LockAcquisition> {
  const staleOwners: LedgerLockOwner[] = [];
  const tombstones: string[] = [];
  let liveOwner: LedgerLockOwner | null = null;
  let waited = 0;
  for (;;) {
    let observedBytes: Buffer | null = null;
    try { observedBytes = await io.readFile(paths.lock); } catch (error) {
      const code = errorCode(error);
      if (code === "EACCES" || code === "EPERM") {
        if (waited >= timeoutMs) fail("read-lock", "LOCK_READ_TIMEOUT");
        const pause = Math.min(pollMs, timeoutMs - waited);
        try { await io.sleep(pause); } catch (sleepError) { fail("acquire-lock", closedReason(sleepError)); }
        waited += pause;
        continue;
      }
      if (code !== "ENOENT") fail("read-lock", closedReason(error));
    }
    const decision = observedBytes === null
      ? await withLockTransition(paths, io, timeoutMs, pollMs, async () => {
        const created = await createHeldLock(paths, owner, io);
        return created.kind === "created" ? created : { kind: "retry" } as const;
      })
      : await (async () => {
        const current = parseLock(observedBytes);
        if (current === null) return { kind: "invalid" } as const;
        let state: "alive" | "dead" | "unknown";
        try { state = await io.processState(current, paths); } catch (error) { fail("read-lock", closedReason(error)); }
        if (knownProcessState(state) === "alive") return { kind: "live", owner: current } as const;
        return withLockTransition(paths, io, timeoutMs, pollMs, async () => {
          let currentBytes: Buffer;
          try { currentBytes = await io.readFile(paths.lock); } catch (error) {
            if (errorCode(error) === "ENOENT") return { kind: "retry" } as const;
            fail("read-lock", closedReason(error));
          }
          if (!currentBytes.equals(observedBytes)) return { kind: "retry" } as const;
          let currentState: "alive" | "dead" | "unknown";
          try { currentState = await io.processState(current, paths); } catch (error) { fail("read-lock", closedReason(error)); }
          if (knownProcessState(currentState) === "alive") return { kind: "live", owner: current } as const;
          const tombstone = await nextTombstonePath(paths, owner, io);
          try { await io.rename(paths.lock, tombstone); } catch (error) {
            if (errorCode(error) === "ENOENT") return { kind: "retry" } as const;
            fail("takeover-lock", closedReason(error));
          }
          const created = await createHeldLock(paths, owner, io);
          if (created.kind !== "created") fail("takeover-lock", "SUCCESSOR_EXISTS");
          return { kind: "taken-over", owner: current, tombstone, ownerServer: created.ownerServer } as const;
        });
      })();
    if (decision.kind === "created") return { held: true, liveOwner, staleOwners, tombstones, ownerServer: decision.ownerServer };
    if (decision.kind === "taken-over") {
      staleOwners.push(decision.owner);
      tombstones.push(decision.tombstone);
      return { held: true, liveOwner, staleOwners, tombstones, ownerServer: decision.ownerServer };
    }
    if (decision.kind === "retry") {
      if (waited >= timeoutMs) fail("acquire-lock", "LOCK_ACQUIRE_TIMEOUT");
      const pause = Math.min(pollMs, timeoutMs - waited);
      try { await io.sleep(pause); } catch (error) { fail("acquire-lock", closedReason(error)); }
      waited += pause;
      continue;
    }
    const current = decision.kind === "live" ? decision.owner : null;
    if (current === null) {
      if (waited >= timeoutMs) fail("read-lock", "LOCK_INVALID");
      const pause = Math.min(pollMs, timeoutMs - waited);
      try { await io.sleep(pause); } catch (error) { fail("acquire-lock", closedReason(error)); }
      waited += pause;
      continue;
    }
    liveOwner = current;
    return { held: false, liveOwner, staleOwners, tombstones, ownerServer: null };
  }
}

function eventCovered(draft: LedgerDraft | LedgerEntry, event: LedgerSystemEvent): boolean {
  if (event.kind === "torn-tail" && draft.kind !== "correction") return false;
  if (event.kind !== "torn-tail" && draft.kind !== "note") return false;
  if (draft.step !== null || draft.outcome !== null) return false;
  for (const [key, value] of Object.entries(event)) {
    if (JSON.stringify(draft.evidence[key]) !== JSON.stringify(value)) return false;
  }
  return true;
}

async function appendLines(
  target: SegmentSnapshot,
  tail: LedgerTail,
  drafts: readonly LedgerDraft[],
  io: LedgerStoreIo,
): Promise<readonly LedgerEntry[]> {
  const planned: { readonly bytes: Buffer; readonly entry: LedgerEntry }[] = [];
  let nextTail = tail;
  for (const draft of drafts) {
    const encoded = planLedgerAppend(nextTail, draft);
    if (!encoded.ok) fail("encode-ledger", encoded.reason === "SECRET_SHAPED_VALUE" ? "SECRET_SHAPED_VALUE" : encoded.reason);
    planned.push({ bytes: Buffer.from(encoded.line, "utf8"), entry: encoded.entry });
    nextTail = { lastSeq: encoded.entry.seq, lastAtUtcMs: encoded.entry.atUtcMs };
  }
  let handle: LedgerStoreHandle;
  try { handle = await io.open(target.file, target.exists ? "a" : "ax", 0o600); }
  catch (error) { fail("open-ledger", closedReason(error)); }

  let failure: LedgerStoreError | null = null;
  try {
    let current: { readonly size: number };
    try { current = await handle.stat(); } catch (error) { fail("open-ledger", closedReason(error)); }
    if (current.size !== target.size) fail("open-ledger", "LEDGER_CHANGED");
    for (const line of planned) {
      let result: { readonly bytesWritten: number };
      try { result = await handle.write(line.bytes); } catch (error) { fail("write-ledger", closedReason(error)); }
      if (result.bytesWritten !== line.bytes.length) fail("write-ledger", "PARTIAL_WRITE");
      try { await handle.sync(); } catch (error) { fail("sync-ledger", closedReason(error)); }
    }
  } catch (error) {
    failure = error instanceof LedgerStoreError ? error : new LedgerStoreError("write-ledger", "IO_ERROR");
  }
  try { await handle.close(); } catch (error) { if (failure === null) failure = new LedgerStoreError("close-ledger", closedReason(error)); }
  if (failure !== null) throw failure;
  return planned.map(item => item.entry);
}

async function releaseLock(paths: LedgerStorePaths, owner: LedgerLockOwner, ownerServer: Server, io: LedgerStoreIo): Promise<void> {
  await withLockTransition(paths, io, 5_000, 10, async () => {
    let current: Buffer;
    try { current = await io.readFile(paths.lock); } catch (error) { fail("release-lock", closedReason(error)); }
    const parsed = parseLock(current);
    if (parsed === null || parsed.pid !== owner.pid || parsed.startedAtUtcMs !== owner.startedAtUtcMs) fail("release-lock", "LOCK_OWNERSHIP_CHANGED");
    try { await io.unlink(paths.lock); } catch (error) { fail("release-lock", closedReason(error)); }
    try { await closeTransition(ownerServer); } catch (error) { fail("release-lock", closedReason(error)); }
  });
}

export interface AppendActivationLedgerInput {
  readonly root: string;
  readonly owner: LedgerLockOwner;
  /** Called only after the lock is held; the supplied tail lets the caller stamp a monotonic append-time observation. */
  readonly makeSystemDraft: (event: LedgerSystemEvent, tail: LedgerTail, context: LedgerSystemContext | null) => LedgerDraft;
  readonly io?: LedgerStoreIo;
  readonly contentionTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface LedgerSystemContext {
  readonly attempt: string;
  readonly anchorDay: string;
}

export interface ActivationLedgerSession {
  readonly read: () => Promise<ActivationLedgerSnapshot>;
  readonly append: (draft: LedgerDraft) => Promise<readonly LedgerEntry[]>;
}

export type WithActivationLedgerResult<T> =
  | { readonly kind: "completed"; readonly value: T; readonly systemEntries: readonly LedgerEntry[] }
  | { readonly kind: "contended"; readonly entries: readonly LedgerEntry[] };

function tailOf(snapshot: InternalSnapshot): LedgerTail {
  return snapshot.entries.length === 0
    ? { lastSeq: 0, lastAtUtcMs: null }
    : ledgerTail({ entries: snapshot.entries, torn: null, corrupt: [] });
}

async function appendUnderLock(
  paths: LedgerStorePaths,
  io: LedgerStoreIo,
  makeSystemDraft: AppendActivationLedgerInput["makeSystemDraft"],
  systemEvents: readonly LedgerSystemEvent[],
  draft: LedgerDraft | null,
): Promise<readonly LedgerEntry[]> {
  const snapshot = await readInternalAt(paths, io);
  if (snapshot.state === "corrupt") fail("read-ledger", "HISTORY_CORRUPT");

  const tail = tailOf(snapshot);
  let target = snapshot.active ?? {
    segment: 0,
    file: paths.ledger,
    exists: false,
    size: 0,
    state: "empty" as const,
    entries: [],
    tornBytes: null,
    corrupt: [],
    tail,
  };
  const orderedEvents: LedgerSystemEvent[] = [];
  if (target.state === "torn") {
    orderedEvents.push({ kind: "torn-tail", segment: target.segment, damagedSeq: tail.lastSeq + 1 });
    const nextSegment = target.segment + 1;
    target = {
      segment: nextSegment,
      file: recoveryFile(paths, nextSegment),
      exists: false,
      size: 0,
      state: "empty",
      entries: [],
      tornBytes: null,
      corrupt: [],
      tail,
    };
  }
  orderedEvents.push(...systemEvents.filter(event => event.kind === "torn-tail"
    || !snapshot.entries.some(entry => eventCovered(entry, event))));

  const prior = snapshot.entries.at(-1);
  const context: LedgerSystemContext | null = prior === undefined
    ? (draft === null ? null : { attempt: draft.attempt, anchorDay: draft.anchorDay })
    : { attempt: prior.attempt, anchorDay: prior.anchorDay };
  const systemDrafts = orderedEvents.map(event => {
    try {
      const value = makeSystemDraft(event, tail, context);
      if (!eventCovered(value, event)
        || (context !== null && (value.attempt !== context.attempt || value.anchorDay !== context.anchorDay))) {
        fail("encode-ledger", "SYSTEM_DRAFT_INVALID");
      }
      return value;
    } catch (error) {
      if (error instanceof LedgerStoreError) throw error;
      fail("encode-ledger", "SYSTEM_DRAFT_FAILED");
    }
  });
  const drafts = draft === null ? systemDrafts : [...systemDrafts, draft];
  if (drafts.length === 0) return [];
  return appendLines(target, tail, drafts, io);
}

async function pendingTombstones(paths: LedgerStorePaths, io: LedgerStoreIo): Promise<readonly { file: string; owner: LedgerLockOwner }[]> {
  let names: readonly string[];
  try { names = await io.readDirectory(paths.root); } catch (error) { fail("read-directory", closedReason(error)); }
  const prefix = `${path.basename(paths.lock)}.stale-`;
  const pending: { file: string; owner: LedgerLockOwner }[] = [];
  for (const name of [...names].sort()) {
    if (!name.startsWith(prefix) || name.endsWith(".recorded")) continue;
    const file = path.join(paths.root, name);
    let bytes: Buffer;
    try { bytes = await io.readFile(file); } catch (error) { fail("read-lock", closedReason(error)); }
    const owner = parseLock(bytes);
    if (owner === null) fail("read-lock", "STALE_LOCK_INVALID");
    pending.push({ file, owner });
  }
  return pending;
}

async function markTombstonesRecorded(files: readonly string[], io: LedgerStoreIo): Promise<void> {
  for (const file of files) {
    const recorded = `${file}.recorded`;
    try { await io.rename(file, recorded); } catch (error) { fail("takeover-lock", closedReason(error)); }
    try { await io.unlink(recorded); } catch { /* durable ledger evidence is authoritative */ }
  }
}

/**
 * Holds the pid/start-time lease for the complete activation invocation. Unit 10
 * must perform all of its reads, intent/result appends, and host work inside
 * `work`; a live competitor receives one durable note and `work` is never run.
 */
export async function withActivationLedger<T>(
  input: AppendActivationLedgerInput,
  work: (session: ActivationLedgerSession) => Promise<T>,
): Promise<WithActivationLedgerResult<T>> {
  const io = input.io ?? nodeLedgerStoreIo;
  const paths = ledgerStorePaths(input.root);
  const timeoutMs = input.contentionTimeoutMs ?? 5_000;
  const pollMs = input.pollIntervalMs ?? 10;
  if (!Number.isSafeInteger(input.owner.pid) || input.owner.pid <= 0 || !Number.isSafeInteger(input.owner.startedAtUtcMs) || input.owner.startedAtUtcMs < 0) {
    fail("acquire-lock", "OWNER_INVALID");
  }
  const processOwner = currentLedgerLockOwner();
  if (io === nodeLedgerStoreIo && (input.owner.pid !== processOwner.pid || input.owner.startedAtUtcMs !== processOwner.startedAtUtcMs)) {
    fail("acquire-lock", "OWNER_PROCESS_MISMATCH");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(pollMs) || pollMs < 1) fail("acquire-lock", "WAIT_INVALID");

  const acquisition = await acquireLock(paths, input.owner, io, timeoutMs, pollMs);
  if (!acquisition.held) {
    if (acquisition.liveOwner === null) fail("acquire-lock", "LIVE_OWNER_MISSING");
    const claimId = `live-${String(input.owner.pid)}-${String(input.owner.startedAtUtcMs)}`;
    // The contender's own budget says how long it may wait for the *lease*; it must not
    // also decide whether the contender can record that it was here. A caller that may not
    // wait at all — the 15:05 disarm, and any test that pins that semantics — passes 0, and
    // under load the transition for this one note then times out and turns "somebody else
    // holds the lease" into a store failure. The note gets a floor of its own (R4-15,
    // measured 2026-09-20 as the last red of four concurrent suite runs under CPU load).
    const noteTimeoutMs = Math.max(timeoutMs, 2_000);
    const entries = await withLockTransition(paths, io, noteTimeoutMs, pollMs, () => appendUnderLock(
      paths,
      io,
      input.makeSystemDraft,
      [{ kind: "live-lock", owner: acquisition.liveOwner as LedgerLockOwner, contender: input.owner, claimId }],
      null,
    ));
    return { kind: "contended", entries };
  }
  if (acquisition.ownerServer === null) fail("acquire-lock", "OWNER_IDENTITY_MISSING");
  let result: WithActivationLedgerResult<T> | null = null;
  let workFailure: unknown = null;
  try {
    const discovered = await pendingTombstones(paths, io);
    const staleOwners = discovered.map(item => item.owner);
    const tombstones = [...new Set([...acquisition.tombstones, ...discovered.map(item => item.file)])];
    const staleEntries = await withLockTransition(paths, io, timeoutMs, pollMs, () => appendUnderLock(
      paths,
      io,
      input.makeSystemDraft,
      staleOwners.map(owner => ({ kind: "stale-lock", owner })),
      null,
    ));
    await markTombstonesRecorded(tombstones, io);
    if (acquisition.liveOwner !== null) {
      result = { kind: "contended", entries: staleEntries };
    } else {
      const session: ActivationLedgerSession = {
        async read() {
          const snapshot = await withLockTransition(paths, io, timeoutMs, pollMs, () => readInternalAt(paths, io));
          return { state: snapshot.state, entries: snapshot.entries, damage: snapshot.damage, corrupt: snapshot.corrupt };
        },
        async append(draft) {
          return withLockTransition(paths, io, timeoutMs, pollMs, () => appendUnderLock(paths, io, input.makeSystemDraft, [], draft));
        },
      };
      // The callback's own failures are unit 10's, not the store's: they keep their
      // own stage so a typed abort never pages as a ledger defect. The original
      // error travels as `cause`; the message stays closed.
      let value: T;
      try {
        value = await work(session);
      } catch (error) {
        throw error instanceof LedgerStoreError ? error : new LedgerStoreError("callback", "WORK_FAILED", { cause: error });
      }
      result = { kind: "completed", value, systemEntries: staleEntries };
    }
  } catch (error) {
    workFailure = error;
  }

  let releaseFailure: unknown = null;
  try { await releaseLock(paths, input.owner, acquisition.ownerServer, io); } catch (error) {
    releaseFailure = error;
    try { await closeTransition(acquisition.ownerServer); } catch { /* release already failed closed */ }
  }
  if (workFailure !== null) rethrowClosed(workFailure, "write-ledger");
  if (releaseFailure !== null) rethrowClosed(releaseFailure, "release-lock");
  if (result === null) fail("write-ledger", "NO_RESULT");
  return result;
}
