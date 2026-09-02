import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountBoundBrokerPort } from "../src/shell/account-bound-broker.js";
import { parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { createAlpacaBroker } from "../src/shell/alpaca-broker.js";
import { buildRuntime, shutdownRuntimeResources, withVerifiedChildFailureCleanup } from "../src/shell/agent-runtime.js";
import type { AgentRuntime } from "../src/shell/agent-runtime.js";
import { admitCertificateCommand, CERTIFICATE_RUN_LIMITS } from "../src/shell/certificate-command-guard.js";
import { runWithinCycleWalltime } from "../src/shell/cycle-walltime.js";
import { enumerateRuntimeFiles } from "../src/shell/digests.js";
import { readHolder, releaseHolder, withMutex, writeHolder } from "../src/shell/epoch-store.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import type { BrokerMutation, BrokerMutationPort } from "../src/shell/mutation-gateway.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { createPingPort } from "../src/shell/ping-healthchecks.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import { recordStartupBrokerFence } from "../src/shell/startup-broker-fence.js";
import { nextCertificateCycleIndex, recoverCertificateAfterFailure, unresolvedRecoveryEntryIds } from "../src/shell/certificate-run.js";

const ORIGIN = "https://paper-api.alpaca.markets";
const EXPECTED = "PA_EXPECTED";
const BINDING = { profile: "dev", tradingOrigin: ORIGIN, accountId: EXPECTED } as const;
const CERTIFICATE_TEST_CONFIG = { scheduling: { cycleWalltimeBudgetMs: 100, lockTakeoverBoundMs: 1_000 } } as const;
const temporaryDirectories: string[] = [];

describe("certificate command admission", () => {
  it("refuses every non-dev command before runtime construction and requires owner-go for smoke/live commands", () => {
    expect(admitCertificateCommand({ profile: "competition", ownerGo: true, preflight: true })).toMatchObject({ ok: false });
    expect(admitCertificateCommand({ profile: "competition", ownerGo: true, preflight: false })).toMatchObject({ ok: false });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: false })).toMatchObject({ ok: false });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: true, preflight: false })).toEqual({ ok: true });
    expect(CERTIFICATE_RUN_LIMITS).toEqual({ maxEntryCycles: 8, entryIntervalMs: 180_000, patienceCycles: 3, maxFlattenCycles: 20, flattenIntervalMs: 60_000 });
    expect(Object.values(CERTIFICATE_RUN_LIMITS).every(value => Number.isSafeInteger(value) && value > 0)).toBe(true);
  });
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function submitMutation(): BrokerMutation {
  return {
    kind: "submit_order",
    clientOrderId: "entry:test",
    binding: BINDING,
    payload: {
      legs: [{ contractId: "SPY260904C00500000", underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call", side: "buy", ratio: 1 }],
      quantity: 1,
      limit: { kind: "debit", priceCents: 100 },
      intent: "entry",
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("P7 launch hardening — independent account identity", () => {
  it.runIf(process.platform === "win32")("canonicalizes Windows aliases before deriving the kernel mutex identity", async () => {
    const directory = temporaryDirectory("gbt-p7-state-alias-");
    const ordinary = resolveStateDir(directory);
    const extended = resolveStateDir(`\\\\?\\${directory}`);
    if (!ordinary.ok || !extended.ok) throw new Error("state alias did not resolve");
    expect(extended.value.root).toBe(ordinary.value.root);

    let releaseFirst: (() => void) | undefined;
    let firstEntered: (() => void) | undefined;
    const entered = new Promise<void>(resolve => { firstEntered = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = withMutex(ordinary.value, async () => { firstEntered?.(); await release; });
    await entered;
    let secondEntered = false;
    const second = withMutex(extended.value, () => { secondEntered = true; });
    await new Promise(resolve => setTimeout(resolve, 25));
    const enteredBeforeRelease = secondEntered;
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(enteredBeforeRelease).toBe(false);
    expect(secondEntered).toBe(true);
  });

  it("suppresses a rival runtime before every broker read and appends one witness", async () => {
    const stateRoot = temporaryDirectory("gbt-p7-runtime-suppressed-");
    const resolved = resolveStateDir(stateRoot);
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "active-cycle", acquiredAt: new Date(now).toISOString(), seedPending: false, resetPending: false }), "utf8");
    writeHolder(resolved.value, { holderId: "active-cycle", heartbeatAt: now });
    let brokerCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { brokerCalls += 1; return Promise.reject(new Error("broker must not be called")); };
    try {
      const built = await buildRuntime({
        repoRoot: process.cwd(),
        processEnv: {
          ALPACA_PROFILE: "dev",
          ALPACA_DEV_KEY_ID: "dummy-key",
          ALPACA_DEV_SECRET_KEY: "dummy-secret",
          ALPACA_DEV_ACCOUNT_ID: EXPECTED,
          STATE_DIR: stateRoot,
          BOOTSTRAP_DIAGNOSTIC_SINK: path.join(stateRoot, "startup-diagnostics.jsonl"),
          ANALYST_MODEL: "claude-sonnet-5",
        },
        clock: () => now + 1_000,
        objective: "certificate",
        instanceId: "suppressed-cycle",
        log: () => undefined,
      });
      expect(built).toMatchObject({ ok: false, stage: "suppressed" });
      expect(brokerCalls).toBe(0);
      expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries).toMatchObject([{ type: "SUPPRESSED", instanceId: "suppressed-cycle", holderId: "active-cycle", reason: "LOCK_HELD" }]);
      expect(readHolder(resolved.value)).toEqual({ holderId: "active-cycle", heartbeatAt: now });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("releases the temporary startup holder after journaling CONFIG_INVALID", async () => {
    const stateRoot = temporaryDirectory("gbt-p7-config-holder-");
    const resolved = resolveStateDir(stateRoot);
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "prior", acquiredAt: new Date(now - 120_000).toISOString(), seedPending: false, resetPending: false }), "utf8");

    const built = await buildRuntime({
      repoRoot: process.cwd(),
      processEnv: {
        ALPACA_PROFILE: "invalid-profile",
        ALPACA_DEV_ACCOUNT_ID: EXPECTED,
        STATE_DIR: stateRoot,
        BOOTSTRAP_DIAGNOSTIC_SINK: path.join(stateRoot, "startup-diagnostics.jsonl"),
      },
      clock: () => now,
      objective: "certificate",
      instanceId: "config-probe",
      log: () => undefined,
    });

    expect(built).toMatchObject({ ok: false, stage: "startup" });
    expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries.at(-1)).toMatchObject({ type: "HALT", reason: "CONFIG_INVALID" });
    expect(readHolder(resolved.value)).toBeNull();
  });

  it("persists AUTH_FAILURE when the authenticated account read succeeds but the calendar rejects credentials", async () => {
    const stateRoot = temporaryDirectory("gbt-p7-calendar-auth-fence-");
    const resolved = resolveStateDir(stateRoot);
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T14:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "prior", acquiredAt: new Date(now - 120_000).toISOString(), seedPending: false, resetPending: false }), "utf8");
    const originalFetch = globalThis.fetch;
    let accountReads = 0;
    let calendarReads = 0;
    globalThis.fetch = (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v2/account")) {
        accountReads += 1;
        return Promise.resolve(jsonResponse(200, { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" }));
      }
      if (url.includes("/v2/calendar?")) {
        calendarReads += 1;
        return Promise.resolve(jsonResponse(401, { message: "unauthorized" }));
      }
      return Promise.resolve(jsonResponse(500, { message: "unexpected request" }));
    };
    try {
      const built = await buildRuntime({
        repoRoot: process.cwd(),
        processEnv: {
          ALPACA_PROFILE: "dev",
          ALPACA_DEV_KEY_ID: "dummy-key",
          ALPACA_DEV_SECRET_KEY: "dummy-secret",
          ALPACA_DEV_ACCOUNT_ID: EXPECTED,
          STATE_DIR: stateRoot,
          BOOTSTRAP_DIAGNOSTIC_SINK: path.join(stateRoot, "startup-diagnostics.jsonl"),
          ANALYST_MODEL: "claude-sonnet-5",
        },
        clock: () => now,
        objective: "certificate",
        instanceId: "calendar-auth-probe",
        log: () => undefined,
      });
      expect(built).toMatchObject({ ok: false, stage: "calendar" });
      expect(accountReads).toBe(1);
      expect(calendarReads).toBe(1);
      expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries.at(-1)).toMatchObject({ type: "HALT", reason: "AUTH_FAILURE" });
      expect(readHaltState(resolved.value)).toEqual({ halted: true, reason: "AUTH_FAILURE", sticky: false });
      expect(readHolder(resolved.value)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each(["ACCOUNT_BINDING_MISMATCH", "AUTH_FAILURE"] as const)("persists and pings an early %s refusal before the real broker gateway exists", async reason => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-startup-fence-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    const pings: readonly string[][] = [];
    const mutablePings = pings as string[][];
    const journaled = await recordStartupBrokerFence({
      paths: resolved.value,
      secrets: [],
      clock: () => Date.parse("2026-09-01T12:00:00.000Z"),
      instanceId: "startup-refusal",
      lockTakeoverBoundMs: 60_000,
      reason,
      detail: "independent broker identity check refused",
      ping: { success: () => Promise.resolve(), fail: conditions => { mutablePings.push([...conditions]); return Promise.resolve(); } },
    });
    expect(journaled).toBe(true);
    expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries.at(-1)).toMatchObject({ type: "HALT", reason });
    expect(readHaltState(resolved.value)).toMatchObject({ halted: true, reason });
    expect(readHolder(resolved.value)).toBeNull();
    expect(pings).toEqual([[reason]]);
  });

  it.each(["ACCOUNT_BINDING_MISMATCH", "AUTH_FAILURE"] as const)("persists %s while preserving a fresh rival holder", async reason => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-overlap-fence-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "active-cycle", acquiredAt: new Date(now).toISOString(), seedPending: false, resetPending: false }), "utf8");
    writeHolder(resolved.value, { holderId: "active-cycle", heartbeatAt: now });
    const pings: string[][] = [];

    const journaled = await recordStartupBrokerFence({
      paths: resolved.value,
      secrets: [],
      clock: () => now + 1_000,
      instanceId: "startup-contender",
      lockTakeoverBoundMs: 60_000,
      reason,
      detail: "startup contender observed a broker safety failure",
      ping: { success: () => Promise.resolve(), fail: conditions => { pings.push([...conditions]); return Promise.resolve(); } },
    });

    expect(journaled).toBe(true);
    expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries.at(-1)).toMatchObject({ type: "HALT", epoch: 7, reason });
    expect(readHaltState(resolved.value)).toMatchObject({ halted: true, reason });
    expect(readHolder(resolved.value)).toEqual({ holderId: "active-cycle", heartbeatAt: now });
    expect(pings).toEqual([[reason]]);
  });

  it("vetoes a stale entry after the overlap halt but still permits cancel and explicit close", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-overlap-veto-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "prior", acquiredAt: new Date(now - 120_000).toISOString(), seedPending: false, resetPending: false }), "utf8");
    const calls: BrokerMutation[] = [];
    const gateway = createMutationGateway({
      paths: resolved.value,
      secrets: [],
      clock: () => now,
      brokerPort: { mutate: mutation => { calls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: `broker-${String(calls.length)}` }); } },
      instanceId: "active-cycle",
      lockTakeoverBoundMs: 60_000,
      binding: BINDING,
    });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 8 });

    const contender = createMutationGateway({
      paths: resolved.value,
      secrets: [],
      clock: () => now + 1,
      brokerPort: { mutate: () => Promise.resolve({ ok: false, reason: "MUST_NOT_RUN" }) },
      instanceId: "startup-contender",
      lockTakeoverBoundMs: 60_000,
    });
    expect(await contender.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "credential check failed during an active cycle" })).toMatchObject({ ok: true });

    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: submitMutation() } })).toMatchObject({ ok: false, reason: "HALT" });
    expect(calls).toEqual([]);

    const cancel: BrokerMutation = { kind: "cancel_order", clientOrderId: "entry:test", binding: BINDING };
    const close: BrokerMutation = {
      ...submitMutation(),
      clientOrderId: "close:test",
      payload: { ...(submitMutation().payload as Record<string, unknown>), intent: "close" },
    };
    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: cancel } })).toMatchObject({ ok: true });
    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: close } })).toMatchObject({ ok: true });
    expect(calls.map(call => call.clientOrderId)).toEqual(["entry:test", "close:test"]);
  });

  it.each(["missing", "stale-false"] as const)("repairs a %s halt projection from the durable journal before reads and broker entry", async variant => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-halt-recovery-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "prior", acquiredAt: new Date(now - 120_000).toISOString(), seedPending: false, resetPending: false }), "utf8");
    const calls: BrokerMutation[] = [];
    const gateway = createMutationGateway({
      paths: resolved.value,
      secrets: [],
      clock: () => now,
      brokerPort: { mutate: mutation => { calls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: "must-not-run" }); } },
      instanceId: "active-cycle",
      lockTakeoverBoundMs: 60_000,
      binding: BINDING,
    });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 8 });
    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "journal_append", entry: { at: new Date(now).toISOString(), epoch: 8, type: "HALT", reason: "AUTH_FAILURE", detail: "durable before projection", sticky: false } } })).toMatchObject({ ok: true });

    const breakProjection = (): void => {
      if (variant === "missing") rmSync(resolved.value.halt);
      else writeFileSync(resolved.value.halt, JSON.stringify({ halted: false, reason: null, sticky: false }), "utf8");
    };
    breakProjection();
    expect((await gateway.openJournal()).halt).toEqual({ halted: true, reason: "AUTH_FAILURE", sticky: false });
    expect(readHaltState(resolved.value)).toEqual({ halted: true, reason: "AUTH_FAILURE", sticky: false });

    breakProjection();
    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: submitMutation() } })).toMatchObject({ ok: false, reason: "HALT" });
    expect(calls).toEqual([]);
    expect(readHaltState(resolved.value)).toEqual({ halted: true, reason: "AUTH_FAILURE", sticky: false });
  });

  it("repairs a stale halted projection after a durable human unhalt", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-unhalt-recovery-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "prior", acquiredAt: new Date(now - 120_000).toISOString(), seedPending: false, resetPending: false }), "utf8");
    const calls: BrokerMutation[] = [];
    const gateway = createMutationGateway({
      paths: resolved.value,
      secrets: [],
      clock: () => now,
      brokerPort: { mutate: mutation => { calls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: "broker-entry" }); } },
      instanceId: "active-cycle",
      lockTakeoverBoundMs: 60_000,
      binding: BINDING,
    });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 8 });
    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "journal_append", entry: { at: new Date(now).toISOString(), epoch: 8, type: "HALT", reason: "AUTH_FAILURE", detail: "operator will reconcile", sticky: false } } })).toMatchObject({ ok: true, seq: 1 });
    expect(await gateway.dispatchManualUnhalt({ operator: "felix", reason: "broker reconciled", expectedHaltSeq: 1, expectedHaltReason: "AUTH_FAILURE" })).toMatchObject({ ok: true, seq: 2 });

    const staleHalt = { halted: true, reason: "AUTH_FAILURE", sticky: false };
    writeFileSync(resolved.value.halt, JSON.stringify(staleHalt), "utf8");
    expect((await gateway.openJournal()).halt).toEqual({ halted: false, reason: null, sticky: false });
    expect(readHaltState(resolved.value)).toEqual({ halted: false, reason: null, sticky: false });

    writeFileSync(resolved.value.halt, JSON.stringify(staleHalt), "utf8");
    expect(await gateway.dispatchManualUnhalt({ operator: "felix", reason: "retry after crash" })).toMatchObject({ ok: false, reason: "NOT_HALTED" });
    expect(readHaltState(resolved.value)).toEqual({ halted: false, reason: null, sticky: false });
    expect(await gateway.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: submitMutation() } })).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("keeps the monotonic interlock runtime-closed to the two broker safety reasons", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-safety-reason-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 4, holderId: "active", acquiredAt: "2026-09-01T12:00:00.000Z", seedPending: false, resetPending: false }), "utf8");
    const gateway = createMutationGateway({ paths: resolved.value, secrets: [], clock: () => Date.parse("2026-09-01T12:00:01.000Z"), brokerPort: { mutate: () => Promise.resolve({ ok: false, reason: "MUST_NOT_RUN" }) }, instanceId: "contender", lockTakeoverBoundMs: 60_000 });

    const result = await gateway.dispatchSafetyHalt({ reason: "MANUAL", detail: "not an allowed interlock reason" } as never);

    expect(result).toMatchObject({ ok: false, reason: "SAFETY_HALT_REASON_NOT_ALLOWED" });
    expect(readHaltState(resolved.value)).toEqual({ halted: false, reason: null, sticky: false });
    expect(() => readFileSync(resolved.value.journal, "utf8")).toThrow();
  });

  it("refuses a mutation before the delegate when active credentials report a foreign account", async () => {
    const calls: BrokerMutation[] = [];
    const delegate: BrokerMutationPort = { mutate: mutation => { calls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: "should-not-run" }); } };
    const port = createAccountBoundBrokerPort({
      profile: "dev",
      requestedOrigin: ORIGIN,
      observedOrigin: ORIGIN,
      config: { canonicalTradingOrigin: ORIGIN, expectedAccountId: EXPECTED },
      expectedBinding: BINDING,
      brokerReportedAccountId: () => Promise.resolve("PA_FOREIGN"),
      delegate,
    });
    await expect(port.mutate(submitMutation())).rejects.toThrow("ACCOUNT_BINDING_MISMATCH:ACCOUNT_ID_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("the real gateway path journals and halts the independently observed mismatch", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-binding-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 1, holderId: "prior", acquiredAt: "2026-09-01T12:00:00.000Z", seedPending: false, resetPending: false }), "utf8");
    const calls: BrokerMutation[] = [];
    const delegate: BrokerMutationPort = { mutate: mutation => { calls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: "should-not-run" }); } };
    const port = createAccountBoundBrokerPort({
      profile: "dev", requestedOrigin: ORIGIN, observedOrigin: ORIGIN,
      config: { canonicalTradingOrigin: ORIGIN, expectedAccountId: EXPECTED }, expectedBinding: BINDING,
      brokerReportedAccountId: () => Promise.resolve("PA_FOREIGN"), delegate,
    });
    const gateway = createMutationGateway({ paths: resolved.value, secrets: [], clock: () => Date.parse("2026-09-01T12:01:00.000Z"), brokerPort: port, instanceId: "current", lockTakeoverBoundMs: 1, binding: BINDING });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    const result = await gateway.dispatch({ class: "authoritative", epoch: 2, action: { kind: "broker_mutation", mutation: submitMutation() } });
    expect(result).toMatchObject({ ok: false, reason: "ACCOUNT_BINDING_MISMATCH", source: "broker_port" });
    expect(calls).toEqual([]);
    expect(readHaltState(resolved.value)).toMatchObject({ halted: true, reason: "ACCOUNT_BINDING_MISMATCH" });
    expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries.at(-1)).toMatchObject({ type: "HALT", reason: "ACCOUNT_BINDING_MISMATCH" });
  });

  it("the gateway refuses a broker mutation whose aggregate cycle deadline has elapsed", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-deadline-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 1, holderId: "prior", acquiredAt: "2026-09-01T12:00:00.000Z", seedPending: false, resetPending: false }), "utf8");
    let now = 0;
    const calls: BrokerMutation[] = [];
    const gateway = createMutationGateway({
      paths: resolved.value,
      secrets: [],
      clock: () => now,
      brokerPort: { mutate: mutation => { calls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: "late" }); } },
      instanceId: "deadline-runner",
      lockTakeoverBoundMs: 60_000,
      binding: BINDING,
    });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    now = 10;
    expect(await gateway.dispatch({ class: "authoritative", epoch: 2, deadlineAtMs: 10, action: { kind: "broker_mutation", mutation: { ...submitMutation(), notAfterMs: 10 } } })).toMatchObject({ ok: false, reason: "CYCLE_WALLTIME_EXCEEDED" });
    expect(calls).toEqual([]);
  });

  it("keeps a live broker operation serialized until a waiting safety halt can become durable", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-live-mutex-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 7, holderId: "prior", acquiredAt: new Date(now - 120_000).toISOString(), seedPending: false, resetPending: false }), "utf8");
    let releaseAccount: ((accountId: string) => void) | undefined;
    let accountReadStarted: (() => void) | undefined;
    const accountStarted = new Promise<void>(resolve => { accountReadStarted = resolve; });
    const accountResult = new Promise<string>(resolve => { releaseAccount = resolve; });
    const delegateCalls: BrokerMutation[] = [];
    const boundPort = createAccountBoundBrokerPort({
      profile: "dev", requestedOrigin: ORIGIN, observedOrigin: ORIGIN,
      config: { canonicalTradingOrigin: ORIGIN, expectedAccountId: EXPECTED }, expectedBinding: BINDING,
      brokerReportedAccountId: () => { accountReadStarted?.(); return accountResult; },
      delegate: { mutate: mutation => { delegateCalls.push(mutation); return Promise.resolve({ ok: true, brokerOrderId: "entry-before-halt" }); } },
      clock: () => now,
    });
    const active = createMutationGateway({ paths: resolved.value, secrets: [], clock: () => now, brokerPort: boundPort, instanceId: "active", lockTakeoverBoundMs: 60_000, binding: BINDING });
    expect(await active.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 8 });

    const entry = active.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: submitMutation() } });
    await accountStarted;
    const contender = createMutationGateway({ paths: resolved.value, secrets: [], clock: () => now + 1, brokerPort: { mutate: () => Promise.resolve({ ok: false, reason: "MUST_NOT_RUN" }) }, instanceId: "contender", lockTakeoverBoundMs: 60_000 });
    let haltSettled = false;
    const halt = contender.dispatchSafetyHalt({ reason: "AUTH_FAILURE", detail: "must serialize after the live entry" }).finally(() => { haltSettled = true; });
    await new Promise(resolve => { setTimeout(resolve, 25); });
    expect(haltSettled).toBe(false);

    releaseAccount?.(EXPECTED);
    expect(await entry).toMatchObject({ ok: true });
    expect(delegateCalls).toHaveLength(1);
    expect(await halt).toMatchObject({ ok: true });
    expect(parseJournalText(readFileSync(resolved.value.journal, "utf8")).entries.at(-1)).toMatchObject({ type: "HALT", reason: "AUTH_FAILURE" });
    expect(await active.dispatch({ class: "authoritative", epoch: 8, action: { kind: "broker_mutation", mutation: submitMutation() } })).toMatchObject({ ok: false, reason: "HALT" });
    expect(delegateCalls).toHaveLength(1);
  });

  it("downgrades a mutation that settles after its aggregate deadline to broker-side confirmation uncertainty", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-inflight-deadline-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeFileSync(resolved.value.epoch, JSON.stringify({ epoch: 1, holderId: "prior", acquiredAt: "2026-09-01T12:00:00.000Z", seedPending: false, resetPending: false }), "utf8");
    let now = 0;
    let finish: (() => void) | undefined;
    let effects = 0;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const settled = new Promise<ReturnType<BrokerMutationPort["mutate"]> extends Promise<infer T> ? T : never>(resolve => {
      finish = () => { effects += 1; resolve({ ok: true, brokerOrderId: "late-effect" }); };
    });
    const gateway = createMutationGateway({ paths: resolved.value, secrets: [], clock: () => now, brokerPort: { mutate: () => { markStarted?.(); return settled; } }, instanceId: "deadline-runner", lockTakeoverBoundMs: 60_000, binding: BINDING });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    const pending = gateway.dispatch({ class: "authoritative", epoch: 2, deadlineAtMs: 10, action: { kind: "broker_mutation", mutation: { ...submitMutation(), notAfterMs: 10 } } });
    await started;
    now = 10;
    finish?.();
    expect(await pending).toMatchObject({ ok: false, reason: "PORT_ERROR:CYCLE_WALLTIME_EXCEEDED", source: "broker_port" });
    expect(effects).toBe(1);
  });
});

