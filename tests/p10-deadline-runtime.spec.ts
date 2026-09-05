// P10 — the Friday deadline entries' composition root
// (src/shell/deadline-runtime.ts) and its one-shot process entry point
// (src/shell/deadline-cli.ts). Until these existed, `runDeadlineReconciliation`
// and `runTerminal` (S-G11-03/04) had no caller outside the test suite: the
// Friday story could only have been told by writing code on Friday, which the
// S-ARM-01 runtime digest forbids.
//
// Six properties are proven here against the deterministic fake broker and the
// same P5 harness the G11 suite uses: a valid configuration composes the ports
// and the reconciliation entry lands with its revision reference; a flat book
// ends in a clean TERMINAL with a success ping; a still-open risk-bearing
// structure records the remainder and raises the fail ping; a live writer
// suppresses the invocation with zero appends; a second TERMINAL is refused
// with zero appends; and an invalid configuration refuses before the broker
// adapter is even constructed. The argument surface is a pure function and is
// tested as one, and the process entry point is exercised over the two paths
// that reach no broker at all.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, inject, it } from "vitest";
import type { MarketObservation } from "../src/core/execution.js";
import type { MarketWindow } from "../src/shell/alpaca-broker.js";
import { runDeadlineReconciliation, runTerminal } from "../src/shell/deadline.js";
import { admitDeadlineEntry, composeDeadline, deadlineCycleIndex, parseDeadlineCommand } from "../src/shell/deadline-runtime.js";
import type { DeadlineBrokerAdapter } from "../src/shell/deadline-runtime.js";
import type { CalendarDay } from "../src/shell/market-calendar.js";
import type { EnvRecord } from "../src/shell/runtime-config.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { TEST_ONLY_ACCOUNT_ID } from "./journal-fixtures.js";
import { cleanupLifecycleDirs, lifecycleHarness, lifecycleMarket, P5_NOW } from "./lifecycle-fixtures.js";
import type { LifecycleHarness } from "./lifecycle-fixtures.js";
import { BrokerHttpError } from "../src/shell/broker-errors.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { readEpochStore } from "../src/shell/epoch-store.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Past `LOCK_TAKEOVER_BOUND_MS` (400 s in the tracked policy) so the harness's own holder record no longer suppresses. */
const AFTER_TAKEOVER_BOUND = P5_NOW + 500_000;
const REVISION = "journal-rev-p10-abc123";

const fixtureRoots: string[] = [];

