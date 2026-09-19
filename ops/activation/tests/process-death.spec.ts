// What survives a process that stops existing.
//
// One of the owner's required operating proofs for the unattended run is "resumption after
// a process abort at critical boundaries". The boundary that matters most here is the one
// where a process holds the activation lease **and** has already changed the world: the
// lock file says an owner is alive, the world is half-way through a teardown, and nobody
// is coming back to finish it.
//
// This file kills a real process at that boundary and asks what the next invocation does.
// It is not the whole proof — a host-level proof needs unit 13's bindings and a real
// reboot — but it is the part that can be measured now, and it is measured against real
// files, a real lock and a real kill rather than against a fake.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readActivationLedger } from "../store/ledger-store.ts";
import { readStopMark } from "../store/stop-mark.ts";
import { foldLedgerSnapshot } from "../core/fold.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const COMPETE = path.join(REPO, "ops", "activation", "tests", "support", "compete.mjs");

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async item => { await rm(item, { recursive: true, force: true, maxRetries: 3 }); }));
});

async function root(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "gbt-death-"));
  roots.push(created);
  await writeFile(path.join(created, ".env"), "", "utf8");
  await writeFile(path.join(created, "world.json"), JSON.stringify({ tasks: { cycle: true, watchdog: true }, disarmRegistered: true, certificateLine: null, effects: [], enableDelayMs: 0 }, null, 2), "utf8");
  return created;
}

function start(argv: readonly string[]): ReturnType<typeof spawn> {
  return spawn(process.execPath, argv, { cwd: REPO, windowsHide: true });
}

function finish(argv: readonly string[]): Promise<{ readonly exitCode: number; readonly output: string }> {
  return new Promise((resolve, reject) => {
    const child = start(argv);
    let output = "";
    child.stdout?.on("data", chunk => { output += String(chunk); });
    child.stderr?.on("data", chunk => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", code => { resolve({ exitCode: code ?? -1, output }); });
  });
}

async function waitFor(file: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const seen = await readFile(file, "utf8").catch(() => null);
    if (seen !== null) return;
    await new Promise(resolve => { setTimeout(resolve, 20); });
  }
  throw new Error(`the process never reached its boundary: ${file}`);
}

describe("a process that dies holding the lease, half way through changing the world", () => {
  it("does not stop the next invocation from finishing the job", async () => {
    const stateRoot = await root();
    const worldFile = path.join(stateRoot, "world.json");
    const readyFile = path.join(stateRoot, "ready");

    const doomed = start([COMPETE, "hold-and-hang", stateRoot, worldFile, readyFile]);
    await waitFor(readyFile);

    // Half the world: one task disabled, the other still enabled, the lock held by a
    // process that is about to stop existing.
    const midway = JSON.parse(await readFile(worldFile, "utf8")) as { readonly tasks: Record<string, boolean> };
    expect(midway.tasks["cycle"]).toBe(false);
    expect(midway.tasks["watchdog"]).toBe(true);

    doomed.kill("SIGKILL");
    await new Promise<void>(resolve => { doomed.on("close", () => { resolve(); }); });

    // The owner types a stop afterwards, which is the realistic next move: something is
    // wrong, and he wants the deployment harmless.
    const stop = await finish([COMPETE, "stop", stateRoot, worldFile, "felix"]);
    expect(stop.exitCode).toBe(0);

    // The world is whole again, and it was the surviving invocation that finished it.
    const after = JSON.parse(await readFile(worldFile, "utf8")) as { readonly tasks: Record<string, boolean>; readonly disarmRegistered: boolean };
    expect(after.tasks["cycle"]).toBe(false);
    expect(after.tasks["watchdog"]).toBe(false);
    expect(after.disarmRegistered).toBe(false);

    // The stop mark stands, so nothing will arm this deployment until the owner says so.
    expect((await readStopMark(stateRoot)).kind).toBe("present");

    // And the record says a dead owner was found rather than pretending the lease was
    // free: the store's own stale-lock evidence is in the ledger, and the stop's terminal
    // entry is after it.
    const snapshot = await readActivationLedger(stateRoot);
    const kinds = snapshot.entries.map(entry => { const kind = entry.evidence["kind"]; return typeof kind === "string" ? kind : ""; });
    expect(kinds).toContain("stale-lock");
    const fold = foldLedgerSnapshot(snapshot);
    expect(fold.attemptEnded === null || fold.attemptEnded.byOwner).toBe(true);
  }, 60_000);

  it("leaves no lock behind that a later invocation cannot get past", async () => {
    const stateRoot = await root();
    const worldFile = path.join(stateRoot, "world.json");
    const readyFile = path.join(stateRoot, "ready");

    const doomed = start([COMPETE, "hold-and-hang", stateRoot, worldFile, readyFile]);
    await waitFor(readyFile);
    doomed.kill("SIGKILL");
    await new Promise<void>(resolve => { doomed.on("close", () => { resolve(); }); });

    // Two invocations in a row, because the first one's takeover must not leave a state
    // the second one trips over — which is the failure mode a takeover usually has.
    const first = await finish([path.join(REPO, "ops", "activation", "cli.ts"), "status", "--state-root", stateRoot]);
    const second = await finish([path.join(REPO, "ops", "activation", "cli.ts"), "status", "--state-root", stateRoot]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("ledger");
  }, 60_000);
});