describe("P7 launch hardening — certificate failure recovery", () => {
  it("starts a same-day certificate retry after the highest journaled cycle identity", () => {
    const entries = [
      { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "CYCLE", cycleIndex: 1 },
      { seq: 2, at: "2026-09-01T12:01:00.000Z", epoch: 1, type: "SKIP", cycleIndex: 7 },
      { seq: 3, at: "2026-09-01T12:02:00.000Z", epoch: null, type: "SUPPRESSED" },
    ] as unknown as readonly JournalEntry[];
    expect(nextCertificateCycleIndex(entries)).toBe(8);
    expect(nextCertificateCycleIndex([])).toBe(1);
  });

  it("keeps lost acknowledgements unresolved until exact broker-terminal evidence exists", () => {
    const intent = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "INTENT", action: "entry", clientOrderId: "entry:unclear", quantity: 2 } as unknown as JournalEntry;
    const notAtBroker = { seq: 2, at: "2026-09-01T12:00:01.000Z", epoch: 1, type: "RECONCILIATION", reasonCodes: ["NOT_SUBMITTED"], items: [{ kind: "entry_order", clientOrderId: "entry:unclear", classification: "NOT_AT_BROKER" }] } as unknown as JournalEntry;
    const unclear = { seq: 3, at: "2026-09-01T12:00:02.000Z", epoch: 1, type: "OUTCOME", clientOrderId: "entry:unclear", status: "confirmation_unclear", brokerOrderId: null, filledQuantity: 0, avgFillPriceCents: null } as unknown as JournalEntry;
    const canceled = { seq: 4, at: "2026-09-01T12:00:03.000Z", epoch: 1, type: "OUTCOME", clientOrderId: "entry:unclear", status: "canceled", brokerOrderId: "broker-unclear", filledQuantity: 0, avgFillPriceCents: null } as unknown as JournalEntry;
    const partialTerminal = { ...canceled, status: "partially_filled", filledQuantity: 1, avgFillPriceCents: 100, avgFillPriceRaw: "1.00" } as unknown as JournalEntry;
    expect(unresolvedRecoveryEntryIds([intent, notAtBroker, unclear])).toEqual(["entry:unclear"]);
    expect(unresolvedRecoveryEntryIds([intent, notAtBroker, unclear, canceled])).toEqual([]);
    expect(unresolvedRecoveryEntryIds([intent, notAtBroker, unclear, partialTerminal])).toEqual([]);
  });

  it("retries after the first post-fill broker read throws and drives the account flat", async () => {
    let snapshotReads = 0;
    let exposed = true;
    let flattenCycles = 0;
    let halted = false;
    const halt = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "certificate aborted", sticky: false } as unknown as JournalEntry;
    const failures: string[][] = [];
    const runtime = {
      config: CERTIFICATE_TEST_CONFIG,
      binding: BINDING,
      tradingDay: "2026-09-01",
      broker: {
        fullSnapshot: () => {
          snapshotReads += 1;
          if (snapshotReads === 1) return Promise.reject(new Error("transient post-fill read failure"));
          return Promise.resolve({ account: { accountId: EXPECTED }, positions: exposed ? [{ contractId: "SPY260904C00500000", quantity: 1 }] : [], nonTerminalOrders: [], pagesComplete: true, consistentReads: 2 });
        },
      },
      gateway: {
        heartbeat: () => Promise.resolve(true),
        openJournal: () => Promise.resolve({ entries: halted ? [halt] : [], quarantined: [], halt: halted ? { halted: true, reason: "MANUAL", sticky: false } : { halted: false, reason: null, sticky: false } }),
        openJournalAsWriter: () => Promise.resolve({ entries: halted ? [halt] : [], quarantined: [], halt: halted ? { halted: true, reason: "MANUAL", sticky: false } : { halted: false, reason: null, sticky: false } }),
        dispatch: () => { halted = true; return Promise.resolve({ ok: true, seq: 1, stalenessNeutral: false }); },
      },
      cycle: () => { flattenCycles += 1; exposed = false; return Promise.resolve({}); },
      ping: { success: () => Promise.resolve(), fail: (conditions: readonly string[]) => { failures.push([...conditions]); return Promise.resolve(); } },
    } as unknown as AgentRuntime;

    const recovered = await recoverCertificateAfterFailure({
      runtime,
      repoRoot: process.cwd(),
      clock: () => 0,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      maxEntryCycles: 1,
      entryIntervalMs: 1,
      patienceCycles: 1,
      maxFlattenCycles: 3,
      flattenIntervalMs: 1,
      approveFenceUnhalt: () => Promise.resolve(null),
    });

    expect(recovered).toBe(true);
    expect(flattenCycles).toBe(1);
    expect(snapshotReads).toBe(2);
    expect(failures).toEqual([["CERTIFICATE_ABORTED"]]);
  });

  it("waits for an already-admitted broker mutation before accepting a flat recovery snapshot", async () => {
    let releaseBarrier: (() => void) | undefined;
    let enterBarrier: (() => void) | undefined;
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
    const barrierEntered = new Promise<void>(resolve => { enterBarrier = resolve; });
    let barrierReads = 0;
    let snapshotReads = 0;
    let exposed = false;
    let flattenCycles = 0;
    let halted = false;
    let terminal = false;
    let haltRequests = 0;
    const intent = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "INTENT", action: "entry", clientOrderId: "entry:late", quantity: 1 } as unknown as JournalEntry;
    const halt = { seq: 2, at: "2026-09-01T12:00:01.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "certificate aborted", sticky: false } as unknown as JournalEntry;
    const filled = { seq: 3, at: "2026-09-01T12:00:02.000Z", epoch: 1, type: "OUTCOME", clientOrderId: "entry:late", status: "filled", brokerOrderId: "broker-late", filledQuantity: 1, avgFillPriceCents: 100, avgFillPriceRaw: "1.00" } as unknown as JournalEntry;
    const runtime = {
      config: CERTIFICATE_TEST_CONFIG,
      binding: BINDING,
      tradingDay: "2026-09-01",
      broker: {
        fullSnapshot: () => {
          snapshotReads += 1;
          return Promise.resolve({ account: { accountId: EXPECTED }, positions: exposed ? [{ contractId: "SPY260904C00500000", quantity: 1 }] : [], nonTerminalOrders: [], pagesComplete: true, consistentReads: 2 });
        },
      },
      gateway: {
        heartbeat: () => Promise.resolve(true),
        openJournal: () => Promise.resolve({ entries: terminal ? [intent, halt, filled] : halted ? [intent, halt] : [intent], quarantined: [], halt: halted ? { halted: true, reason: "MANUAL", sticky: false } : { halted: false, reason: null, sticky: false } }),
        openJournalAsWriter: async () => {
          barrierReads += 1;
          if (barrierReads === 1) {
            enterBarrier?.();
            await barrier;
          }
          return { entries: terminal ? [intent, halt, filled] : halted ? [intent, halt] : [intent], quarantined: [], halt: halted ? { halted: true, reason: "MANUAL", sticky: false } : { halted: false, reason: null, sticky: false } };
        },
        dispatch: () => { haltRequests += 1; halted = true; return Promise.resolve({ ok: true, seq: 2, stalenessNeutral: false }); },
      },
      epoch: 1,
      cycle: () => { flattenCycles += 1; exposed = false; terminal = true; return Promise.resolve({}); },
      ping: { success: () => Promise.resolve(), fail: () => Promise.resolve() },
    } as unknown as AgentRuntime;

    const recovery = recoverCertificateAfterFailure({
      runtime,
      repoRoot: process.cwd(),
      clock: () => 0,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      maxEntryCycles: 1,
      entryIntervalMs: 1,
      patienceCycles: 1,
      maxFlattenCycles: 2,
      flattenIntervalMs: 1,
      approveFenceUnhalt: () => Promise.resolve(null),
    });
    await barrierEntered;
    expect(snapshotReads).toBe(0);
    exposed = true;
    releaseBarrier?.();

    await expect(recovery).resolves.toBe(true);
    expect(snapshotReads).toBe(1);
    expect(flattenCycles).toBe(1);
    expect(haltRequests).toBe(1);
  });

  it("refuses a flat recovery snapshot when writer authority changes during the broker read", async () => {
    let writerReads = 0;
    const halt = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "certificate aborted", sticky: false } as unknown as JournalEntry;
    const runtime = {
      config: CERTIFICATE_TEST_CONFIG,
      binding: BINDING,
      tradingDay: "2026-09-01",
      epoch: 1,
      broker: { fullSnapshot: () => Promise.resolve({ account: { accountId: EXPECTED }, positions: [], nonTerminalOrders: [], pagesComplete: true, consistentReads: 2 }) },
      gateway: {
        heartbeat: () => Promise.resolve(false),
        openJournalAsWriter: () => {
          writerReads += 1;
          return Promise.resolve(writerReads === 1 ? { entries: [halt], quarantined: [], halt: { halted: true, reason: "MANUAL", sticky: false } } : null);
        },
      },
      cycle: () => Promise.resolve({}),
      ping: { success: () => Promise.resolve(), fail: () => Promise.resolve() },
    } as unknown as AgentRuntime;

    await expect(recoverCertificateAfterFailure({
      runtime,
      repoRoot: process.cwd(),
      clock: () => 0,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      maxEntryCycles: 1,
      entryIntervalMs: 1,
      patienceCycles: 1,
      maxFlattenCycles: 1,
      flattenIntervalMs: 1,
      approveFenceUnhalt: () => Promise.resolve(null),
    })).resolves.toBe(false);
    expect(writerReads).toBe(2);
  });

  it("invalidates a flat proof when the human halt transition changes during the snapshot", async () => {
    const firstHalt = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "abort", sticky: false } as unknown as JournalEntry;
    const unhalt = { seq: 2, at: "2026-09-01T12:00:01.000Z", epoch: 1, type: "UNHALT", operator: "owner", reason: "changed", actor: "human" } as unknown as JournalEntry;
    const replacement = { seq: 3, at: "2026-09-01T12:00:02.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "replacement", sticky: false } as unknown as JournalEntry;
    let opens = 0;
    const runtime = {
      config: CERTIFICATE_TEST_CONFIG,
      binding: BINDING,
      tradingDay: "2026-09-01",
      epoch: 1,
      broker: { fullSnapshot: () => Promise.resolve({ account: { accountId: EXPECTED }, positions: [], nonTerminalOrders: [], pagesComplete: true, consistentReads: 2 }) },
      gateway: {
        heartbeat: () => Promise.resolve(false),
        openJournalAsWriter: () => {
          opens += 1;
          const entries = opens === 1 ? [firstHalt] : [firstHalt, unhalt, replacement];
          return Promise.resolve({ entries, quarantined: [], halt: { halted: true, reason: "MANUAL", sticky: false } });
        },
      },
      cycle: () => Promise.resolve({}),
      ping: { success: () => Promise.resolve(), fail: () => Promise.resolve() },
    } as unknown as AgentRuntime;

    await expect(recoverCertificateAfterFailure({ runtime, repoRoot: process.cwd(), clock: () => 0, sleep: () => Promise.resolve(), log: () => undefined, maxEntryCycles: 1, entryIntervalMs: 1, patienceCycles: 1, maxFlattenCycles: 1, flattenIntervalMs: 1, approveFenceUnhalt: () => Promise.resolve(null) })).resolves.toBe(false);
    expect(opens).toBe(2);
  });

  it("invalidates a flat recovery proof when lifecycle journal truth changes during the snapshot", async () => {
    const halt = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "abort", sticky: false } as unknown as JournalEntry;
    const intent = { seq: 2, at: "2026-09-01T12:00:01.000Z", epoch: 1, type: "INTENT", action: "entry", clientOrderId: "entry:late", quantity: 1 } as unknown as JournalEntry;
    const canceled = { seq: 3, at: "2026-09-01T12:00:02.000Z", epoch: 1, type: "OUTCOME", clientOrderId: "entry:late", status: "canceled", brokerOrderId: "broker-late", filledQuantity: 0, avgFillPriceCents: null } as unknown as JournalEntry;
    const lateFill = { seq: 4, at: "2026-09-01T12:00:03.000Z", epoch: 1, type: "OUTCOME", clientOrderId: "entry:late", status: "filled", brokerOrderId: "broker-late", filledQuantity: 1, avgFillPriceCents: 100, avgFillPriceRaw: "1.00" } as unknown as JournalEntry;
    let opens = 0;
    const runtime = {
      config: CERTIFICATE_TEST_CONFIG,
      binding: BINDING,
      tradingDay: "2026-09-01",
      epoch: 1,
      broker: { fullSnapshot: () => Promise.resolve({ account: { accountId: EXPECTED }, positions: [], nonTerminalOrders: [], pagesComplete: true, consistentReads: 2 }) },
      gateway: {
        heartbeat: () => Promise.resolve(false),
        openJournalAsWriter: () => {
          opens += 1;
          const entries = opens === 1 ? [halt, intent, canceled] : [halt, intent, canceled, lateFill];
          return Promise.resolve({ entries, quarantined: [], halt: { halted: true, reason: "MANUAL", sticky: false } });
        },
      },
      cycle: () => Promise.resolve({}),
      ping: { success: () => Promise.resolve(), fail: () => Promise.resolve() },
    } as unknown as AgentRuntime;

    await expect(recoverCertificateAfterFailure({ runtime, repoRoot: process.cwd(), clock: () => 0, sleep: () => Promise.resolve(), log: () => undefined, maxEntryCycles: 1, entryIntervalMs: 1, patienceCycles: 1, maxFlattenCycles: 1, flattenIntervalMs: 1, approveFenceUnhalt: () => Promise.resolve(null) })).resolves.toBe(false);
    expect(opens).toBe(2);
  });

  it("does not declare a quiescent recovery snapshot flat while it still carries a nonzero position", async () => {
    // Both certificate-recovery fixtures above flip their fake `exposed` flag false via the flatten `cycle()`
    // side effect before the deciding snapshot read, so the snapshot itself is always already flat by then.
    // This fixture stays quiescent (already halted, no unresolved entry lifecycle) from the very first barrier,
    // so the recovery loop reaches the stable-flat snapshot gate on attempt 1 while the broker still reports a
    // real nonzero position: `positions.every(quantity === 0)` must be the reason recovery is refused, not
    // merely `pagesComplete`/`consistentReads`/`nonTerminalOrders`, which all read as satisfied here.
    const halt = { seq: 1, at: "2026-09-01T12:00:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "certificate aborted", sticky: false } as unknown as JournalEntry;
    let flattenCycles = 0;
    const failures: string[][] = [];
    const runtime = {
      config: CERTIFICATE_TEST_CONFIG,
      binding: BINDING,
      tradingDay: "2026-09-01",
      epoch: 1,
      broker: { fullSnapshot: () => Promise.resolve({ account: { accountId: EXPECTED }, positions: [{ contractId: "SPY260904C00500000", quantity: 1 }], nonTerminalOrders: [], pagesComplete: true, consistentReads: 2 }) },
      gateway: {
        heartbeat: () => Promise.resolve(true),
        openJournal: () => Promise.resolve({ entries: [halt], quarantined: [], halt: { halted: true, reason: "MANUAL", sticky: false } }),
        openJournalAsWriter: () => Promise.resolve({ entries: [halt], quarantined: [], halt: { halted: true, reason: "MANUAL", sticky: false } }),
        dispatch: () => Promise.resolve({ ok: true, seq: 2, stalenessNeutral: false }),
      },
      cycle: () => { flattenCycles += 1; return Promise.resolve({}); },
      ping: { success: () => Promise.resolve(), fail: (conditions: readonly string[]) => { failures.push([...conditions]); return Promise.resolve(); } },
    } as unknown as AgentRuntime;

    const recovered = await recoverCertificateAfterFailure({
      runtime,
      repoRoot: process.cwd(),
      clock: () => 0,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      maxEntryCycles: 1,
      entryIntervalMs: 1,
      patienceCycles: 1,
      maxFlattenCycles: 1,
      flattenIntervalMs: 1,
      approveFenceUnhalt: () => Promise.resolve(null),
    });

    expect(recovered).toBe(false);
    expect(flattenCycles).toBe(1);
    expect(failures).toEqual([["CERTIFICATE_ABORTED"], ["CERTIFICATE_EXPOSURE_UNRESOLVED"]]);
  });
});