afterEach(() => {
  cleanupLifecycleDirs();
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A checkout-shaped fixture root: the real, tracked policy document and no `.env`, so the environment is the test's alone. */
function fixtureRepoRoot(options: { readonly withPolicy: boolean } = { withPolicy: true }): string {
  const root = mkdtempSync(path.join(tmpdir(), "gbt-p10-deadline-"));
  fixtureRoots.push(root);
  if (options.withPolicy) {
    mkdirSync(path.join(root, "config"));
    copyFileSync(path.join(REPO_ROOT, "config", "policy.json"), path.join(root, "config", "policy.json"));
  }
  return root;
}

function deadlineEnv(paths: StatePaths, overrides: Readonly<Record<string, string | undefined>> = {}): EnvRecord {
  return {
    ALPACA_PROFILE: "dev",
    ALPACA_DEV_KEY_ID: "TEST_ONLY_KEY_ID",
    ALPACA_DEV_SECRET_KEY: "TEST_ONLY_SECRET_KEY",
    ALPACA_DEV_ACCOUNT_ID: TEST_ONLY_ACCOUNT_ID,
    STATE_DIR: paths.root,
    BOOTSTRAP_DIAGNOSTIC_SINK: path.join(paths.root, "bootstrap-sink.jsonl"),
    ...overrides,
  };
}

const CALENDAR_DAYS: readonly CalendarDay[] = [
  { date: "2026-08-31", open: "09:30", close: "16:00" },
  { date: "2026-09-01", open: "09:30", close: "16:00" },
  { date: "2026-09-02", open: "09:30", close: "16:00" },
  { date: "2026-09-03", open: "09:30", close: "16:00" },
  { date: "2026-09-04", open: "09:30", close: "16:00" },
];

interface AdapterRecord {
  readonly factory: (input: { readonly clock: () => number }) => DeadlineBrokerAdapter;
  /** How often the composition asked for an adapter at all — a configuration refusal must never get that far. */
  readonly constructions: { count: number };
  readonly windows: MarketWindow[];
  readonly calendarCalls: string[][];
}

/** The fake broker dressed as the adapter the composition binds; it records what the composed ports ask for. */
function recordingAdapter(harness: LifecycleHarness): AdapterRecord {
  const constructions = { count: 0 };
  const windows: MarketWindow[] = [];
  const calendarCalls: string[][] = [];
  return {
    constructions,
    windows,
    calendarCalls,
    factory: () => {
      constructions.count += 1;
      return {
        read: harness.fake.read,
        port: harness.fake.port,
        market: (window: MarketWindow): Promise<MarketObservation> => {
          windows.push(window);
          return lifecycleMarket(() => harness.clock.now)();
        },
        calendar: (startDate: string, endDate: string): Promise<readonly CalendarDay[]> => {
          calendarCalls.push([startDate, endDate]);
          return Promise.resolve(CALENDAR_DAYS);
        },
      };
    },
  };
}

interface Composed {
  readonly composition: Awaited<ReturnType<typeof composeDeadline>>;
  readonly logs: string[];
  readonly adapter: AdapterRecord;
}

async function compose(harness: LifecycleHarness, options: { readonly repoRoot: string; readonly env?: Readonly<Record<string, string | undefined>>; readonly instanceId?: string } = { repoRoot: "" }): Promise<Composed> {
  const logs: string[] = [];
  const adapter = recordingAdapter(harness);
  const composition = await composeDeadline({
    repoRoot: options.repoRoot,
    processEnv: deadlineEnv(harness.paths, options.env ?? {}),
    clock: () => harness.clock.now,
    instanceId: options.instanceId ?? "deadline-test",
    log: line => logs.push(line),
    brokerAdapter: adapter.factory,
  });
  return { composition, logs, adapter };
}

/** The local ping evidence the composed (URL-less) ping port leaves behind in STATE_DIR. */
function pingRecord(paths: StatePaths): string {
  const file = path.join(paths.root, "pings.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("P10 — the composed deadline dependencies write the S-G11-03 reconciliation entry", () => {
  it("composes gateway, broker, market and calendar from the validated configuration and appends DEADLINE_RECONCILIATION with the revision reference", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const before = harness.entries().length;
    // A non-empty book on purpose: an entry that reports on nothing cannot
    // show whether the observation carried the identities it holds (R41-C2).
    harness.fake.setPositions([
      { contractId: "SPY260904C00500000", quantity: -1, avgEntryPriceCents: 300 },
      { contractId: "SPY260904C00505000", quantity: 1, avgEntryPriceCents: 100 },
      { contractId: "SPY", quantity: 100, avgEntryPriceCents: 50_000 },
    ]);

    const { composition, adapter, logs } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.ok).toBe(true);
    if (!composition.ok) return;
    // The one-shot process fenced the previous writer through the shared store, exactly as a scheduled cycle would.
    expect(composition.acquired).toBe("WON");
    expect(composition.epoch).toBe(2);
    expect(composition.paths.root).toBe(harness.paths.root);
    expect(composition.deps.tradingDay).toBe("2026-08-31");
    expect(composition.deps.cycleIndex).toBe(deadlineCycleIndex(harness.entries()));
    expect(composition.deps.calendar.isTradingDay).toBe(true);
    expect(logs.some(line => line.includes("deadline composed for the dev profile"))).toBe(true);
    // The calendar is read once, after the fence, and the market window is the closing one.
    expect(adapter.calendarCalls).toHaveLength(1);
    expect(adapter.windows).toHaveLength(0);

    const report = await runDeadlineReconciliation(composition.deps, REVISION);
    expect(report).toMatchObject({ appended: true, holdVisible: false, remainder: null, ping: "success" });
    expect(adapter.windows).toHaveLength(1);
    expect(adapter.windows[0]?.underlyings).toEqual(["SPY", "QQQ"]);
    expect(adapter.windows[0]?.strikeWindowBps).toBe(1_000);
    // S-X-07 / R41-C2: the book this entry reports on is also the book whose
    // identities the observation must carry.
    const heldNow = (await harness.fake.read.positions()).filter(position => position.contractId !== "SPY").map(position => position.contractId).sort();
    expect(heldNow, "the assertion below is vacuous against a flat book").toEqual(["SPY260904C00500000", "SPY260904C00505000"]);
    expect(adapter.windows[0]?.heldContractIds).toEqual(heldNow);

    const entries = harness.entries();
    expect(entries).toHaveLength(before + 1);
    const entry = entries.find(item => item.type === "DEADLINE_RECONCILIATION");
    expect(entry).toMatchObject({ reference: REVISION, epoch: 2 });
    expect(entry?.["snapshot"]).toMatchObject({ accountId: TEST_ONLY_ACCOUNT_ID });
    expect(pingRecord(harness.paths)).toContain("success");

    await composition.release();
  });
});

