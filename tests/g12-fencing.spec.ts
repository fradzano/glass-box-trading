import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, inject, it } from "vitest";
import { authorizeMutation, compareAndIncrement, planEpochAcquisition, resetPairPresent, shouldAttemptTakeover, validateSchedulingBounds } from "../src/core/authority.js";
import type { EpochStoreState } from "../src/core/authority.js";
import { journalStaleness, parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { readEpochStore } from "../src/shell/epoch-store.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { createMutationGateway, NO_BROKER_PORT } from "../src/shell/mutation-gateway.js";
import type { BrokerMutationPort, MutationRequest } from "../src/shell/mutation-gateway.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN, bootstrapEntry, cycleEntry, draftOf, haltEntry, intentEntry, witnessEntry } from "./journal-fixtures.js";

const temporaryDirectories: string[] = [];
function temporaryStateDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p2-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const BOUND_MS = 60_000;
const BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;

function freshPaths(): StatePaths {
  const paths = resolveStateDir(temporaryStateDir());
  if (!paths.ok) throw new Error(paths.reason);
  return paths.value;
}

function recordingPort(): BrokerMutationPort & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, mutate: (request) => { calls.push(request); return Promise.resolve({ ok: true, brokerOrderId: "fake-1" }); } };
}

function gatewayFor(paths: StatePaths, instanceId: string, clock: () => number, port: BrokerMutationPort = NO_BROKER_PORT) {
  return createMutationGateway({ paths, secrets: [], clock, brokerPort: port, instanceId, lockTakeoverBoundMs: BOUND_MS, binding: BINDING });
}

function entriesOf(paths: StatePaths): readonly JournalEntry[] {
  return existsSync(paths.journal) ? parseJournalText(readFileSync(paths.journal, "utf8")).entries : [];
}

function submitOrder(epoch: number | null, clientOrderId = "entry:x"): MutationRequest {
  return { class: "authoritative", epoch, action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId, binding: BINDING } } };
}

async function runCli(compiledDist: string, args: readonly string[]): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(compiledDist, "shell", "gateway-cli.js"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", code => { resolve({ code, stdout, stderr }); });
  });
}

describe("S-G12-01 lock held by a live instance", () => {
  it("S-G12-01 the second instance is suppressed, appends one staleness-neutral witness line, and never reaches the broker", async () => {
    const paths = freshPaths();
    const portA = recordingPort();
    const portB = recordingPort();
    const first = gatewayFor(paths, "first", () => TEST_ONLY_AT_MS, portA);
    expect(await first.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1, seeded: "bootstrap" });
    expect(await first.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1)) } })).toMatchObject({ ok: true, seq: 1 });
    expect(await first.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(2)) } })).toMatchObject({ ok: true, seq: 2 });

    const second = gatewayFor(paths, "second", () => TEST_ONLY_AT_MS + 10_000, portB);
    const suppressed = await second.acquireAuthority({ account: "unknown" });
    expect(suppressed).toEqual({ kind: "SUPPRESSED", holderId: "first", reason: "LOCK_HELD" });
    expect(await second.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "NOT_THE_WRITER" });
    const witness = await second.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(3, "SUPPRESSED", { instanceId: "second", holderId: "first", reason: "LOCK_HELD", at: "2026-08-31T13:30:10.000Z" })) } });
    expect(witness).toMatchObject({ ok: true, seq: 3, stalenessNeutral: true });
    expect(await second.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(3, "SUPPRESSED", { instanceId: "second", holderId: "first", reason: "LOCK_HELD" })) } })).toMatchObject({ ok: false, reason: "WITNESS_ALREADY_RECORDED" });
    expect(await second.dispatch({ class: "witness", action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: "entry:x", binding: BINDING } } })).toMatchObject({ ok: false, reason: "WITNESS_CANNOT_MUTATE_BROKER" });
    expect(await second.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(cycleEntry(4)) } })).toMatchObject({ ok: false, reason: "WITNESS_TYPE_REQUIRED" });
    expect(await first.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(witnessEntry(4, "SUPPRESSED")) } })).toMatchObject({ ok: false, reason: "AUTHORITATIVE_TYPE_REQUIRED" });
    expect(portB.calls).toHaveLength(0);

    const entries = entriesOf(paths);
    expect(entries.map(entry => entry.type)).toEqual(["BOOTSTRAP", "CYCLE", "SUPPRESSED"]);
    expect(entries[2]).toMatchObject({ epoch: null });
    const staleness = journalStaleness(entries);
    expect(staleness).toEqual({ lastAuthoritativeAt: TEST_ONLY_AT, lastAt: "2026-08-31T13:30:10.000Z", lastAuthoritativeSeq: 2 });
    expect(journalStaleness([])).toEqual({ lastAuthoritativeAt: null, lastAt: null, lastAuthoritativeSeq: null });
    expect(await first.dispatch(submitOrder(1))).toMatchObject({ ok: true });
    expect(portA.calls).toHaveLength(1);
  });

  it("S-G12-01 concurrent in-process appends reach the file serialized, never interleaved", async () => {
    const paths = freshPaths();
    writeFileSync(paths.epoch, JSON.stringify({ epoch: 1, holderId: "prior", acquiredAt: TEST_ONLY_AT, seedPending: false }), "utf8");
    const gateway = gatewayFor(paths, "writer", () => TEST_ONLY_AT_MS);
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    const results = await Promise.all(Array.from({ length: 25 }, (_, index) => gateway.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2, cycleIndex: index })) } })));
    expect(results.every(result => result.ok)).toBe(true);
    const parsed = parseJournalText(readFileSync(paths.journal, "utf8"));
    expect(parsed.corrupt).toEqual([]);
    expect(parsed.torn).toBeNull();
    expect(parsed.entries.map(entry => entry.seq)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(new Set(parsed.entries.map(entry => (entry as unknown as { cycleIndex: number }).cycleIndex)).size).toBe(25);
  });

  it("S-G12-01 concurrent appends from separate processes (one writer, four witnesses) are serialized through the same lock", async () => {
    const compiledDist = inject("compiledDist");
    const paths = freshPaths();
    writeFileSync(paths.epoch, JSON.stringify({ epoch: 1, holderId: "dead", acquiredAt: TEST_ONLY_AT, seedPending: false }), "utf8");
    writeFileSync(paths.holder, JSON.stringify({ holderId: "dead", heartbeatAt: 0 }), "utf8");
    const processes = await Promise.all([
      runCli(compiledDist, [paths.root, "writer", "write", "20"]),
      ...Array.from({ length: 4 }, (_, index) => runCli(compiledDist, [paths.root, `bystander-${String(index)}`, "witness"])),
    ]);
    for (const result of processes) expect(result.code, result.stderr + result.stdout).toBe(0);
    const parsed = parseJournalText(readFileSync(paths.journal, "utf8"));
    expect(parsed.corrupt).toEqual([]);
    expect(parsed.torn).toBeNull();
    expect(parsed.entries.map(entry => entry.seq)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(parsed.entries.filter(entry => entry.type === "CYCLE")).toHaveLength(20);
    expect(parsed.entries.filter(entry => entry.type === "SUPPRESSED").map(entry => entry["instanceId"]).sort()).toEqual(["bystander-0", "bystander-1", "bystander-2", "bystander-3"]);
    expect(parsed.entries.filter(entry => entry.type === "CYCLE").every(entry => entry.epoch === 2)).toBe(true);
    expect(readEpochStore(paths)).toMatchObject({ kind: "present", epoch: 2, holderId: "writer" });
  }, 60_000);
});

