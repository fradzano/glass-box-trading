// Runtime enforcement of core purity: execute the compiled core inside an
// isolated realm that has no clock, no randomness, no environment, no locale,
// no code generation, and frozen intrinsics. Whatever the source text spelled,
// an executed path that reaches an ambient capability fails here.
//
// This complements the static gate (tools/check-core-architecture.mjs). The
// static gate reads the source and rejects known impurity classes; this gate
// does not read source at all, so laundering through the type system cannot
// pass it. Its own declared limit: it proves purity only for the paths it
// executes (the recorded fixture, a determinism replay, and the sampled
// lifecycle, partial-fill, and parser paths below) and only for the
// capabilities the taming removes: clock, randomness, locale, code
// generation, stack observation, the symbol registry, mutation of
// intrinsics, and mutation of the core's exported values (restricted to
// ordinary functions, arrays, and plain records, then deep-frozen after
// load; accessors, proxies, and objects with internal slots are rejected).
// It does not observe: unexecuted paths, mutation of non-exported
// module-scope objects inside the core (closure state included), and any
// capability not listed here.
// Run with:
//   node --experimental-vm-modules tools/run-core-sandboxed.mjs
// after `npm run build` (dist/core must exist).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { types } from "node:util";
import vm from "node:vm";

const DIST = path.resolve("dist");

const TAMING = `
  "use strict";
  const deny = (name) => function denied() { throw new Error("ambient access denied: " + name); };
  // Clock, randomness, locale, environment, timers: absent or throwing.
  for (const name of ["Date", "Intl", "SharedArrayBuffer", "Atomics", "WeakRef", "FinalizationRegistry"]) {
    Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
  }
  Object.defineProperty(Math, "random", { value: deny("Math.random"), writable: false, configurable: false });
  // The symbol registry is realm-global mutable state.
  Object.defineProperty(Symbol, "for", { value: deny("Symbol.for"), writable: false, configurable: false });
  Object.defineProperty(Symbol, "keyFor", { value: deny("Symbol.keyFor"), writable: false, configurable: false });
  Object.defineProperty(globalThis, "eval", { value: deny("eval"), writable: false, configurable: false });
  for (const name of ["localeCompare", "toLocaleString", "toLocaleLowerCase", "toLocaleUpperCase"]) {
    Object.defineProperty(String.prototype, name, { value: deny("String.prototype." + name), writable: false, configurable: false });
  }
  for (const proto of [Number.prototype, Array.prototype, Object.prototype, BigInt.prototype]) {
    Object.defineProperty(proto, "toLocaleString", { value: deny("toLocaleString"), writable: false, configurable: false });
  }
  // Code generation: every function constructor throws.
  const constructors = [Function, Object.getPrototypeOf(function* () {}).constructor, Object.getPrototypeOf(async function () {}).constructor, Object.getPrototypeOf(async function* () {}).constructor];
  for (const ctor of constructors) {
    Object.defineProperty(ctor.prototype, "constructor", { value: deny("Function constructor"), writable: false, configurable: false });
  }
  Object.defineProperty(globalThis, "Function", { value: deny("Function"), writable: false, configurable: false });
  // Stack traces observe the host (file paths, frames): reading them is denied.
  Error.stackTraceLimit = 0;
  Object.defineProperty(Error, "prepareStackTrace", { value: () => { throw new Error("ambient access denied: Error.stack"); }, writable: false, configurable: false });
  Object.defineProperty(Error, "captureStackTrace", { value: deny("Error.captureStackTrace"), writable: false, configurable: false });
  // Freeze every intrinsic reachable from the global object (a minimal harden).
  const seen = new Set();
  const freezeDeep = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) return;
    seen.add(value);
    try { Object.freeze(value); } catch { /* typed-array views with elements cannot be frozen; they hold no capability */ }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if ("value" in descriptor) freezeDeep(descriptor.value);
      if (descriptor.get !== undefined) freezeDeep(descriptor.get);
      if (descriptor.set !== undefined) freezeDeep(descriptor.set);
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== null) freezeDeep(proto);
  };
  freezeDeep(globalThis);
`;

function createTamedRealm() {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(TAMING, context, { filename: "taming.js" });
  return context;
}

async function loadModuleGraph(context, entryFile, inlineSources = new Map()) {
  // The cache holds the promise of a fully linked module, so a diamond in the
  // import graph (two modules requesting the same dependency while its own
  // link is in flight) waits for that link instead of receiving an unlinked
  // module. The core has no import cycles (the static gate rejects nothing
  // outside src/core, and the graph is layered), so the wait always resolves.
  const cache = new Map();
  function load(file) {
    const cached = cache.get(file);
    if (cached !== undefined) return cached;
    const pending = (async () => {
      const source = inlineSources.get(file) ?? await readFile(file, "utf8");
      const module = new vm.SourceTextModule(source, { context, identifier: file });
      await module.link(specifier => {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw new Error(`core imports a non-relative module: ${specifier}`);
        return load(path.resolve(path.dirname(file), specifier));
      });
      return module;
    })();
    cache.set(file, pending);
    return pending;
  }
  const entry = await load(entryFile);
  await entry.evaluate();
  // Harden: everything reachable from the loaded graph's exports is restricted
  // to shapes that `Object.freeze` actually makes immutable — ordinary
  // functions, ordinary arrays, and plain records whose prototype is the
  // realm's `Object.prototype` or `null` — decided by prototype identity, never
  // by a tag — and is then deep-frozen along its data properties. Anything else
  // is rejected at load: accessor properties (a frozen getter can still close
  // over mutable state), proxies, custom prototypes, and every object with
  // mutable internal slots that freeze does not reach (Map, Set, typed arrays,
  // ArrayBuffer, iterators, generator objects, boxed primitives, Date, RegExp …).
  // A failing freeze is an error, never swallowed. Realm intrinsics are already
  // frozen by the taming and are skipped, not traversed.
  const intrinsics = intrinsicsOf(context);
  const seen = new Set();
  // Shape is decided by realm prototype identity, never by a tag: `Symbol.toStringTag`
  // is author-controlled, a prototype link is not. Custom prototypes are rejected.
  // `Function` is the denial stub inside the realm, so %Function.prototype% is
  // taken from a function literal, not from the (replaced) global.
  const [realmObjectPrototype, realmArrayPrototype, realmFunctionPrototype] = vm.runInContext("[Object.prototype, Array.prototype, Object.getPrototypeOf(function () {})]", context);
  const shapeOf = (value) => {
    if (types.isProxy(value)) return "proxy";
    const prototype = Object.getPrototypeOf(value);
    if (typeof value === "function") return prototype === realmFunctionPrototype ? "function" : "exotic function";
    if (Array.isArray(value)) return prototype === realmArrayPrototype ? "array" : "exotic array";
    return prototype === realmObjectPrototype || prototype === null ? "record" : "exotic object or custom-prototype record";
  };
  const harden = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value) || intrinsics.has(value)) return;
    const shape = shapeOf(value);
    if (shape === "proxy" || shape.startsWith("exotic")) throw new Error(`export hardening denied non-ordinary exported value '${shape}'`);
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) throw new Error(`export hardening denied accessor property '${String(key)}' on a core-owned value`);
      harden(descriptor.value);
    }
    Object.freeze(value);
    if (!Object.isFrozen(value)) throw new Error(`export hardening could not freeze a core-owned value ('${shape}')`);
  };
  for (const module of await Promise.all(cache.values())) for (const value of Object.values(module.namespace)) harden(value);
  return entry.namespace;
}