describe("P10 / S-G11-04 — the composed TERMINAL entry ends the run, in writing either way", () => {
  it("a flat book ends in a clean TERMINAL with no remainder and a success ping", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;

    const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.ok).toBe(true);
    if (!composition.ok) return;
    const report = await runTerminal(composition.deps);
    expect(report).toMatchObject({ appended: true, remainder: null, holdVisible: false, ping: "success" });

    const terminal = harness.entries().find(item => item.type === "TERMINAL");
    expect(terminal).toMatchObject({ epoch: 2 });
    // A clean end carries no `remainder` key at all — absence, not an empty shape, is what "flat" reads as.
    expect(terminal === undefined ? true : "remainder" in terminal).toBe(false);
    expect(pingRecord(harness.paths)).toContain("success");

    await composition.release();
  });

  it("an open risk-bearing structure is recorded as an explicit remainder and raises the fail ping", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the 500/505 credit vertical fills and survives to Friday close
    harness.clock.now = AFTER_TAKEOVER_BOUND;

    const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.ok).toBe(true);
    if (!composition.ok) return;
    const report = await runTerminal(composition.deps);
    expect(report.appended).toBe(true);
    expect(report.ping).toBe("fail");
    expect(report.remainder).not.toBeNull();

    const terminal = harness.entries().find(item => item.type === "TERMINAL");
    const remainder = terminal?.["remainder"] as { positions: readonly { contractId: string }[]; maxLossStatement: string; expiryConsequence: string };
    expect(remainder.positions.length).toBeGreaterThan(0);
    expect(remainder.maxLossStatement.length).toBeGreaterThan(0);
    expect(remainder.expiryConsequence.length).toBeGreaterThan(0);
    expect(pingRecord(harness.paths)).toContain("fail TERMINAL_REMAINDER_RISK_BEARING");

    await composition.release();
  });
});

