// P8 — the scheduled watchdog's composition root (src/shell/watchdog-runtime.ts):
// the ports the CLI entry hands to `runWatchdog`. Four properties are proven
// here against the deterministic fake broker and the same P5 harness the G14
// suite uses: a valid configuration composes live broker/market/binding ports
// and the recovery branch closes an intact MATCHED structure whole; a missing
// or unusable configuration degrades to exactly the fence-and-halt-only ports
// (broker null, market null) and the watchdog still fences and halts; every
// such degrade nevertheless keeps the ping port, so the takeover raises its
// ACTIVE alarm and not only the passive missed-ping SLA (S-G14-03); a
// configured account identity the credentials do not report refuses at the
// mutation boundary (S-J-06) so no order reaches the broker; and an empty book
// produces no broker mutation at all.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketObservation } from "../src/core/execution.js";
import type { MarketWindow } from "../src/shell/alpaca-broker.js";
import { composeWatchdog } from "../src/shell/watchdog-runtime.js";
import type { WatchdogBrokerAdapter } from "../src/shell/watchdog-runtime.js";
import { runWatchdog } from "../src/shell/watchdog.js";
import type { CalendarDay } from "../src/shell/market-calendar.js";
import type { EnvRecord } from "../src/shell/runtime-config.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_ORIGIN } from "./journal-fixtures.js";
import { cleanupLifecycleDirs, lifecycleHarness, lifecycleMarket, P5_NOW } from "./lifecycle-fixtures.js";
import type { LifecycleHarness } from "./lifecycle-fixtures.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEAD_MAN_BOUND_MS = 3_000_000;
/** The instant the G14 suite uses for "in-session, journal stale beyond the bound". */
const STALE_NOW = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;

const fixtureRoots: string[] = [];

