// Unit 9, red first: the activation record is useful only if the store makes
// the codec's promises durable under concurrency and failure. These tests use
// real files for byte-level and lock behaviour, and narrow fault ports for the
// failures that cannot be produced safely on the host (disk full and fsync).
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LedgerDraft } from "../core/ledger.ts";
import { planLedgerAppend } from "../core/ledger.ts";
import {
  LedgerStoreError,
  ledgerStorePaths,
  nodeLedgerStoreIo,
  readActivationLedger,
  withActivationLedger,
  type LedgerLockOwner,
  type LedgerStoreIo,
  type LedgerSystemEvent,
} from "../store/ledger-store.ts";

const roots: string[] = [];
const OWNER: LedgerLockOwner = { pid: 4_242, startedAtUtcMs: 1_789_900_000_000 };

async function root(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "gbt-activation-ledger-"));
  roots.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async item => { await rm(item, { recursive: true, force: true }); }));
});

function draft(index = 0, overrides: Partial<LedgerDraft> = {}): LedgerDraft {
  return {
    at: `2026-09-21T15:35:${String(index).padStart(2, "0")}+02:00`,
    atUtcMs: 1_789_997_700_000 + index * 1_000,
    attempt: `a${String(index)}`,
    anchorDay: "2026-09-22",
    step: "0-preflight",
    kind: "intent",
    outcome: null,
    evidence: { index },
    nextOwnerAction: null,
    ...overrides,
  };
}

function systemDraft(event: LedgerSystemEvent, tail: { readonly lastAtUtcMs: number | null }): LedgerDraft {
  const isTorn = event.kind === "torn-tail";
  const atUtcMs = tail.lastAtUtcMs ?? 1_789_997_700_000;
  const at = new Date(atUtcMs + 2 * 60 * 60 * 1_000).toISOString().replace("Z", "+02:00");
  return draft(0, {
    at,
    atUtcMs,
    attempt: "system",
    step: null,
    kind: isTorn ? "correction" : "note",
    evidence: event,
  });
}

async function appendActivationLedger(input: {
  readonly root: string;
  readonly owner: LedgerLockOwner;
  readonly draft: LedgerDraft;
  readonly makeSystemDraft: typeof systemDraft;
  readonly io?: LedgerStoreIo;
  readonly contentionTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}) {
  const { draft: requested, ...lease } = input;
  const result = await withActivationLedger(lease, async session => session.append(requested));
  if (result.kind === "contended") return result;
  return { kind: "appended" as const, entries: [...result.systemEntries, ...result.value] };
}

async function expectStoreError(promise: Promise<unknown>, stage: string, reason: string): Promise<LedgerStoreError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerStoreError);
    const storeError = error as LedgerStoreError;
    expect(storeError.stage).toBe(stage);
    expect(storeError.reason).toBe(reason);
    return storeError;
  }
  throw new Error("expected LedgerStoreError");
}

