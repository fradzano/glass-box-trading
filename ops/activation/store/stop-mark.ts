// The durable half of the owner's stop (`docs/P12-STOP-AND-LOG-CONTRACTS.md`, SC-2).
//
// One small file beside the ledger, `stop.json`, written before the stop's first
// teardown action and removed only by `activation open`. It is deliberately not a ledger
// entry: the ledger lives under a lease, and the whole point of the mark is to stand
// before the lease is taken and to be readable by an invocation that is *holding* that
// lease.
//
// Durability, in the order it matters: the bytes go to a temporary file, that file is
// fsynced, and only then is it renamed onto the final name. A reader therefore sees
// either no mark or a whole one, never half of one.
import { open as openFile, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { StopMark, StopMarkState } from "../core/stop.ts";

export function stopMarkPath(root: string): string {
  return path.join(root, "stop.json");
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { readonly code: unknown }).code) : null;
}

/**
 * What the state root says about a stop.
 *
 * Three answers, and the third one is load-bearing: a file that exists but cannot be read
 * or cannot be parsed is `unreadable`, never `absent`. `stopRefusal` turns that into a
 * refusal of every arming action, which is the safe direction — see the note there.
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "unreadable", reason: `${stopMarkPath(root)}: not JSON` };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "unreadable", reason: `${stopMarkPath(root)}: not an object` };
  const record = parsed as Record<string, unknown>;
  const operator = record["operator"];
  const at = record["at"];
  const atUtcMs = record["atUtcMs"];
  const reason = record["reason"];
  if (typeof operator !== "string" || typeof at !== "string" || typeof atUtcMs !== "number" || typeof reason !== "string") {
    return { kind: "unreadable", reason: `${stopMarkPath(root)}: a field is missing or of the wrong type` };
  }
  return { kind: "present", mark: { operator, at, atUtcMs, reason } };
}

/**
 * Writes the mark durably, or throws. The caller reports a failure rather than swallowing
 * it: a stop whose mark could not be written still disarms, but it is not a durable stop
 * and must not be reported as one (SC-2).
 */
export async function writeStopMark(root: string, mark: StopMark): Promise<void> {
  const target = stopMarkPath(root);
  const temporary = `${target}.writing`;
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
 * Removes the mark. Only `activation open` calls this — the owner's typed continuation is
 * the one thing that lifts his own stop (SC-8). An absent mark is not an error: clearing
 * what is not there is the state the caller wanted.
 */
export async function clearStopMark(root: string): Promise<boolean> {
  try {
    await unlink(stopMarkPath(root));
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}
