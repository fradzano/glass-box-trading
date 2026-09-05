// S-CYC-09 at the composition root (P8): the competition provenance port is
// actually wired. The pure proof and the runner branch existed since P5, but
// the real runtime never supplied a `provenance` port, so a competition
// BOOTSTRAP was guaranteed to fail closed on its first cycle. These tests
// cover the composition function that decides whether the port exists, the
// real adapter's fully paginated bundle read, and the four executed runner
// outcomes: virgin bootstrap, non-virgin latch, unavailable bundle, and the
// dev profile that must never read a bundle at all.
import { afterEach, describe, expect, it } from "vitest";
import { mapAccountActivity } from "../src/core/alpaca-mapping.js";
import type { AccountActivityRecord } from "../src/core/alpaca-mapping.js";
import { utcIsoToEpochMs } from "../src/core/execution.js";
import { validateCompetitionProvenance } from "../src/core/lifecycle.js";
import { buildLifecycleDeps } from "../src/shell/agent-runtime.js";
import type { LifecycleComposition, ProvenanceSource } from "../src/shell/agent-runtime.js";
import { createAlpacaBroker } from "../src/shell/alpaca-broker.js";
import { runCycle } from "../src/shell/cycle-runner.js";
import type { CycleReport } from "../src/shell/cycle-runner.js";
import { readEpochStore, writeEpochStore } from "../src/shell/epoch-store.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import type { FakeBroker } from "../src/shell/fake-broker.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import type { JournalEntry } from "../src/core/journal.js";
import { RECORDED_OPENING_FUNDING_JOURNAL, RECORDED_VIRGIN_COMPETITION_ACCOUNT, RECORDED_VIRGIN_COMPETITION_ACTIVITIES } from "./alpaca-fixtures.js";
import { TEST_ONLY_EXECUTION_CONFIG } from "./execution-fixtures.js";
import { TEST_ONLY_O5_CONFIG } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_ORIGIN } from "./journal-fixtures.js";
import {
  P5_NOW,
  cleanupLifecycleDirs,
  entriesOf,
  freshLifecyclePaths,
  lifecycleCalendar,
  lifecycleHarness,
  lifecycleMarket,
  recordingPing,
} from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

const COMPETITION_START_MS = utcIsoToEpochMs("2026-08-28T15:00:00Z") as number;
const INITIAL_CAPITAL_CENTS = 10_000_000;
const CYCLE_DEADLINE_MS = 1_788_183_100_000;

const EXPECTATIONS = { expectedAccountId: TEST_ONLY_ACCOUNT_ID, competitionStartMs: COMPETITION_START_MS, initialCapitalCents: INITIAL_CAPITAL_CENTS };

/** The recorded opening funding journal, through the real mapping — never a hand-written approximation of it. */
function openingFundingJournal(overrides: Record<string, unknown> = {}): AccountActivityRecord {
  const mapped = mapAccountActivity({ ...RECORDED_OPENING_FUNDING_JOURNAL, ...overrides });
  if (mapped === null) throw new Error("the recorded funding journal must map");
  return mapped;
}

function activity(overrides: Record<string, unknown>): AccountActivityRecord {
  return { id: "x-1", activityType: "CSD", status: "executed", netAmountCents: null, currency: "USD", occurredAt: null, ...overrides };
}

/**
 * The bundle a genuinely virgin competition account produces once its funding journal is posted; overrides break
 * exactly one clause at a time. Note the ledger: a settled Alpaca paper account is NOT activity-free — it carries
 * the journal that funded it. The brand-new account's other virgin shape (ledger still empty) is `ledger([])`.
 */
function virginBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountRole: "paper",
    accountId: TEST_ONLY_ACCOUNT_ID,
    createdAt: "2026-08-28T16:00:00.000Z",
    openingCashCents: INITIAL_CAPITAL_CENTS,
    openingEquityCents: INITIAL_CAPITAL_CENTS,
    positionCount: 0,
    nonTerminalOrderCount: 0,
    orderHistory: { complete: true, items: 0 },
    fillHistory: { complete: true, items: 0 },
    activityLedger: { complete: true, activities: [openingFundingJournal()] },
    ...overrides,
  };
}

function ledger(activities: readonly AccountActivityRecord[], complete = true): Record<string, unknown> {
  return { activityLedger: { complete, activities } };
}

