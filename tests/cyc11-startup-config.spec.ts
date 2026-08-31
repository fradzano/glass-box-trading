// S-CYC-11 — startup config validation, fail closed. The pure matrix drives
// `validateStartupConfig` directly (BEQ-5, GV-5, KGV-8, KGV-15, KGV-17,
// WIN-5); the shell paths drive `runStartup` against the real P2 gateway in a
// temporary STATE_DIR and the file diagnostic sink (WIN-4): a violation
// journals a CONFIG_INVALID halt and fail-pings, an unopenable STATE_DIR
// takes the narrow sink path before any broker access, and a repaired run
// imports the pending diagnostic as CONFIG_INVALID.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { epochMsToUtcIso } from "../src/core/execution.js";
import { parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { validateStartupConfig } from "../src/core/startup.js";
import type { StartupViolation, StartupViolationCode } from "../src/core/startup.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import type { FakeBroker } from "../src/shell/fake-broker.js";
import { createFileDiagnosticSink } from "../src/shell/diagnostic-sink.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import { ALERT_SLA_MS, CANONICAL_PAPER_TRADING_ORIGIN, runStartup } from "../src/shell/startup.js";
import type { StartupOutcome, StartupPorts } from "../src/shell/startup.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN, journalSnapshot } from "./journal-fixtures.js";
import { validStartupConfig } from "./startup-fixtures.js";
import type { RawStartupConfig } from "./startup-fixtures.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function freshDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p4-"));
  temporaryDirectories.push(directory);
  return directory;
}

const EXPECTATIONS = { canonicalTradingOrigin: CANONICAL_PAPER_TRADING_ORIGIN, alertSlaMs: ALERT_SLA_MS };

function violationsFor(overrides: RawStartupConfig): readonly StartupViolation[] {
  const raw = validStartupConfig("C:\\state", "C:\\sink\\diagnostics.jsonl", overrides);
  const result = validateStartupConfig(raw, EXPECTATIONS);
  return result.ok ? [] : result.violations;
}

function codesFor(overrides: RawStartupConfig): readonly StartupViolationCode[] {
  return violationsFor(overrides).map(item => item.code);
}

