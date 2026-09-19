// The durable half of the owner's stop (`docs/P12-STOP-AND-LOG-CONTRACTS.md`, SC-2).
//
// One small file beside the ledger, `stop.json`, written before the stop's first teardown
// action and removed only by `activation open`. It is deliberately not a ledger entry:
// the ledger lives under a lease, and the whole point of the mark is to stand before the
// lease is taken and to be readable by an invocation that is *holding* that lease.
//
// Durability, in the order it matters: the bytes go to a temporary file, that file is
// fsynced, and only then is it renamed onto the final name. A reader therefore sees
// either no mark or a whole one, never half of one.
//
// **A mark has an identity, and that is not decoration** (R4-01, 2026-09-19). The first
// version of this module let `open` unlink whatever occupied the path. Executed: a
// continuation that had read an *older* stop erased a *newer* one written while it held
// the ledger lease, the concurrent abort then reported "the stop is confirmed" with no
// mark on disk, and the next anchor day's tick opened an attempt by itself. A stop is a
// resource with an owner and an instant, so lifting one is a compare-and-delete against
// the id that was read, never a delete of "the file".
//
// The compare and the delete are made atomic with respect to a concurrent writer by a
// **dedicated lock of this file only** — not the ledger lease. It is held for the
// duration of one small write or one compare-and-delete, which keeps SC-1 true: the
// owner's stop still never waits for a running invocation's ledger lease.
import { open as openFile, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StopMark, StopMarkState } from "../core/stop.ts";

export function stopMarkPath(root: string): string {
  return path.join(root, "stop.json");
}

function stopLockPath(root: string): string {
  return `${stopMarkPath(root)}.lock`;
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { readonly code: unknown }).code) : null;
}

/** How long a caller waits for the mark's own lock before it decides without it. */
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 15;
/**
 * A lock older than this is taken over. It is generous against a slow disk and short
 * against a crashed process: what it guards is two file operations, not a session.
 */
const LOCK_STALE_MS = 30_000;

async function takeLock(root: string, nowUtcMs: number): Promise<boolean> {
  const file = stopLockPath(root);
  const deadline = nowUtcMs + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await openFile(file, "wx");
      try {
        await handle.write(Buffer.from(`${JSON.stringify({ pid: process.pid, atUtcMs: Date.now() })}\n`, "utf8"));
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return false;
      // A lock left behind by a process that died mid-write must not stop the owner's
      // stop for ever. It is taken over by age, and the age is read from the lock itself.
      const held = await readFile(file, "utf8").catch(() => null);
      const heldAt = held === null ? null : (JSON.parse(held) as { readonly atUtcMs?: unknown }).atUtcMs;
      if (typeof heldAt === "number" && Date.now() - heldAt > LOCK_STALE_MS) {
        await unlink(file).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => { setTimeout(resolve, LOCK_POLL_MS); });
    }
  }
}

async function releaseLock(root: string): Promise<void> {
  await unlink(stopLockPath(root)).catch(() => undefined);
}

async function withStopLock<T>(root: string, work: () => Promise<T>, whenUnavailable: () => T): Promise<T> {
  const taken = await takeLock(root, Date.now());
  if (!taken) return whenUnavailable();
  try {
    return await work();
  } finally {
    await releaseLock(root);
  }
}

function parseMark(text: string, where: string): StopMarkState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable", reason: `${where}: not JSON` };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "unreadable", reason: `${where}: not an object` };
  const record = parsed as Record<string, unknown>;
  const id = record["id"];
  const operator = record["operator"];
  const at = record["at"];
  const atUtcMs = record["atUtcMs"];
  const reason = record["reason"];
  if (typeof id !== "string" || typeof operator !== "string" || typeof at !== "string" || typeof atUtcMs !== "number" || typeof reason !== "string") {
    return { kind: "unreadable", reason: `${where}: a field is missing or of the wrong type` };
  }
  return { kind: "present", mark: { id, operator, at, atUtcMs, reason } };
}