interface CountingSource extends ProvenanceSource {
  readonly calls: { deadlineAtMs: number | undefined }[];
}

function countingSource(answer: () => Promise<unknown>): CountingSource {
  const calls: { deadlineAtMs: number | undefined }[] = [];
  return {
    calls,
    provenanceBundle: (deadlineAtMs?: number) => {
      calls.push({ deadlineAtMs });
      return answer();
    },
  };
}

function composition(profile: "dev" | "competition", source: ProvenanceSource): LifecycleComposition {
  return {
    profile,
    flattenDate: "2026-09-03",
    nextTradingDay: "2026-09-01",
    residueMaxSessions: 1,
    closeEscalationStepCents: 2,
    finalCycleOfSession: false,
    competitionStartMs: COMPETITION_START_MS,
    initialCapitalCents: INITIAL_CAPITAL_CENTS,
    qualification: { checkpointMs: COMPETITION_START_MS + 86_400_000, windowEndMs: COMPETITION_START_MS + 7 * 86_400_000, maxLossCents: 100_000 },
    provenanceSource: source,
    cycleDeadlineMs: CYCLE_DEADLINE_MS,
  };
}

function haltEntries(entries: readonly JournalEntry[]): readonly JournalEntry[] {
  return entries.filter(entry => entry.type === "HALT");
}

interface RecoveredRun {
  readonly paths: StatePaths;
  readonly fake: FakeBroker;
  readonly report: CycleReport;
  readonly ping: ReturnType<typeof recordingPing>;
  entries(): readonly JournalEntry[];
}

/**
 * A competition bootstrap whose epoch store survived a lost journal: the seed
 * is already spent (`seedPending: false`), so — unlike a first-ever arming —
 * the refusal's own GAP and HALT entries can actually land. This is the state
 * in which the S-CYC-09 halt is observable; the first-ever arming is covered
 * separately below.
 */
async function recoveredCompetitionRun(provenance: () => Promise<unknown>): Promise<RecoveredRun> {
  const paths = freshLifecyclePaths();
  const clock = { now: P5_NOW };
  writeEpochStore(paths, { epoch: 5, holderId: "long-gone", acquiredAt: "2026-08-30T13:30:00.000Z", seedPending: false, resetPending: false });
  const fake = createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: INITIAL_CAPITAL_CENTS, equityCents: INITIAL_CAPITAL_CENTS, clock: () => clock.now });
  const binding = { profile: "competition", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;
  const gateway = createMutationGateway({ paths, secrets: [], clock: () => clock.now, brokerPort: fake.port, instanceId: "p8-provenance", lockTakeoverBoundMs: 60_000, binding });
  const acquired = await gateway.acquireAuthority({ account: "unknown" });
  if (acquired.kind !== "WON") throw new Error(`fixture acquisition failed: ${JSON.stringify(acquired)}`);
  const ping = recordingPing(() => clock.now);
  const source = countingSource(provenance);
  const report = await runCycle({
    gateway, epoch: acquired.epoch, paths, binding, broker: fake.read, market: lifecycleMarket(() => clock.now),
    analyst: () => Promise.resolve("{\"candidates\":[]}"), analystTimeoutMs: 200, clock: () => clock.now,
    calendar: lifecycleCalendar(clock.now), tradingDay: "2026-08-31", cycleIndex: 1, profile: "competition",
    decisionConfig: TEST_ONLY_O5_CONFIG, executionConfig: TEST_ONLY_EXECUTION_CONFIG,
    lifecycle: buildLifecycleDeps(composition("competition", source)), ping,
  });
  return { paths, fake, report, ping, entries: () => entriesOf(paths) };
}