describe("S-CYC-11 pure config matrix — the closed field set fails closed", () => {
  it("accepts the coherent baseline and hands back the validated bundle", () => {
    const result = validateStartupConfig(validStartupConfig("C:\\state", "C:\\sink\\d.jsonl"), EXPECTATIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profile).toBe("dev");
    expect(result.value.binding).toEqual({ canonicalTradingOrigin: TEST_ONLY_ORIGIN, expectedAccountId: TEST_ONLY_ACCOUNT_ID });
    expect(result.value.decision.cycleIntervalMs).toBe(900_000);
    expect(result.value.execution.killEquityThresholdCents).toBe(9_000_000);
    expect(result.value.scheduling.deadManBoundMs).toBe(3_000_000);
    expect(result.value.qualification.maxLossCents).toBe(50_000);
    expect(result.value.analystProfile).toBe("dev");
  });

  it("GV-5: an unset, empty, or whitespace EXPECTED_ACCOUNT_ID never arms", () => {
    expect(codesFor({ EXPECTED_ACCOUNT_ID: undefined })).toContain("MISSING");
    expect(codesFor({ EXPECTED_ACCOUNT_ID: "" })).toContain("WRONG_TYPE");
    expect(codesFor({ EXPECTED_ACCOUNT_ID: "   " })).toContain("WRONG_TYPE");
  });

  it("missing configuration is indistinguishable from wrong configuration — both refuse", () => {
    expect(codesFor({ CYCLE_INTERVAL_MS: undefined }).length).toBeGreaterThan(0);
    expect(codesFor({ CYCLE_INTERVAL_MS: "15 minutes" }).length).toBeGreaterThan(0);
  });

  it("the profile is exactly dev or competition; anything else is UNKNOWN_PROFILE", () => {
    expect(codesFor({ ALPACA_PROFILE: "prod" })).toContain("UNKNOWN_PROFILE");
    expect(codesFor({ ALPACA_PROFILE: "DEV" })).toContain("UNKNOWN_PROFILE");
    expect(codesFor({ ALPACA_PROFILE: undefined })).toContain("MISSING");
    expect(codesFor({ ALPACA_PROFILE: "competition", PRE_ARM_CERTIFICATE: { placeholder: true } })).toEqual([]);
  });

  it("competition arming without the S-ARM-01 certificate refuses (WIN-7 startup half)", () => {
    expect(codesFor({ ALPACA_PROFILE: "competition" })).toContain("CERTIFICATE_MISSING");
  });

  it("only the byte-exact canonical paper origin passes; every lookalike fails", () => {
    for (const origin of [
      "https://api.alpaca.markets",
      "https://paper-api.alpaca.markets/",
      "https://paper-api.alpaca.markets/v2",
      "https://paper-api.alpaca.markets?x=1",
      "https://paper-api.alpaca.markets#f",
      "https://paper-api.alpaca.markets:443",
      "http://paper-api.alpaca.markets",
      "HTTPS://PAPER-API.ALPACA.MARKETS",
      " https://paper-api.alpaca.markets",
      "https://user@paper-api.alpaca.markets",
      "https://paper-api.alpaca.markets.evil.example",
    ]) {
      expect(codesFor({ ALPACA_TRADING_ORIGIN: origin }), origin).toContain("ORIGIN_NOT_CANONICAL");
    }
    expect(codesFor({ ALPACA_TRADING_ORIGIN: "https://paper-api.alpaca.markets" })).toEqual([]);
  });

  it("BEQ-5: a config violating the S-G12-02 inequalities refuses to arm", () => {
    expect(codesFor({ LOCK_TAKEOVER_BOUND_MS: 300_000 })).toContain("SCHEDULING_BOUNDS_VIOLATED");
    expect(codesFor({ LOCK_TAKEOVER_BOUND_MS: 700_000 })).toContain("SCHEDULING_BOUNDS_VIOLATED");
  });

  it("KGV-17: detection plus delivery must stay at or under the 60-minute SLA — the edge passes, one ms beyond fails", () => {
    expect(codesFor({ ALERT_DELIVERY_BUDGET_MS: 600_000 })).toEqual([]);
    expect(codesFor({ ALERT_DELIVERY_BUDGET_MS: 600_001 })).toContain("ALERT_SLA_EXCEEDED");
  });

  it("KGV-15: SNAPSHOT_STALENESS_BOUND outside its coupling never arms; both edges pass", () => {
    expect(codesFor({ SNAPSHOT_STALENESS_BOUND_MS: 299_999 })).toContain("STALENESS_COUPLING_VIOLATED");
    expect(codesFor({ SNAPSHOT_STALENESS_BOUND_MS: 900_001 })).toContain("STALENESS_COUPLING_VIOLATED");
    expect(codesFor({ SNAPSHOT_STALENESS_BOUND_MS: 300_000 })).toEqual([]);
    expect(codesFor({ SNAPSHOT_STALENESS_BOUND_MS: 900_000 })).toEqual([]);
  });

  it("WIN-5: missing or contradictory G8 bounds never arm", () => {
    expect(codesFor({ MAX_CANDIDATE_QTY: undefined })).toContain("MISSING");
    expect(codesFor({ EXPIRY_MAX_SESSIONS: 3, EXPIRY_MIN_SESSIONS: 4 })).toContain("OUT_OF_BOUNDS");
    expect(codesFor({ EXPIRY_MIN_SESSIONS: 1 })).toContain("OUT_OF_BOUNDS");
    expect(codesFor({ MAX_STRIKE_DISTANCE_BPS: 0 })).toContain("OUT_OF_BOUNDS");
    expect(codesFor({ MAX_STRIKE_DISTANCE_BPS: 10_001 })).toContain("OUT_OF_BOUNDS");
    expect(codesFor({ MAX_LOSS_PER_POSITION_BPS: 10_001 })).toContain("OUT_OF_BOUNDS");
  });

  it("KGV-8: a short-capable whitelist without the S-X-06 capability flag never arms", () => {
    for (const structure of ["vertical_credit", "vertical_debit", "iron_condor"]) {
      expect(codesFor({ STRUCTURE_WHITELIST: ["long_option", structure] }), structure).toContain("SHORT_CAPABILITY_FLAG_MISSING");
      expect(codesFor({ STRUCTURE_WHITELIST: ["long_option", structure], SHORT_ASSIGNMENT_CAPABILITY: true }), structure).toEqual([]);
    }
    expect(codesFor({ STRUCTURE_WHITELIST: ["long_option"] })).toEqual([]);
    expect(codesFor({ STRUCTURE_WHITELIST: ["calendar_spread"] })).toContain("WHITELIST_UNKNOWN_STRUCTURE");
  });

  it("the qualifying checkpoint precedes the window end and the cap sits strictly below both sleeve caps", () => {
    expect(codesFor({ QUALIFYING_ACTIVITY_CHECKPOINT: "2026-09-02T20:00:00Z" })).toContain("QUALIFICATION_UNORDERED");
    // income cap 240_000, convex cap 160_000 at the baseline; equality is not strictly below.
    expect(codesFor({ QUALIFICATION_MAX_LOSS_CENTS: 160_000 })).toContain("QUALIFICATION_CAP_NOT_BELOW_SLEEVE_CAP");
    expect(codesFor({ QUALIFICATION_MAX_LOSS_CENTS: 159_999 })).toEqual([]);
    expect(codesFor({ QUALIFICATION_MAX_LOSS_CENTS: 0 })).toContain("OUT_OF_BOUNDS");
    expect(codesFor({ QUALIFYING_ACTIVITY_CHECKPOINT: "September 1st" })).toContain("WRONG_TYPE");
  });

  it("validateKillThreshold is an arming check: a threshold ignoring planned convex decay never arms", () => {
    expect(codesFor({ KILL_EQUITY_THRESHOLD_CENTS: 9_200_001 })).toContain("KILL_THRESHOLD_INVALID");
    expect(codesFor({ KILL_EQUITY_THRESHOLD_CENTS: 9_200_000 })).toEqual([]);
  });

  it("every timeout lives under CYCLE_WALLTIME_BUDGET", () => {
    expect(codesFor({ ANALYST_TIMEOUT_MS: 300_001 })).toContain("TIMEOUT_EXCEEDS_WALLTIME");
  });

  it("unknown fields are rejected, not ignored", () => {
    const found = violationsFor({ EXTRA_KNOB: 1 });
    expect(found.map(item => item.code)).toContain("UNKNOWN_FIELD");
    expect(found.map(item => item.field)).toContain("EXTRA_KNOB");
  });

  it("the analyst child profile is exactly dev — competition executor credentials never reach it", () => {
    expect(codesFor({ ANALYST_ALPACA_PROFILE: "competition" })).toContain("OUT_OF_BOUNDS");
  });

  it("a relative STATE_DIR is not an absolute path literal", () => {
    expect(codesFor({ STATE_DIR: "state" })).toContain("STATE_DIR_NOT_ABSOLUTE");
    expect(codesFor({ STATE_DIR: "./state" })).toContain("STATE_DIR_NOT_ABSOLUTE");
  });
});