describe("P10 / S-G14-03 — HEALTHCHECK_PING_URL is actually wired to ping delivery", () => {
  // `pingRecord` above proves only that the URL-less port's local fallback
  // fires; it says nothing about the environment value actually reaching
  // `createPingPort`. A mutant that drops the binding (`env["HEALTHCHECK_PING_URL"]
  // ?? null` replaced by `null`) still passes every assertion in the suites
  // above, because the URL-less branch also writes the local record and
  // reports the same `ping: "success" | "fail"` outcome. These two tests
  // observe the remote delivery instead.
  async function pingListener(): Promise<{ readonly url: string; readonly hits: { method: string; url: string; body: string }[]; close(): Promise<void> }> {
    const hits: { method: string; url: string; body: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => { body += String(chunk); });
      req.on("end", () => {
        hits.push({ method: req.method ?? "", url: req.url ?? "", body });
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const port = (server.address() as AddressInfo).port;
    return {
      url: `http://127.0.0.1:${String(port)}/hc`,
      hits,
      async close(): Promise<void> {
        await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
      },
    };
  }

  it("delivers the DEADLINE_RECONCILIATION success ping to the configured HEALTHCHECK_PING_URL", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const listener = await pingListener();
    try {
      const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot(), env: { HEALTHCHECK_PING_URL: listener.url } });
      expect(composition.ok).toBe(true);
      if (!composition.ok) return;

      const report = await runDeadlineReconciliation(composition.deps, REVISION);
      expect(report.ping).toBe("success");
      expect(listener.hits).toEqual([{ method: "GET", url: "/hc", body: "" }]);
      expect(pingRecord(harness.paths)).toContain("success");

      await composition.release();
    } finally {
      await listener.close();
    }
  });

  it("delivers the TERMINAL_REMAINDER_RISK_BEARING fail-ping to the configured HEALTHCHECK_PING_URL", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the 500/505 credit vertical fills and survives to Friday close
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const listener = await pingListener();
    try {
      const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot(), env: { HEALTHCHECK_PING_URL: listener.url } });
      expect(composition.ok).toBe(true);
      if (!composition.ok) return;

      const report = await runTerminal(composition.deps);
      expect(report.ping).toBe("fail");
      expect(listener.hits).toHaveLength(1);
      expect(listener.hits[0]?.method).toBe("POST");
      expect(listener.hits[0]?.url).toBe("/hc/fail");
      expect(listener.hits[0]?.body).toContain("TERMINAL_REMAINDER_RISK_BEARING");
      expect(pingRecord(harness.paths)).toContain("fail TERMINAL_REMAINDER_RISK_BEARING");

      await composition.release();
    } finally {
      await listener.close();
    }
  });
});

describe("P10 — a deadline entry never races and is never written twice", () => {
  it("a live writer suppresses the invocation and nothing at all is appended", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    // The clock stays at the harness's own acquisition instant: the holder record is fresh, the writer is live.
    const before = harness.entries();

    const { composition, adapter } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.ok).toBe(false);
    if (composition.ok) return;
    expect(composition.stage).toBe("suppressed");
    expect(composition.reason).toContain("holder runner");
    expect(composition.reason).toContain("LOCK_HELD");
    // No append, no witness line, and no broker read: the adapter was constructed but never called.
    expect(harness.entries()).toEqual(before);
    expect(adapter.calendarCalls).toEqual([]);
    expect(adapter.windows).toEqual([]);
    // The live writer still owns its epoch — the refusal cost it nothing.
    const stillWriting = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T15:00:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(stillWriting.ok).toBe(true);
  });

  it("a second terminal invocation is refused on the standing TERMINAL and appends nothing", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const repoRoot = fixtureRepoRoot();

    const first = await compose(harness, { repoRoot, instanceId: "deadline-first" });
    expect(first.composition.ok).toBe(true);
    if (!first.composition.ok) return;
    expect(admitDeadlineEntry("terminal", first.composition.entries)).toEqual({ ok: true });
    expect((await runTerminal(first.composition.deps)).appended).toBe(true);
    await first.composition.release();
    const after = harness.entries();

    const second = await compose(harness, { repoRoot, instanceId: "deadline-second" });
    expect(second.composition.ok).toBe(true);
    if (!second.composition.ok) return;
    const admission = admitDeadlineEntry("terminal", second.composition.entries);
    expect(admission.ok).toBe(false);
    if (admission.ok) return;
    expect(admission.reason).toContain("TERMINAL entry already stands");
    await second.composition.release();
    expect(harness.entries()).toEqual(after);

    // The reconciliation snapshot stays repeatable: only the controlled end is once-only.
    expect(admitDeadlineEntry("reconciliation", second.composition.entries)).toEqual({ ok: true });
  });
});