describe("S-G12-02 time alone never grants authority", () => {
  it("S-G12-02 a stale heartbeat is only the trigger; authority comes from the epoch increment, and the bounds are scheduling constraints", async () => {
    expect(shouldAttemptTakeover(BOUND_MS + 1, BOUND_MS)).toBe(true);
    expect(shouldAttemptTakeover(BOUND_MS, BOUND_MS)).toBe(false);
    expect(shouldAttemptTakeover(-5, BOUND_MS)).toBe(false);
    expect(validateSchedulingBounds({ lockTakeoverBoundMs: 300_000, cycleWalltimeBudgetMs: 240_000, cycleIntervalMs: 900_000, deadManBoundMs: 3_000_000 })).toEqual({ ok: true });
    expect(validateSchedulingBounds({ lockTakeoverBoundMs: 240_000, cycleWalltimeBudgetMs: 240_000, cycleIntervalMs: 900_000, deadManBoundMs: 3_000_000 })).toMatchObject({ ok: false, violations: ["LOCK_TAKEOVER_BOUND_NOT_ABOVE_CYCLE_WALLTIME_BUDGET"] });
    expect(validateSchedulingBounds({ lockTakeoverBoundMs: 300_000, cycleWalltimeBudgetMs: 240_000, cycleIntervalMs: 900_000, deadManBoundMs: 2_579_999 })).toMatchObject({ ok: false, violations: ["TAKEOVER_DOES_NOT_FIT_DEAD_MAN_BOUND"] });
    expect(validateSchedulingBounds({ lockTakeoverBoundMs: 300_000, cycleWalltimeBudgetMs: 240_000, cycleIntervalMs: 900_000, deadManBoundMs: 2_580_000 })).toEqual({ ok: true });
    expect(validateSchedulingBounds({ lockTakeoverBoundMs: 0, cycleWalltimeBudgetMs: -1, cycleIntervalMs: 900_000, deadManBoundMs: 3_000_000 })).toMatchObject({ ok: false });

    const paths = freshPaths();
    const first = gatewayFor(paths, "first", () => TEST_ONLY_AT_MS);
    expect(await first.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1 });
    expect(await first.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1)) } })).toMatchObject({ ok: true, seq: 1 });
    // A fresh heartbeat: no takeover, regardless of how confident the second instance is.
    const eager = gatewayFor(paths, "eager", () => TEST_ONLY_AT_MS + BOUND_MS);
    expect(await eager.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "SUPPRESSED" });
    expect(await eager.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "NOT_THE_WRITER" });
    expect(await eager.dispatch(submitOrder(null))).toMatchObject({ ok: false, reason: "EPOCH_REQUIRED" });
    expect(await eager.dispatch(submitOrder(7))).toMatchObject({ ok: false, reason: "STALE_EPOCH" });
    // A stale heartbeat triggers the takeover; the takeover is the epoch increment, and only then may the taker act.
    const late = gatewayFor(paths, "late", () => TEST_ONLY_AT_MS + BOUND_MS + 1);
    // G1-F1: a stale heartbeat plus the observed epoch is still not authority — acquisition must happen first.
    expect(await late.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "NOT_THE_WRITER" });
    expect(await late.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2, seeded: null });
    expect(readEpochStore(paths)).toMatchObject({ kind: "present", epoch: 2, holderId: "late" });
    expect(await late.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "STALE_EPOCH" });
    // G3-F1: the appended entry's own epoch field is bound to the authorized request epoch.
    expect(await late.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 1 })) } })).toMatchObject({ ok: false, reason: "ENTRY_EPOCH_MISMATCH" });
    expect(await late.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 7 })) } })).toMatchObject({ ok: false, reason: "ENTRY_EPOCH_MISMATCH" });
    expect(await late.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2 })) } })).toMatchObject({ ok: true });
    expect(entriesOf(paths).map(entry => entry.epoch)).toEqual([1, 2]);
    // G3-F2: a restarted process with the same instanceId is not the acquirer of this process lifetime.
    const lateAgain = gatewayFor(paths, "late", () => TEST_ONLY_AT_MS + BOUND_MS + 2);
    expect(await lateAgain.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(2, { epoch: 2 })) } })).toMatchObject({ ok: false, reason: "NOT_ACQUIRED_IN_PROCESS" });
    expect(await lateAgain.dispatch(submitOrder(2))).toMatchObject({ ok: false, reason: "NOT_ACQUIRED_IN_PROCESS" });
    expect(await lateAgain.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 3 });
    expect(await lateAgain.dispatch({ class: "authoritative", epoch: 3, action: { kind: "journal_append", entry: draftOf(cycleEntry(2, { epoch: 3 })) } })).toMatchObject({ ok: true, seq: 3 });
  });
});