afterEach(() => {
  cleanupLifecycleDirs();
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A checkout-shaped fixture root: the real, tracked policy document and no `.env`, so the environment is the test's alone. */
function fixtureRepoRoot(options: { readonly withPolicy: boolean } = { withPolicy: true }): string {
  const root = mkdtempSync(path.join(tmpdir(), "gbt-p8-watchdog-"));
  fixtureRoots.push(root);
  if (options.withPolicy) {
    mkdirSync(path.join(root, "config"));
    copyFileSync(path.join(REPO_ROOT, "config", "policy.json"), path.join(root, "config", "policy.json"));
  }
  return root;
}

function watchdogEnv(paths: StatePaths, overrides: Readonly<Record<string, string | undefined>> = {}): EnvRecord {
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

interface AdapterRecord {
  readonly factory: (input: { readonly clock: () => number }) => WatchdogBrokerAdapter;
  readonly windows: MarketWindow[];
  readonly calendarCalls: string[][];
}

/** The fake broker dressed as the adapter the composition binds; it records what the composed market asks for. */
function recordingAdapter(harness: LifecycleHarness): AdapterRecord {
  const windows: MarketWindow[] = [];
  const calendarCalls: string[][] = [];
  const days: readonly CalendarDay[] = [
    { date: "2026-08-31", open: "09:30", close: "16:00" },
    { date: "2026-09-01", open: "09:30", close: "16:00" },
    { date: "2026-09-02", open: "09:30", close: "16:00" },
    { date: "2026-09-03", open: "09:30", close: "16:00" },
    { date: "2026-09-04", open: "09:30", close: "16:00" },
  ];
  return {
    windows,
    calendarCalls,
    factory: () => ({
      read: harness.fake.read,
      port: harness.fake.port,
      market: (window: MarketWindow): Promise<MarketObservation> => {
        windows.push(window);
        return lifecycleMarket(() => harness.clock.now)();
      },
      calendar: (startDate: string, endDate: string): Promise<readonly CalendarDay[]> => {
        calendarCalls.push([startDate, endDate]);
        return Promise.resolve(days);
      },
    }),
  };
}

interface Composed {
  readonly composition: Awaited<ReturnType<typeof composeWatchdog>>;
  readonly logs: string[];
  readonly adapter: AdapterRecord;
}

async function compose(harness: LifecycleHarness, options: { readonly repoRoot: string; readonly env?: Readonly<Record<string, string | undefined>> }): Promise<Composed> {
  const logs: string[] = [];
  const adapter = recordingAdapter(harness);
  const composition = await composeWatchdog({
    paths: harness.paths,
    repoRoot: options.repoRoot,
    processEnv: watchdogEnv(harness.paths, options.env ?? {}),
    clock: () => harness.clock.now,
    instanceId: "watchdog",
    session: { isTradingDay: true, opensAt: harness.clock.now - 3_600_000, closesAt: harness.clock.now + 3_600_000 },
    deadManBoundMs: DEAD_MAN_BOUND_MS,
    log: line => logs.push(line),
    brokerAdapter: adapter.factory,
  });
  return { composition, logs, adapter };
}

/** The local ping evidence the composed (URL-less) ping port leaves behind in the invoked STATE_DIR. */
function pingRecord(paths: StatePaths): string {
  const file = path.join(paths.root, "pings.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

describe("P8 — a valid configuration composes the book-recovery ports", () => {
  it("composes broker, market and binding, and the takeover closes the intact MATCHED structure whole", async () => {
    const harness = await lifecycleHarness();
    const entry = await harness.cycle(); // the 500/505 credit vertical fills and is journaled
    expect(entry.actions).toMatchObject([{ result: "SUBMITTED" }]);
    harness.clock.now = STALE_NOW;
    const mutationsBefore = harness.fake.mutations.length;

    const { composition, adapter } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.degraded).toBeNull();
    expect(composition.deps.broker).not.toBeNull();
    expect(composition.deps.market).not.toBeNull();
    expect(composition.deps.binding).toEqual({ profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID });
    // The validated policy, not the fence-only literals, parameterizes the composed run.
    expect(composition.deps.closeEscalationStepCents).toBe(2);
    expect(composition.deps.tradingDay).toBe("2026-08-31");
    expect(composition.deps.secrets).toContain("TEST_ONLY_SECRET_KEY");

    const report = await runWatchdog(composition.deps);
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true);
    expect(report.classification).not.toBeNull();

    // One whole-structure close through the mutation gateway: two legs, one mleg, intent close.
    expect(report.closes).toHaveLength(1);
    expect(report.closes[0]?.subject.startsWith("exposure:")).toBe(true);
    const closeSubmits = harness.fake.mutations.slice(mutationsBefore).filter(mutation => mutation.kind === "submit_order" && (mutation.payload as { intent?: string }).intent === "close");
    expect(closeSubmits).toHaveLength(1);
    expect((closeSubmits[0]?.payload as { legs: readonly unknown[] }).legs).toHaveLength(2);
    expect(harness.entries().some(item => item.type === "HALT" && item["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);

    // The market observation is the runner's own port, asked for a closing window: the configured universe,
    // the full configured strike distance, and expiries from today (not only the entry-eligible ones).
    expect(adapter.calendarCalls).toHaveLength(1);
    expect(adapter.windows).toHaveLength(1);
    expect(adapter.windows[0]?.underlyings).toEqual(["SPY", "QQQ"]);
    expect(adapter.windows[0]?.strikeWindowBps).toBe(1_000);
    expect(adapter.windows[0]?.expiries).toContain("2026-09-04");
    expect(adapter.windows[0]?.expiries).toContain("2026-08-31");
  });

  it("submits nothing when there is nothing to close, and still fences and halts", async () => {
    const harness = await lifecycleHarness(); // seeded BOOTSTRAP only: no position, no order
    harness.clock.now = STALE_NOW;
    const { composition, adapter } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.degraded).toBeNull();

    const report = await runWatchdog(composition.deps);
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true);
    // The recovery branch ran — the book was classified — and produced no mutation.
    expect(adapter.windows).toHaveLength(1);
    expect(report.classification).not.toBeNull();
    expect(report.closes).toEqual([]);
    expect(harness.fake.mutations).toHaveLength(0);
  });
});

describe("P8 — an unusable configuration degrades to fencing and halting, never to silence", () => {
  it("a missing policy document leaves the null ports and the watchdog still fences and halts", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = STALE_NOW;
    const mutationsBefore = harness.fake.mutations.length;

    const { composition, logs } = await compose(harness, { repoRoot: fixtureRepoRoot({ withPolicy: false }) });
    expect(composition.degraded).not.toBeNull();
    expect(composition.degraded).toContain("composition failed exceptionally");
    expect(logs.some(line => line.includes("fencing and halting only"))).toBe(true);
    expect(composition.deps.broker).toBeNull();
    expect(composition.deps.market).toBeNull();
    expect(composition.deps.binding).toBeNull();

    const report = await runWatchdog(composition.deps);
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true);
    expect(report.closes).toEqual([]);
    expect(harness.entries().some(item => item.type === "HALT" && item["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
    expect(harness.fake.mutations.slice(mutationsBefore)).toHaveLength(0);
  });

  it("absent role credentials and a foreign STATE_DIR each degrade, with the reason named", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = STALE_NOW;
    const repoRoot = fixtureRepoRoot();

    const withoutCredentials = await compose(harness, { repoRoot, env: { ALPACA_DEV_KEY_ID: undefined, ALPACA_DEV_SECRET_KEY: undefined } });
    expect(withoutCredentials.composition.degraded).toBe("no credentials for the dev role");
    expect(withoutCredentials.composition.deps.broker).toBeNull();

    const foreignStateDir = mkdtempSync(path.join(tmpdir(), "gbt-p8-foreign-"));
    fixtureRoots.push(foreignStateDir);
    const elsewhere = await compose(harness, { repoRoot, env: { STATE_DIR: foreignStateDir } });
    expect(elsewhere.composition.degraded).toContain("foreign deployment");
    expect(elsewhere.composition.deps.broker).toBeNull();
    // The fence still lands in the STATE_DIR this invocation was pointed at.
    expect(elsewhere.composition.deps.paths.root).toBe(harness.paths.root);
  });

  it("an invalid configured value refuses to arm and names the field, never the value", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = STALE_NOW;
    const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot(), env: { ALPACA_PROFILE: "production" } });
    expect(composition.degraded).toContain("ALPACA_PROFILE:UNKNOWN_PROFILE");
    expect(composition.degraded).not.toContain("production");
    expect(composition.deps.broker).toBeNull();
  });
});

describe("P8 / S-G14-03 — a degraded composition still raises the active alarm", () => {
  // Every reason a composition can degrade. The fail-ping is the ONLY active
  // signal a takeover has (the 45–60 min missed-ping SLA is passive), so a
  // watchdog that fences, halts and journals but cannot ping has degraded its
  // alarm together with its book recovery — which S-G14-02/03 does not allow.
  const branches: readonly { readonly what: string; readonly setup: () => { readonly repoRoot: string; readonly env: Readonly<Record<string, string | undefined>> } }[] = [
    { what: "a missing policy document", setup: () => ({ repoRoot: fixtureRepoRoot({ withPolicy: false }), env: {} }) },
    { what: "a configuration that refuses to arm", setup: () => ({ repoRoot: fixtureRepoRoot(), env: { ALPACA_PROFILE: "production" } }) },
    { what: "absent role credentials", setup: () => ({ repoRoot: fixtureRepoRoot(), env: { ALPACA_DEV_KEY_ID: undefined, ALPACA_DEV_SECRET_KEY: undefined } }) },
    {
      what: "a foreign configured STATE_DIR",
      setup: (): { readonly repoRoot: string; readonly env: Readonly<Record<string, string | undefined>> } => {
        const foreign = mkdtempSync(path.join(tmpdir(), "gbt-p8-foreign-"));
        fixtureRoots.push(foreign);
        return { repoRoot: fixtureRepoRoot(), env: { STATE_DIR: foreign } };
      },
    },
  ];

  for (const branch of branches) {
    it(`fail-pings the takeover when ${branch.what} degrades the composition`, async () => {
      const harness = await lifecycleHarness();
      harness.clock.now = STALE_NOW;
      const { composition } = await compose(harness, branch.setup());
      expect(composition.degraded).not.toBeNull();
      expect(composition.deps.broker).toBeNull();
      // The degraded record loses book recovery, never the alarm port.
      expect(composition.deps.ping).not.toBeNull();

      const report = await runWatchdog(composition.deps);
      expect(report.halted).toBe(true);
      expect(report.alarmConditions.some(condition => condition.startsWith("WATCHDOG_TAKEOVER"))).toBe(true);
      // Planned AND delivered: the URL-less port leaves its record in the invoked STATE_DIR.
      expect(report.ping).toBe("fail");
      const record = pingRecord(harness.paths);
      expect(record).toContain("fail ");
      expect(record).toContain("WATCHDOG_TAKEOVER");
    });
  }
});

describe("P8 / S-G14-03 — HEALTHCHECK_PING_URL is actually wired to the fail-ping delivery", () => {
  // The suites above prove the port is composed and that a URL-less composition
  // records locally. Neither reaches the network: a mutant that drops the
  // environment value at the binding site (`env["HEALTHCHECK_PING_URL"] ?? null`
  // replaced by `null`) still passes every assertion above, because the
  // URL-less branch of `createPingPort` also writes the local record. This
  // proves the wiring itself by observing the remote delivery.
  it("delivers the takeover fail-ping to the configured HEALTHCHECK_PING_URL and still records it locally", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = STALE_NOW;
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
    const url = `http://127.0.0.1:${String(port)}/hc`;
    try {
      // Degrade the composition (no role credentials) so `runWatchdog` reaches
      // exactly the fence-and-halt path: the takeover's fail-ping is the only
      // ACTIVE alarm this branch raises (S-G14-03).
      const { composition } = await compose(harness, {
        repoRoot: fixtureRepoRoot(),
        env: { HEALTHCHECK_PING_URL: url, ALPACA_DEV_KEY_ID: undefined, ALPACA_DEV_SECRET_KEY: undefined },
      });
      expect(composition.degraded).toBe("no credentials for the dev role");
      expect(composition.deps.broker).toBeNull();

      const report = await runWatchdog(composition.deps);
      expect(report.halted).toBe(true);
      expect(report.ping).toBe("fail");
      expect(hits).toHaveLength(1);
      expect(hits[0]?.method).toBe("POST");
      expect(hits[0]?.url).toBe("/hc/fail");
      expect(hits[0]?.body).toContain("WATCHDOG_TAKEOVER");
      const record = pingRecord(harness.paths);
      expect(record).toContain("fail ");
      expect(record).toContain("WATCHDOG_TAKEOVER");
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    }
  });
});

