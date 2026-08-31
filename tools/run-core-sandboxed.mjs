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
// intrinsics, and mutation of the core's exported values (hardened after
// load). It does not observe: unexecuted paths, mutation of non-exported
// module-scope objects inside the core, and any capability not listed here.
// Run with:
//   node --experimental-vm-modules tools/run-core-sandboxed.mjs
// after `npm run build` (dist/core must exist).

import { readFile } from "node:fs/promises";
import path from "node:path";
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
  const cache = new Map();
  async function load(file) {
    const cached = cache.get(file);
    if (cached !== undefined) return cached;
    const source = inlineSources.get(file) ?? await readFile(file, "utf8");
    const module = new vm.SourceTextModule(source, { context, identifier: file });
    cache.set(file, module);
    await module.link(specifier => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw new Error(`core imports a non-relative module: ${specifier}`);
      return load(path.resolve(path.dirname(file), specifier));
    });
    return module;
  }
  const entry = await load(entryFile);
  await entry.evaluate();
  // Harden: every value the loaded graph exports — functions included — is
  // deep-frozen along its data properties *and* its custom prototype chain, so
  // a laundered defineProperty/assign/setPrototypeOf on a core export (or on a
  // prototype reachable from it) throws instead of installing hidden module
  // state. Accessor properties on core-owned values are denied outright: a
  // frozen getter can still close over mutable state. Realm intrinsics are
  // already frozen by the taming and are skipped, not traversed.
  const intrinsics = intrinsicsOf(context);
  const seen = new Set();
  const harden = (value) => {
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value) || intrinsics.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) throw new Error(`export hardening denied accessor property '${String(key)}' on a core-owned value`);
      harden(descriptor.value);
    }
    harden(Object.getPrototypeOf(value));
    try { Object.freeze(value); } catch { /* unfreezable views hold no capability */ }
  };
  for (const module of cache.values()) for (const value of Object.values(module.namespace)) harden(value);
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
  ];
  for (const [name, source] of mutants) {
    const context = createTamedRealm();
    const file = path.join(DIST, "core", `__mutant__${name.replace(/\W+/gu, "-")}.js`);
    let outcome;
    try {
      const namespace = await loadModuleGraph(context, file, new Map([[file, source]]));
      const exported = Object.values(namespace)[0];
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