describe("activation ledger store — bytes and state", () => {
  it("keeps absent, empty, intact, torn and corrupt as five distinct states", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    expect((await readActivationLedger(stateRoot)).state).toBe("absent");

    await writeFile(paths.ledger, Buffer.alloc(0));
    expect((await readActivationLedger(stateRoot)).state).toBe("empty");

    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft });
    expect((await readActivationLedger(stateRoot)).state).toBe("intact");

    await writeFile(paths.ledger, Buffer.from('{"seq":2', "utf8"), { flag: "a" });
    expect((await readActivationLedger(stateRoot)).state).toBe("torn");

    const corruptRoot = await root();
    await writeFile(ledgerStorePaths(corruptRoot).ledger, Buffer.from("not-json\n", "utf8"));
    expect((await readActivationLedger(corruptRoot)).state).toBe("corrupt");
  });

  it("writes only the codec's UTF-8, one-LF line and fsyncs before resolving", async () => {
    const stateRoot = await root();
    let synced = false;
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== ledgerStorePaths(stateRoot).ledger) return handle;
        return {
          ...handle,
          async sync() { await handle.sync(); synced = true; },
        };
      },
    };
    const result = await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io });
    expect(synced).toBe(true);
    expect(result.kind).toBe("appended");
    const bytes = await readFile(ledgerStorePaths(stateRoot).ledger);
    expect(bytes.at(-1)).toBe(0x0a);
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes.toString("utf8")).toBe(`${JSON.stringify(result.entries[0])}\n`);
  });

  it("serializes concurrent writers: every seq is unique and no line is interleaved", async () => {
    const stateRoot = await root();
    const io: LedgerStoreIo = { ...nodeLedgerStoreIo, processState() { return Promise.resolve("alive"); } };
    const writes = Array.from({ length: 24 }, (_, index) => appendActivationLedger({
      root: stateRoot,
      owner: { pid: process.pid + index + 1, startedAtUtcMs: OWNER.startedAtUtcMs + index },
      draft: draft(0, { attempt: `writer-${String(index)}` }),
      makeSystemDraft: systemDraft,
      io,
      contentionTimeoutMs: 5_000,
      pollIntervalMs: 1,
    }));
    await Promise.all(writes);
    const bytes = await readFile(ledgerStorePaths(stateRoot).ledger);
    const lines = bytes.toString("utf8").split("\n");
    expect(lines.at(-1)).toBe("");
    const values = lines.slice(0, -1).map(line => JSON.parse(line) as { seq: number });
    expect(values).toHaveLength(24);
    expect(values.map(value => value.seq)).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect((await readActivationLedger(stateRoot)).state).toBe("intact");
  });

  it("serializes parallel appends made by one held session", async () => {
    const stateRoot = await root();
    const result = await withActivationLedger(
      { root: stateRoot, owner: OWNER, makeSystemDraft: systemDraft },
      async session => Promise.all([
        session.append(draft(0, { attempt: "left" })),
        session.append(draft(1, { attempt: "right" })),
      ]),
    );
    expect(result.kind).toBe("completed");
    const snapshot = await readActivationLedger(stateRoot);
    expect(snapshot.state).toBe("intact");
    expect(snapshot.entries.map(entry => entry.seq)).toEqual([1, 2]);
  });

  it("never glues to a torn tail: it preserves the bytes and continues in a recovery segment", async () => {
    const stateRoot = await root();
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft });
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.ledger, Buffer.from('{"seq":2,"at":"torn', "utf8"), { flag: "a" });
    const damaged = await readFile(paths.ledger);

    const result = await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(2), makeSystemDraft: systemDraft });
    expect(result.entries.map(entry => entry.kind)).toEqual(["correction", "intent"]);
    expect(await readFile(paths.ledger)).toEqual(damaged);
    const recovery = await readFile(path.join(stateRoot, "ledger.jsonl.recovery-000001"), "utf8");
    expect(recovery.endsWith("\n")).toBe(true);
    expect(recovery.split("\n").slice(0, -1)).toHaveLength(2);
    const snapshot = await readActivationLedger(stateRoot);
    expect(snapshot.state).toBe("torn");
    expect(snapshot.entries.map(entry => entry.seq)).toEqual([1, 2, 3]);
    expect(snapshot.damage).toHaveLength(1);
  });

  it("preserves a second torn tail and advances to a new recovery segment", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.ledger, Buffer.from("partial", "utf8"));
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(1), makeSystemDraft: systemDraft });
    const firstRecovery = path.join(stateRoot, "ledger.jsonl.recovery-000001");
    await writeFile(firstRecovery, Buffer.from("partial-again", "utf8"), { flag: "a" });
    const damaged = await readFile(firstRecovery);
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(2), makeSystemDraft: systemDraft });
    expect(await readFile(firstRecovery)).toEqual(damaged);
    expect((await readFile(path.join(stateRoot, "ledger.jsonl.recovery-000002"), "utf8")).split("\n").slice(0, -1)).toHaveLength(2);
    expect((await readActivationLedger(stateRoot)).damage).toHaveLength(2);
  });

  it("preserves a partial first recovery marker and advances again", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.ledger, Buffer.from("partial", "utf8"));
    const firstRecovery = path.join(stateRoot, "ledger.jsonl.recovery-000001");
    await writeFile(firstRecovery, Buffer.from('{"seq":1,"at":', "utf8"));
    const before = await readFile(firstRecovery);
    expect((await readActivationLedger(stateRoot)).state).toBe("torn");
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft });
    expect(await readFile(firstRecovery)).toEqual(before);
    expect((await readFile(path.join(stateRoot, "ledger.jsonl.recovery-000002"))).length).toBeGreaterThan(0);
    expect((await readActivationLedger(stateRoot)).state).toBe("torn");
  });

  it("refuses terminated corruption without changing any ledger byte", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.ledger, Buffer.from("broken\n", "utf8"));
    const before = await readFile(paths.ledger);
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft }),
      "read-ledger",
      "HISTORY_CORRUPT",
    );
    expect(await readFile(paths.ledger)).toEqual(before);
  });

  it("treats terminated invalid UTF-8 and a forged recovery chain as corruption", async () => {
    const utf8Root = await root();
    await writeFile(ledgerStorePaths(utf8Root).ledger, Buffer.from([0xff, 0x0a]));
    expect((await readActivationLedger(utf8Root)).state).toBe("corrupt");

    const bomRoot = await root();
    const canonical = await (async () => {
      const planned = await appendActivationLedger({ root: bomRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft });
      expect(planned.kind).toBe("appended");
      return readFile(ledgerStorePaths(bomRoot).ledger);
    })();
    await writeFile(ledgerStorePaths(bomRoot).ledger, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonical]));
    expect((await readActivationLedger(bomRoot)).state).toBe("corrupt");

    const forgedRoot = await root();
    const forgedPaths = ledgerStorePaths(forgedRoot);
    await writeFile(forgedPaths.ledger, Buffer.from("torn", "utf8"));
    const forged = planLedgerAppend({ lastSeq: 0, lastAtUtcMs: null }, draft());
    if (!forged.ok) throw new Error(forged.reason);
    await writeFile(path.join(forgedRoot, "ledger.jsonl.recovery-000001"), forged.line, "utf8");
    const snapshot = await readActivationLedger(forgedRoot);
    expect(snapshot.state).toBe("corrupt");
    expect(snapshot.corrupt).toContainEqual({ segment: 1, line: 1, reason: "RECOVERY_MARKER_MISSING" });
  });

  it("rejects a recovery segment after an intact primary even with a plausible marker", async () => {
    const stateRoot = await root();
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft });
    const fakeMarker = { ...draft(1, { kind: "correction", step: null, evidence: { kind: "torn-tail", segment: 0, damagedSeq: 2 } }), seq: 2 };
    await writeFile(path.join(stateRoot, "ledger.jsonl.recovery-000001"), `${JSON.stringify(fakeMarker)}\n`, "utf8");
    expect((await readActivationLedger(stateRoot)).corrupt).toContainEqual({ segment: 1, line: null, reason: "UNEXPECTED_RECOVERY_SEGMENT" });
  });

  it("rejects a system factory that does not encode the required torn correction", async () => {
    const stateRoot = await root();
    await writeFile(ledgerStorePaths(stateRoot).ledger, Buffer.from("partial", "utf8"));
    await expectStoreError(
      appendActivationLedger({
        root: stateRoot,
        owner: OWNER,
        draft: draft(),
        makeSystemDraft(event, tail) { return { ...systemDraft(event, tail), kind: "note" }; },
      }),
      "encode-ledger",
      "SYSTEM_DRAFT_INVALID",
    );
    await expect(readFile(path.join(stateRoot, "ledger.jsonl.recovery-000001"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves an empty recovery segment left by a crash and continues beyond it", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.ledger, Buffer.from("partial", "utf8"));
    const recovery = path.join(stateRoot, "ledger.jsonl.recovery-000001");
    await writeFile(recovery, Buffer.alloc(0));
    const before = await readFile(paths.ledger);
    expect((await readActivationLedger(stateRoot)).state).toBe("torn");
    const result = await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft });
    expect(result.entries.map(entry => entry.kind)).toEqual(["correction", "intent"]);
    expect(await readFile(paths.ledger)).toEqual(before);
    expect(await readFile(recovery)).toEqual(Buffer.alloc(0));
    expect((await readFile(path.join(stateRoot, "ledger.jsonl.recovery-000002"))).length).toBeGreaterThan(0);
    expect((await readActivationLedger(stateRoot)).state).toBe("torn");
  });
});

