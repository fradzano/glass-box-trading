import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindAccount, isAllowedMarketDataOrigin } from "../src/core/authority.js";
import { encodeJournalLine, parseJournalText, redactSecrets } from "../src/core/journal.js";
import { createMutationGateway, NO_BROKER_PORT } from "../src/shell/mutation-gateway.js";
import type { BrokerMutationPort } from "../src/shell/mutation-gateway.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN, cycleEntry, draftOf, intentEntry, journalSnapshot } from "./journal-fixtures.js";

const temporaryDirectories: string[] = [];
function temporaryStateDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p2-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const FAKE_KEY = "TEST_ONLY_FAKE_KEY_PKX7Q2ZL9M4A";
const FAKE_SECRET = "TEST_ONLY_FAKE_SECRET_s3cr3tV4lu3W1thL3ngth";
const FAKE_PING = "https://hc-ping.test/TEST_ONLY_FAKE_PING_UUID";

function recordingPort(): BrokerMutationPort & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    mutate: (request) => {
      calls.push(request);
      return Promise.resolve({ ok: true, brokerOrderId: "fake-1" });
    },
  };
}

describe("S-J-05 secrets never reach the journal", () => {
  it("S-J-05 redacts every known secret from strings before encoding and refuses a line that still carries one", () => {
    expect(redactSecrets(`401 for key ${FAKE_KEY} at ${FAKE_PING}`, [FAKE_KEY, FAKE_SECRET, FAKE_PING])).toBe("401 for key [REDACTED] at [REDACTED]");
    expect(redactSecrets(`${FAKE_KEY}${FAKE_KEY}`, [FAKE_KEY])).toBe("[REDACTED][REDACTED]");
    expect(redactSecrets("nothing here", [FAKE_KEY])).toBe("nothing here");
    expect(() => redactSecrets("x", [""])).toThrow(/empty secret/u);
    const entry = cycleEntry(1, {
      reasonCodes: ["AUTH_FAILURE"],
      batchVerdicts: [{ code: "SCHEMA_VETO", reason: `broker said: invalid key ${FAKE_KEY} / secret ${FAKE_SECRET}` }],
      snapshot: journalSnapshot({ openOrders: [{ brokerOrderId: "b", clientOrderId: `entry:${FAKE_SECRET}`, status: "accepted", brokerSubmittedAt: "x" }] }),
    });
    const encoded = encodeJournalLine(entry, [FAKE_KEY, FAKE_SECRET, FAKE_PING]);
    if (!encoded.ok) throw new Error(encoded.reason);
    expect(encoded.line).not.toContain(FAKE_KEY);
    expect(encoded.line).not.toContain(FAKE_SECRET);
    expect(encoded.line).toContain("[REDACTED]");
    // A secret that only appears after JSON escaping (a quote inside it) is caught by the post-encoding check, not by string replacement.
    const quotedSecret = 'TEST_ONLY_"quoted"_SECRET';
    const carrier = cycleEntry(1, { batchVerdicts: [{ code: "SCHEMA_VETO", reason: `raw ${quotedSecret} raw` }] });
    expect(encodeJournalLine(carrier, [JSON.stringify(quotedSecret).slice(1, -1)])).toMatchObject({ ok: false, reason: "SECRET_LEAK" });
  });

  it("S-J-05 a fake key injected into an error path never reaches the journal file", async () => {
    const paths = resolveStateDir(temporaryStateDir());
    if (!paths.ok) throw new Error(paths.reason);
    writeFileSync(paths.value.epoch, JSON.stringify({ epoch: 1, holderId: "prior-writer", acquiredAt: TEST_ONLY_AT, seedPending: false }), "utf8");
    const gateway = createMutationGateway({ paths: paths.value, secrets: [FAKE_KEY, FAKE_SECRET, FAKE_PING], clock: () => TEST_ONLY_AT_MS, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    const errorText = `AuthError: 403 Forbidden for APCA-API-KEY-ID=${FAKE_KEY} secret=${FAKE_SECRET} ping=${FAKE_PING}`;
    const result = await gateway.dispatch({
      class: "authoritative",
      epoch: 2,
      action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2, reasonCodes: ["AUTH_FAILURE"], batchVerdicts: [{ code: "SCHEMA_VETO", reason: errorText }] })) },
    });
    expect(result).toMatchObject({ ok: true, seq: 1 });
    const rejected = await gateway.dispatch({
      class: "authoritative",
      epoch: 2,
      action: { kind: "journal_append", entry: draftOf(cycleEntry(1, { epoch: 2, reasonCodes: ["NOT_A_CODE"], batchVerdicts: [{ code: "SCHEMA_VETO", reason: errorText }] })) },
    });
    expect(rejected).toMatchObject({ ok: false });
    expect(JSON.stringify(rejected)).not.toContain(FAKE_KEY);
    const text = readFileSync(paths.value.journal, "utf8");
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain("TEST_ONLY_FAKE_PING_UUID");
    expect(text).toContain("[REDACTED]");
    expect(parseJournalText(text).entries).toHaveLength(1);
    expect(() => createMutationGateway({ paths: paths.value, secrets: [""], clock: () => TEST_ONLY_AT_MS, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 })).toThrow(/empty secret/u);
  });
});