describe("P8 / S-CYC-09 — the provenance port exists only on the competition profile", () => {
  it("buildLifecycleDeps carries a provenance port for competition and none at all for dev", () => {
    const devSource = countingSource(() => Promise.resolve(virginBundle()));
    const dev = buildLifecycleDeps(composition("dev", devSource));
    expect("provenance" in dev).toBe(false);
    expect(dev.provenance).toBeUndefined();
    expect(devSource.calls).toHaveLength(0);

    const competitionSource = countingSource(() => Promise.resolve(virginBundle()));
    const competition = buildLifecycleDeps(composition("competition", competitionSource));
    expect(typeof competition.provenance).toBe("function");
    // Building the record calls nothing: the port is wired, not invoked.
    expect(competitionSource.calls).toHaveLength(0);
    expect(competition.competitionStartMs).toBe(COMPETITION_START_MS);
    expect(competition.initialCapitalCents).toBe(INITIAL_CAPITAL_CENTS);
  });

  it("the competition port delegates to the adapter and inherits the cycle deadline", async () => {
    const source = countingSource(() => Promise.resolve(virginBundle()));
    const deps = buildLifecycleDeps(composition("competition", source));
    await expect(deps.provenance?.()).resolves.toMatchObject({ accountRole: "paper" });
    expect(source.calls).toEqual([{ deadlineAtMs: CYCLE_DEADLINE_MS }]);
  });
});