describe("P8 / S-G12-06 — a rejected credential during recovery is fenced, not swallowed", () => {
  it("a 401 read escapes the run and the composition turns it into a durable AUTH_FAILURE halt", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = STALE_NOW;
    harness.fake.setReadHttpFailure(["account"], 401);

    const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot() });
    expect(composition.degraded).toBeNull();
    // The recovery branch reads the account after the fence; a rejected credential throws past runWatchdog.
    const failure = await runWatchdog(composition.deps).then(() => null, (error: unknown) => error);
    expect(failure).not.toBeNull();
    // The takeover halt is already durable at this point; the fence adds the distinguishable reason.
    expect(harness.entries().some(item => item.type === "HALT" && item["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);

    expect(await composition.recordCredentialFence(failure)).toBe("AUTH_FAILURE");
    expect(harness.entries().some(item => item.type === "HALT" && item["reason"] === "AUTH_FAILURE")).toBe(true);
    // A non-HTTP failure is world degradation and adds no halt of its own.
    expect(await composition.recordCredentialFence(new Error("socket closed"))).toBe("WORLD_DEGRADED");
    expect(harness.entries().filter(item => item.type === "HALT" && item["reason"] === "AUTH_FAILURE")).toHaveLength(1);
  });
});

describe("P8 / S-J-06 — the composed mutation port refuses a foreign account identity", () => {
  it("an account-ID mismatch halts on the binding and no order reaches the broker", async () => {
    const harness = await lifecycleHarness();
    const entry = await harness.cycle();
    expect(entry.actions).toMatchObject([{ result: "SUBMITTED" }]);
    harness.clock.now = STALE_NOW;
    const mutationsBefore = harness.fake.mutations.length;

    const { composition } = await compose(harness, { repoRoot: fixtureRepoRoot(), env: { ALPACA_DEV_ACCOUNT_ID: "TEST_ONLY_PA999999999" } });
    expect(composition.degraded).toBeNull(); // the mismatch is only observable at the broker, never at composition
    expect(composition.deps.binding).toEqual({ profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: "TEST_ONLY_PA999999999" });

    const report = await runWatchdog(composition.deps);
    expect(report.halted).toBe(true);
    // The close was planned and journaled, but the account-bound port refused before the delegate.
    expect(report.closes).toHaveLength(1);
    expect(harness.fake.mutations.slice(mutationsBefore)).toHaveLength(0);
    const entries = harness.entries();
    expect(entries.some(item => item.type === "HALT" && item["reason"] === "ACCOUNT_BINDING_MISMATCH")).toBe(true);
    expect(entries.some(item => item.type === "HALT" && item["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
  });
});

describe("P8 / S-G14-03 — an unreadable environment loses the ping URL, never the local record", () => {
  /**
   * The one branch that composes before an environment exists. `loadEnvironment`
   * swallows a missing or unreadable `.env`, so its read fails only when the
   * ambient record itself refuses to yield its entries — a hardened or revoked
   * process environment.
   */
  function unreadableProcessEnv(): EnvRecord {
    const env: Record<string, string | undefined> = {};
    Object.defineProperty(env, "ALPACA_PROFILE", {
      enumerable: true,
      configurable: true,
      get: (): string => { throw new Error("TEST_ONLY the process environment cannot be read"); },
    });
    return env;
  }

  it("still records the takeover's fail-ping in the invoked STATE_DIR", async () => {
    // The ping URL lives in the environment, so this branch genuinely has none.
    // The record FILE does not: it derives from the invoked STATE_DIR, which
    // this invocation was handed. Dropping it too would leave the takeover with
    // no evidence at all — not even the local trace the credential fence keeps.
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = STALE_NOW;
    const logs: string[] = [];

    const composition = await composeWatchdog({
      paths: harness.paths,
      repoRoot: fixtureRepoRoot(),
      processEnv: unreadableProcessEnv(),
      clock: () => harness.clock.now,
      instanceId: "watchdog",
      session: { isTradingDay: true, opensAt: harness.clock.now - 3_600_000, closesAt: harness.clock.now + 3_600_000 },
      deadManBoundMs: DEAD_MAN_BOUND_MS,
      log: line => logs.push(line),
    });
    expect(composition.degraded).toContain("environment could not be read");
    expect(logs.some(line => line.includes("fencing and halting only"))).toBe(true);
    expect(composition.deps.broker).toBeNull();
    expect(composition.deps.ping).not.toBeNull();

    const report = await runWatchdog(composition.deps);
    expect(report.halted).toBe(true);
    expect(report.ping).toBe("fail");
    expect(harness.entries().some(item => item.type === "HALT" && item["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
    const record = pingRecord(harness.paths);
    expect(record).toContain("fail ");
    expect(record).toContain("WATCHDOG_TAKEOVER");
  });
});