describe("S-J-06 account binding", () => {
  const config = { canonicalTradingOrigin: TEST_ONLY_ORIGIN, expectedAccountId: TEST_ONLY_ACCOUNT_ID };
  const observed = { profile: "dev", requestedOrigin: TEST_ONLY_ORIGIN, observedOrigin: TEST_ONLY_ORIGIN, brokerReportedAccountId: TEST_ONLY_ACCOUNT_ID };

  it("S-J-06 binds the closed triplet from two independent sources and fails closed on every mismatch class", () => {
    expect(bindAccount(config, observed)).toEqual({ ok: true, binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } });
    expect(bindAccount(config, { ...observed, profile: "competition" })).toMatchObject({ ok: true, binding: { profile: "competition" } });
    expect(bindAccount(config, { ...observed, profile: "live" })).toMatchObject({ ok: false, reason: "UNKNOWN_PROFILE" });
    expect(bindAccount(config, { ...observed, profile: "" })).toMatchObject({ ok: false, reason: "UNKNOWN_PROFILE" });
    expect(bindAccount(config, { ...observed, profile: "Dev" })).toMatchObject({ ok: false, reason: "UNKNOWN_PROFILE" });
    // The live origin fails even when it reports the expected ID.
    expect(bindAccount(config, { ...observed, requestedOrigin: "https://api.alpaca.markets", observedOrigin: "https://api.alpaca.markets" })).toMatchObject({ ok: false, reason: "ORIGIN_NOT_CANONICAL" });
    expect(bindAccount({ ...config, canonicalTradingOrigin: "https://api.alpaca.markets" }, { ...observed, requestedOrigin: "https://api.alpaca.markets", observedOrigin: "https://api.alpaca.markets" })).toMatchObject({ ok: false, reason: "CONFIG_INVALID_TRADING_ORIGIN" });
    // Redirect: the observed origin differs from the requested canonical one.
    expect(bindAccount(config, { ...observed, observedOrigin: "https://paper-api.alpaca.markets.example.net" })).toMatchObject({ ok: false, reason: "ORIGIN_REDIRECTED" });
    expect(bindAccount(config, { ...observed, observedOrigin: "https://api.alpaca.markets" })).toMatchObject({ ok: false, reason: "ORIGIN_REDIRECTED" });
    for (const foreign of [
      "http://paper-api.alpaca.markets",
      "https://paper-api.alpaca.markets:443",
      "https://paper-api.alpaca.markets:8443",
      "https://paper-api.alpaca.markets/",
      "https://paper-api.alpaca.markets/v2",
      "https://paper-api.alpaca.markets?x=1",
      "https://paper-api.alpaca.markets#f",
      "https://PAPER-API.alpaca.markets",
      "https://paper-api.alpaca.markets.evil.example",
      "https://evil.example@paper-api.alpaca.markets",
      "https://paper-api.alpaca.markets․com",
      " https://paper-api.alpaca.markets",
      "",
    ]) {
      expect(bindAccount(config, { ...observed, requestedOrigin: foreign, observedOrigin: foreign }), foreign).toMatchObject({ ok: false });
    }
    // Valid paper origin with the wrong ID.
    expect(bindAccount(config, { ...observed, brokerReportedAccountId: "PA_OTHER" })).toMatchObject({ ok: false, reason: "ACCOUNT_ID_MISMATCH" });
    expect(bindAccount(config, { ...observed, brokerReportedAccountId: TEST_ONLY_ACCOUNT_ID.toLowerCase() })).toMatchObject({ ok: false, reason: "ACCOUNT_ID_MISMATCH" });
    // Unset or empty expected ID is a config error; empty-vs-empty never matches (GV-5).
    expect(bindAccount({ ...config, expectedAccountId: "" }, { ...observed, brokerReportedAccountId: "" })).toMatchObject({ ok: false, reason: "CONFIG_INVALID_EXPECTED_ACCOUNT_ID" });
    expect(bindAccount({ ...config, expectedAccountId: "   " }, { ...observed, brokerReportedAccountId: "   " })).toMatchObject({ ok: false, reason: "CONFIG_INVALID_EXPECTED_ACCOUNT_ID" });
    expect(bindAccount({ ...config, expectedAccountId: undefined }, observed)).toMatchObject({ ok: false, reason: "CONFIG_INVALID_EXPECTED_ACCOUNT_ID" });
    expect(bindAccount(config, { ...observed, brokerReportedAccountId: "" })).toMatchObject({ ok: false, reason: "ACCOUNT_ID_MISMATCH" });
    expect(bindAccount(config, { ...observed, brokerReportedAccountId: undefined })).toMatchObject({ ok: false, reason: "ACCOUNT_ID_MISMATCH" });
    // Market-data origins are a separate allowlist and never grant order capability.
    const dataAllowlist = ["https://data.alpaca.markets"];
    expect(isAllowedMarketDataOrigin("https://data.alpaca.markets", dataAllowlist)).toBe(true);
    expect(isAllowedMarketDataOrigin("https://data.alpaca.markets/v2", dataAllowlist)).toBe(false);
    expect(isAllowedMarketDataOrigin(TEST_ONLY_ORIGIN, dataAllowlist)).toBe(false);
    expect(bindAccount(config, { ...observed, requestedOrigin: "https://data.alpaca.markets", observedOrigin: "https://data.alpaca.markets" })).toMatchObject({ ok: false, reason: "ORIGIN_NOT_CANONICAL" });
  });

  it("S-J-06 the gateway refuses a broker mutation whose binding differs from the configured one, journals it, and halts", async () => {
    const paths = resolveStateDir(temporaryStateDir());
    if (!paths.ok) throw new Error(paths.reason);
    writeFileSync(paths.value.epoch, JSON.stringify({ epoch: 1, holderId: "prior-writer", acquiredAt: TEST_ONLY_AT, seedPending: false }), "utf8");
    const port = recordingPort();
    const gateway = createMutationGateway({
      paths: paths.value,
      secrets: [],
      clock: () => TEST_ONLY_AT_MS,
      brokerPort: port,
      instanceId: "writer-a",
      lockTakeoverBoundMs: 60_000,
      binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID },
    });
    expect(await gateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    const wrongAccount = await gateway.dispatch({
      class: "authoritative",
      epoch: 2,
      action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: "entry:x", binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: "PA_OTHER" } } },
    });
    expect(wrongAccount).toMatchObject({ ok: false, reason: "ACCOUNT_BINDING_MISMATCH" });
    const wrongOrigin = await gateway.dispatch({
      class: "authoritative",
      epoch: 2,
      action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: "entry:x", binding: { profile: "dev", tradingOrigin: "https://api.alpaca.markets", accountId: TEST_ONLY_ACCOUNT_ID } } },
    });
    expect(wrongOrigin).toMatchObject({ ok: false, reason: "ACCOUNT_BINDING_MISMATCH" });
    const wrongRole = await gateway.dispatch({
      class: "authoritative",
      epoch: 2,
      action: { kind: "broker_mutation", mutation: { kind: "cancel_order", clientOrderId: "entry:x", binding: { profile: "competition", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } } },
    });
    expect(wrongRole).toMatchObject({ ok: false, reason: "ACCOUNT_BINDING_MISMATCH" });
    expect(port.calls).toHaveLength(0);
    const entries = parseJournalText(readFileSync(paths.value.journal, "utf8")).entries;
    expect(entries.filter(entry => entry.type === "HALT")).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "HALT", reason: "ACCOUNT_BINDING_MISMATCH" });
    expect(readHaltState(paths.value)).toMatchObject({ halted: true, reason: "ACCOUNT_BINDING_MISMATCH" });
    // Order-related journal entries must carry the same binding.
    const foreignIntent = await gateway.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(intentEntry(1, { epoch: 2, binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: "PA_OTHER" } })) } });
    expect(foreignIntent).toMatchObject({ ok: false, reason: "ACCOUNT_BINDING_MISMATCH" });
    const boundIntent = await gateway.dispatch({ class: "authoritative", epoch: 2, action: { kind: "journal_append", entry: draftOf(intentEntry(1, { epoch: 2 })) } });
    expect(boundIntent).toMatchObject({ ok: true });
    // In a fresh, un-halted state the correctly bound request reaches the port exactly once, with the bound triplet.
    const freshPaths = resolveStateDir(temporaryStateDir());
    if (!freshPaths.ok) throw new Error(freshPaths.reason);
    writeFileSync(freshPaths.value.epoch, JSON.stringify({ epoch: 1, holderId: "prior-writer", acquiredAt: TEST_ONLY_AT, seedPending: false }), "utf8");
    const freshGateway = createMutationGateway({ paths: freshPaths.value, secrets: [], clock: () => TEST_ONLY_AT_MS, brokerPort: port, instanceId: "writer-a", lockTakeoverBoundMs: 60_000, binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } });
    expect(await freshGateway.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 2 });
    const accepted = await freshGateway.dispatch({
      class: "authoritative",
      epoch: 2,
      action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: "entry:x", binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } } },
    });
    expect(accepted).toMatchObject({ ok: true });
    expect(port.calls).toHaveLength(1);
    // Without a configured binding, no broker mutation is possible at all.
    const unbound = createMutationGateway({ paths: paths.value, secrets: [], clock: () => TEST_ONLY_AT_MS + 120_000, brokerPort: port, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    expect(await unbound.acquireAuthority({ account: "unknown" })).toMatchObject({ kind: "WON", epoch: 3 });
    expect(await unbound.dispatch({ class: "authoritative", epoch: 3, action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: "entry:y", binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } } } })).toMatchObject({ ok: false, reason: "NO_ACCOUNT_BINDING" });
    expect(port.calls).toHaveLength(1);
  });
});