describe("S-G12-07 writer fencing at the single final gateway", () => {
  it("S-G12-07 (1) a paused writer resuming after a takeover has every authoritative mutation rejected while it holds the lock, and may append exactly one FENCED_OUT witness", async () => {
    const paths = freshPaths();
    const oldPort = recordingPort();
    let now = TEST_ONLY_AT_MS;
    const old = gatewayFor(paths, "old", () => now, oldPort);
    expect(await old.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1 });
    expect(await old.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1)) } })).toMatchObject({ ok: true });
    expect(await old.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(2)) } })).toMatchObject({ ok: true });
    // The old writer pauses; its heartbeat goes stale; a successor fences it.
    now += BOUND_MS + 1;
    const successor = gatewayFor(paths, "successor", () => now);
    expect(await successor.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    // The old writer wakes up, still believing in epoch 1, and reacquires the OS lock on every dispatch.
    const requests: readonly MutationRequest[] = [
      submitOrder(1, "entry:new"),
      { class: "authoritative", epoch: 1, action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: "entry:x", binding: BINDING } } },
      { class: "authoritative", epoch: 1, action: { kind: "broker_mutation", mutation: { kind: "close_position", clientOrderId: "close:x:g0", binding: BINDING } } },
      { class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(2)) } },
      { class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(intentEntry(2)) } },
      { class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(haltEntry(3)) } },
    ];
    for (const request of requests) {
      const result = await old.dispatch(request);
      expect(result).toMatchObject({ ok: false, reason: "STALE_EPOCH", lockHeld: true });
    }
    expect(oldPort.calls).toHaveLength(0);
    // Reacquiring the lock explicitly (heartbeat refresh) does not help either.
    await old.heartbeat();
    expect(await old.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "STALE_EPOCH", lockHeld: true });
    const fenced = await old.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(2, "FENCED_OUT", { instanceId: "old", staleEpoch: 1, observedEpoch: 2 })) } });
    expect(fenced).toMatchObject({ ok: true, seq: 3, stalenessNeutral: true });
    expect(await old.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(3, "FENCED_OUT", { instanceId: "old", staleEpoch: 1, observedEpoch: 2 })) } })).toMatchObject({ ok: false, reason: "WITNESS_ALREADY_RECORDED" });
    expect(await old.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(3, "FENCED_OUT", { instanceId: "old", staleEpoch: 1, observedEpoch: 3 })) } })).toMatchObject({ ok: false, reason: "WITNESS_ALREADY_RECORDED" });
    expect(await old.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(3, "SUPPRESSED", { instanceId: "old", holderId: "successor", reason: "EPOCH_CHANGED" })) } })).toMatchObject({ ok: false, reason: "WITNESS_ALREADY_RECORDED" });
    expect(entriesOf(paths).map(entry => entry.type)).toEqual(["BOOTSTRAP", "CYCLE", "FENCED_OUT"]);
    expect(await successor.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(4, { epoch: 2 })) } })).toMatchObject({ ok: true, seq: 4 });
    expect(readEpochStore(paths)).toMatchObject({ kind: "present", epoch: 2 });
  });

  it("S-G12-07 (5) a request built before a takeover is rejected when dispatched after it; an unreadable epoch never authorizes", async () => {
    const paths = freshPaths();
    let now = TEST_ONLY_AT_MS;
    const writer = gatewayFor(paths, "writer", () => now);
    expect(await writer.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1 });
    const prepared = submitOrder(1);
    now += BOUND_MS + 1;
    const taker = gatewayFor(paths, "taker", () => now);
    expect(await taker.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    expect(await writer.dispatch(prepared)).toMatchObject({ ok: false, reason: "STALE_EPOCH" });

    writeFileSync(paths.epoch, "{corrupt", "utf8");
    expect(readEpochStore(paths)).toMatchObject({ kind: "unreadable" });
    expect(await taker.dispatch(submitOrder(2))).toMatchObject({ ok: false, reason: "EPOCH_UNREADABLE" });
    expect(await taker.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2 })) } })).toMatchObject({ ok: false, reason: "EPOCH_UNREADABLE" });
    const third = gatewayFor(paths, "third", () => now + BOUND_MS + 1);
    expect(await third.acquireAuthority({ account: "virgin" })).toEqual({ kind: "REFUSED", reason: "EPOCH_UNREADABLE" });
    expect(await third.dispatch({ class: "witness", action: { kind: "journal_append", entry: draftOf(witnessEntry(1, "SUPPRESSED", { instanceId: "third", holderId: "taker", reason: "EPOCH_UNREADABLE" })) } })).toMatchObject({ ok: true });
    expect(readFileSync(paths.epoch, "utf8")).toBe("{corrupt");
    writeFileSync(paths.epoch, JSON.stringify({ epoch: 0, holderId: "x", acquiredAt: TEST_ONLY_AT }), "utf8");
    expect(readEpochStore(paths)).toMatchObject({ kind: "unreadable" });
    writeFileSync(paths.epoch, JSON.stringify({ epoch: 2.5, holderId: "x", acquiredAt: TEST_ONLY_AT }), "utf8");
    expect(readEpochStore(paths)).toMatchObject({ kind: "unreadable" });
  });

  it("S-G12-07 (3) two concurrent takeover attempts in one process yield exactly one winner; the loser demotes itself", async () => {
    const paths = freshPaths();
    writeFileSync(paths.epoch, JSON.stringify({ epoch: 4, holderId: "dead", acquiredAt: TEST_ONLY_AT }), "utf8");
    writeFileSync(paths.holder, JSON.stringify({ holderId: "dead", heartbeatAt: TEST_ONLY_AT_MS - BOUND_MS - 5 }), "utf8");
    const left = gatewayFor(paths, "left", () => TEST_ONLY_AT_MS);
    const right = gatewayFor(paths, "right", () => TEST_ONLY_AT_MS);
    const results = await Promise.all([left.acquireAuthority({ account: "unknown" }), right.acquireAuthority({ account: "unknown" })]);
    const winners = results.filter(result => result.kind === "WON");
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ epoch: 5 });
    const loser = results.find(result => result.kind !== "WON");
    expect(loser?.kind === "LOST" || loser?.kind === "SUPPRESSED").toBe(true);
    expect(readEpochStore(paths)).toMatchObject({ kind: "present", epoch: 5 });
    const [winner, other] = results[0].kind === "WON" ? [left, right] : [right, left];
    expect(await winner.dispatch({ class: "authoritative", epoch: 5, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 5 })) } })).toMatchObject({ ok: true });
    expect(await other.dispatch({ class: "authoritative", epoch: 5, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 5 })) } })).toMatchObject({ ok: false, reason: "NOT_THE_WRITER" });
    expect(await other.dispatch({ class: "authoritative", epoch: 4, action: { kind: "journal_append", entry: draftOf(cycleEntry(1)) } })).toMatchObject({ ok: false });
    // G1-F1: once the winner's heartbeat is stale, the loser still cannot dispatch with the epoch it merely observed — it never acquired it.
    const laterLoser = gatewayFor(paths, other === left ? "left" : "right", () => TEST_ONLY_AT_MS + BOUND_MS + 1);
    expect(await laterLoser.dispatch({ class: "authoritative", epoch: 5, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 5 })) } })).toMatchObject({ ok: false, reason: "NOT_THE_WRITER" });
    expect(await laterLoser.dispatch(submitOrder(5))).toMatchObject({ ok: false, reason: "NOT_THE_WRITER" });
    expect(entriesOf(paths)).toHaveLength(1);
  });

  it("S-G12-07 (3) takeover attempts from separate processes yield exactly one winner and one epoch increment", async () => {
    const compiledDist = inject("compiledDist");
    const paths = freshPaths();
    writeFileSync(paths.epoch, JSON.stringify({ epoch: 9, holderId: "dead", acquiredAt: TEST_ONLY_AT }), "utf8");
    writeFileSync(paths.holder, JSON.stringify({ holderId: "dead", heartbeatAt: 0 }), "utf8");
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => runCli(compiledDist, [paths.root, `taker-${String(index)}`, "takeover"])));
    for (const result of results) expect(result.code, result.stderr).toBe(0);
    const outcomes = results.map(result => JSON.parse(result.stdout) as { kind: string; epoch?: number });
    const winners = outcomes.filter(outcome => outcome.kind === "WON");
    expect(winners).toHaveLength(1);
    expect(winners[0]?.epoch).toBe(10);
    expect(outcomes.every(outcome => outcome.kind === "WON" || outcome.kind === "LOST" || outcome.kind === "SUPPRESSED")).toBe(true);
    expect(readEpochStore(paths)).toMatchObject({ kind: "present", epoch: 10 });
  }, 60_000);

  it("S-G12-07 (4) the watchdog acquires its own epoch atomically like any other taker", async () => {
    const paths = freshPaths();
    let now = TEST_ONLY_AT_MS;
    const agent = gatewayFor(paths, "agent", () => now);
    expect(await agent.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1 });
    expect(await agent.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1)) } })).toMatchObject({ ok: true, seq: 1 });
    now += BOUND_MS + 1;
    const watchdog = gatewayFor(paths, "watchdog", () => now);
    expect(await watchdog.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    expect(await watchdog.dispatch({ class: "authoritative", epoch: 2, action: { kind: "broker_mutation", mutation: { kind: "close_position", clientOrderId: "close:x:g0", binding: BINDING } } })).toMatchObject({ ok: false, reason: "BROKER_PORT_NOT_IMPLEMENTED" });
    expect(await agent.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "STALE_EPOCH" });
  });

  it("S-G12-07 an absent epoch store facing a non-virgin account is the GAP path with halt; a virgin re-seed must be journaled as BOOTSTRAP", async () => {
    // Non-virgin account, absent store.
    const gapPaths = freshPaths();
    const gapGateway = gatewayFor(gapPaths, "agent", () => TEST_ONLY_AT_MS);
    expect(await gapGateway.acquireAuthority({ account: "non_virgin" })).toMatchObject({ kind: "GAP_HALT", epoch: 1 });
    expect(entriesOf(gapPaths).map(entry => entry.type)).toEqual(["GAP", "HALT"]);
    expect(entriesOf(gapPaths)[1]).toMatchObject({ type: "HALT", reason: "EPOCH_STORE_RESET", sticky: false });
    expect(readHaltState(gapPaths)).toMatchObject({ halted: true, reason: "EPOCH_STORE_RESET" });
    expect(readEpochStore(gapPaths)).toMatchObject({ kind: "present", epoch: 1 });
    // G3-F3: if the GAP/HALT pair cannot land, no store may exist afterwards — the next attempt takes the GAP path again.
    const blockedPaths = freshPaths();
    writeFileSync(blockedPaths.journal, "", "utf8");
    chmodSync(blockedPaths.journal, 0o444);
    const blocked = gatewayFor(blockedPaths, "agent", () => TEST_ONLY_AT_MS);
    expect(await blocked.acquireAuthority({ account: "non_virgin" })).toMatchObject({ kind: "REFUSED", reason: expect.stringContaining("EPERM") });
    // The pending store is durable but authorizes nothing; the crashed twin cannot use it, the next acquirer completes it.
    expect(readEpochStore(blockedPaths)).toMatchObject({ kind: "present", epoch: 1, holderId: "agent", resetPending: true });
    expect(await blocked.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "RESET_PENDING" });
    chmodSync(blockedPaths.journal, 0o644);
    expect(await gatewayFor(blockedPaths, "agent-retry", () => TEST_ONLY_AT_MS + BOUND_MS + 1_000).acquireAuthority({ account: "non_virgin" })).toMatchObject({ kind: "GAP_HALT", epoch: 2 });
    expect(entriesOf(blockedPaths).map(entry => [entry.type, entry.epoch])).toEqual([["GAP", 2], ["HALT", 2]]);
    expect(readEpochStore(blockedPaths)).toMatchObject({ kind: "present", epoch: 2, resetPending: false });
    // G5-F1: the reset is a persisted pending acquisition. The pair is appended only under a pending epoch that exists in
    // the store; a failed store write leaves nothing behind; an interrupted reset is completed, never duplicated.
    const dirPaths = freshPaths();
    const temporaryStorePath = `${dirPaths.epoch}.${String(process.pid)}.tmp`;
    mkdirSync(temporaryStorePath);
    const storeFails = gatewayFor(dirPaths, "agent", () => TEST_ONLY_AT_MS);
    expect(await storeFails.acquireAuthority({ account: "non_virgin" })).toMatchObject({ kind: "REFUSED" });
    expect(entriesOf(dirPaths)).toEqual([]);
    expect(existsSync(dirPaths.halt)).toBe(false);
    expect(existsSync(dirPaths.holder)).toBe(false);
    rmSync(temporaryStorePath, { recursive: true, force: true });
    expect(await gatewayFor(dirPaths, "agent-retry", () => TEST_ONLY_AT_MS + 1_000).acquireAuthority({ account: "non_virgin" })).toMatchObject({ kind: "GAP_HALT", epoch: 1 });
    expect(entriesOf(dirPaths).map(entry => entry.type)).toEqual(["GAP", "HALT"]);
    expect(readEpochStore(dirPaths)).toMatchObject({ kind: "present", epoch: 1, resetPending: false });
    // Interrupted after the pending store was written, before the pair: the next acquirer completes exactly one pair.
    const pendingPaths = freshPaths();
    writeFileSync(pendingPaths.epoch, JSON.stringify({ epoch: 1, holderId: "crashed", acquiredAt: TEST_ONLY_AT, seedPending: false, resetPending: true }), "utf8");
    writeFileSync(pendingPaths.holder, JSON.stringify({ holderId: "crashed", heartbeatAt: 0 }), "utf8");
    const crashedTwin = gatewayFor(pendingPaths, "crashed", () => TEST_ONLY_AT_MS);
    expect(await crashedTwin.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(1)) } })).toMatchObject({ ok: false, reason: "RESET_PENDING" });
    const completer = gatewayFor(pendingPaths, "completer", () => TEST_ONLY_AT_MS + 1_000);
    expect(await completer.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "GAP_HALT", epoch: 2 });
    expect(entriesOf(pendingPaths).map(entry => [entry.type, entry.epoch])).toEqual([["GAP", 2], ["HALT", 2]]);
    expect(readEpochStore(pendingPaths)).toMatchObject({ kind: "present", epoch: 2, holderId: "completer", resetPending: false });
    expect(readHaltState(pendingPaths)).toMatchObject({ halted: true, reason: "EPOCH_STORE_RESET" });
    expect(await completer.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2 })) } })).toMatchObject({ ok: true, seq: 3 });
    // Interrupted after the pair, before promotion: promote without a second pair.
    const promotePaths = freshPaths();
    const firstTry = gatewayFor(promotePaths, "first", () => TEST_ONLY_AT_MS);
    expect(await firstTry.acquireAuthority({ account: "non_virgin" })).toMatchObject({ kind: "GAP_HALT", epoch: 1 });
    writeFileSync(promotePaths.epoch, JSON.stringify({ epoch: 1, holderId: "first", acquiredAt: TEST_ONLY_AT, seedPending: false, resetPending: true }), "utf8");
    writeFileSync(promotePaths.holder, JSON.stringify({ holderId: "first", heartbeatAt: 0 }), "utf8");
    expect(await gatewayFor(promotePaths, "second", () => TEST_ONLY_AT_MS + 1_000).acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "GAP_HALT", epoch: 2 });
    expect(entriesOf(promotePaths).map(entry => entry.type)).toEqual(["GAP", "HALT"]);
    expect(readEpochStore(promotePaths)).toMatchObject({ kind: "present", epoch: 2, resetPending: false });
    // While a reset is pending in the store, nothing authoritative passes — not even for the pending holder itself.
    const guardPaths = freshPaths();
    writeFileSync(guardPaths.epoch, JSON.stringify({ epoch: 1, holderId: "agent", acquiredAt: TEST_ONLY_AT, seedPending: false, resetPending: true }), "utf8");
    expect(authorizeMutation({ class: "authoritative", epoch: 1, action: { kind: "broker_mutation" } }, readEpochStore(guardPaths))).toEqual({ authorized: false, reason: "RESET_PENDING" });
    // Unknown account state is treated as non-virgin.
    const unknownPaths = freshPaths();
    expect(await gatewayFor(unknownPaths, "agent", () => TEST_ONLY_AT_MS).acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "GAP_HALT" });
    // A store reset under an existing journal is a reset even when the account looks virgin.
    const resetPaths = freshPaths();
    const original = gatewayFor(resetPaths, "agent", () => TEST_ONLY_AT_MS);
    expect(await original.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1, seeded: "bootstrap" });
    expect(await original.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1)) } })).toMatchObject({ ok: true });
    rmSync(resetPaths.epoch);
    rmSync(resetPaths.holder);
    expect(await gatewayFor(resetPaths, "agent-restarted", () => TEST_ONLY_AT_MS + 1_000).acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "GAP_HALT" });
    // Virgin account, empty journal: the seed is allowed but must be journaled before anything else.
    const seedPaths = freshPaths();
    const seeded = gatewayFor(seedPaths, "agent", () => TEST_ONLY_AT_MS);
    expect(await seeded.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1, seeded: "bootstrap" });
    expect(await seeded.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(1)) } })).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
    expect(await seeded.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
    expect(await seeded.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1, { epochSeeded: false })) } })).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
    // G1-F2: the obligation is persisted in the store, not in process memory — a restarted instance inherits it.
    expect(readEpochStore(seedPaths)).toMatchObject({ kind: "present", epoch: 1, seedPending: true });
    const restarted = gatewayFor(seedPaths, "agent", () => TEST_ONLY_AT_MS + 500);
    // G3-F2 first: the restarted process never acquired; had it acquired, the inherited flag (G2-F1, tested below) would still block it.
    expect(await restarted.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(1)) } })).toMatchObject({ ok: false, reason: "NOT_ACQUIRED_IN_PROCESS" });
    expect(await restarted.dispatch(submitOrder(1))).toMatchObject({ ok: false, reason: "NOT_ACQUIRED_IN_PROCESS" });
    expect(await seeded.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1)) } })).toMatchObject({ ok: true, seq: 1 });
    expect(readEpochStore(seedPaths)).toMatchObject({ kind: "present", epoch: 1, seedPending: false });
    expect(await seeded.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(2)) } })).toMatchObject({ ok: true, seq: 2 });
    // G2-F1: the seed obligation survives a takeover as well — an acquirer that increments a seed-pending store inherits it.
    const takeoverPaths = freshPaths();
    expect(await gatewayFor(takeoverPaths, "seeder", () => TEST_ONLY_AT_MS).acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 1, seeded: "bootstrap" });
    const inheritor = gatewayFor(takeoverPaths, "inheritor", () => TEST_ONLY_AT_MS + BOUND_MS + 1);
    expect(await inheritor.acquireAuthority({ account: "virgin" })).toMatchObject({ kind: "WON", epoch: 2, seeded: "bootstrap" });
    expect(readEpochStore(takeoverPaths)).toMatchObject({ kind: "present", epoch: 2, holderId: "inheritor", seedPending: true });
    expect(await inheritor.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2 })) } })).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
    expect(await inheritor.dispatch(submitOrder(2))).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
    expect(await inheritor.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(bootstrapEntry(1, { epoch: 2 })) } })).toMatchObject({ ok: true, seq: 1 });
    expect(readEpochStore(takeoverPaths)).toMatchObject({ kind: "present", epoch: 2, seedPending: false });
    expect(readdirSync(seedPaths.root).sort()).toEqual(["epoch.json", "halt.json", "holder.json", "journal.jsonl", "quarantine"].filter(name => name !== "halt.json" || existsSync(seedPaths.halt)).sort());
  });

  it("S-G12-07 the pure authority core decides acquisition, compare-and-increment, and authorization without any clock", () => {
    const absent: EpochStoreState = { kind: "absent" };
    const present: EpochStoreState = { kind: "present", epoch: 3, holderId: "a", acquiredAt: TEST_ONLY_AT, seedPending: false, resetPending: false };
    const unreadable: EpochStoreState = { kind: "unreadable", detail: "x" };
    expect(planEpochAcquisition(absent, { account: "virgin", journalEmpty: true })).toEqual({ kind: "SEED_BOOTSTRAP", epoch: 1 });
    expect(planEpochAcquisition(absent, { account: "virgin", journalEmpty: false })).toEqual({ kind: "SEED_GAP", epoch: 1, haltReason: "EPOCH_STORE_RESET" });
    expect(planEpochAcquisition(absent, { account: "non_virgin", journalEmpty: true })).toEqual({ kind: "SEED_GAP", epoch: 1, haltReason: "EPOCH_STORE_RESET" });
    expect(planEpochAcquisition(absent, { account: "unknown", journalEmpty: true })).toEqual({ kind: "SEED_GAP", epoch: 1, haltReason: "EPOCH_STORE_RESET" });
    expect(planEpochAcquisition(present, { account: "virgin", journalEmpty: true })).toEqual({ kind: "INCREMENT", expected: 3, next: 4, seedPending: false, resetPending: false });
    expect(planEpochAcquisition({ ...present, seedPending: true }, { account: "non_virgin", journalEmpty: false })).toEqual({ kind: "INCREMENT", expected: 3, next: 4, seedPending: true, resetPending: false });
    expect(planEpochAcquisition({ ...present, resetPending: true }, { account: "virgin", journalEmpty: true })).toEqual({ kind: "INCREMENT", expected: 3, next: 4, seedPending: false, resetPending: true });
    expect(resetPairPresent([cycleEntry(1), { ...cycleEntry(2), type: "GAP", reasonCodes: [], snapshot: null, detail: "x" } as unknown as JournalEntry, { ...cycleEntry(3), type: "HALT", reason: "EPOCH_STORE_RESET", detail: "x", sticky: false } as unknown as JournalEntry])).toBe(true);
    expect(resetPairPresent([cycleEntry(1), { ...cycleEntry(2), type: "HALT", reason: "EPOCH_STORE_RESET", detail: "x", sticky: false } as unknown as JournalEntry])).toBe(false);
    expect(resetPairPresent([{ ...cycleEntry(1), type: "GAP", reasonCodes: [], snapshot: null, detail: "x" } as unknown as JournalEntry, { ...cycleEntry(2), type: "HALT", reason: "MANUAL", detail: "x", sticky: false } as unknown as JournalEntry])).toBe(false);
    expect(resetPairPresent([])).toBe(false);
    expect(planEpochAcquisition(unreadable, { account: "virgin", journalEmpty: true })).toEqual({ kind: "REFUSE", reason: "EPOCH_UNREADABLE" });
    expect(planEpochAcquisition({ kind: "present", epoch: Number.MAX_SAFE_INTEGER, holderId: "a", acquiredAt: TEST_ONLY_AT, seedPending: false, resetPending: false }, { account: "virgin", journalEmpty: true })).toEqual({ kind: "REFUSE", reason: "EPOCH_EXHAUSTED" });
    expect(compareAndIncrement(present, 3)).toEqual({ kind: "COMMIT", next: 4 });
    expect(compareAndIncrement({ ...present, epoch: 4 }, 3)).toEqual({ kind: "CHANGED", observed: 4 });
    expect(compareAndIncrement(absent, 3)).toEqual({ kind: "CHANGED", observed: null });
    expect(compareAndIncrement(unreadable, 3)).toEqual({ kind: "REFUSE", reason: "EPOCH_UNREADABLE" });

    const append = { kind: "journal_append", entryType: "CYCLE" } as const;
    expect(authorizeMutation({ class: "authoritative", epoch: 3, action: append }, { ...present, resetPending: true })).toEqual({ authorized: false, reason: "RESET_PENDING" });
    expect(authorizeMutation({ class: "authoritative", epoch: 3, action: append }, present)).toEqual({ authorized: true });
    expect(authorizeMutation({ class: "authoritative", epoch: 2, action: append }, present)).toEqual({ authorized: false, reason: "STALE_EPOCH" });
    expect(authorizeMutation({ class: "authoritative", epoch: 4, action: append }, present)).toEqual({ authorized: false, reason: "STALE_EPOCH" });
    expect(authorizeMutation({ class: "authoritative", epoch: null, action: append }, present)).toEqual({ authorized: false, reason: "EPOCH_REQUIRED" });
    expect(authorizeMutation({ class: "authoritative", epoch: 3, action: append }, absent)).toEqual({ authorized: false, reason: "EPOCH_ABSENT" });
    expect(authorizeMutation({ class: "authoritative", epoch: 3, action: append }, unreadable)).toEqual({ authorized: false, reason: "EPOCH_UNREADABLE" });
    expect(authorizeMutation({ class: "authoritative", epoch: 3, action: { kind: "journal_append", entryType: "SUPPRESSED" } }, present)).toEqual({ authorized: false, reason: "AUTHORITATIVE_TYPE_REQUIRED" });
    expect(authorizeMutation({ class: "authoritative", epoch: 3, action: { kind: "broker_mutation" } }, present)).toEqual({ authorized: true });
    expect(authorizeMutation({ class: "witness", action: { kind: "journal_append", entryType: "FENCED_OUT" } }, unreadable)).toEqual({ authorized: true });
    expect(authorizeMutation({ class: "witness", action: { kind: "journal_append", entryType: "SUPPRESSED" } }, absent)).toEqual({ authorized: true });
    expect(authorizeMutation({ class: "witness", action: { kind: "journal_append", entryType: "CYCLE" } }, present)).toEqual({ authorized: false, reason: "WITNESS_TYPE_REQUIRED" });
    expect(authorizeMutation({ class: "witness", action: { kind: "broker_mutation" } }, present)).toEqual({ authorized: false, reason: "WITNESS_CANNOT_MUTATE_BROKER" });
  });

  it("S-G12-07 (2) no shell code path mutates the journal or the broker except through the gateway", () => {
    const shellDirectory = path.resolve("src/shell");
    const files = readdirSync(shellDirectory).filter(name => name.endsWith(".ts"));
    const writers = files.filter(name => /appendFile|createWriteStream|writeSync|writeFile\(|truncateSync|"a"|'a'/u.test(readFileSync(path.join(shellDirectory, name), "utf8")) && name !== "render-fixture.ts");
    // diagnostic-sink.ts writes ONLY to the pre-armed OS sink outside STATE_DIR (S-CYC-11); it can reach
    // neither the journal nor the broker and is never state authority. dashboard-build.ts (P6) writes ONLY
    // rendered pages into the site output directory through its injected sink (S-J-07); it reads the journal
    // through the pure projection and never touches STATE_DIR.
    // ping-healthchecks.ts (P7) appends ONLY the local ping record (a sidecar in STATE_DIR outside the journal, epoch,
    // and halt flag) as the dead-man port's fallback; the runner decides every ping through the pure planPing.
    expect(writers.sort()).toEqual(["dashboard-build.ts", "diagnostic-sink.ts", "epoch-store.ts", "journal-store.ts", "ping-healthchecks.ts"]);
    const atomicWriters = files.filter(name => readFileSync(path.join(shellDirectory, name), "utf8").includes("writeJsonAtomically"));
    // publisher.ts (P6) writes the push state and the deployment receipts — sidecar files in STATE_DIR outside the
    // journal, epoch, and halt flag (S-J-07: receipts never create a journal revision); its only journal append is
    // the S-J-08 refusal, dispatched through the gateway.
    expect(atomicWriters.sort()).toEqual(["epoch-store.ts", "halt-state.ts", "publisher.ts"]);
    const importers = files.filter(name => readFileSync(path.join(shellDirectory, name), "utf8").includes("./journal-store.js"));
    expect(importers).toEqual(["mutation-gateway.ts"]);
    const brokerUsers = files.filter(name => /brokerPort|\.mutate\(/u.test(readFileSync(path.join(shellDirectory, name), "utf8")));
    // watchdog.ts (P5) constructs its own gateway like gateway-cli; it never calls the port directly.
    // agent-runtime.ts (P7) is the composition root: it constructs the gateway with the real Alpaca port exactly like
    // gateway-cli constructs it with the fake; it never calls the port itself.
    expect(brokerUsers.sort()).toEqual(["agent-runtime.ts", "gateway-cli.ts", "manual-unhalt.ts", "mutation-gateway.ts", "watchdog.ts"]);
    for (const name of ["gateway-cli.ts", "manual-unhalt.ts", "watchdog.ts", "watchdog-cli.ts", "deadline.ts", "cycle-runner.ts", "agent-runtime.ts", "certificate-run.ts", "certificate-cli.ts", "agent-cli.ts"]) {
      expect(readFileSync(path.join(shellDirectory, name), "utf8")).not.toMatch(/\.mutate\(/u);
    }
  });
});