describe("P8 / S-CYC-09 — the executed competition bootstrap", () => {
  it("(a) a virgin bundle produces BOOTSTRAP, no PROVENANCE block, and no halt", async () => {
    const harness = await lifecycleHarness({ seedEntries: null, profile: "competition" });
    const source = countingSource(() => Promise.resolve(virginBundle()));
    const report = await harness.cycle({ lifecycle: buildLifecycleDeps(composition("competition", source)) });

    expect(report.primary).toBe("BOOTSTRAP");
    expect(harness.entries()[0]?.type).toBe("BOOTSTRAP");
    expect(report.entriesBlocked).not.toContain("PROVENANCE");
    expect(report.alarmConditions).not.toContain("COMPETITION_PROVENANCE_FAILED");
    expect(haltEntries(harness.entries())).toHaveLength(0);
    expect(readHaltState(harness.paths).halted).toBe(false);
    expect(source.calls).toHaveLength(1);
  });

  it("(a') an EMPTY complete ledger on an exact-capital account bootstraps too — the balance is the funding evidence", async () => {
    // The recorded competition account: the broker had not posted its opening journal yet. Requiring the journal
    // would have blocked arming until the broker got around to it, possibly past the qualification window.
    const harness = await lifecycleHarness({ seedEntries: null, profile: "competition" });
    const source = countingSource(() => Promise.resolve(virginBundle(ledger([]))));
    const report = await harness.cycle({ lifecycle: buildLifecycleDeps(composition("competition", source)) });

    expect(report.primary).toBe("BOOTSTRAP");
    expect(harness.entries()[0]?.type).toBe("BOOTSTRAP");
    expect(report.entriesBlocked).not.toContain("PROVENANCE");
    expect(report.alarmConditions).not.toContain("COMPETITION_PROVENANCE_FAILED");
    expect(haltEntries(harness.entries())).toHaveLength(0);
    expect(readHaltState(harness.paths).halted).toBe(false);
    expect(source.calls).toHaveLength(1);
  });

  it("(b) a pre-start creation instant journals GAP and latches the irreversible PROVENANCE_BROKEN halt", async () => {
    const run = await recoveredCompetitionRun(() => Promise.resolve(virginBundle({ createdAt: "2026-08-27T16:00:00.000Z" })));

    expect(run.report.primary).toBe("GAP");
    expect(run.report.entriesBlocked).toContain("PROVENANCE");
    expect(run.report.alarmConditions).toContain("COMPETITION_PROVENANCE_FAILED");
    expect(run.report.ping).toBe("fail");
    const types = run.entries().map(entry => entry.type);
    expect(types).toContain("GAP");
    expect(types).not.toContain("BOOTSTRAP");
    expect(run.entries().find(entry => entry.type === "GAP")?.["detail"]).toContain("account was created before COMPETITION_START");
    expect(run.fake.mutations).toHaveLength(0);
    expect(haltEntries(run.entries())[0]).toMatchObject({ reason: "PROVENANCE_BROKEN", sticky: true });
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "PROVENANCE_BROKEN", sticky: true });
  });

  it("(b') an activity beyond the opening funding journal is reuse evidence and latches PROVENANCE_BROKEN as well", async () => {
    const used = virginBundle(ledger([openingFundingJournal(), activity({ id: "x-2", activityType: "CSD", netAmountCents: 5_000 })]));
    const run = await recoveredCompetitionRun(() => Promise.resolve(used));

    expect(run.report.primary).toBe("GAP");
    expect(run.entries().map(entry => entry.type)).not.toContain("BOOTSTRAP");
    expect(run.fake.mutations).toHaveLength(0);
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "PROVENANCE_BROKEN", sticky: true });
  });

  it("(c') an empty ledger whose cash is one cent short halts RETRYABLY — a balance mismatch is ineligibility, not proof of spending", async () => {
    // Classification argument: with no ledger entry at all there is no record of anything leaving the account, so
    // $99,999.99 is evidence that this account is not the virgin $100,000 the competition requires — not evidence
    // that it was traded. It could equally be a broker still settling the funding. Ineligible, therefore blocked;
    // unproven as reuse, therefore the retryable GAP rather than the irreversible PROVENANCE_BROKEN latch.
    const run = await recoveredCompetitionRun(() => Promise.resolve(virginBundle({ ...ledger([]), openingCashCents: INITIAL_CAPITAL_CENTS - 1 })));

    expect(run.report.primary).toBe("GAP");
    expect(run.entries().map(entry => entry.type)).not.toContain("BOOTSTRAP");
    expect(run.fake.mutations).toHaveLength(0);
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "GAP", sticky: false });
  });

  it("(c'') a ledger with only an uncountable journal still halts retryably — the empty-ledger rule does not cover it", async () => {
    const run = await recoveredCompetitionRun(() => Promise.resolve(virginBundle(ledger([openingFundingJournal({ status: "canceled" })]))));

    expect(run.report.primary).toBe("GAP");
    expect(run.entries().map(entry => entry.type)).not.toContain("BOOTSTRAP");
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "GAP", sticky: false });
  });

  it("(c) an unavailable bundle halts retryably with GAP — an unreadable account is not proof of reuse", async () => {
    const run = await recoveredCompetitionRun(() => Promise.reject(new Error("BROKER_TIMEOUT after 30000 ms")));

    expect(run.report.primary).toBe("GAP");
    expect(run.report.entriesBlocked).toContain("PROVENANCE");
    expect(run.report.alarmConditions).toContain("COMPETITION_PROVENANCE_FAILED");
    expect(run.entries().map(entry => entry.type)).not.toContain("BOOTSTRAP");
    expect(run.fake.mutations).toHaveLength(0);
    const halt = readHaltState(run.paths);
    expect(halt).toEqual({ halted: true, reason: "GAP", sticky: false });
    expect(halt.reason).not.toBe("PROVENANCE_BROKEN");
  });

  it("(b'') on a first-ever arming the refusal journals nothing at all — the unspent epoch seed is what blocks every order", async () => {
    const harness = await lifecycleHarness({ seedEntries: null, profile: "competition" });
    const source = countingSource(() => Promise.resolve(virginBundle({ createdAt: "2026-08-27T16:00:00.000Z" })));
    const report = await harness.cycle({ lifecycle: buildLifecycleDeps(composition("competition", source)) });

    expect(report.primary).toBeNull();
    expect(report.entriesBlocked).toContain("PROVENANCE");
    expect(report.alarmConditions).toContain("COMPETITION_PROVENANCE_FAILED");
    expect(report.ping).toBe("fail");
    // Nothing authoritative can land before a valid BOOTSTRAP, so neither the GAP nor the halt is journaled;
    // the seed gate itself is what makes an order impossible (P5 decision, mirrored in cyc-recovery-bootstrap).
    expect(harness.entries()).toHaveLength(0);
    expect(harness.fake.mutations).toHaveLength(0);

    // R48: what the JOURNAL does not record, the durable mark now does. Since
    // every refused HALT marks before it appends, this refusal leaves a
    // PROVENANCE_BROKEN mark in the epoch store -- and because that reason is
    // sticky, no manual release can clear it. The runbook told the operator
    // there was "no fence to clear" here and that the state directory could be
    // emptied; both were false, and this assertion is what makes them stay
    // false-proof.
    const store = readEpochStore(harness.paths);
    expect(store.kind).toBe("present");
    expect(store.kind === "present" && store.fencePending, "the refusal is durable even with an empty journal").toBe(true);
    expect(store.kind === "present" ? store.fenceReason : null).toBe("PROVENANCE_BROKEN");
    expect(readHaltState(harness.paths).halted, "and it is NOT in the halt projection either").toBe(false);
    const blocked = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T13:32:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(blocked).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
  });

  it("(d) the dev profile bootstraps without ever reading a provenance bundle", async () => {
    const harness = await lifecycleHarness({ seedEntries: null, profile: "dev" });
    const source = countingSource(() => Promise.reject(new Error("the dev profile must never reach this port")));
    const report = await harness.cycle({ lifecycle: buildLifecycleDeps(composition("dev", source)) });

    expect(report.primary).toBe("BOOTSTRAP");
    expect(source.calls).toHaveLength(0);
    expect(haltEntries(harness.entries())).toHaveLength(0);
    expect(readHaltState(harness.paths).halted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The bundle read itself: the real adapter over a stub transport
// ---------------------------------------------------------------------------

/** A raw wire activity document, as a page of the stub ledger. */
function activityDocument(id: string, activityType = "CSD"): Record<string, unknown> {
  return { id, activity_type: activityType, status: "executed", currency: "USD", net_amount: "1.00", created_at: "2026-08-31T13:30:00Z" };
}

interface StubRoutes {
  readonly account: Record<string, unknown>;
  readonly activityPages: readonly (readonly Record<string, unknown>[])[];
  readonly fillPages: readonly (readonly Record<string, unknown>[])[];
  /** When true every activity request answers the same first page, so the cursor never advances. */
  readonly repeatFirstActivityPage?: boolean;
}

/** Answers the activity request from the `page_token` cursor, exactly as the broker does: the token is the previous page's last ID. */
function pageFor(pages: readonly (readonly Record<string, unknown>[])[], token: string | null): readonly Record<string, unknown>[] {
  if (token === null) return pages[0] ?? [];
  const index = pages.findIndex(page => page[page.length - 1]?.["id"] === token);
  return index < 0 ? [] : pages[index + 1] ?? [];
}

function stubBroker(routes: StubRoutes): { readonly broker: ReturnType<typeof createAlpacaBroker>; readonly requests: string[] } {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = input => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    requests.push(url);
    const path = url.slice(TEST_ONLY_ORIGIN.length);
    let body: unknown;
    if (path === "/v2/account") body = routes.account;
    else if (path === "/v2/positions") body = [];
    else if (path.startsWith("/v2/orders")) body = [];
    else if (path.startsWith("/v2/account/activities")) {
      const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      const pages = query.has("activity_types") ? routes.fillPages : routes.activityPages;
      body = routes.repeatFirstActivityPage === true ? pages[0] ?? [] : pageFor(pages, query.get("page_token"));
    } else return Promise.reject(new Error(`unexpected request ${url}`));
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  };
  const broker = createAlpacaBroker({
    credentials: { keyId: "TEST_ONLY_KEY", secretKey: "TEST_ONLY_SECRET" },
    tradingOrigin: TEST_ONLY_ORIGIN,
    dataOrigin: "https://data.alpaca.markets",
    clock: () => 1_788_183_060_000,
    fetchImpl,
  });
  return { broker, requests };
}

function virginAccountDocument(): Record<string, unknown> {
  return { account_number: TEST_ONLY_ACCOUNT_ID, cash: "100000.00", equity: "100000.00", created_at: "2026-08-28T16:00:00.123456789Z", status: "ACTIVE" };
}

describe("P8 / S-CYC-09 — the pure opening-ledger classification", () => {
  it("the recorded opening funding journal is the virgin state, not reuse evidence", () => {
    expect(validateCompetitionProvenance(virginBundle(), EXPECTATIONS)).toEqual({ ok: true });
    // Two journals that together fund exactly INITIAL_CAPITAL are equally legitimate: the rule is the sum, not the count.
    const split = ledger([openingFundingJournal({ id: "j-1", net_amount: "40000" }), openingFundingJournal({ id: "j-2", net_amount: "60000" })]);
    expect(validateCompetitionProvenance(virginBundle(split), EXPECTATIONS)).toEqual({ ok: true });
  });

  it("a funding sum other than INITIAL_CAPITAL is reset evidence", () => {
    const short = virginBundle(ledger([openingFundingJournal({ net_amount: "99999.99" })]));
    expect(validateCompetitionProvenance(short, EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: true });
    const doubled = virginBundle(ledger([openingFundingJournal({ id: "j-1" }), openingFundingJournal({ id: "j-2" })]));
    const verdict = validateCompetitionProvenance(doubled, EXPECTATIONS);
    expect(verdict).toMatchObject({ ok: false, reuseEvidence: true });
    if (verdict.ok) return;
    expect(verdict.violations.some(item => item.includes("sum to 20000000 cents"))).toBe(true);
  });

  it("any activity type beyond the opening funding journal is reuse evidence, and the message names it", () => {
    for (const type of ["FILL", "TRADE", "DIV", "JNLS", "CSD", "CSW", "FEE"]) {
      const used = virginBundle(ledger([openingFundingJournal(), activity({ id: `x-${type}`, activityType: type, netAmountCents: 100 })]));
      const verdict = validateCompetitionProvenance(used, EXPECTATIONS);
      expect(verdict).toMatchObject({ ok: false, reuseEvidence: true });
      if (verdict.ok) continue;
      expect(verdict.violations.some(item => item.includes(`beyond the opening funding journal: ${type}`))).toBe(true);
    }
  });

  it("an uncountable cash journal blocks the bootstrap without latching; cash journalled OUT latches", () => {
    // Cancelled or non-USD: the record cannot be counted as funding, but it is not proof the account was spent.
    // An irreversible latch on a benign funding retry would cost the whole competition week, so it stays retryable.
    for (const uncountable of [{ status: "canceled" }, { currency: "EUR" }, { net_amount: "0" }]) {
      const verdict = validateCompetitionProvenance(virginBundle(ledger([openingFundingJournal(uncountable)])), EXPECTATIONS);
      expect(verdict).toMatchObject({ ok: false, reuseEvidence: false });
      if (verdict.ok) continue;
      expect(verdict.violations.some(item => item.includes("cannot be counted as funding"))).toBe(true);
    }
    // An executed NEGATIVE cash journal is money that left the account: prior use, irreversible latch.
    const out = virginBundle(ledger([openingFundingJournal(), openingFundingJournal({ id: "j-out", net_amount: "-500" })]));
    expect(validateCompetitionProvenance(out, EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: true });
    // R31 gate: the two rules must hold as a conjunction. Money that left the account latches even when the
    // remaining journals still sum to exactly INITIAL_CAPITAL — a cash-out is never "funding".
    const nettingBack = virginBundle(ledger([openingFundingJournal({ id: "j-in", net_amount: "150000" }), openingFundingJournal({ id: "j-out-2", net_amount: "-50000" })]));
    expect(validateCompetitionProvenance(nettingBack, EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: true });
  });

  it("an EMPTY complete ledger at exactly INITIAL_CAPITAL is virgin evidence: the balance funds the proof", () => {
    // The broker posts the opening journal asynchronously (recorded on the competition account 2026-09-02:
    // ledger empty under every filter, cash and equity already $100,000). On an otherwise perfect snapshot the
    // balance itself is the funding evidence, so the bootstrap is not held hostage to the broker's posting delay.
    expect(validateCompetitionProvenance(virginBundle(ledger([])), EXPECTATIONS)).toEqual({ ok: true });
  });

  it("an empty ledger is virgin evidence ONLY at exactly INITIAL_CAPITAL — a wrong balance leaves the funding evidence incomplete", () => {
    // MUTANT GUARD: an implementation that accepts an empty ledger regardless of balances drops the funding
    // violation asserted here. The balance clauses themselves keep their own verdict (blocked, no reuse latch):
    // with an empty ledger nothing records money leaving the account, so a mismatch is ineligibility evidence,
    // not proof of spending, and it must stay retryable.
    for (const off of [{ openingCashCents: INITIAL_CAPITAL_CENTS - 1 }, { openingEquityCents: INITIAL_CAPITAL_CENTS - 1 }, { openingCashCents: INITIAL_CAPITAL_CENTS + 100 }]) {
      const verdict = validateCompetitionProvenance(virginBundle({ ...ledger([]), ...off }), EXPECTATIONS);
      expect(verdict).toMatchObject({ ok: false, reuseEvidence: false });
      if (verdict.ok) continue;
      expect(verdict.violations.some(item => item.includes("INITIAL_CAPITAL"))).toBe(true);
      expect(verdict.violations.some(item => item.includes("no opening funding journal"))).toBe(true);
    }
    // The same for the rest of the virgin snapshot: an empty ledger next to a used account proves nothing.
    for (const off of [{ fillHistory: { complete: true, items: 1 } }, { orderHistory: { complete: false, items: 0 } }, { positionCount: 1 }, { nonTerminalOrderCount: 1 }, { createdAt: "2026-08-27T16:00:00.000Z" }]) {
      const verdict = validateCompetitionProvenance(virginBundle({ ...ledger([]), ...off }), EXPECTATIONS);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.violations.some(item => item.includes("no opening funding journal"))).toBe(true);
    }
  });

  it("a non-empty ledger without a countable funding journal still reports the missing funding evidence", () => {
    const verdict = validateCompetitionProvenance(virginBundle(ledger([openingFundingJournal({ status: "canceled" })])), EXPECTATIONS);
    expect(verdict).toMatchObject({ ok: false, reuseEvidence: false });
    if (verdict.ok) return;
    expect(verdict.violations.some(item => item.includes("no opening funding journal"))).toBe(true);
  });

  it("an incomplete ledger page and a malformed ledger both fail closed without claiming reuse", () => {
    expect(validateCompetitionProvenance(virginBundle(ledger([openingFundingJournal()], false)), EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: false });
    // MUTANT GUARD: an incomplete EMPTY page must never read as the virgin empty ledger — the missing page could
    // hold the FILL that disqualifies the account. An implementation that treats it as complete returns ok here.
    const incompleteEmpty = validateCompetitionProvenance(virginBundle(ledger([], false)), EXPECTATIONS);
    expect(incompleteEmpty).toMatchObject({ ok: false, reuseEvidence: false });
    if (!incompleteEmpty.ok) {
      expect(incompleteEmpty.violations.some(item => item.includes("activityLedger pagination is incomplete"))).toBe(true);
      expect(incompleteEmpty.violations.some(item => item.includes("no opening funding journal"))).toBe(true);
    }
    expect(validateCompetitionProvenance(virginBundle({ activityLedger: { complete: true, activities: [{ id: "a" }] } }), EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: false });
    // A bundle in the OLD count-only shape no longer satisfies the proof: the shape change fails closed, not open.
    expect(validateCompetitionProvenance(virginBundle({ activityLedger: { complete: true, items: 0 } }), EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: false });
  });

  it("a FILL still fails the fill history independently of the ledger classification", () => {
    const filled = virginBundle({ fillHistory: { complete: true, items: 1 } });
    expect(validateCompetitionProvenance(filled, EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: true });
  });
});

describe("P8 — the real adapter assembles the bundle the pure proof accepts", () => {
  it("a virgin paper account with its recorded funding journal yields a bundle that passes the proof", async () => {
    const { broker, requests } = stubBroker({ account: virginAccountDocument(), activityPages: [[RECORDED_OPENING_FUNDING_JOURNAL]], fillPages: [[]] });
    const bundle = await broker.provenanceBundle();

    expect(bundle).toEqual({
      accountRole: "paper",
      accountId: TEST_ONLY_ACCOUNT_ID,
      createdAt: "2026-08-28T16:00:00.123Z",
      openingCashCents: INITIAL_CAPITAL_CENTS,
      openingEquityCents: INITIAL_CAPITAL_CENTS,
      positionCount: 0,
      nonTerminalOrderCount: 0,
      orderHistory: { complete: true, items: 0 },
      fillHistory: { complete: true, items: 0 },
      activityLedger: { complete: true, activities: [openingFundingJournal()] },
    });
    expect(validateCompetitionProvenance(bundle, EXPECTATIONS)).toEqual({ ok: true });
    // Both ledgers are read: the whole activity history and the fill subset separately.
    expect(requests.some(url => url.includes("/v2/account/activities?page_size=100&direction=asc") && !url.includes("activity_types"))).toBe(true);
    expect(requests.some(url => url.includes("activity_types=FILL"))).toBe(true);
  });

  it("the recorded brand-new competition account — empty ledger, exact capital — assembles a bundle that passes the proof", async () => {
    const { broker } = stubBroker({ account: { ...RECORDED_VIRGIN_COMPETITION_ACCOUNT }, activityPages: [RECORDED_VIRGIN_COMPETITION_ACTIVITIES], fillPages: [[]] });
    const bundle = await broker.provenanceBundle();

    expect(bundle).toEqual({
      accountRole: "paper",
      accountId: RECORDED_VIRGIN_COMPETITION_ACCOUNT.account_number,
      // The broker's nanosecond creation instant, truncated to the millisecond the proof compares.
      createdAt: "2026-09-02T09:54:41.384Z",
      openingCashCents: INITIAL_CAPITAL_CENTS,
      openingEquityCents: INITIAL_CAPITAL_CENTS,
      positionCount: 0,
      nonTerminalOrderCount: 0,
      orderHistory: { complete: true, items: 0 },
      fillHistory: { complete: true, items: 0 },
      activityLedger: { complete: true, activities: [] },
    });
    const expectations = { ...EXPECTATIONS, expectedAccountId: RECORDED_VIRGIN_COMPETITION_ACCOUNT.account_number };
    expect(validateCompetitionProvenance(bundle, expectations)).toEqual({ ok: true });
  });

  it("the activity ledger is paged to the end and every page reaches the proof", async () => {
    const first = Array.from({ length: 100 }, (_unused, index) => activityDocument(`a-${String(index)}`, "CSD"));
    const second = [activityDocument("a-100", "CSD"), RECORDED_OPENING_FUNDING_JOURNAL];
    const { broker } = stubBroker({ account: virginAccountDocument(), activityPages: [first, second], fillPages: [[]] });
    const listing = await broker.accountActivities([]);

    expect(listing).toMatchObject({ pages: 2, complete: true });
    expect(listing.activities).toHaveLength(102);
    const bundle = await broker.provenanceBundle();
    expect(bundle.activityLedger.complete).toBe(true);
    expect(bundle.activityLedger.activities).toHaveLength(102);
    // The funding journal on the second page is found, but the 101 deposits around it are reuse evidence.
    expect(validateCompetitionProvenance(bundle, EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: true });
  });

  it("a cursor that never advances is reported as incomplete pagination, not as a finished ledger", async () => {
    const page = Array.from({ length: 100 }, (_unused, index) => activityDocument(`a-${String(index)}`, "CSD"));
    const { broker } = stubBroker({ account: virginAccountDocument(), activityPages: [page], fillPages: [[]], repeatFirstActivityPage: true });
    const listing = await broker.accountActivities([]);

    expect(listing.complete).toBe(false);
    expect(listing.activities).toHaveLength(100);
    const bundle = await broker.provenanceBundle();
    expect(bundle.activityLedger.complete).toBe(false);
    const verdict = validateCompetitionProvenance(bundle, EXPECTATIONS);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.violations.some(item => item.includes("activityLedger pagination is incomplete"))).toBe(true);
  });

  it("a malformed net amount on the wire fails the read closed instead of mapping to no amount", async () => {
    const broken = { ...RECORDED_OPENING_FUNDING_JOURNAL, net_amount: "100000.005" };
    const { broker } = stubBroker({ account: virginAccountDocument(), activityPages: [[broken]], fillPages: [[]] });
    await expect(broker.provenanceBundle()).rejects.toThrow("ACTIVITY_DOCUMENT_INVALID");
  });

  it("the real adapter is the composition's provenance source: the wired port returns the adapter's own bundle", async () => {
    const { broker } = stubBroker({ account: virginAccountDocument(), activityPages: [[RECORDED_OPENING_FUNDING_JOURNAL]], fillPages: [[]] });
    // The same assignment the composition root makes: `provenanceSource: broker`.
    const deps = buildLifecycleDeps(composition("competition", broker));
    const bundle = await deps.provenance?.();

    expect(validateCompetitionProvenance(bundle, EXPECTATIONS)).toEqual({ ok: true });
  });

  it("an account document without a creation instant fails closed retryably rather than passing as virgin", async () => {
    const account = { ...virginAccountDocument(), created_at: undefined };
    const { broker } = stubBroker({ account, activityPages: [[RECORDED_OPENING_FUNDING_JOURNAL]], fillPages: [[]] });
    const bundle = await broker.provenanceBundle();

    expect(bundle.createdAt).toBeNull();
    expect(validateCompetitionProvenance(bundle, EXPECTATIONS)).toMatchObject({ ok: false, reuseEvidence: false });
  });
});