// ---------------------------------------------------------------------------
// Shell paths against the real gateway and the file sink
// ---------------------------------------------------------------------------

interface ShellHarness {
  readonly outcome: StartupOutcome;
  readonly pings: readonly string[];
  readonly fake: FakeBroker;
  readonly sinkPath: string;
  entries(): readonly JournalEntry[];
}

function testGateway(stateDir: string, fake: FakeBroker): ReturnType<typeof createMutationGateway> {
  const resolved = resolveStateDir(stateDir);
  if (!resolved.ok) throw new Error(resolved.detail);
  return createMutationGateway({
    paths: resolved.value, secrets: [], clock: () => TEST_ONLY_AT_MS, brokerPort: fake.port, instanceId: "startup",
    lockTakeoverBoundMs: 60_000, binding: { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID },
  });
}

/** Models a STATE_DIR a first cycle has already bootstrapped: the seed obligation is discharged, authoritative appends land. */
async function seedStateDir(stateDir: string, fake: FakeBroker): Promise<void> {
  const gateway = testGateway(stateDir, fake);
  const acquired = await gateway.acquireAuthority({ account: "virgin" });
  if (acquired.kind !== "WON") throw new Error(`fixture acquisition failed: ${JSON.stringify(acquired)}`);
  const bootstrap = { at: epochMsToUtcIso(TEST_ONLY_AT_MS), epoch: acquired.epoch, type: "BOOTSTRAP", snapshot: journalSnapshot(), epochSeeded: true };
  const result = await gateway.dispatch({ class: "authoritative", epoch: acquired.epoch, action: { kind: "journal_append", entry: bootstrap } });
  if (!result.ok) throw new Error(`fixture seed append failed: ${result.reason}`);
}