describe("P7 launch hardening — real broker transport", () => {
  it("treats a non-2xx health response as failed delivery", async () => {
    let calls = 0;
    const ping = createPingPort({ url: "https://health.example/check", recordFile: null, clock: () => 0, timeoutMs: 100, fetchImpl: () => { calls += 1; return Promise.resolve(new Response(null, { status: 503 })); } });
    await expect(ping.success()).rejects.toThrow("PING_HTTP_503");
    expect(calls).toBe(1);
  });

  it("does not start a health request after the inherited cycle deadline", async () => {
    let calls = 0;
    const ping = createPingPort({ url: "https://health.example/check", recordFile: null, clock: () => 10, timeoutMs: 100, fetchImpl: () => { calls += 1; return Promise.resolve(new Response(null, { status: 200 })); } });
    await expect(ping.success(10)).rejects.toThrow("PING_DEADLINE_EXCEEDED");
    expect(calls).toBe(0);
  });

  it("preserves a mutation HTTP 403 as a typed credential failure", async () => {
    const fetchImpl = (() => Promise.resolve(jsonResponse(403, { message: "credential scope revoked" }))) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => 0, fetchImpl, requestTimeoutMs: 100 });
    await expect(broker.port.mutate(submitMutation())).rejects.toMatchObject({ status: 403 });
  });

  it("times out even when an injected fetch implementation ignores AbortSignal", async () => {
    const fetchImpl = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => 0, fetchImpl, requestTimeoutMs: 5 });
    await expect(broker.read.account()).rejects.toThrow("BROKER_TIMEOUT after 5 ms");
  });

  it("keeps the broker timeout active while a response body is stalled", async () => {
    const stalled = { status: 200, text: () => new Promise<string>(() => undefined) } as Response;
    const fetchImpl = (() => Promise.resolve(stalled)) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => 0, fetchImpl, requestTimeoutMs: 5 });
    await expect(broker.read.account()).rejects.toThrow("BROKER_TIMEOUT after 5 ms");
  });

  it("returns control at the aggregate cycle walltime even when the work never settles", async () => {
    await expect(runWithinCycleWalltime(5, () => 0, () => new Promise<never>(() => undefined))).rejects.toThrow("CYCLE_WALLTIME_EXCEEDED after 5 ms");
  });

  it("does not report a cycle result after synchronous work blocks past the walltime", async () => {
    const budgetMs = 10;
    await expect(runWithinCycleWalltime(budgetMs, () => Date.now(), async () => {
      await Promise.resolve();
      const releaseAt = Date.now() + 50;
      while (Date.now() < releaseAt) { /* executable synchronous-stall probe */ }
      return "LATE_SUCCESS";
    })).rejects.toThrow(`CYCLE_WALLTIME_EXCEEDED after ${String(budgetMs)} ms`);
  });

  it("does not report the pre-fill half of a torn snapshot as stable flat", async () => {
    let positionReads = 0;
    const account = { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" };
    const position = { symbol: "SPY260904C00500000", qty: "1", avg_entry_price: "1.00", side: "long" };
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v2/account")) return Promise.resolve(jsonResponse(200, account));
      if (url.endsWith("/v2/positions")) {
        positionReads += 1;
        return Promise.resolve(jsonResponse(200, positionReads === 1 ? [] : [position]));
      }
      if (url.includes("/v2/orders?")) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(404, { message: "unexpected" }));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => 1_000, fetchImpl, requestTimeoutMs: 100 });
    const snapshot = await broker.fullSnapshot();
    expect(positionReads).toBe(3);
    expect(snapshot.consistentReads).toBe(2);
    expect(snapshot.positions).toHaveLength(1);
  });

  it("does not call two order snapshots stable when only the exact raw fill average changed", async () => {
    let orderReads = 0;
    const account = { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" };
    const order = (raw: string) => ({ id: "broker-raw", client_order_id: "entry:raw", symbol: "SPY260904C00645000", side: "buy", qty: "2", filled_qty: "1", filled_avg_price: raw, limit_price: "1.03", status: "partially_filled" });
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v2/account")) return Promise.resolve(jsonResponse(200, account));
      if (url.endsWith("/v2/positions")) return Promise.resolve(jsonResponse(200, []));
      if (url.includes("/v2/orders?")) {
        orderReads += 1;
        return Promise.resolve(jsonResponse(200, [order(orderReads === 1 ? "1.031" : "1.034")]));
      }
      return Promise.resolve(jsonResponse(404, { message: "unexpected" }));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => 1_000, fetchImpl, requestTimeoutMs: 100 });
    const snapshot = await broker.fullSnapshot();
    expect(orderReads).toBe(3);
    expect(snapshot.consistentReads).toBe(2);
    expect(snapshot.orders[0]).toMatchObject({ avgFillPriceCents: 103, avgFillPriceRaw: "1.034" });
  });

  it("carries one absolute deadline through every page of a full broker snapshot", async () => {
    let now = 0;
    let orderRequests = 0;
    const page = Array.from({ length: 500 }, (_, index) => ({ id: `broker-${String(index)}`, client_order_id: `entry:${String(index)}`, symbol: "SPY260904C00645000", side: "buy", qty: "1", filled_qty: "0", filled_avg_price: null, limit_price: "1.00", status: "accepted", submitted_at: `2026-09-01T14:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z` }));
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      now += 20;
      if (url.endsWith("/v2/account")) return Promise.resolve(jsonResponse(200, { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" }));
      if (url.endsWith("/v2/positions")) return Promise.resolve(jsonResponse(200, []));
      if (url.includes("/v2/orders?")) { orderRequests += 1; return Promise.resolve(jsonResponse(200, page)); }
      return Promise.resolve(jsonResponse(404, { message: "unexpected" }));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => now, fetchImpl, requestTimeoutMs: 100 });
    await expect(broker.fullSnapshot(50)).rejects.toThrow("CYCLE_WALLTIME_EXCEEDED");
    expect(orderRequests).toBe(1);
  });

  it("refuses a stable snapshot when synchronous response work crosses its absolute deadline", async () => {
    let now = 0;
    let orderRequests = 0;
    const account = { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" };
    const order = { id: "broker-sync", client_order_id: "entry:sync", symbol: "SPY260904C00645000", side: "buy", qty: "1", filled_qty: "0", filled_avg_price: null, limit_price: "1.00", status: "accepted" };
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v2/account")) return Promise.resolve(jsonResponse(200, account));
      if (url.endsWith("/v2/positions")) return Promise.resolve(jsonResponse(200, []));
      if (url.includes("/v2/orders?")) {
        orderRequests += 1;
        now += orderRequests === 1 ? 40 : 70;
        return Promise.resolve(jsonResponse(200, [order]));
      }
      return Promise.resolve(jsonResponse(404, { message: "unexpected" }));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => now, fetchImpl, requestTimeoutMs: 100 });
    await expect(broker.fullSnapshot(100)).rejects.toThrow("CYCLE_WALLTIME_EXCEEDED");
    expect(orderRequests).toBe(2);
    expect(now).toBe(110);
  });

  it("does not return a late snapshot when synchronous broker work blocks the real wall clock", async () => {
    let orderRequests = 0;
    const account = { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" };
    const order = { id: "broker-wallclock", client_order_id: "entry:wallclock", symbol: "SPY260904C00645000", side: "buy", qty: "1", filled_qty: "0", filled_avg_price: null, limit_price: "1.00", status: "accepted" };
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/v2/account")) return Promise.resolve(jsonResponse(200, account));
      if (url.endsWith("/v2/positions")) return Promise.resolve(jsonResponse(200, []));
      if (url.includes("/v2/orders?")) {
        orderRequests += 1;
        if (orderRequests === 2) {
          const releaseAt = Date.now() + 60;
          while (Date.now() < releaseAt) { /* executable synchronous-stall probe */ }
        }
        return Promise.resolve(jsonResponse(200, [order]));
      }
      return Promise.resolve(jsonResponse(404, { message: "unexpected" }));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => Date.now(), fetchImpl, requestTimeoutMs: 200 });
    await expect(broker.fullSnapshot(Date.now() + 30)).rejects.toThrow("CYCLE_WALLTIME_EXCEEDED");
    expect(orderRequests).toBe(2);
  });

  it("threads the same absolute deadline into the stability re-read instead of re-deriving a fresh one for it", async () => {
    let now = 0;
    const account = { account_number: EXPECTED, cash: "100000.00", equity: "100000.00", created_at: "2026-09-01T12:00:00Z", status: "ACTIVE" };
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      now += 20;
      if (url.endsWith("/v2/account")) return Promise.resolve(jsonResponse(200, account));
      if (url.endsWith("/v2/positions")) return Promise.resolve(jsonResponse(200, []));
      if (url.includes("/v2/orders?")) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(404, { message: "unexpected" }));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => now, fetchImpl, requestTimeoutMs: 100_000 });
    // The first read (account, positions, one empty orders page) completes at now=60; the loop's pre-read
    // check at now=60 still clears deadlineAtMs=70, so the stability re-read genuinely starts. Its first
    // request pushes now to 80 — past that same absolute deadline. A correctly threaded deadline rejects
    // there; a freshly re-derived deadline for the re-read (e.g. clock-at-call-time plus its own budget)
    // would not, since it would always still be in the future relative to whatever "now" is by then.
    await expect(broker.fullSnapshot(70)).rejects.toThrow("CYCLE_WALLTIME_EXCEEDED");
  });

  it("enforces its one absolute deadline on every page of an order-history pagination, including the third and later", async () => {
    let now = 0;
    let pageRequests = 0;
    const submittedAt = (index: number): string => new Date(1_772_000_000_000 + index * 1_000).toISOString();
    const rawOrder = (index: number) => ({ id: `broker-${String(index)}`, client_order_id: `entry:${String(index)}`, symbol: "SPY260904C00645000", side: "buy", qty: "1", filled_qty: "0", filled_avg_price: null, limit_price: "1.00", status: "accepted", submitted_at: submittedAt(index) });
    const page1 = Array.from({ length: 500 }, (_, index) => rawOrder(index));
    const page2 = Array.from({ length: 500 }, (_, index) => rawOrder(500 + index));
    const page3 = Array.from({ length: 10 }, (_, index) => rawOrder(1_000 + index));
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/v2/orders?")) return Promise.reject(new Error(`unexpected request ${url}`));
      pageRequests += 1;
      // Pages 1 and 2 are cheap; page 3 is where the clock crosses the deadline.
      now += pageRequests <= 2 ? 20 : 100;
      const body = pageRequests === 1 ? page1 : pageRequests === 2 ? page2 : pageRequests === 3 ? page3 : [];
      return Promise.resolve(jsonResponse(200, body));
    }) as typeof fetch;
    const broker = createAlpacaBroker({ credentials: { keyId: "test", secretKey: "test" }, tradingOrigin: ORIGIN, dataOrigin: "https://data.alpaca.markets", clock: () => now, fetchImpl, requestTimeoutMs: 100_000 });
    // Three genuine pages (two full 500-item pages force real pagination, then a short third page); pages 1-2
    // land under deadlineAtMs=100 carrying that same absolute deadline, page 3 pushes now to 140 past it.
    await expect(broker.ordersByStatus("all", 100)).rejects.toThrow("CYCLE_WALLTIME_EXCEEDED");
    expect(pageRequests).toBe(3);
  });
});