describe("P10 — an unusable configuration refuses before any broker exists", () => {
  it("an invalid configured value names the field, never the value, and no adapter is constructed", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const before = harness.entries();

    const { composition, adapter } = await compose(harness, { repoRoot: fixtureRepoRoot(), env: { ALPACA_PROFILE: "production" } });
    expect(composition.ok).toBe(false);
    if (composition.ok) return;
    expect(composition.stage).toBe("configuration");
    expect(composition.reason).toContain("ALPACA_PROFILE:UNKNOWN_PROFILE");
    expect(composition.reason).not.toContain("production");
    expect(adapter.constructions.count).toBe(0);
    expect(harness.entries()).toEqual(before);
  });

  it("a missing policy document, an unusable STATE_DIR and absent credentials each refuse at their own stage", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;

    const withoutPolicy = await compose(harness, { repoRoot: fixtureRepoRoot({ withPolicy: false }) });
    expect(withoutPolicy.composition).toMatchObject({ ok: false, stage: "configuration" });
    expect(withoutPolicy.adapter.constructions.count).toBe(0);

    const repoRoot = fixtureRepoRoot();
    const missingStateDir = path.join(harness.paths.root, "does-not-exist");
    const unusable = await compose(harness, { repoRoot, env: { STATE_DIR: missingStateDir } });
    expect(unusable.composition).toMatchObject({ ok: false });
    expect(unusable.adapter.constructions.count).toBe(0);

    const withoutCredentials = await compose(harness, { repoRoot, env: { ALPACA_DEV_KEY_ID: undefined, ALPACA_DEV_SECRET_KEY: undefined } });
    expect(withoutCredentials.composition).toMatchObject({ ok: false, stage: "credentials" });
    expect(withoutCredentials.adapter.constructions.count).toBe(0);
  });
});

describe("P10 — the command surface is a pure function", () => {
  it("accepts the two documented invocations and refuses everything else by name", () => {
    expect(parseDeadlineCommand(["reconciliation", "--revision", REVISION])).toEqual({ ok: true, command: "reconciliation", revision: REVISION, nowMs: null });
    expect(parseDeadlineCommand(["reconciliation", "--revision", REVISION, "--now", "1788183000000"])).toEqual({ ok: true, command: "reconciliation", revision: REVISION, nowMs: 1_788_183_000_000 });
    expect(parseDeadlineCommand(["terminal"])).toEqual({ ok: true, command: "terminal", nowMs: null });
    expect(parseDeadlineCommand(["terminal", "--now", "1788183000000"])).toEqual({ ok: true, command: "terminal", nowMs: 1_788_183_000_000 });

    expect(parseDeadlineCommand([])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["flatten"])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["reconciliation"])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["reconciliation", "--revision", "  "])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["reconciliation", "--revision"])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["terminal", "--revision", REVISION])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["terminal", "--now", "not-a-number"])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["terminal", "--now", "0"])).toMatchObject({ ok: false });
    expect(parseDeadlineCommand(["terminal", "--state-dir", "C:/elsewhere"])).toMatchObject({ ok: false });
  });
});