describe("activation ledger store — lock ownership", () => {
  it("holds the lease across the whole invocation and never runs a competing callback", async () => {
    const stateRoot = await root();
    const firstOwner = { pid: 7_001, startedAtUtcMs: OWNER.startedAtUtcMs };
    const secondOwner = { pid: 7_002, startedAtUtcMs: OWNER.startedAtUtcMs + 1 };
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      processState(owner) { return Promise.resolve(owner.pid === firstOwner.pid ? "alive" : "dead"); },
    };
    const first = withActivationLedger(
      { root: stateRoot, owner: firstOwner, makeSystemDraft: systemDraft, io, contentionTimeoutMs: 2_000, pollIntervalMs: 2 },
      async session => {
        await session.append(draft(0, { attempt: "first" }));
        firstStarted();
        await release;
        await session.append(draft(1, { attempt: "first" }));
        return "first-done";
      },
    );
    await started;
    let secondRan = false;
    const second = withActivationLedger(
      { root: stateRoot, owner: secondOwner, makeSystemDraft: systemDraft, io, contentionTimeoutMs: 0, pollIntervalMs: 2 },
      async () => { await Promise.resolve(); secondRan = true; return "must-not-run"; },
    );
    await new Promise(resolve => { setTimeout(resolve, 25); });
    expect(secondRan).toBe(false);
    releaseFirst();
    const secondResult = await second;
    expect(secondResult.kind).toBe("contended");
    expect(secondResult.kind === "contended" ? secondResult.entries : []).toHaveLength(1);
    expect((await first).kind).toBe("completed");
    expect(secondRan).toBe(false);
    const entries = (await readActivationLedger(stateRoot)).entries;
    expect(entries.map(entry => entry.attempt)).toEqual(["first", "system", "first"]);
    expect(entries[1]?.evidence).toMatchObject({ kind: "live-lock", owner: firstOwner });
  });

  it("records a live competitor once, performs no requested action, and exits", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.lock, `${JSON.stringify(OWNER)}\n`, { flag: "wx" });
    setTimeout(() => { void rm(paths.lock, { force: true }); }, 25);
    const result = await appendActivationLedger({
      root: stateRoot,
      owner: { pid: 4_243, startedAtUtcMs: OWNER.startedAtUtcMs + 1 },
      draft: draft(1),
      makeSystemDraft: systemDraft,
      io: { ...nodeLedgerStoreIo, processState(owner) { return Promise.resolve(owner.pid === OWNER.pid ? "alive" : "dead"); } },
      contentionTimeoutMs: 1_000,
      pollIntervalMs: 2,
    });
    expect(result.kind).toBe("contended");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.kind).toBe("note");
    expect(result.entries[0]?.evidence).toMatchObject({ kind: "live-lock", owner: OWNER });
    expect((await readActivationLedger(stateRoot)).entries.some(entry => entry.attempt === "a1")).toBe(false);
  });

  it("takes over a provably dead lock and records the takeover before the requested entry", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const dead = { pid: 99_999, startedAtUtcMs: 1_700_000_000_000 };
    await writeFile(paths.lock, `${JSON.stringify(dead)}\n`, { flag: "wx" });
    const result = await appendActivationLedger({
      root: stateRoot,
      owner: OWNER,
      draft: draft(1),
      makeSystemDraft: systemDraft,
      io: { ...nodeLedgerStoreIo, processState() { return Promise.resolve("dead"); } },
    });
    expect(result.entries.map(entry => entry.kind)).toEqual(["note", "intent"]);
    expect(result.entries[0]?.evidence).toMatchObject({ kind: "stale-lock", owner: dead });
    expect((await readActivationLedger(stateRoot)).entries.map(entry => entry.seq)).toEqual([1, 2]);
  });

  it("serializes a stalled stale-takeover note against a direct live-contender note", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const dead = { pid: 90_001, startedAtUtcMs: 1_700_000_000_000 };
    const firstOwner = { pid: 90_002, startedAtUtcMs: 1_700_000_000_001 };
    const secondOwner = { pid: 90_003, startedAtUtcMs: 1_700_000_000_002 };
    await writeFile(paths.lock, `${JSON.stringify(dead)}\n`, { flag: "wx" });
    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const release = new Promise<void>(resolve => { releaseWrite = resolve; });
    const started = new Promise<void>(resolve => { writeStarted = resolve; });
    let stallFirstLedgerWrite = true;
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      processState(owner) { return Promise.resolve(owner.pid === dead.pid ? "dead" : "alive"); },
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== paths.ledger) return handle;
        return {
          ...handle,
          async write(bytes) {
            if (stallFirstLedgerWrite) {
              stallFirstLedgerWrite = false;
              writeStarted();
              await release;
            }
            return handle.write(bytes);
          },
        };
      },
    };
    const first = withActivationLedger(
      { root: stateRoot, owner: firstOwner, makeSystemDraft: systemDraft, io, contentionTimeoutMs: 2_000, pollIntervalMs: 1 },
      async () => { await Promise.resolve(); return "first"; },
    );
    await started;
    const second = withActivationLedger(
      { root: stateRoot, owner: secondOwner, makeSystemDraft: systemDraft, io, contentionTimeoutMs: 2_000, pollIntervalMs: 1 },
      async () => { await Promise.resolve(); throw new Error("must not run"); },
    );
    await new Promise(resolve => { setTimeout(resolve, 10); });
    releaseWrite();
    expect((await first).kind).toBe("completed");
    expect((await second).kind).toBe("contended");
    const snapshot = await readActivationLedger(stateRoot);
    expect(snapshot.state).toBe("intact");
    expect(snapshot.entries.map(entry => entry.seq)).toEqual([1, 2]);
  });

  it("preserves an unrecorded stale tombstone across append failure and replays it exactly once", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const dead = { pid: 98_765, startedAtUtcMs: 1_700_000_000_000 };
    await writeFile(paths.lock, `${JSON.stringify(dead)}\n`, { flag: "wx" });
    const noSpace: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      processState() { return Promise.resolve("dead"); },
      async open(file, flags, mode) {
        if (file === paths.ledger) throw Object.assign(new Error("secret"), { code: "ENOSPC" });
        return nodeLedgerStoreIo.open(file, flags, mode);
      },
    };
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io: noSpace }),
      "open-ledger",
      "NO_SPACE",
    );
    expect((await nodeLedgerStoreIo.readDirectory(stateRoot)).some(name => name.startsWith("ledger.lock.stale-"))).toBe(true);

    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(1), makeSystemDraft: systemDraft });
    const entries = (await readActivationLedger(stateRoot)).entries;
    expect(entries.filter(entry => entry.evidence["kind"] === "stale-lock")).toHaveLength(1);
    expect(entries.at(-1)?.kind).toBe("intent");
  });

  it("does not duplicate a durable stale note when tombstone marking fails", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const dead = { pid: 98_766, startedAtUtcMs: 1_700_000_000_001 };
    await writeFile(paths.lock, `${JSON.stringify(dead)}\n`, { flag: "wx" });
    let failMark = true;
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      processState() { return Promise.resolve("dead"); },
      async rename(from, to) {
        if (failMark && to.endsWith(".recorded")) {
          failMark = false;
          throw Object.assign(new Error("secret"), { code: "EACCES" });
        }
        await nodeLedgerStoreIo.rename(from, to);
      },
    };
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
      "takeover-lock",
      "ACCESS_DENIED",
    );
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(1), makeSystemDraft: systemDraft, io });
    expect((await readActivationLedger(stateRoot)).entries.filter(entry => entry.evidence["kind"] === "stale-lock")).toHaveLength(1);
  });

  it("does not steal an unreadable or unverifiably stale lock", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.lock, Buffer.from("not a lock\n", "utf8"), { flag: "wx" });
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, contentionTimeoutMs: 0 }),
      "read-lock",
      "LOCK_INVALID",
    );
    expect(await readFile(paths.lock, "utf8")).toBe("not a lock\n");
  });

  it("fails closed when liveness cannot be proved and directly records a long-lived competitor", async () => {
    const unknownRoot = await root();
    await writeFile(ledgerStorePaths(unknownRoot).lock, `${JSON.stringify(OWNER)}\n`, { flag: "wx" });
    await expectStoreError(
      appendActivationLedger({
        root: unknownRoot,
        owner: { pid: OWNER.pid + 1, startedAtUtcMs: OWNER.startedAtUtcMs + 1 },
        draft: draft(),
        makeSystemDraft: systemDraft,
        io: { ...nodeLedgerStoreIo, processState() { return Promise.resolve("unknown"); } },
        contentionTimeoutMs: 0,
      }),
      "read-lock",
      "LOCK_OWNER_UNKNOWN",
    );

    const liveRoot = await root();
    const contender = { pid: OWNER.pid + 2, startedAtUtcMs: OWNER.startedAtUtcMs + 2 };
    await writeFile(ledgerStorePaths(liveRoot).lock, `${JSON.stringify(OWNER)}\n`, { flag: "wx" });
    const result = await appendActivationLedger({
      root: liveRoot,
      owner: contender,
      draft: draft(),
      makeSystemDraft: systemDraft,
      io: { ...nodeLedgerStoreIo, processState() { return Promise.resolve("alive"); } },
      contentionTimeoutMs: 0,
    });
    expect(result.kind).toBe("contended");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.evidence).toMatchObject({ kind: "live-lock", owner: OWNER, contender });
    expect((await readActivationLedger(liveRoot)).entries).toHaveLength(1);
  });

  it("writes only pid and start time to the lock and fsyncs it", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    let lockBytes = "";
    let lockSynced = false;
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== paths.lock) return handle;
        return {
          ...handle,
          async write(bytes) { lockBytes += bytes.toString("utf8"); return handle.write(bytes); },
          async sync() { await handle.sync(); lockSynced = true; },
        };
      },
    };
    await appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io });
    expect(lockSynced).toBe(true);
    expect(JSON.parse(lockBytes)).toEqual(OWNER);
    expect(Object.keys(JSON.parse(lockBytes) as object)).toEqual(["pid", "startedAtUtcMs"]);
  });

  it.runIf(process.platform === "win32")("recognizes Windows EACCES from a racing wx create as lock contention", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    let lockReads = 0;
    const enoent = Object.assign(new Error("missing"), { code: "ENOENT" });
    const denied = Object.assign(new Error("collision"), { code: "EACCES" });
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async readFile(file) {
        if (file === paths.lock) {
          lockReads += 1;
          if (lockReads === 1) throw enoent;
          return Buffer.from(`${JSON.stringify(OWNER)}\n`, "utf8");
        }
        return nodeLedgerStoreIo.readFile(file);
      },
      async open(file, flags, mode) {
        if (file === paths.lock) throw denied;
        return nodeLedgerStoreIo.open(file, flags, mode);
      },
      processState() { return Promise.resolve("alive"); },
    };
    const result = await appendActivationLedger({
      root: stateRoot,
      owner: { pid: OWNER.pid + 20, startedAtUtcMs: OWNER.startedAtUtcMs + 20 },
      draft: draft(),
      makeSystemDraft: systemDraft,
      io,
      contentionTimeoutMs: 0,
    });
    expect(result.kind).toBe("contended");
  });
});