// Every object reachable from the realm's global object (values, accessors,
// prototypes): the set the taming already froze. Collected on the host side so
// export hardening can tell a core-owned prototype from an intrinsic one.
function intrinsicsOf(context) {
  const set = new Set();
  const walk = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null || set.has(value)) return;
    set.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if ("value" in descriptor) walk(descriptor.value);
      if (descriptor.get !== undefined) walk(descriptor.get);
      if (descriptor.set !== undefined) walk(descriptor.set);
    }
    walk(Object.getPrototypeOf(value));
  };
  walk(vm.runInContext("globalThis", context));
  return set;
}

function stable(value) {
  return JSON.stringify(value, (_key, inner) => typeof inner === "bigint" ? `${inner}n` : inner);
}

async function exerciseCore() {
  const context = createTamedRealm();
  const paths = [];
  const core = await loadModuleGraph(context, path.join(DIST, "core", "decision.js"));
  const identity = await loadModuleGraph(context, path.join(DIST, "core", "order-identity.js"));
  const domain = await loadModuleGraph(context, path.join(DIST, "core", "domain.js"));
  const fixture = await loadModuleGraph(context, path.join(DIST, "fixtures", "p1-recorded-cycle.js"));

  const first = core.decide(fixture.P1_RECORDED_SNAPSHOT, fixture.P1_RECORDED_CANDIDATES, fixture.TEST_ONLY_P1_O5_CONFIG, fixture.TEST_ONLY_P1_NOW);
  const second = core.decide(fixture.P1_RECORDED_SNAPSHOT, fixture.P1_RECORDED_CANDIDATES, fixture.TEST_ONLY_P1_O5_CONFIG, fixture.TEST_ONLY_P1_NOW);
  if (stable(first) !== stable(second)) throw new Error("sandboxed decide is not deterministic across two identical calls");
  if (first.candidateVerdicts.length === 0 || first.candidateVerdicts.some(verdict => verdict.gateVector.length !== 8)) throw new Error("sandboxed decide did not return a complete G1–G8 vector per candidate");
  paths.push(`decide(recorded fixture) ×2 deterministic, ${first.candidateVerdicts.length} candidates, ${first.actions.length} action(s)`);

  const malformed = core.parseAnalystOutput("{\"candidates\":[{\"candidateId\":\"x\"}]}");
  if (malformed.kind !== "structural_failure") throw new Error("sandboxed parser accepted a malformed candidate");
  const stale = core.decide({ ...fixture.P1_RECORDED_SNAPSHOT, snapshotAt: domain.integerUnit(0, "EpochMilliseconds") }, fixture.P1_RECORDED_CANDIDATES, fixture.TEST_ONLY_P1_O5_CONFIG, fixture.TEST_ONLY_P1_NOW);
  if (stale.actions.length !== 0 || !stale.batchVerdicts.some(verdict => verdict.code === "STALE_SNAPSHOT")) throw new Error("sandboxed stale snapshot did not void actions");
  paths.push("parseAnalystOutput(malformed) → structural_failure; decide(stale snapshot) → STALE_SNAPSHOT");

  const candidates = fixture.P1_RECORDED_CANDIDATES;
  const passing = candidates.kind === "candidates" ? candidates.candidates.find(candidate => first.actions.some(action => action.candidateId === candidate.candidateId)) : undefined;
  if (passing === undefined) throw new Error("recorded fixture has no passing candidate to reconcile");
  const reconciled = core.reconcilePartialFillRisk(passing, domain.integerUnit(1, "Quantity"), passing.entryLimit.priceCents, domain.integerUnit(0, "Quantity"));
  if (reconciled.components.length !== 1 || reconciled.components[0].kind !== "filled") throw new Error("sandboxed partial-fill reconciliation produced an unexpected component set");
  paths.push("reconcilePartialFillRisk(full fill) → one filled component");

  const plan = identity.planCloseLifecycle({
    exposureLifecycleId: first.actions[0].exposureLifecycleId,
    route: "ordinary",
    currentExposureQuantity: domain.integerUnit(1, "Quantity"),
    attempts: [],
  });
  if (plan.kind !== "SUBMIT") throw new Error(`sandboxed close planner returned ${plan.kind} for a fresh lifecycle`);
  paths.push(`planCloseLifecycle(fresh) → SUBMIT ${plan.attemptId}`);

  // P2 journal and authority core: schema validation, line codec with torn tail, redaction, halt fold, fencing decisions, binding.
  const journal = await loadModuleGraph(context, path.join(DIST, "core", "journal.js"));
  const authority = await loadModuleGraph(context, path.join(DIST, "core", "authority.js"));
  const snapshotRecord = { accountId: "TEST_ONLY_SANDBOX", snapshotAt: "2026-08-31T13:30:00.000Z", cashCents: 1, equityCents: 1, positions: [], openOrders: [], quoteSamples: { SPY: { C1: { bidCents: 1, askCents: 2, bidSize: 1, askSize: 1, quotedAt: "2026-08-31T13:30:00.000Z", brokerQuotedAt: "raw" } } } };
  const cycleDraft = { at: "2026-08-31T13:30:00.000Z", epoch: 1, type: "CYCLE", cycleIndex: 0, tradingDay: "2026-08-31", reasonCodes: ["WORLD_PARTIAL"], snapshot: snapshotRecord, batchVerdicts: [{ code: "SCHEMA_VETO", reason: "key TEST_ONLY_SANDBOX_SECRET leaked" }], candidateVerdicts: [] };
  const planned = journal.planAppend({ lastSeq: 0, priorIntentRationales: [] }, cycleDraft, ["TEST_ONLY_SANDBOX_SECRET"]);
  if (!planned.ok || planned.entry.seq !== 1 || planned.line.includes("TEST_ONLY_SANDBOX_SECRET") || !planned.line.includes("[REDACTED]")) throw new Error("sandboxed planAppend did not assign seq 1 with the secret redacted");
  const parsed = journal.parseJournalText(planned.line + planned.line.slice(0, 20));
  if (parsed.entries.length !== 1 || parsed.torn === null || parsed.corrupt.length !== 0) throw new Error("sandboxed parseJournalText did not detect the torn tail");
  const rejected = journal.validateJournalEntry({ ...planned.entry, type: "NOT_A_TYPE" });
  const witnessWithEpoch = journal.validateJournalEntry({ seq: 2, at: "2026-08-31T13:30:00.000Z", epoch: 1, type: "SUPPRESSED", instanceId: "x", holderId: "y", reason: "LOCK_HELD" });
  if (rejected.ok || witnessWithEpoch.ok || journal.requestClassOf("FENCED_OUT") !== "witness" || journal.isUtcIsoTimestamp("2026-08-31T15:30:00+02:00")) throw new Error("sandboxed journal validation accepted an out-of-set value");
  const halted = journal.haltStateFrom([planned.entry, { seq: 2, at: "2026-08-31T13:31:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "", sticky: false }]);
  const unhalted = journal.haltStateAfter(halted, { seq: 3, at: "2026-08-31T13:32:00.000Z", epoch: 1, type: "UNHALT", operator: "o", reason: "r", actor: "human" });
  if (!halted.halted || unhalted.halted) throw new Error("sandboxed halt fold is wrong");
  paths.push("planAppend(CYCLE, secret) → seq 1 redacted; parseJournalText(torn) → 1 entry + torn; validateJournalEntry(out-of-set) → rejected; haltStateFrom/After → HALT then human UNHALT");

  const present = { kind: "present", epoch: 3, holderId: "a", acquiredAt: "2026-08-31T13:30:00.000Z", seedPending: false, resetPending: false };
  const staleEpoch = authority.authorizeMutation({ class: "authoritative", epoch: 2, action: { kind: "broker_mutation" } }, present);
  const fresh = authority.authorizeMutation({ class: "authoritative", epoch: 3, action: { kind: "journal_append", entryType: "CYCLE" } }, present);
  const witnessBroker = authority.authorizeMutation({ class: "witness", action: { kind: "broker_mutation" } }, present);
  const increment = authority.compareAndIncrement(present, 3);
  const changed = authority.compareAndIncrement(present, 2);
  const seed = authority.planEpochAcquisition({ kind: "absent" }, { account: "non_virgin", journalEmpty: true });
  if (staleEpoch.authorized || !fresh.authorized || witnessBroker.authorized || increment.kind !== "COMMIT" || increment.next !== 4 || changed.kind !== "CHANGED" || seed.kind !== "SEED_GAP") throw new Error("sandboxed authority decisions are wrong");
  const bound = authority.bindAccount({ canonicalTradingOrigin: "https://paper-api.alpaca.markets", expectedAccountId: "PA_TEST_ONLY" }, { profile: "dev", requestedOrigin: "https://paper-api.alpaca.markets", observedOrigin: "https://paper-api.alpaca.markets", brokerReportedAccountId: "PA_TEST_ONLY" });
  const live = authority.bindAccount({ canonicalTradingOrigin: "https://paper-api.alpaca.markets", expectedAccountId: "PA_TEST_ONLY" }, { profile: "dev", requestedOrigin: "https://api.alpaca.markets", observedOrigin: "https://api.alpaca.markets", brokerReportedAccountId: "PA_TEST_ONLY" });
  if (!bound.ok || live.ok || !authority.validateSchedulingBounds({ lockTakeoverBoundMs: 300_000, cycleWalltimeBudgetMs: 240_000, cycleIntervalMs: 900_000, deadManBoundMs: 3_000_000 }).ok) throw new Error("sandboxed binding decisions are wrong");
  paths.push("authorizeMutation(stale/fresh/witness-broker), compareAndIncrement(commit/changed), planEpochAcquisition(absent+non-virgin) → SEED_GAP, bindAccount(paper ok / live rejected)");

  // P3 execution core: UTC conversion without a clock, limit pricing, fill classification, the snapshot adapter,
  // the lifecycle fold, the revalidation claimset, the kill plan, and emergency-close eligibility.
  const execution = await loadModuleGraph(context, path.join(DIST, "core", "execution.js"));
  const ms = 1_788_183_000_123;
  if (execution.epochMsToUtcIso(ms) !== "2026-08-31T13:30:00.123Z" || execution.utcIsoToEpochMs("2026-08-31T13:30:00.123Z") !== ms || execution.utcIsoToEpochMs("2026-08-31T15:30:00+02:00") !== null) throw new Error("sandboxed UTC conversion is wrong");
  const executionConfig = { limitToleranceCents: domain.integerUnit(2, "OptionPriceCents"), killEquityThresholdCents: domain.integerUnit(9_200_000, "MoneyCents"), initialCapitalCents: domain.integerUnit(10_000_000, "MoneyCents") };
  const legs = [
    { contractId: "SHORT", underlying: "SPY", expiry: "2026-09-04", strikeCents: domain.integerUnit(50_000, "StrikeCents"), right: "call", side: "sell", ratio: domain.lotCount(1) },
    { contractId: "LONG", underlying: "SPY", expiry: "2026-09-04", strikeCents: domain.integerUnit(50_500, "StrikeCents"), right: "call", side: "buy", ratio: domain.lotCount(1) },
  ];
  const candidate = { candidateId: "c", declaredStructureType: "vertical_credit", sleeve: "income", quantity: domain.lotCount(1), remainingTradingSessions: domain.integerUnit(5, "Quantity"), rationale: "SPY vertical_credit sandbox", entryLimit: { kind: "credit", priceCents: domain.integerUnit(200, "OptionPriceCents") }, legs };
  const quote = (bid, ask) => ({ bidCents: domain.integerUnit(bid, "OptionPriceCents"), askCents: domain.integerUnit(ask, "OptionPriceCents"), bidSize: domain.integerUnit(20, "Quantity"), askSize: domain.integerUnit(20, "Quantity"), quotedAt: domain.integerUnit(ms, "EpochMilliseconds") });
  const quotes = { SHORT: quote(300, 302), LONG: quote(100, 102) };
  const priced = execution.priceEntryLimit(candidate, quotes, executionConfig);
  if (!priced.ok || priced.candidate.entryLimit.priceCents !== 198 || execution.classifyFillPrice(priced.candidate.entryLimit, 150) !== "BROKER_PRICE_BREACH" || execution.classifyFillPrice(priced.candidate.entryLimit, 199) !== "PRICE_IMPROVED") throw new Error("sandboxed pricing or fill classification is wrong");
  const market = { quotesByContract: { SHORT: { bidCents: 300, askCents: 302, bidSize: 20, askSize: 20, quotedAtMs: ms, brokerQuotedAt: "raw" } }, contractsById: { SHORT: { contractId: "SHORT", underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call" } }, spotCentsByUnderlying: { SPY: 50_000 } };
  const book = { accountId: "TEST_ONLY_SANDBOX", cashCents: 1, equityCents: 10_000_000, positions: [], openOrders: [], observedAtMs: ms };
  const calendar = { isTradingDay: true, opensAt: domain.integerUnit(ms - 1, "EpochMilliseconds"), closesAt: domain.integerUnit(ms + 1, "EpochMilliseconds") };
  const assembled = execution.assembleDecisionSnapshot({ broker: book, market, journal: [planned.entry], halt: false, profile: "dev", calendar, tradingDay: "2026-08-31", cycleIndex: 1 });
  const refusedContract = execution.assembleDecisionSnapshot({ broker: book, market: { ...market, contractsById: { SHORT: null } }, journal: [], halt: false, profile: "dev", calendar, tradingDay: "2026-08-31", cycleIndex: 1 });
  if (!assembled.ok || assembled.snapshot.priorQuotesByUnderlying.SPY === undefined || refusedContract.ok) throw new Error("sandboxed snapshot adapter is wrong");
  const binding = { profile: "dev", tradingOrigin: "https://paper-api.alpaca.markets", accountId: "TEST_ONLY_SANDBOX" };
  const entryPlan = { kind: "ENTRY_ACTION_PLAN", candidateId: "c", exposureLifecycleId: "exposure:e", clientOrderId: "entry:e", sleeve: "income", underlying: "SPY", submittedLimit: priced.candidate.entryLimit, reservedMaxLossCents: domain.integerUnit(30_200, "MoneyCents"), legs, quantity: domain.lotCount(1) };
  const claimset = execution.buildClaimset(entryPlan, book, binding, 1, executionConfig);
  const recheck = { batchVerdicts: [], candidateVerdicts: [{ candidateId: "c", candidateRationale: "r", decision: "VETO", reservedMaxLossCents: domain.integerUnit(30_200, "MoneyCents"), gateVector: Array.from({ length: 8 }, (_, index) => ({ gate: "G" + String(index + 1), passed: index !== 6, code: "PASS", reasons: [] })) }], actions: [] };
  const holds = execution.revalidateClaimset(claimset, { book, brokerReportedAccountId: "TEST_ONLY_SANDBOX", epoch: 1, halted: false, recheck });
  const crossed = execution.revalidateClaimset(claimset, { book: { ...book, equityCents: 9_199_999 }, brokerReportedAccountId: "TEST_ONLY_SANDBOX", epoch: 1, halted: false, recheck });
  if (!holds.ok || crossed.ok || !crossed.killTriggered || claimset.claims.length !== 8) throw new Error("sandboxed revalidation is wrong");
  const intentDraft = execution.intentDraft({ atIso: "2026-08-31T13:31:00.000Z", epoch: 1 }, entryPlan, priced.candidate, recheck.candidateVerdicts[0], assembled.snapshot, binding);
  const intentPlanned = journal.planAppend({ lastSeq: 1, priorIntentRationales: [] }, intentDraft, []);
  if (!intentPlanned.ok) throw new Error("sandboxed intentDraft did not validate: " + intentPlanned.reason);
  const outcome = execution.outcomeFromOrder({ clientOrderId: "entry:e", limit: priced.candidate.entryLimit, binding, epoch: 1, atIso: "2026-08-31T13:32:00.000Z" }, { brokerOrderId: "b", clientOrderId: "entry:e", status: "filled", filledQuantity: 1, avgFillPriceCents: 198, avgFillPriceRaw: "1.98", brokerTimestamps: {}, brokerReason: null, legs: [], quantity: 1, limit: null });
  const outcomePlanned = journal.planAppend({ lastSeq: 2, priorIntentRationales: [] }, outcome.draft, []);
  if (!outcomePlanned.ok) throw new Error("sandboxed OUTCOME draft did not validate: " + outcomePlanned.reason);
  const fold = execution.foldLifecycles([planned.entry, intentPlanned.entry, outcomePlanned.entry]);
  if (!fold.ok || fold.entries.length !== 1 || fold.entries[0].state !== "filled") throw new Error("sandboxed lifecycle fold is wrong");
  const heldBook = { ...book, equityCents: 9_000_000, positions: [{ contractId: "SHORT", quantity: -1, avgEntryPriceCents: 300 }, { contractId: "LONG", quantity: 1, avgEntryPriceCents: 100 }], openOrders: [{ brokerOrderId: "o", clientOrderId: "entry:x", status: "accepted", filledQuantity: 0, avgFillPriceCents: null, avgFillPriceRaw: null, brokerTimestamps: {}, brokerReason: null, legs: [{ contractId: "OTHER", side: "buy", ratio: 1 }], quantity: 1, limit: null }] };
  const killPlan = execution.planKillManagement(heldBook, fold.entries);
  const eligible = execution.emergencyCloseEligibility(heldBook.positions, [{ contractId: "SHORT", side: "buy", quantity: 1 }, { contractId: "LONG", side: "sell", quantity: 1 }]);
  const opening = execution.emergencyCloseEligibility(heldBook.positions, [{ contractId: "OTHER", side: "buy", quantity: 1 }]);
  if (!execution.killTriggered(9_199_999, 9_200_000) || execution.killTriggered(9_200_000, 9_200_000) || killPlan.cancel.length !== 1 || killPlan.flatten.length !== 1 || killPlan.residue.length !== 0 || !eligible.eligible || opening.eligible || execution.isBookFlat(heldBook)) throw new Error("sandboxed kill plan or emergency eligibility is wrong");
  paths.push("utcIso<->epochMs, priceEntryLimit(credit vertical) → 198, classifyFillPrice(breach/improved), assembleDecisionSnapshot(ok / null contract refused), buildClaimset+revalidateClaimset(holds / kill crossed), intentDraft+OUTCOME → foldLifecycles(filled), planKillManagement(cancel 1, flatten 1), emergencyCloseEligibility(whole close ok / opening leg refused)");

  // P4 startup core: fail-closed config validation, the canonical-origin rule, the MCP launch/inventory verifiers,
  // the constructed child environment, and the credential-fence classification.
  const startup = await loadModuleGraph(context, path.join(DIST, "core", "startup.js"));
  const expectations = { canonicalTradingOrigin: "https://paper-api.alpaca.markets", alertSlaMs: 3_600_000 };
  const validRaw = {
    EXPECTED_ACCOUNT_ID: "TEST_ONLY_SANDBOX", ALPACA_PROFILE: "dev", ALPACA_TRADING_ORIGIN: "https://paper-api.alpaca.markets",
    STATE_DIR: "C:\\state", BOOTSTRAP_DIAGNOSTIC_SINK: "C:\\sink\\d.jsonl",
    INCOME_BUDGET_CENTS: 1_200_000, CONVEX_BUDGET_CENTS: 800_000, INITIAL_CAPITAL_CENTS: 10_000_000,
    MAX_LOSS_PER_POSITION_BPS: 2_000, MAX_UNDERLYING_EXPOSURE_CENTS: 500_000, MAX_REL_SPREAD_BPS: 500,
    MIN_QUOTE_SIZE: 1, QUOTE_MAX_AGE_MS: 60_000, SNAPSHOT_STALENESS_BOUND_MS: 600_000,
    KILL_EQUITY_THRESHOLD_CENTS: 9_000_000, DEAD_MAN_BOUND_MS: 3_000_000, ALERT_DELIVERY_BUDGET_MS: 600_000,
    CYCLE_INTERVAL_MS: 900_000, UNDERLYING_UNIVERSE: ["SPY"], STRUCTURE_WHITELIST: ["long_option"],
    EXPIRY_MIN_SESSIONS: 2, EXPIRY_MAX_SESSIONS: 10, MAX_STRIKE_DISTANCE_BPS: 1_000, MAX_CANDIDATE_QTY: 5,
    LIMIT_TOLERANCE_CENTS: 5, CLOSE_ESCALATION_STEP_CENTS: 2, RESIDUE_MAX_SESSIONS: 1,
    ANALYST_TIMEOUT_MS: 240_000, CYCLE_WALLTIME_BUDGET_MS: 300_000, LOCK_TAKEOVER_BOUND_MS: 400_000,
    ANALYST_MODEL: "claude-sonnet-5",
    ANALYST_MCP_CAPABILITY_MANIFEST: "config/analyst-mcp-readonly.json", ANALYST_MCP_RUNTIME_LOCK: "config/analyst-runtime-lock.json",
    ANALYST_ALPACA_PROFILE: "dev", QUALIFYING_ACTIVITY_CHECKPOINT: "2026-09-01T20:00:00Z",
    QUALIFICATION_WINDOW_END: "2026-09-02T20:00:00Z", QUALIFICATION_MAX_LOSS_CENTS: 50_000,
    COMPETITION_START: "2026-08-28T15:00:00Z", FLATTEN_DATE: "2026-09-03",
  };
  const armed = startup.validateStartupConfig(validRaw, expectations);
  const refusedProfile = startup.validateStartupConfig({ ...validRaw, ALPACA_PROFILE: "prod" }, expectations);
  const refusedUnknown = startup.validateStartupConfig({ ...validRaw, EXTRA_KNOB: 1 }, expectations);
  const refusedOrigin = startup.validateStartupConfig({ ...validRaw, ALPACA_TRADING_ORIGIN: "https://paper-api.alpaca.markets/" }, expectations);
  const refusedShort = startup.validateStartupConfig({ ...validRaw, STRUCTURE_WHITELIST: ["vertical_credit"] }, expectations);
  if (!armed.ok || refusedProfile.ok || refusedUnknown.ok || refusedOrigin.ok || refusedShort.ok) throw new Error("sandboxed startup validation is wrong");
  if (armed.value.decision.cycleIntervalMs !== 900_000 || armed.value.execution.killEquityThresholdCents !== 9_000_000) throw new Error("sandboxed startup bundle is wrong");
  const sandboxLock = {
    schemaVersion: 1,
    source: { repository: "https://example.invalid/repo.git", commit: "a".repeat(40), package: "alpaca-mcp-server", version: "2.3.0", dependencyLockAtCommit: "uv.lock", dependencySiteSha256: "d".repeat(64) },
    interpreter: { implementation: "CPython", version: "3.14.1", wheelPlatformTag: "win_amd64", launcherSha256: "b".repeat(64), runtimeSha256: "c".repeat(64) },
    installPolicy: { dedicatedEnvironment: true, buildFromPinnedCommit: true, frozenDependencyLock: true, learnHashesFromInstalledEnvironment: false, verifyImmutableSourceAndPackageFilesBeforeSpawn: true, removeBeforeSpawn: ["**/__pycache__/**", "**/*.pyc", "site/bin/**"], requireRemovedFilesAbsentBeforeSpawn: true, disableBytecodeWritesInChild: true },
  };
  const sandboxManifest = { schemaVersion: 1, server: { package: "alpaca-mcp-server", version: "2.3.0", runtimeLock: "lock.json" }, analystProfile: "dev", inventoryPolicy: "exact", alpacaToolsets: ["assets"], allowedTools: ["get_asset", "get_clock"] };
  const lockOk = startup.validateRuntimeLock(sandboxLock);
  const manifestOk = startup.validateAnalystManifest(sandboxManifest);
  if (!lockOk.ok || !manifestOk.ok || !startup.verifyManifestLockAgreement(manifestOk.value, lockOk.value).ok) throw new Error("sandboxed manifest/lock validation is wrong");
  const env = startup.buildAnalystChildEnv(manifestOk.value, { devKeyId: "k", devSecretKey: "s" });
  const observation = {
    sourceRepository: sandboxLock.source.repository, sourceCommit: sandboxLock.source.commit, packageName: "alpaca-mcp-server", packageVersion: "2.3.0",
    dependencyLockMatchesPin: true, dependencyContentMatchesPin: true, interpreterLauncherSha256: sandboxLock.interpreter.launcherSha256, interpreterRuntimeSha256: sandboxLock.interpreter.runtimeSha256,
    hashProvenance: "runtime_lock", immutableFileMismatches: [], bytecodeArtifactsPresent: [], bytecodeWritesDisabled: true, childEnvironment: env,
  };
  const launchOk = startup.verifyMcpLaunch(lockOk.value, observation, []);
  const launchDrift = startup.verifyMcpLaunch(lockOk.value, { ...observation, hashProvenance: "installed_environment" }, []);
  const launchLeak = startup.verifyMcpLaunch(lockOk.value, { ...observation, childEnvironment: { ...env, ALPACA_COMP_KEY_ID: "leak" } }, []);
  const inventoryOk = startup.verifyMcpInventory(manifestOk.value, ["get_asset", "get_clock"]);
  const inventoryExtra = startup.verifyMcpInventory(manifestOk.value, ["get_asset", "get_clock", "place_order"]);
  if (!launchOk.ok || launchDrift.ok || launchLeak.ok || !inventoryOk.ok || inventoryExtra.ok) throw new Error("sandboxed MCP verification is wrong");
  if (startup.classifyBrokerFailure(401) !== "AUTH_FAILURE" || startup.classifyBrokerFailure(403) !== "AUTH_FAILURE" || startup.classifyBrokerFailure(500) !== "WORLD_DEGRADED" || startup.classifyBrokerFailure(null) !== "WORLD_DEGRADED") throw new Error("sandboxed fence classification is wrong");
  const importDraft = startup.importedDiagnosticDraft({ atIso: "2026-08-31T13:30:00.000Z", epoch: 1 }, { at: "2026-08-31T13:00:00.000Z", code: "CONFIG_INVALID_STATE_DIR", detail: "x" });
  const importPlanned = journal.planAppend({ lastSeq: 0, priorIntentRationales: [] }, importDraft, []);
  if (!importPlanned.ok || !startup.redactedViolationSummary(refusedProfile.ok ? [] : refusedProfile.violations).includes("ALPACA_PROFILE:UNKNOWN_PROFILE")) throw new Error("sandboxed startup journal material is wrong");
  paths.push("validateStartupConfig(armed / profile / unknown field / origin lookalike / short-capable without flag), manifest+lock schemas agree, verifyMcpLaunch(ok / self-learned hash / env leak), verifyMcpInventory(exact / extra), classifyBrokerFailure(401/403 fence), importedDiagnosticDraft → valid append");

  // P5 lifecycle core: the deadline regime and entry veto, book classification, bootstrap-versus-gap,
  // the escalation ladder and marketable residue limit, the expiry-hold proof, staleness, and the ping plan.
  const lifecycle = await loadModuleGraph(context, path.join(DIST, "core", "lifecycle.js"));
  if (lifecycle.deadlineRegime("2026-09-02", "2026-09-03") !== "normal" || lifecycle.deadlineRegime("2026-09-03", "2026-09-03") !== "flatten" || lifecycle.deadlineRegime("2026-09-04", "2026-09-03") !== "post_flatten") throw new Error("sandboxed deadline regime is wrong");
  const vetoDeadline = lifecycle.lifecycleEntryVeto(candidate, { regime: "flatten", nextTradingDay: "2026-09-04" });
  const vetoExpiry = lifecycle.lifecycleEntryVeto(candidate, { regime: "normal", nextTradingDay: "2026-09-04" });
  const noVeto = lifecycle.lifecycleEntryVeto(candidate, { regime: "normal", nextTradingDay: "2026-09-01" });
  if (vetoDeadline?.code !== "DEADLINE" || vetoExpiry?.code !== "EXPIRY" || noVeto !== null) throw new Error("sandboxed lifecycle entry veto is wrong");
  const classifiedBook = { ...heldBook, positions: [...heldBook.positions, { contractId: "SPY", quantity: -100, avgEntryPriceCents: 50_000 }, { contractId: "TSLA", quantity: 1, avgEntryPriceCents: 1 }] };
  const classified = lifecycle.classifyBook(classifiedBook, fold.entries, fold.closes, ["entry:x"]);
  const classMap = Object.fromEntries(classified.positions.map(item => [item.contractId, item.class]));
  if (classMap.SHORT !== "MATCHED" || classMap.SPY !== "RESIDUE" || classMap.TSLA !== "HUMAN_ACTION" || classified.orders.some(item => item.clientOrderId === "entry:x" && item.class !== "CONFIRMATION_UNCLEAR")) throw new Error("sandboxed book classification is wrong");
  const bootstrapPlan = lifecycle.planPrimaryEntry({ journalEmpty: true, bookVirgin: true, lastPrimaryAtMs: null, nowMs: ms, cycleIntervalMs: 900_000 });
  const foreignPlan = lifecycle.planPrimaryEntry({ journalEmpty: true, bookVirgin: false, lastPrimaryAtMs: null, nowMs: ms, cycleIntervalMs: 900_000 });
  const gapPlan = lifecycle.planPrimaryEntry({ journalEmpty: false, bookVirgin: true, lastPrimaryAtMs: ms - 3_600_000, nowMs: ms, cycleIntervalMs: 900_000 });
  if (bootstrapPlan.kind !== "BOOTSTRAP" || foreignPlan.kind !== "FOREIGN_BOOK_GAP" || gapPlan.kind !== "GAP") throw new Error("sandboxed primary planning is wrong");
  const escalated = lifecycle.escalateCloseLimit([{ ...legs[0], side: "buy" }, { ...legs[1], side: "sell" }], quotes, 2, 25, lifecycle.closeCapFor(candidate));
  const atCap = lifecycle.escalateCloseLimit([{ ...legs[0], side: "buy" }, { ...legs[1], side: "sell" }], quotes, 2, 300, lifecycle.closeCapFor(candidate));
  const marketable = lifecycle.marketableCloseLimit([{ ...legs[0], side: "buy" }], quotes, 1, 10);
  if (!escalated.ok || escalated.limit.priceCents !== 250 || !atCap.ok || !atCap.atCap || atCap.limit.priceCents !== 500 || !marketable.ok || marketable.limit.priceCents !== 312) throw new Error("sandboxed escalation ladder is wrong");
  const holdProof = lifecycle.evaluateExpiryHold({ contract: { contractId: "LONG", underlying: "SPY", expiry: "2026-09-04", strikeCents: domain.integerUnit(50_500, "StrikeCents"), right: "call" }, quantity: 1, quote: { ...quotes.LONG, bidCents: domain.integerUnit(0, "OptionPriceCents") }, spotCents: 50_000, pairedShortOrLiability: false, exerciseProtectionConfirmed: true }, ms, 60_000);
  const holdRefused = lifecycle.evaluateExpiryHold({ contract: { contractId: "LONG", underlying: "SPY", expiry: "2026-09-04", strikeCents: domain.integerUnit(50_500, "StrikeCents"), right: "call" }, quantity: 1, quote: quotes.LONG, spotCents: 50_000, pairedShortOrLiability: false, exerciseProtectionConfirmed: true }, ms, 60_000);
  if (!holdProof.ok || holdRefused.ok) throw new Error("sandboxed expiry-hold proof is wrong");
  const session = { isTradingDay: true, opensAt: ms - 1_000, closesAt: ms + 1_000 };
  const staleAssessment = lifecycle.assessStaleness(ms, session, ms - 5_000, 3_000);
  const quietAssessment = lifecycle.assessStaleness(ms, { ...session, isTradingDay: false }, ms - 5_000, 3_000);
  const failPing = lifecycle.planPing({ durableAppendLanded: true, alarmConditions: ["X"] });
  const successPing = lifecycle.planPing({ durableAppendLanded: true, alarmConditions: [] });
  if (staleAssessment.kind !== "stale" || quietAssessment.kind !== "quiet" || failPing.kind !== "fail" || successPing.kind !== "success") throw new Error("sandboxed staleness or ping planning is wrong");
  const provenance = lifecycle.validateCompetitionProvenance({ accountRole: "paper", accountId: "TEST_ONLY_SANDBOX", createdAt: "2026-08-28T16:00:00.000Z", openingCashCents: 10_000_000, openingEquityCents: 10_000_000, positionCount: 0, nonTerminalOrderCount: 0, orderHistory: { complete: true, items: 0 }, fillHistory: { complete: true, items: 0 }, activityHistory: { complete: true, items: 0 } }, { expectedAccountId: "TEST_ONLY_SANDBOX", competitionStartMs: execution.utcIsoToEpochMs("2026-08-28T15:00:00.000Z"), initialCapitalCents: 10_000_000 });
  const reused = lifecycle.validateCompetitionProvenance({ accountRole: "paper", accountId: "TEST_ONLY_SANDBOX", createdAt: "2026-08-27T16:00:00.000Z", openingCashCents: 10_000_000, openingEquityCents: 10_000_000, positionCount: 0, nonTerminalOrderCount: 0, orderHistory: { complete: true, items: 0 }, fillHistory: { complete: true, items: 0 }, activityHistory: { complete: true, items: 0 } }, { expectedAccountId: "TEST_ONLY_SANDBOX", competitionStartMs: execution.utcIsoToEpochMs("2026-08-28T15:00:00.000Z"), initialCapitalCents: 10_000_000 });
  if (!provenance.ok || reused.ok || !reused.reuseEvidence) throw new Error("sandboxed provenance proof is wrong");
  paths.push("deadlineRegime(normal/flatten/post), lifecycleEntryVeto(DEADLINE/EXPIRY/none), classifyBook(matched/residue/human/unclear), planPrimaryEntry(bootstrap/foreign/gap), escalateCloseLimit(step / AT cap 500) + marketableCloseLimit(312), evaluateExpiryHold(proof ok / nonzero bid refused), assessStaleness(stale/quiet) + planPing(fail-over-success), validateCompetitionProvenance(virgin ok / reuse flagged)");

  // P6 public-evidence core: the performance projection at an explicit cutoff, the qualification state and its vetoes,
  // the anonymous probe contract, promotion/rollback planning, the push-target check, and the push retry state.
  const projection = await loadModuleGraph(context, path.join(DIST, "core", "projection.js"));
  const qualification = await loadModuleGraph(context, path.join(DIST, "core", "qualification.js"));
  const publish = await loadModuleGraph(context, path.join(DIST, "core", "publish.js"));
  const bootstrapEntry = { seq: 1, at: "2026-08-31T13:30:00.000Z", epoch: 1, type: "BOOTSTRAP", epochSeeded: true, snapshot: { accountId: "TEST_ONLY_SANDBOX", snapshotAt: "2026-08-31T13:30:00.000Z", cashCents: 10_000_000, equityCents: 10_000_000, positions: [], openOrders: [], quoteSamples: {} } };
  const laterCycle = { ...planned.entry, seq: 4, at: "2026-08-31T14:00:00.000Z", snapshot: { ...planned.entry.snapshot, snapshotAt: "2026-08-31T14:00:00.000Z", equityCents: 10_000_500, cashCents: 10_000_500, quoteSamples: { SPY: { SHORT: { bidCents: 300, askCents: 302, bidSize: 20, askSize: 20, quotedAt: "2026-08-31T14:00:00.000Z", brokerQuotedAt: "raw" }, LONG: { bidCents: 100, askCents: 102, bidSize: 20, askSize: 20, quotedAt: "2026-08-31T14:00:00.000Z", brokerQuotedAt: "raw" } } } } };
  const journalForProjection = [bootstrapEntry, { ...planned.entry, seq: 2, at: "2026-08-31T13:31:00.000Z" }, { ...intentPlanned.entry, seq: 3, at: "2026-08-31T13:31:30.000Z" }, { ...outcomePlanned.entry, seq: 5, at: "2026-08-31T13:32:00.000Z" }, laterCycle];
  const expectationsForProjection = { initialCapitalCents: 10_000_000, expectedAccountId: "TEST_ONLY_SANDBOX", flattenDate: "2026-09-03", profile: "dev", qualification: null };
  const projected = projection.projectPerformance(journalForProjection, "rev-sandbox", { at: "2026-08-31T14:00:00.000Z", kind: "presentation" }, expectationsForProjection);
  const cutEarly = projection.projectPerformance(journalForProjection, "rev-sandbox", { at: "2026-08-31T13:31:00.000Z", kind: "presentation" }, expectationsForProjection);
  // The credit vertical filled at 1.98 and marks at 2.00 (mid 3.01 short leg, 1.01 long leg): unrealized -200, so the +500 equity delta leaves +700 unattributed.
  if (projected.startEquityCents !== 10_000_000 || projected.pnlAbsoluteCents !== 500 || projected.realizedCents !== 0 || projected.unrealizedCents !== -200 || projected.unattributedCents !== 700 || projected.lifecycles.length !== 1 || projected.lifecycles[0].resolution !== "filled" || projected.flatState !== "flat") throw new Error("sandboxed performance projection is wrong");
  if (cutEarly.entriesBeyondCutoff !== 3 || cutEarly.lifecycles.length !== 0 || cutEarly.milestones.firstTradeAt !== null || projected.milestones.firstTradeAt === null) throw new Error("sandboxed cutoff rejection is wrong");
  const freshness = projection.assessFreshness("2026-08-31T14:00:00.000Z", execution.utcIsoToEpochMs("2026-08-31T14:10:00.000Z"), 900_000, 3_000_000);
  const staleFreshness = projection.assessFreshness("2026-08-31T14:00:00.000Z", execution.utcIsoToEpochMs("2026-08-31T16:00:00.000Z"), 900_000, 3_000_000);
  if (freshness.state !== "fresh" || staleFreshness.state !== "stale") throw new Error("sandboxed freshness assessment is wrong");
  const qualificationConfig = { checkpointMs: execution.utcIsoToEpochMs("2026-09-01T20:00:00Z"), windowEndMs: execution.utcIsoToEpochMs("2026-09-02T20:00:00Z"), maxLossCents: 50_000 };
  const notDue = qualification.projectQualification(journalForProjection, execution.utcIsoToEpochMs("2026-09-01T19:00:00Z"), qualificationConfig, "competition");
  const atRisk = qualification.projectQualification(journalForProjection, execution.utcIsoToEpochMs("2026-09-01T20:00:00Z"), qualificationConfig, "competition");
  const failed = qualification.projectQualification(journalForProjection, execution.utcIsoToEpochMs("2026-09-02T20:00:00Z"), qualificationConfig, "competition");
  const competitionJournal = journalForProjection.map(entry => (entry.type === "INTENT" ? { ...entry, binding: { ...entry.binding, profile: "competition" } } : entry));
  const qualified = qualification.projectQualification(competitionJournal, execution.utcIsoToEpochMs("2026-09-02T20:00:00Z"), qualificationConfig, "competition");
  if (notDue.state !== "NOT_DUE" || atRisk.state !== "COMPETITIVENESS_AT_RISK" || !atRisk.windowOpen || failed.state !== "WINNING_ACCEPTANCE_FAILED" || qualified.state !== "QUALIFIED" || qualification.projectQualification(journalForProjection, 0, qualificationConfig, "dev").state !== "NOT_APPLICABLE") throw new Error("sandboxed qualification projection is wrong");
  const capVeto = qualification.qualificationEntryVeto({ candidateId: "c", quantity: 1, reservedMaxLossCents: 50_001 }, atRisk, qualificationConfig, 0);
  const lotVeto = qualification.qualificationEntryVeto({ candidateId: "c", quantity: 2, reservedMaxLossCents: 1 }, atRisk, qualificationConfig, 0);
  const liveVeto = qualification.qualificationEntryVeto({ candidateId: "c", quantity: 1, reservedMaxLossCents: 1 }, atRisk, qualificationConfig, 1);
  const noVetoAtCap = qualification.qualificationEntryVeto({ candidateId: "c", quantity: 1, reservedMaxLossCents: 50_000 }, atRisk, qualificationConfig, 0);
  const closedWindow = qualification.qualificationEntryVeto({ candidateId: "c", quantity: 9, reservedMaxLossCents: 9_999_999 }, failed, qualificationConfig, 5);
  if (capVeto?.code !== "QUALIFICATION_CAP" || lotVeto?.code !== "QUALIFICATION_ONE_LOT" || liveVeto?.code !== "QUALIFICATION_ONE_LIVE" || noVetoAtCap !== null || closedWindow !== null) throw new Error("sandboxed qualification vetoes are wrong");
  if (JSON.stringify(qualification.qualificationReasonCodes(atRisk)) !== "[\"COMPETITIVENESS_AT_RISK\"]" || JSON.stringify(qualification.qualificationReasonCodes(failed)) !== "[\"WINNING_ACCEPTANCE_FAILED\"]" || qualification.qualificationReasonCodes(qualified).length !== 0) throw new Error("sandboxed qualification reason codes are wrong");
  const expectation = { journalRevision: "rev-sandbox", cutoffAt: "2026-08-31T14:00:00.000Z", cutoffKind: "presentation", lastUpdatedAt: "2026-08-31T14:00:00.000Z", lastSeq: 4 };
  const meta = publish.expectedMeta(expectation);
  const probeOk = publish.verifyProbe(expectation, { ok: true, httpStatus: 200, meta, authenticated: false });
  const probeMismatch = publish.verifyProbe(expectation, { ok: true, httpStatus: 200, meta: { ...meta, "glass-box-journal-revision": "rev-other" }, authenticated: false });
  const probeAuth = publish.verifyProbe(expectation, { ok: true, httpStatus: 200, meta, authenticated: true });
  const probeDown = publish.verifyProbe(expectation, { ok: false, error: "down" });
  if (!probeOk.ok || probeMismatch.ok || probeAuth.ok || probeDown.ok) throw new Error("sandboxed probe contract is wrong");
  const candidateDeployment = { expectation, candidateUrl: "https://c1.invalid/", deployedAt: "t", probedAt: "t" };
  let deployment = publish.stateAfterPromotion(publish.emptyDeploymentState(), publish.planPromotion(candidateDeployment, probeMismatch, "t"));
  if (deployment.stable !== null || deployment.receipts.length !== 1 || deployment.receipts[0].accepted) throw new Error("sandboxed rejection moved the alias");
  deployment = publish.stateAfterPromotion(deployment, publish.planPromotion(candidateDeployment, probeOk, "t1"));
  deployment = publish.stateAfterPromotion(deployment, publish.planPromotion({ ...candidateDeployment, candidateUrl: "https://c2.invalid/" }, probeOk, "t2"));
  const rollback = publish.planStableVerification(deployment, probeMismatch);
  const keep = publish.planStableVerification(deployment, probeOk);
  if (rollback.kind !== "rollback" || rollback.to.candidateUrl !== "https://c1.invalid/" || keep.kind !== "keep" || publish.stateAfterStableVerification(deployment, rollback, "t3").stable.candidateUrl !== "https://c1.invalid/") throw new Error("sandboxed rollback planning is wrong");
  if (publish.checkPushTarget("journal", "journal").ok !== true || publish.checkPushTarget("journal", "main").ok || publish.checkPushTarget("journal", "refs/heads/journal").ok || publish.checkPushTarget("", "journal").ok) throw new Error("sandboxed push-target check is wrong");
  const pushed = publish.pushStateAfter(publish.emptyPushState(), { ok: false, error: "auth" }, "t");
  const retried = publish.planPush(pushed, "rev-sandbox");
  const settled = publish.pushStateAfter(pushed, { ok: true, revision: "rev-sandbox" }, "t2");
  if (pushed.consecutiveFailures !== 1 || retried.kind !== "push" || settled.consecutiveFailures !== 0 || publish.planPush(settled, "rev-sandbox").kind !== "skip" || !publish.publishDegradation(pushed, "rev-sandbox").degraded || publish.publishDegradation(settled, "rev-sandbox").degraded) throw new Error("sandboxed push retry state is wrong");
  // ---- P7: the S-ARM-01 certificate core and the Alpaca wire mapping ----
  const certificate = await loadModuleGraph(context, path.join(DIST, "core", "certificate.js"));
  const alpaca = await loadModuleGraph(context, path.join(DIST, "core", "alpaca-mapping.js"));
  const sha = await loadModuleGraph(context, path.join(DIST, "core", "sha256.js"));
  if (sha.sha256Text("abc") !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") throw new Error("sandboxed sha256 is wrong");
  const rawConfig = { ALPACA_PROFILE: "dev", EXPECTED_ACCOUNT_ID: "TEST_ONLY_SANDBOX", STATE_DIR: "C:/state", BOOTSTRAP_DIAGNOSTIC_SINK: "C:/sink", ALPACA_TRADING_ORIGIN: "https://paper-api.alpaca.markets", MAX_CANDIDATE_QTY: 5, ANALYST_MODEL: "claude-sonnet-5" };
  const devDigest = certificate.policyDigest(rawConfig, { canonicalTradingOrigin: "https://paper-api.alpaca.markets" });
  const competitionDigest = certificate.policyDigest({ ...rawConfig, ALPACA_PROFILE: "competition", EXPECTED_ACCOUNT_ID: "PA_OTHER", STATE_DIR: "D:/other" }, { canonicalTradingOrigin: "https://paper-api.alpaca.markets" });
  const changedDigest = certificate.policyDigest({ ...rawConfig, MAX_CANDIDATE_QTY: 6 }, { canonicalTradingOrigin: "https://paper-api.alpaca.markets" });
  if (!devDigest.ok || !competitionDigest.ok || !changedDigest.ok || devDigest.digest !== competitionDigest.digest || devDigest.digest === changedDigest.digest || certificate.policyDigest({ ...rawConfig, UNKNOWN: 1 }, { canonicalTradingOrigin: "https://paper-api.alpaca.markets" }).ok) throw new Error("sandboxed policy digest is wrong");
  const analystRuntime = { lockSha256: "a".repeat(64), manifestSha256: "b".repeat(64), sourceRepository: "https://x.invalid/r.git", sourceCommit: "0".repeat(40), packageName: "p", packageVersion: "1", interpreterLauncherSha256: "c".repeat(64), interpreterRuntimeSha256: "d".repeat(64), launchArtifactsSha256: "e".repeat(64) };
  const runtimeA = certificate.runtimeDigest({ files: [{ path: "src/a.ts", sha256: "f".repeat(64) }], analystRuntime });
  const runtimeB = certificate.runtimeDigest({ files: [{ path: "src/a.ts", sha256: "0".repeat(64) }], analystRuntime });
  if (!runtimeA.ok || !runtimeB.ok || runtimeA.digest === runtimeB.digest) throw new Error("sandboxed runtime digest is wrong");
  const emptyCertificate = certificate.buildCertificate({ accountId: "TEST_ONLY_SANDBOX", tradingOrigin: "https://paper-api.alpaca.markets", canonicalTradingOrigin: "https://paper-api.alpaca.markets", window: { startedAt: "2026-09-01T13:35:00.000Z", endedAt: "2026-09-01T15:00:00.000Z" }, runtimeDigest: runtimeA.digest, policyDigest: devDigest.digest, mcpInventoryAccepted: true, journal: [], orderObservations: [], harnessCancels: [], fence: null, finalSnapshot: null });
  const arming = certificate.validateArmingCertificate(emptyCertificate, { runtimeDigest: runtimeA.digest, policyDigest: devDigest.digest, canonicalTradingOrigin: "https://paper-api.alpaca.markets" });
  if (emptyCertificate.verdict !== "FAIL" || emptyCertificate.failures.length < 4 || arming.ok || certificate.successfulDevLiveTestAt(emptyCertificate) !== null) throw new Error("sandboxed certificate evaluation is wrong");
  const mappedOrder = alpaca.mapOrder({ id: "o", client_order_id: "c", status: "accepted", qty: "1", filled_qty: "0", limit_price: "-0.35", submitted_at: "2026-09-01T14:00:00.123456789Z", legs: [{ symbol: "A", side: "sell", ratio_qty: "1" }, { symbol: "B", side: "buy", ratio_qty: "1" }] });
  const request = alpaca.buildOrderRequest({ clientOrderId: "c", quantity: 1, intent: "entry", limit: { kind: "credit", priceCents: 35 }, legs: [{ contractId: "A", side: "sell", ratio: 1 }, { contractId: "B", side: "buy", ratio: 1 }] });
  if (mappedOrder === null || mappedOrder.limit.kind !== "credit" || mappedOrder.limit.priceCents !== 35 || mappedOrder.brokerTimestamps.submitted_at !== "2026-09-01T14:00:00.123Z" || request.limit_price !== "-0.35" || alpaca.dollarsToCents("1.235") !== null || alpaca.dollarsToCentsRounded("1.235") !== 124 || alpaca.mapOrder({ id: "o" }) !== null) throw new Error("sandboxed alpaca mapping is wrong");
  paths.push("sha256Text(abc vector), policyDigest(dev == competition identity / policy change differs / unknown field refused), runtimeDigest(file content change differs), buildCertificate(empty evidence -> FAIL, never arms, no live-test instant), mapOrder(credit sign, nanosecond truncation, malformed null) + buildOrderRequest(negative net credit) + dollarsToCents(exact / rounded)");
  paths.push("projectPerformance(reconciled +500 = -200 unrealized + 700 UNATTRIBUTED / cutoff rejects 3), assessFreshness(fresh/stale), projectQualification(not due / at risk / failed / qualified / n.a.) + qualificationEntryVeto(cap / one lot / one live / at cap ok / closed window none), verifyProbe(ok / mismatch / auth wall / down), planPromotion+planStableVerification(reject keeps alias / rollback to prior), checkPushTarget(exact ref only), planPush+pushStateAfter(retry after failure, skip when pushed)");
  return paths;
}

async function calibrate() {
  // The instrument must catch an impure core: each laundered mutant is executed in the tamed realm and must throw.
  const mutants = [
    ["clock via laundering", "const clock = globalThis['Da' + 'te']; export function now() { return clock.now(); }"],
    ["randomness via computed key", "const m = Math; export function roll() { return m['ran' + 'dom'](); }"],
    ["code generation via constructor", "export function make() { return (function () {}).constructor('return 1')(); }"],
    ["locale via structural type", "export function order(left, right) { return left.localeCompare(right); }"],
    ["mutation of a standard object", "export function poison() { Math.max = () => 0; return Math.max(1, 2); }"],
    ["eval", "export function key() { return eval('1 + 1'); }"],
    ["stack trace observation", "export function trace() { const value = new Error('x').stack; if (typeof value !== 'string') { throw new Error('no stack'); } return value; }"],
    ["alias mutation of an intrinsic", "export function poison() { const m = Math; m.max = () => 0; return m.max(1, 2); }"],
    ["symbol registry", "export function registry() { return Symbol.for('glass-box'); }"],
    ["hidden state on an exported function", "export function counter() { const self = counter; Object.defineProperty(self, 'count', { value: 1, writable: true }); return self.count; }"],
    ["hidden state behind an exported accessor", "let hidden = 0; export const box = { get count() { return ++hidden; } }; export function read() { return box.count; }"],
    ["hidden state on an exported value's prototype", "const proto = {}; export const box = Object.create(proto); export function poison() { proto.count = (proto.count ?? 0) + 1; return proto.count; }"],
    ["hidden state via a setter reached from an export", "let hidden = 0; export const box = { set count(value) { hidden = value; }, get current() { return hidden; } }; export function write() { box.count = 7; return box.current; }"],
    ["hidden state in an exported Map", "export const box = new Map(); export function poison() { box.set('k', (box.get('k') ?? 0) + 1); return box.get('k'); }"],
    ["hidden state in an exported typed array", "export const box = new Uint8Array(1); export function poison() { box[0] += 1; return box[0]; }"],
    ["hidden state in an exported generator object", "function* gen() { let n = 0; while (true) { yield ++n; } } export const box = gen(); export function next() { return box.next().value; }"],
    ["hidden state behind an exported proxy", "let hidden = 0; export const box = new Proxy({}, { get() { return ++hidden; } }); export function read() { return box.count; }"],
    ["hidden state in a toStringTag-spoofed exported Map", "export const box = new Map(); Object.defineProperty(box, Symbol.toStringTag, { value: 'Object' }); export function poison() { box.set('k', (box.get('k') ?? 0) + 1); return box.get('k'); }"],
    ["hidden state in a toStringTag-spoofed exported iterator", "export const box = [1, 2, 3][Symbol.iterator](); Object.defineProperty(box, Symbol.toStringTag, { value: 'Object' }); export function next() { return box.next().value; }"],
  ];
  for (const [name, source] of mutants) {
    const context = createTamedRealm();
    const file = path.join(DIST, "core", `__mutant__${name.replace(/\W+/gu, "-")}.js`);
    let outcome;
    try {
      const namespace = await loadModuleGraph(context, file, new Map([[file, source]]));
      // Call the mutant's function export (not merely its first export): a
      // non-function first export would throw `not a function` and count as a
      // catch the hardening never made.
      const exported = Object.values(namespace).find(candidate => typeof candidate === "function");
      if (exported === undefined) throw new Error("calibration mutant exports no function");
      const value = exported("b", "a");
      outcome = `returned ${String(value)}`;
    } catch (error) {
      outcome = `threw ${error instanceof Error ? error.message : String(error)}`;
    }
    if (!outcome.startsWith("threw")) throw new Error(`sandbox calibration failed: mutant '${name}' ${outcome}`);
  }
  return mutants.length;
}

const mutantsCaught = await calibrate();
const executed = await exerciseCore();
process.stdout.write(`Sandbox gate passed: ${mutantsCaught} impure mutants threw inside the tamed realm; the compiled core executed ${executed.length} paths with no clock, randomness, environment, locale, or code generation:\n${executed.map(line => `  - ${line}`).join("\n")}\n`);