async function runShellStartup(config: RawStartupConfig, shared?: { stateDir?: string; sinkPath?: string; fake?: FakeBroker; pings?: string[] }): Promise<ShellHarness> {
  const stateDir = shared?.stateDir ?? freshDir();
  const sinkPath = shared?.sinkPath ?? path.join(freshDir(), "diagnostics.jsonl");
  const fake = shared?.fake ?? createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 0, equityCents: 0, clock: () => TEST_ONLY_AT_MS });
  const pings = shared?.pings ?? [];
  const raw = validStartupConfig(stateDir, sinkPath, config);
  const ports: StartupPorts = {
    rawConfig: raw,
    openSink: name => createFileDiagnosticSink(name),
    failPing: code => { pings.push(code); return Promise.resolve(); },
    journal: {
      append: async (paths, draftFor) => {
        const gateway = testGateway(paths.root, fake);
        // Startup classifies nothing at the broker: the account state is unknown, so an absent store must not be
        // seeded here (S-CYC-09); acquisition on an unseeded store leaves the seed pending and the append fails.
        const acquired = await gateway.acquireAuthority({ account: "unknown" });
        if (acquired.kind !== "WON") return false;
        const result = await gateway.dispatch({ class: "authoritative", epoch: acquired.epoch, action: { kind: "journal_append", entry: draftFor({ atIso: epochMsToUtcIso(TEST_ONLY_AT_MS), epoch: acquired.epoch }) } });
        return result.ok;
      },
    },
    clock: () => TEST_ONLY_AT_MS,
  };
  const outcome = await runStartup(ports);
  const journalFile = path.join(stateDir, "journal.jsonl");
  return {
    outcome, pings, fake, sinkPath,
    entries: () => (existsSync(journalFile) ? parseJournalText(readFileSync(journalFile, "utf8")).entries : []),
  };
}

