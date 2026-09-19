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

async function takeLock(root: string, nowUtcMs: number): Promise<string | null> {
  const file = stopLockPath(root);
  const token = `${String(process.pid)}-${String(Date.now())}-${Math.random().toString(16).slice(2, 10)}`;
  const deadline = nowUtcMs + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await openFile(file, "wx");
      try {
        await handle.write(Buffer.from(`${JSON.stringify({ token, pid: process.pid, atUtcMs: Date.now() })}\n`, "utf8"));
        // Without this the file can be length 0 after an unclean shutdown, and a
        // zero-byte lock used to be a lock nobody could take over — see below.
        await handle.sync();
      } finally {
        await handle.close();
      }
      return token;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return null;
      // **A lock that cannot be read is an expired lock, not an eternal one** (N1,
      // 2026-09-20). This block used to parse the lock's JSON unguarded, so a zero-byte
      // file — exactly what a process killed between `openFile(…, "wx")` and its first
      // write leaves behind — made `JSON.parse` throw out of `takeLock`, out of
      // `writeStopMark`, and out of the owner's abort. Measured consequence: the stop
      // disarmed the world, no mark was written, and the next tick was free to arm again.
      // That is the harm R4-01 exists to prevent, reintroduced by the lock that was meant
      // to close it. The rule now: anything this function cannot understand is stale.
      let heldAt: number | null;
      try {
        const held = await readFile(file, "utf8");
        const parsed = JSON.parse(held) as { readonly atUtcMs?: unknown };
        heldAt = typeof parsed.atUtcMs === "number" ? parsed.atUtcMs : null;
      } catch {
        heldAt = null;
      }
      if (heldAt === null || Date.now() - heldAt > LOCK_STALE_MS) {
        await unlink(file).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) return null;
      await new Promise(resolve => { setTimeout(resolve, LOCK_POLL_MS); });
    }
  }
}

async function releaseLock(root: string, token: string): Promise<void> {
  // Release only what is still ours (N6). If a second invocation took this lock over
  // because it had gone stale, unlinking unconditionally would free *its* lock — the
  // classic double free, and it needs the two lines it costs to avoid.
  try {
    const held = await readFile(stopLockPath(root), "utf8");
    const parsed = JSON.parse(held) as { readonly token?: unknown };
    if (parsed.token !== token) return;
  } catch {
    // Unreadable or already gone: it is not ours to remove, or there is nothing to remove.
    return;
  }
  await unlink(stopLockPath(root)).catch(() => undefined);
}

async function withStopLock<T>(root: string, work: () => Promise<T>, whenUnavailable: () => T): Promise<T> {
  const token = await takeLock(root, Date.now());
  if (token === null) return whenUnavailable();
  try {
    return await work();
  } finally {
    await releaseLock(root, token);
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
  try {
    await rename(temporary, target);
  } catch (error) {
    // The half-written file is not evidence of anything and it litters the one directory
    // an operator inspects by hand (N5). It goes; the failure travels to the caller.
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
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
  //
  // `takeLock` is also not allowed to decide whether this function runs at all — it
  // swallows its own failures and answers `null`, and this `catch` is the second line of
  // that defence (N1). The mark is the one thing that stands between a typed stop and a
  // deployment that arms itself again.
  let token: string | null;
  try {
    token = await takeLock(root, Date.now());
  } catch {
    token = null;
  }
  try {
    await writeMarkFile(root, mark);
  } finally {
    if (token !== null) await releaseLock(root, token).catch(() => undefined);
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
 * Sets an unreadable mark aside so that the owner's continuation is never a dead end (N2,
 * 2026-09-20).
 *
 * A mark whose bytes cannot be parsed has no id, so the compare-and-delete of
 * `clearStopMark` can never match it. Before this existed, `open` simply left it — and a
 * state root with an unparseable `stop.json` was a deployment that would refuse every
 * arming action for ever, while `open` reported success and exit 0. The same applied to a
 * mark written by the version of this code that had no `id` field at all, which makes this
 * the upgrade path as well as the recovery path.
 *
 * The bytes are **renamed, never deleted**: they are the only evidence of whatever wrote
 * them, and a stop nobody can read is exactly the situation where evidence matters.
 */
export async function quarantineStopMark(root: string): Promise<string | null> {
  const target = `${stopMarkPath(root)}.unreadable-${String(Date.now())}`;
  try {
    await rename(stopMarkPath(root), target);
    return target;
  } catch {
    return null;
  }
}

/** Whatever `stop.json.lock` says, for a reader that reports rather than decides (N4). */
export async function readStopLock(root: string): Promise<{ readonly held: boolean; readonly detail: string }> {
  try {
    const held = await readFile(stopLockPath(root), "utf8");
    const parsed = JSON.parse(held) as { readonly atUtcMs?: unknown; readonly pid?: unknown };
    const at = typeof parsed.atUtcMs === "number" ? new Date(parsed.atUtcMs).toISOString() : "an unreadable time";
    const pid = typeof parsed.pid === "number" ? String(parsed.pid) : "an unknown process";
    return { held: true, detail: `held since ${at} by pid ${pid}` };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { held: false, detail: "" };
    return { held: true, detail: "and its own contents cannot be read, so it counts as expired" };
  }
}

/** The recovery record a continuation leaves when it recorded its opening and then could
 * not lift the stop. It is written beside the mark, never over it, so that neither fact
 * can erase the other. `status` reads it — see `statusLines`.
 */
export async function writeStopLiftFailure(root: string, detail: Readonly<Record<string, unknown>>): Promise<void> {
  await writeFile(`${stopMarkPath(root)}.lift-failed`, `${JSON.stringify(detail, null, 2)}\n`, "utf8").catch(() => undefined);
}

/** What a previous continuation left behind, for `status` to report (N4). */
export async function readStopLiftFailure(root: string): Promise<string | null> {
  return await readFile(`${stopMarkPath(root)}.lift-failed`, "utf8").catch(() => null);
}