describe("R42-B4 — a credential rejection during a deadline entry is fenced, not only aborted", () => {
  it("a 401 or 403 becomes a durable AUTH_FAILURE halt; anything else leaves the journal alone", async () => {
    // Since S-X-07 the deadline observation performs an authenticated read of
    // its own, so the new exception can abort the one-shot. An abort satisfies
    // the deadline handover (S-G11-04) but not the shared fence duty of
    // S-G12-06: the rejection must still halt the deployment durably.
    for (const status of [401, 403]) {
      const harness = await lifecycleHarness();
      harness.clock.now = AFTER_TAKEOVER_BOUND;
      const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot() });
      expect(composition.ok).toBe(true);
      if (!composition.ok) return;

      expect(await composition.recordCredentialFence(new BrokerHttpError(status, `${String(status)} forbidden`))).toBe("AUTH_FAILURE");
      const halts = harness.entries().filter(entry => entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE");
      expect(halts, `HTTP ${String(status)} must fence`).toHaveLength(1);
      expect(readHaltState(harness.paths)).toMatchObject({ halted: true, reason: "AUTH_FAILURE" });
      await composition.release();
    }
  });

  it("R44-B4: a 401 on the FIRST authenticated read of the invocation \u2014 the calendar \u2014 fences too", async () => {
    // The fence recorder used to be built inside the dependency record, which
    // is assembled after the calendar read. A 401 there therefore ended the
    // composition with stage "calendar" and left no fence, no halt and no
    // ping: exactly the startup credential rejection S-G12-06 exists for, on
    // the one read that happens before anything else.
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const composition = await composeDeadline({
      repoRoot: fixtureRepoRoot(),
      processEnv: deadlineEnv(harness.paths, {}),
      clock: () => harness.clock.now,
      instanceId: "deadline-calendar-401",
      log: () => undefined,
      brokerAdapter: () => ({
        read: harness.fake.read,
        port: harness.fake.port,
        market: (): Promise<MarketObservation> => lifecycleMarket(() => harness.clock.now)(),
        calendar: (): Promise<readonly CalendarDay[]> => Promise.reject(new BrokerHttpError(401, "401 unauthorized")),
      }),
    });

    expect(composition.ok, "the one-shot still refuses").toBe(false);
    if (composition.ok) return;
    expect(composition.stage).toBe("calendar");
    expect(composition.reason).toContain("AUTH_FAILURE");

    // ...and the refusal left the deployment fenced rather than merely aborted.
    const store = readEpochStore(harness.paths);
    expect(store.kind === "present" && store.fencePending, "the credential fence mark stands").toBe(true);
    expect(readHaltState(harness.paths)).toMatchObject({ halted: true, reason: "AUTH_FAILURE" });
  });

  it("an ordinary failure is classified as degraded and writes no halt", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = AFTER_TAKEOVER_BOUND;
    const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.ok).toBe(true);
    if (!composition.ok) return;

    for (const error of [new BrokerHttpError(500, "500 server error"), new Error("BROKER_TIMEOUT after 30000 ms")]) {
      expect(await composition.recordCredentialFence(error)).toBe("WORLD_DEGRADED");
    }
    expect(harness.entries().some(entry => entry.type === "HALT")).toBe(false);
    expect(readHaltState(harness.paths).halted).toBe(false);
    await composition.release();
  });
});

describe("P10 — the deadline entries are a separate OS process over the same epoch store", () => {
  async function runDeadlineCli(compiledDist: string, args: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(compiledDist, "shell", "deadline-cli.js"), ...args], {
        cwd: options.cwd,
        // A deliberately minimal environment: the developer's own ALPACA_* values must never reach a test process.
        env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], TEMP: process.env["TEMP"], TMP: process.env["TMP"], ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += String(chunk); });
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", code => { resolve({ code, stdout, stderr }); });
    });
  }

  it("refuses an unusable invocation before it composes anything, and refuses to race a live writer through the shared store", async () => {
    const compiledDist = inject("compiledDist");
    const harness = await lifecycleHarness();
    await harness.cycle();
    const repoRoot = fixtureRepoRoot();
    const env = deadlineEnv(harness.paths);
    const before = harness.entries();

    const usage = await runDeadlineCli(compiledDist, ["reconciliation"], { cwd: repoRoot, env });
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain("--revision");
    expect(usage.stdout).toBe("");

    // The harness holds a live writer at `P5_NOW`; the process is pinned to that instant with `--now`.
    const suppressed = await runDeadlineCli(compiledDist, ["terminal", "--now", String(P5_NOW)], { cwd: repoRoot, env });
    expect(suppressed.code).toBe(3);
    expect(suppressed.stderr).toContain("refused at suppressed");
    expect(suppressed.stdout).toBe("");
    expect(harness.entries()).toEqual(before);
  });
});