describe("S-CYC-11 shell paths — refusal is durable, the narrow path stays narrow", () => {
  it("a valid config arms with exit 0, no ping, no halt, and zero broker mutations", async () => {
    const shell = await runShellStartup({});
    expect(shell.outcome.armed).toBe(true);
    expect(shell.outcome.exitCode).toBe(0);
    expect(shell.pings).toEqual([]);
    expect(shell.entries().map(entry => entry.type)).not.toContain("HALT");
    expect(shell.fake.mutations).toEqual([]);
  });

  it("a violation journals a redacted CONFIG_INVALID halt and fail-pings; the configured account ID never appears", async () => {
    const stateDir = freshDir();
    const fake = createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 0, equityCents: 0, clock: () => TEST_ONLY_AT_MS });
    await seedStateDir(stateDir, fake);
    const shell = await runShellStartup({ ALPACA_PROFILE: "prod" }, { stateDir, fake });
    expect(shell.outcome.armed).toBe(false);
    expect(shell.outcome.exitCode).toBe(1);
    expect(shell.outcome.refusal).toBe("CONFIG_INVALID");
    expect(shell.pings).toEqual(["CONFIG_INVALID"]);
    const halts = shell.entries().filter(entry => entry.type === "HALT");
    expect(halts).toHaveLength(1);
    expect(halts[0]?.["reason"]).toBe("CONFIG_INVALID");
    expect(String(halts[0]?.["detail"])).toContain("ALPACA_PROFILE:UNKNOWN_PROFILE");
    expect(String(halts[0]?.["detail"])).not.toContain(TEST_ONLY_ACCOUNT_ID);
    expect(shell.fake.mutations).toEqual([]);
  });

  it("on a virgin install the refusal cannot be journaled without the forbidden broker call: it goes to the sink, and the epoch store stays untouched", async () => {
    const stateDir = freshDir();
    const shell = await runShellStartup({ ALPACA_PROFILE: "prod" }, { stateDir });
    expect(shell.outcome.armed).toBe(false);
    expect(shell.outcome.refusal).toBe("CONFIG_INVALID");
    expect(shell.pings).toEqual(["CONFIG_INVALID"]);
    expect(shell.entries()).toEqual([]);
    expect(existsSync(path.join(stateDir, "epoch.json"))).toBe(false);
    expect(readFileSync(shell.sinkPath, "utf8")).toContain("CONFIG_INVALID_UNJOURNALABLE");
  });

  it("WIN-4: an unopenable STATE_DIR writes the sink diagnostic, sends a failure-only ping, exits nonzero, touches no broker — and the repaired run imports the diagnostic as CONFIG_INVALID", async () => {
    const sinkPath = path.join(freshDir(), "diagnostics.jsonl");
    const missing = path.join(freshDir(), "does-not-exist");
    const fake = createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 0, equityCents: 0, clock: () => TEST_ONLY_AT_MS });
    const pings: string[] = [];
    const broken = await runShellStartup({ STATE_DIR: missing }, { stateDir: missing, sinkPath, fake, pings });
    expect(broken.outcome.armed).toBe(false);
    expect(broken.outcome.exitCode).toBe(1);
    expect(broken.outcome.refusal).toBe("CONFIG_INVALID_STATE_DIR");
    expect(pings).toEqual(["CONFIG_INVALID_STATE_DIR"]);
    expect(broken.entries()).toEqual([]);
    expect(fake.mutations).toEqual([]);
    expect(readFileSync(sinkPath, "utf8")).toContain("CONFIG_INVALID_STATE_DIR");

    // Before any cycle has bootstrapped, the armed run leaves the diagnostic pending in the sink.
    const repairedDir = freshDir();
    const early = await runShellStartup({}, { stateDir: repairedDir, sinkPath, fake, pings });
    expect(early.outcome.armed).toBe(true);
    expect(early.outcome.importedDiagnostics).toBe(0);
    expect(readFileSync(sinkPath, "utf8")).toContain("CONFIG_INVALID_STATE_DIR");

    // Once the store is seeded (the first cycle ran), the next arm imports the diagnostic as CONFIG_INVALID.
    await seedStateDir(repairedDir, fake);
    const repaired = await runShellStartup({}, { stateDir: repairedDir, sinkPath, fake, pings });
    expect(repaired.outcome.armed).toBe(true);
    expect(repaired.outcome.importedDiagnostics).toBe(1);
    const imported = repaired.entries().filter(entry => entry.type === "RECONCILIATION");
    expect(imported).toHaveLength(1);
    expect(imported[0]?.["reasonCodes"]).toEqual(["CONFIG_INVALID"]);
    // The sink is drained: a second arm imports nothing.
    const third = await runShellStartup({}, { stateDir: repairedDir, sinkPath, fake, pings });
    expect(third.outcome.importedDiagnostics).toBe(0);
  });

  it("an unwritable diagnostic sink is itself a config violation", async () => {
    const sinkDir = freshDir();
    const shell = await runShellStartup({ BOOTSTRAP_DIAGNOSTIC_SINK: sinkDir });
    expect(shell.outcome.armed).toBe(false);
    expect(shell.outcome.refusal).toBe("CONFIG_INVALID");
    expect(shell.outcome.violations.map(item => item.field)).toContain("BOOTSTRAP_DIAGNOSTIC_SINK");
  });
});