describe("activation ledger store — failures are never success", () => {
  function throwing(code: string, message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
  }

  it.each([
    ["EACCES", "ACCESS_DENIED"],
    ["EPERM", "ACCESS_DENIED"],
    ["ENOSPC", "NO_SPACE"],
  ])("rejects ledger open/write failure %s with a closed reason", async (code, reason) => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const secret = "sk-ant-api03-do-not-print";
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async open(file, flags, mode) {
        if (file === paths.ledger) throw throwing(code, `failure at ${secret} in ${file}`);
        return nodeLedgerStoreIo.open(file, flags, mode);
      },
    };
    const error = await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
      "open-ledger",
      reason,
    );
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(stateRoot);
  });

  it("rejects a partial/crashed write, leaves it visibly torn, and never reports success", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== paths.ledger) return handle;
        return {
          ...handle,
          async write(bytes) {
            await handle.write(bytes.subarray(0, 17));
            return { bytesWritten: 17 };
          },
        };
      },
    };
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
      "write-ledger",
      "PARTIAL_WRITE",
    );
    expect((await readActivationLedger(stateRoot)).state).toBe("torn");
    expect((await readFile(paths.ledger)).length).toBe(17);
  });

  it("rejects a ledger that changes between read and append", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== paths.ledger) return handle;
        return { ...handle, async stat() { return { size: (await handle.stat()).size + 1 }; } };
      },
    };
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
      "open-ledger",
      "LEDGER_CHANGED",
    );
    expect(await readFile(paths.ledger)).toEqual(Buffer.alloc(0));
  });

  it.each(["sync", "close"] as const)("rejects a ledger %s failure", async operation => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== paths.ledger) return handle;
        return {
          ...handle,
          async [operation]() {
            if (operation === "close") await handle.close();
            throw throwing("EIO", "credential Bearer do-not-print");
          },
        };
      },
    };
    const error = await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
      operation === "sync" ? "sync-ledger" : "close-ledger",
      "IO_ERROR",
    );
    expect(error.message).not.toContain("do-not-print");
  });

  it("rejects lock create and lock fsync failures without a successful append", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    for (const fault of ["open", "sync"] as const) {
      const io: LedgerStoreIo = {
        ...nodeLedgerStoreIo,
        async open(file, flags, mode) {
          if (file === paths.lock && fault === "open") throw throwing("EACCES", "secret path");
          const handle = await nodeLedgerStoreIo.open(file, flags, mode);
          if (file !== paths.lock || fault !== "sync") return handle;
          return { ...handle, sync() { return Promise.reject(throwing("EIO", "secret lock")); } };
        },
      };
      await expectStoreError(
        appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
        fault === "open" ? "acquire-lock" : "sync-lock",
        fault === "open" ? "ACCESS_DENIED" : "IO_ERROR",
      );
      await expect(readFile(paths.ledger)).rejects.toMatchObject({ code: "ENOENT" });
      await rm(paths.lock, { force: true });
    }
  });

  it("rejects live-contention note fsync failure instead of reporting contention", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    await writeFile(paths.lock, `${JSON.stringify(OWNER)}\n`, { flag: "wx" });
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      processState() { return Promise.resolve("alive"); },
      async open(file, flags, mode) {
        const handle = await nodeLedgerStoreIo.open(file, flags, mode);
        if (file !== paths.ledger) return handle;
        return { ...handle, sync() { return Promise.reject(throwing("EIO", "Bearer claim-secret")); } };
      },
    };
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: { pid: OWNER.pid + 10, startedAtUtcMs: OWNER.startedAtUtcMs + 10 }, draft: draft(), makeSystemDraft: systemDraft, io, contentionTimeoutMs: 0 }),
      "sync-ledger",
      "IO_ERROR",
    );
    expect((await readFile(paths.ledger)).at(-1)).toBe(0x0a);
  });

  it("reports release failure even after durable bytes exist", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const io: LedgerStoreIo = {
      ...nodeLedgerStoreIo,
      async unlink(file) {
        if (file === paths.lock) throw throwing("EACCES", "secret release path");
        await nodeLedgerStoreIo.unlink(file);
      },
    };
    await expectStoreError(
      appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(), makeSystemDraft: systemDraft, io }),
      "release-lock",
      "ACCESS_DENIED",
    );
    expect((await readFile(paths.ledger, "utf8")).endsWith("\n")).toBe(true);
  });

  it("does not expose credential-shaped draft data in ledger bytes or errors", async () => {
    const stateRoot = await root();
    const paths = ledgerStorePaths(stateRoot);
    const credentials = [
      "PA349COOGKZ1",
      "sk-ant-api03-super-secret",
      "Bearer super-secret",
      "31a4eae7-f576-4e4a-8d49-a97c64ad5b58",
      "https://hc-ping.com/super-secret",
    ];
    for (const credential of credentials) {
      const error = await expectStoreError(
        appendActivationLedger({ root: stateRoot, owner: OWNER, draft: draft(1, { evidence: { value: credential } }), makeSystemDraft: systemDraft }),
        "encode-ledger",
        "SECRET_SHAPED_VALUE",
      );
      expect(error.message).not.toContain(credential);
    }
    await expect(readFile(paths.ledger)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
