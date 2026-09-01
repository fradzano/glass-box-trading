import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountBoundBrokerPort } from "../src/shell/account-bound-broker.js";
import { parseJournalText } from "../src/core/journal.js";
import { createAlpacaBroker } from "../src/shell/alpaca-broker.js";
import { admitCertificateCommand } from "../src/shell/certificate-command-guard.js";
import { runWithinCycleWalltime } from "../src/shell/cycle-walltime.js";
import { enumerateRuntimeFiles } from "../src/shell/digests.js";
import { readHolder, releaseHolder, writeHolder } from "../src/shell/epoch-store.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import type { BrokerMutation, BrokerMutationPort } from "../src/shell/mutation-gateway.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import { recordStartupBrokerFence } from "../src/shell/startup-broker-fence.js";

const ORIGIN = "https://paper-api.alpaca.markets";
const EXPECTED = "PA_EXPECTED";
const BINDING = { profile: "dev", tradingOrigin: ORIGIN, accountId: EXPECTED } as const;
const temporaryDirectories: string[] = [];

describe("certificate command admission", () => {
  it("refuses every non-dev command before runtime construction and requires owner-go for smoke/live commands", () => {
    expect(admitCertificateCommand({ profile: "competition", ownerGo: true, preflight: true })).toMatchObject({ ok: false });
    expect(admitCertificateCommand({ profile: "competition", ownerGo: true, preflight: false })).toMatchObject({ ok: false });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: false })).toMatchObject({ ok: false });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: true, preflight: false })).toEqual({ ok: true });
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
});

describe("P7 launch hardening — real broker transport", () => {
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
});

describe("P7 launch hardening — runtime and holder identity", () => {
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