describe("P7 launch hardening — runtime and holder identity", () => {
  it("stops the verified child and releases its holder when post-launch construction throws", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-post-launch-cleanup-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeHolder(resolved.value, { holderId: "runtime-builder", heartbeatAt: 1 });
    let stopCalls = 0;

    await expect(withVerifiedChildFailureCleanup({ stop: () => { stopCalls += 1; return Promise.resolve(); } }, resolved.value, "runtime-builder", () => { throw new Error("digest input disappeared"); })).rejects.toThrow("digest input disappeared");

    expect(stopCalls).toBe(1);
    expect(readHolder(resolved.value)).toBeNull();
  });

  it("releases the runtime holder even when verified-child shutdown fails", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-runtime-shutdown-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeHolder(resolved.value, { holderId: "runtime-owner", heartbeatAt: 1 });
    let stopCalls = 0;

    await expect(shutdownRuntimeResources({ stop: () => { stopCalls += 1; return Promise.reject(new Error("child close failed")); } }, resolved.value, "runtime-owner")).rejects.toThrow("child close failed");

    expect(stopCalls).toBe(1);
    expect(readHolder(resolved.value)).toBeNull();
  });

  it("releases the runtime holder when verified-child shutdown never settles", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-runtime-shutdown-timeout-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeHolder(resolved.value, { holderId: "runtime-owner", heartbeatAt: 1 });
    let stopCalls = 0;

    await expect(shutdownRuntimeResources({ stop: () => { stopCalls += 1; return new Promise<void>(() => undefined); } }, resolved.value, "runtime-owner", 5)).rejects.toThrow("MCP_STOP_TIMEOUT after 5 ms");

    expect(stopCalls).toBe(1);
    expect(readHolder(resolved.value)).toBeNull();
  });

  it("releases the construction holder when failure cleanup cannot stop the child", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-runtime-builder-timeout-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeHolder(resolved.value, { holderId: "runtime-builder", heartbeatAt: 1 });

    const failure = withVerifiedChildFailureCleanup(
      { stop: () => new Promise<void>(() => undefined) },
      resolved.value,
      "runtime-builder",
      () => { throw new Error("construction failed"); },
      5,
    );
    await expect(failure).rejects.toThrow("runtime construction failed and cleanup was incomplete");
    expect(readHolder(resolved.value)).toBeNull();
  });

  it("runtime file enumeration includes the built JavaScript Node executes", () => {
    const root = temporaryDirectory("gbt-p7-digest-");
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "dist", "shell"), { recursive: true });
    writeFileSync(path.join(root, "src", "x.ts"), "export const x = 1;\n", "utf8");
    writeFileSync(path.join(root, "dist", "shell", "x.js"), "export const x = 1;\n", "utf8");
    expect(enumerateRuntimeFiles(root).map(item => item.path)).toEqual(["dist/shell/x.js", "src/x.ts"]);
  });

  it("a stale predecessor cannot remove a successor's holder record", async () => {
    const resolved = resolveStateDir(temporaryDirectory("gbt-p7-holder-"));
    if (!resolved.ok) throw new Error(resolved.detail);
    writeHolder(resolved.value, { holderId: "successor", heartbeatAt: 2 });
    expect(await releaseHolder(resolved.value, "predecessor")).toBe(false);
    expect(readHolder(resolved.value)).toEqual({ holderId: "successor", heartbeatAt: 2 });
    expect(await releaseHolder(resolved.value, "successor")).toBe(true);
    expect(readHolder(resolved.value)).toBeNull();
  });
});