/**
 * What the state root says about a stop.
 *
 * Three answers, and the third one is load-bearing: a file that exists but cannot be read
 * or cannot be parsed is `unreadable`, never `absent`. `stopRefusal` turns that into a
 * refusal of every arming action, which is the safe direction — see the note there.
 *
 * It takes no lock: the mark is replaced by rename, so a reader sees one whole version or
 * none, and a reader that waited for a lock could be made to wait by a crashed writer.
 */
export async function readStopMark(root: string): Promise<StopMarkState> {
  let text: string;
  try {
    text = await readFile(stopMarkPath(root), "utf8");
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", reason: `${stopMarkPath(root)}: ${code ?? "read failed"}` };
  }
  return parseMark(text, stopMarkPath(root));
}

async function writeMarkFile(root: string, mark: StopMark): Promise<void> {
  const target = stopMarkPath(root);
  const temporary = `${target}.writing-${String(process.pid)}`;
  const bytes = Buffer.from(`${JSON.stringify(mark, null, 2)}\n`, "utf8");
  const handle = await openFile(temporary, "w");
  try {
    const written = await handle.write(bytes);
    if (written.bytesWritten !== bytes.length) throw new Error(`the stop mark was written partially (${String(written.bytesWritten)} of ${String(bytes.length)} bytes)`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

/**
 * Writes the mark durably, or throws. The caller reports a failure rather than swallowing
 * it: a stop whose mark could not be written still disarms, but it is not a durable stop
 * and must not be reported as one (SC-2).
 *
 * The newest stop wins, always: a stop typed now replaces one typed earlier, and the id
 * of the one that stands is what a later continuation has to match.
 */
export async function writeStopMark(root: string, mark: StopMark): Promise<void> {
  // The lock is a serialiser, not a gate: a stop that cannot take it writes anyway,
  // because failing to record the owner's stop is the worse of the two failures. What is
  // lost without it is only the atomicity against a simultaneous compare-and-delete.
  const taken = await takeLock(root, Date.now());
  try {
    await writeMarkFile(root, mark);
  } finally {
    if (taken) await releaseLock(root);
  }
}

export type StopClearResult =
  | { readonly kind: "cleared"; readonly id: string }
  | { readonly kind: "absent" }
  /** A different stop stands than the one the caller was authorised to lift. */
  | { readonly kind: "superseded"; readonly standing: StopMark }
  | { readonly kind: "unreadable"; readonly reason: string }
  | { readonly kind: "locked"; readonly reason: string };

/**
 * Lifts exactly the stop the caller read, and nothing else (SC-8, R4-01).
 *
 * `activation open` is the owner's typed continuation and the only caller. It names the
 * id it means; a newer stop — one typed while the continuation was working — is left
 * standing and reported back, because the owner's most recent word is the one that counts
 * and the continuation was not authorised to lift it.
 */
export async function clearStopMark(root: string, expectedId: string): Promise<StopClearResult> {
  return withStopLock<StopClearResult>(
    root,
    async () => {
      const state = await readStopMark(root);
      if (state.kind === "absent") return { kind: "absent" };
      if (state.kind === "unreadable") return { kind: "unreadable", reason: state.reason };
      if (state.mark.id !== expectedId) return { kind: "superseded", standing: state.mark };
      await unlink(stopMarkPath(root));
      return { kind: "cleared", id: expectedId };
    },
    () => ({ kind: "locked", reason: "another invocation holds the stop mark's lock; nothing was lifted" }),
  );
}

/**
 * The recovery record a continuation leaves when it recorded its opening and then could
 * not lift the stop. It is written beside the mark, never over it, so that neither fact
 * can erase the other, and `status` reads both.
 */
export async function writeStopLiftFailure(root: string, detail: Readonly<Record<string, unknown>>): Promise<void> {
  await writeFile(`${stopMarkPath(root)}.lift-failed`, `${JSON.stringify(detail, null, 2)}\n`, "utf8").catch(() => undefined);
}
