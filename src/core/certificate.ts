// Pure S-ARM-01 core (P7): the versioned configuration field classification,
// the role-neutral policy digest and the runtime digest, the extraction of
// certificate evidence from journal entries plus the driver's broker
// observations, the PASS/FAIL evaluation, and the arming-time validation of a
// certificate against the deployment's digests. Everything is a decision over
// data the shell hands in; the shell reads files, hashes nothing itself, and
// writes the certificate the core produced.
import { utcIsoToEpochMs } from "./execution.js";
import type { BrokerOrderRecord, BrokerPosition } from "./execution.js";
import type { JournalEntry } from "./journal.js";
import { sha256Text } from "./sha256.js";

type Raw = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Field classification (versioned; every known field has exactly one class)
// ---------------------------------------------------------------------------

export const CONFIG_FIELD_CLASSIFICATION_VERSION = 1;

export type ConfigFieldClass = "policy" | "identity" | "deployment";

/**
 * The closed classification. `identity` is the S-ARM-01 exclusion set
 * (`ALPACA_PROFILE`, `EXPECTED_ACCOUNT_ID`; credentials never enter the
 * config record at all). `deployment` names the host-local locations that
 * differ between the dev run and the competition deployment on purpose
 * (DECISIONS.md P7: the competition journal must not inherit the dev journal,
 * so `STATE_DIR` cannot be policy). Everything else is role-neutral policy.
 */
export function configFieldClassification(): Readonly<Record<string, ConfigFieldClass>> {
  return {
    ALPACA_PROFILE: "identity",
    EXPECTED_ACCOUNT_ID: "identity",
    STATE_DIR: "deployment",
    BOOTSTRAP_DIAGNOSTIC_SINK: "deployment",
    PRE_ARM_CERTIFICATE: "deployment",
    ALPACA_TRADING_ORIGIN: "policy",
    INCOME_BUDGET_CENTS: "policy",
    CONVEX_BUDGET_CENTS: "policy",
    INITIAL_CAPITAL_CENTS: "policy",
    MAX_LOSS_PER_POSITION_BPS: "policy",
    MAX_UNDERLYING_EXPOSURE_CENTS: "policy",
    MAX_REL_SPREAD_BPS: "policy",
    MIN_QUOTE_SIZE: "policy",
    QUOTE_MAX_AGE_MS: "policy",
    SNAPSHOT_STALENESS_BOUND_MS: "policy",
    KILL_EQUITY_THRESHOLD_CENTS: "policy",
    DEAD_MAN_BOUND_MS: "policy",
    ALERT_DELIVERY_BUDGET_MS: "policy",
    CYCLE_INTERVAL_MS: "policy",
    UNDERLYING_UNIVERSE: "policy",
    STRUCTURE_WHITELIST: "policy",
    EXPIRY_MIN_SESSIONS: "policy",
    EXPIRY_MAX_SESSIONS: "policy",
    MAX_STRIKE_DISTANCE_BPS: "policy",
    MAX_CANDIDATE_QTY: "policy",
    LIMIT_TOLERANCE_CENTS: "policy",
    CLOSE_ESCALATION_STEP_CENTS: "policy",
    RESIDUE_MAX_SESSIONS: "policy",
    ANALYST_TIMEOUT_MS: "policy",
    CYCLE_WALLTIME_BUDGET_MS: "policy",
    LOCK_TAKEOVER_BOUND_MS: "policy",
    ANALYST_MCP_CAPABILITY_MANIFEST: "policy",
    ANALYST_MCP_RUNTIME_LOCK: "policy",
    ANALYST_ALPACA_PROFILE: "policy",
    QUALIFYING_ACTIVITY_CHECKPOINT: "policy",
    QUALIFICATION_WINDOW_END: "policy",
    QUALIFICATION_MAX_LOSS_CENTS: "policy",
    COMPETITION_START: "policy",
    FLATTEN_DATE: "policy",
    SHORT_ASSIGNMENT_CAPABILITY: "policy",
  };
}

export type ClassifiedConfig =
  | { readonly ok: true; readonly policy: Raw; readonly identity: Raw; readonly deployment: Raw }
  | { readonly ok: false; readonly unknownFields: readonly string[] };

/** Unknown fields are rejected, never silently assigned (WIN-17): a field the schema does not name cannot enter or escape the digest. */
export function classifyConfig(raw: Raw): ClassifiedConfig {
  const classification = configFieldClassification();
  const policy: Record<string, unknown> = {};
  const identity: Record<string, unknown> = {};
  const deployment: Record<string, unknown> = {};
  const unknownFields: string[] = [];
  for (const field of Object.keys(raw)) {
    const kind = Object.hasOwn(classification, field) ? classification[field] : undefined;
    if (kind === undefined) unknownFields.push(field);
    else if (kind === "policy") policy[field] = raw[field];
    else if (kind === "identity") identity[field] = raw[field];
    else deployment[field] = raw[field];
  }
  if (unknownFields.length > 0) return { ok: false, unknownFields };
  return { ok: true, policy, identity, deployment };
}

/** True when a value tree contains `undefined`, `NaN`, or an infinity: such material has no canonical form and is refused, never coerced to null. */
export function containsNonCanonical(value: unknown): boolean {
  if (value === undefined || value === null) return value === undefined;
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string" || typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.some(containsNonCanonical);
  // Boxed primitives, dates, maps, class instances: only a plain record or array has a canonical form.
  if (!isRecord(value)) return true;
  // A boxed primitive or a Date unwraps to something other than itself; an object without own keys that does not
  // serialize as `{}` is not a plain record either. (A Map or Set serializes as `{}` exactly as JSON.stringify would;
  // such values cannot arrive from a JSON-loaded policy and are not distinguished here without reflection.)
  const unwrapped = (value as { readonly valueOf?: () => unknown }).valueOf;
  if (typeof unwrapped === "function" && unwrapped.call(value) !== value) return true;
  // Digest material admits no empty object: a Map, Set, RegExp, or symbol-keyed object shows no own string keys and
  // would otherwise canonicalize as `{}` exactly like an empty record; refusing every keyless object closes that
  // class without reflection (gate finding G4-K3, P7). No legitimate policy or evidence value is an empty object.
  if (Object.keys(value).length === 0) return true;
  return Object.values(value).some(containsNonCanonical);
}

/** Canonical JSON: object keys sorted recursively, arrays in order, no whitespace. Throws on `undefined` (callers refuse first). */
export function canonicalJson(value: unknown): string {
  if (containsNonCanonical(value)) throw new RangeError("undefined, non-finite numbers, functions, and boxed or exotic objects have no canonical JSON form");
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type DigestResult = { readonly ok: true; readonly digest: string; readonly material: string } | { readonly ok: false; readonly reason: string };

/** The role-neutral policy digest: version + every policy field, canonical, hashed. Identity and deployment fields never enter. */
export function policyDigest(raw: Raw, expectations: { readonly canonicalTradingOrigin: string }): DigestResult {
  const classified = classifyConfig(raw);
  if (!classified.ok) return { ok: false, reason: `unknown configuration field(s): ${classified.unknownFields.join(", ")}` };
  const origin = classified.policy["ALPACA_TRADING_ORIGIN"];
  if (origin !== expectations.canonicalTradingOrigin) return { ok: false, reason: "the policy origin is not the canonical paper trading origin" };
  if (containsNonCanonical(classified.policy)) return { ok: false, reason: "a policy field has no canonical value; undefined and non-finite numbers never enter the digest" };
  const material = canonicalJson({ fieldClassificationVersion: CONFIG_FIELD_CLASSIFICATION_VERSION, policy: classified.policy });
  return { ok: true, digest: sha256Text(material), material };
}

export interface RuntimeDigestInput {
  /** Repository-relative path and the SHA-256 of the LF-normalized content, for every executable/schema/lock file. */
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  readonly analystRuntime: {
    readonly lockSha256: string;
    readonly manifestSha256: string;
    readonly sourceRepository: string;
    readonly sourceCommit: string;
    readonly packageName: string;
    readonly packageVersion: string;
    readonly interpreterLauncherSha256: string;
    readonly interpreterRuntimeSha256: string;
    /** Digest over every verified immutable launch artifact (the installed package files), computed by the shell over content. */
    readonly launchArtifactsSha256: string;
  };
}

function isUtcIso(value: unknown): value is string {
  return typeof value === "string" && utcIsoToEpochMs(value) !== null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Raw {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

type FieldKind = "string" | "instant" | "integer" | "boolean" | "strings";

/** The exact typed shape of every evidence clause; `instant` fields must parse and lie inside the certificate window at arming. */
function evidenceClauseShapes(): Readonly<Record<string, Readonly<Record<string, FieldKind>>>> {
  return {
    liquidity: { contractId: "string", bidCents: "integer", askCents: "integer", bidSize: "integer", askSize: "integer", quotedAt: "instant", brokerQuotedAt: "string", snapshotSeq: "integer" },
    creditAcceptance: { clientOrderId: "string", exposureLifecycleId: "string", intentSeq: "integer", brokerOrderId: "string", acceptedStatus: "string", acceptedAt: "instant", terminalStatus: "string", terminalAt: "instant", outcomeSeq: "integer", harnessRequestedCancel: "boolean" },
    fill: { clientOrderId: "string", brokerOrderId: "string", filledQuantity: "integer", avgFillPriceCents: "integer", filledAt: "instant", outcomeSeq: "integer", reconciledSnapshotSeq: "integer" },
    fence: { httpStatus: "integer", haltSeq: "integer", unhaltSeq: "integer", workingOrdersAtFence: "strings", canceledAtFence: "strings" },
    finalSnapshot: { at: "instant", accountId: "string", cashCents: "integer", equityCents: "integer", positionCount: "integer", nonTerminalOrderCount: "integer", orderPagesFetched: "integer", pagesComplete: "boolean" },
  };
}

function clauseViolations(clause: string, value: unknown, shape: Readonly<Record<string, FieldKind>>, window: { readonly startMs: number; readonly endMs: number } | null): readonly string[] {
  if (!hasExactKeys(value, Object.keys(shape))) return [`certificate ${clause} evidence is absent or malformed`];
  const out: string[] = [];
  for (const [field, kind] of Object.entries(shape)) {
    const item = value[field];
    const ok = kind === "string" ? typeof item === "string"
      : kind === "integer" ? Number.isSafeInteger(item)
      : kind === "boolean" ? typeof item === "boolean"
      : kind === "strings" ? Array.isArray(item) && item.every(entry => typeof entry === "string")
      : instantOf(item) !== null;
    if (!ok) out.push(`certificate ${clause}.${field} has the wrong type`);
    else if (kind === "instant" && window !== null) {
      const ms = instantOf(item) ?? 0;
      if (ms < window.startMs || ms > window.endMs) out.push(`certificate ${clause}.${field} lies outside the certificate window`);
    }
  }
  return out;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function runtimeDigest(input: RuntimeDigestInput): DigestResult {
  if (input.files.length === 0) return { ok: false, reason: "no executable files were enumerated" };
  const paths = new Set<string>();
  for (const file of input.files) {
    if (paths.has(file.path)) return { ok: false, reason: `duplicate file path: ${file.path}` };
    if (!isSha256(file.sha256)) return { ok: false, reason: `malformed digest for ${file.path}` };
    paths.add(file.path);
  }
  const runtime = input.analystRuntime;
  const digests: Readonly<Record<string, string>> = { lockSha256: runtime.lockSha256, manifestSha256: runtime.manifestSha256, interpreterLauncherSha256: runtime.interpreterLauncherSha256, interpreterRuntimeSha256: runtime.interpreterRuntimeSha256, launchArtifactsSha256: runtime.launchArtifactsSha256 };
  for (const [name, value] of Object.entries(digests)) {
    if (!isSha256(value)) return { ok: false, reason: `malformed analyst runtime digest: ${name}` };
  }
  if (containsNonCanonical(runtime) || Object.values(runtime).some(value => typeof value !== "string" || value.length === 0)) return { ok: false, reason: "every analyst runtime identity field must be a non-empty string" };
  const files = [...input.files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const material = canonicalJson({ version: 1, files, analystRuntime: runtime });
  return { ok: true, digest: sha256Text(material), material };
}

// ---------------------------------------------------------------------------
// Certificate schema
// ---------------------------------------------------------------------------

export const CERTIFICATE_SCHEMA_VERSION = 1;

export interface LiquidityInputEvidence {
  readonly contractId: string;
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidSize: number;
  readonly askSize: number;
  readonly quotedAt: string;
  readonly brokerQuotedAt: string;
  /** The CYCLE entry whose snapshot carried this sample into the gate. */
  readonly snapshotSeq: number;
}

export interface CreditAcceptanceEvidence {
  readonly clientOrderId: string;
  readonly exposureLifecycleId: string;
  readonly intentSeq: number;
  readonly brokerOrderId: string;
  readonly acceptedStatus: string;
  readonly acceptedAt: string;
  readonly terminalStatus: "filled" | "canceled";
  readonly terminalAt: string;
  readonly outcomeSeq: number;
  readonly harnessRequestedCancel: boolean;
}

export interface FillEvidence {
  readonly clientOrderId: string;
  readonly brokerOrderId: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number;
  readonly filledAt: string;
  readonly outcomeSeq: number;
  /** The later snapshot-bearing entry whose broker positions reflect the filled legs. */
  readonly reconciledSnapshotSeq: number;
}

export interface FenceDrillEvidence {
  readonly httpStatus: number;
  readonly haltSeq: number;
  readonly unhaltSeq: number;
  readonly workingOrdersAtFence: readonly string[];
  readonly canceledAtFence: readonly string[];
}

export interface FinalSnapshotEvidence {
  readonly at: string;
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positionCount: number;
  readonly nonTerminalOrderCount: number;
  readonly orderPagesFetched: number;
  readonly pagesComplete: boolean;
}

/** The digest a certificate carries over its own account, window, digests, inventory flag, and evidence: any later edit of the file breaks it. */
export function certificateEvidenceDigest(certificate: Omit<PreArmCertificate, "evidenceDigest" | "verdict" | "failures">): string {
  return sha256Text(canonicalJson({ schemaVersion: certificate.schemaVersion, role: certificate.role, accountId: certificate.accountId, tradingOrigin: certificate.tradingOrigin, window: certificate.window, runtimeDigest: certificate.runtimeDigest, policyDigest: certificate.policyDigest, fieldClassificationVersion: certificate.fieldClassificationVersion, mcpInventoryAccepted: certificate.mcpInventoryAccepted, evidence: certificate.evidence }));
}

export interface PreArmCertificate {
  readonly schemaVersion: 1;
  readonly verdict: "PASS" | "FAIL";
  readonly role: "dev";
  readonly accountId: string;
  readonly tradingOrigin: string;
  readonly window: { readonly startedAt: string; readonly endedAt: string };
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly fieldClassificationVersion: number;
  readonly mcpInventoryAccepted: boolean;
  readonly evidence: {
    readonly liquidity: readonly LiquidityInputEvidence[];
    readonly creditAcceptance: CreditAcceptanceEvidence | null;
    readonly fill: FillEvidence | null;
    readonly fence: FenceDrillEvidence | null;
    readonly finalSnapshot: FinalSnapshotEvidence | null;
  };
  readonly failures: readonly string[];
  /** `certificateEvidenceDigest` of everything above except verdict and failures. */
  readonly evidenceDigest: string;
}

/** `successful_dev_live_test_at`: exists only inside a PASS certificate (S-ARM-01). */
export function successfulDevLiveTestAt(certificate: PreArmCertificate): string | null {
  return certificate.verdict === "PASS" ? certificate.window.endedAt : null;
}

// ---------------------------------------------------------------------------
// Evidence extraction from the journal and the driver's broker observations
// ---------------------------------------------------------------------------

export interface OrderObservation {
  readonly observedAt: string;
  readonly order: BrokerOrderRecord;
}

export interface FenceObservation {
  readonly httpStatus: number;
  readonly workingOrdersAtFence: readonly string[];
  readonly canceledAtFence: readonly string[];
}

export interface FinalSnapshotObservation {
  readonly at: string;
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positions: readonly BrokerPosition[];
  readonly nonTerminalOrders: readonly string[];
  readonly orderPagesFetched: number;
  readonly pagesComplete: boolean;
}

export interface CertificateInputs {
  readonly accountId: string;
  readonly tradingOrigin: string;
  readonly canonicalTradingOrigin: string;
  readonly window: { readonly startedAt: string; readonly endedAt: string };
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly mcpInventoryAccepted: boolean;
  readonly journal: readonly JournalEntry[];
  readonly orderObservations: readonly OrderObservation[];
  readonly harnessCancels: readonly string[];
  readonly fence: FenceObservation | null;
  readonly finalSnapshot: FinalSnapshotObservation | null;
}

/**
 * The broker states that prove acceptance. A `filled` or `partially_filled`
 * record proves it too: the broker cannot fill what it did not accept, and a
 * fast fill can precede the driver's first observation (DECISIONS.md P7).
 */
function positiveAcceptanceStatuses(): readonly string[] {
  return ["new", "accepted", "open", "pending_new", "partially_filled", "filled"];
}

function fullLegsOf(entry: JournalEntry): readonly { readonly contractId: string; readonly side: string; readonly underlying: string; readonly expiry: string; readonly right: string; readonly ratio: number }[] {
  const legs = entry["legs"];
  if (!Array.isArray(legs)) return [];
  return legs.flatMap(leg => (isRecord(leg) && typeof leg["contractId"] === "string" && typeof leg["side"] === "string" && typeof leg["underlying"] === "string" && typeof leg["expiry"] === "string" && typeof leg["right"] === "string" && Number.isSafeInteger(leg["ratio"]) && (leg["ratio"] as number) > 0 ? [{ contractId: leg["contractId"], side: leg["side"], underlying: leg["underlying"], expiry: leg["expiry"], right: leg["right"], ratio: leg["ratio"] as number }] : []));
}

function legsOf(entry: JournalEntry): readonly { readonly contractId: string; readonly side: string }[] {
  const legs = entry["legs"];
  if (!Array.isArray(legs)) return [];
  return legs.flatMap(leg => (isRecord(leg) && typeof leg["contractId"] === "string" && typeof leg["side"] === "string" ? [{ contractId: leg["contractId"], side: leg["side"] }] : []));
}

function snapshotOf(entry: JournalEntry): Raw | null {
  const snapshot = entry["snapshot"];
  return isRecord(snapshot) ? snapshot : null;
}

function gatePassed(entry: JournalEntry, gate: string): boolean {
  const vector = entry["gateVector"];
  if (!Array.isArray(vector)) return false;
  return vector.some(item => isRecord(item) && item["gate"] === gate && item["passed"] === true);
}

function instantOf(value: unknown): number | null {
  return typeof value === "string" ? utcIsoToEpochMs(value) : null;
}

/** A broker quote timestamp (nanoseconds, `Z`) reduced to the core's millisecond grammar; anything else is null. */
function brokerInstantToIso(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (match === null) return null;
  const iso = `${match[1] as string}.${(match[2] ?? "").slice(0, 3).padEnd(3, "0")}Z`;
  return utcIsoToEpochMs(iso) === null ? null : iso;
}

/** Every evidence instant must lie inside the test window; an instant that cannot be parsed is outside by definition. */
function outsideWindow(window: { readonly startedAt: string; readonly endedAt: string }, ...instants: readonly (string | undefined)[]): boolean {
  const start = instantOf(window.startedAt);
  const end = instantOf(window.endedAt);
  if (start === null || end === null) return true;
  return instants.some(instant => {
    const ms = instantOf(instant);
    return ms === null || ms < start || ms > end;
  });
}

function isEntryIntent(entry: JournalEntry): boolean {
  return entry.type === "INTENT" && (entry["action"] === "entry" || entry["action"] === undefined);
}

function liquidityFor(entry: JournalEntry, journal: readonly JournalEntry[]): readonly LiquidityInputEvidence[] {
  // The CYCLE/BOOTSTRAP entry immediately preceding the INTENT in the same invocation carries the snapshot the gate consumed.
  const preceding = journal.filter(item => item.seq < entry.seq && (item.type === "CYCLE" || item.type === "BOOTSTRAP") && snapshotOf(item) !== null).sort((a, b) => b.seq - a.seq)[0];
  if (preceding === undefined) return [];
  const samples = snapshotOf(preceding)?.["quoteSamples"];
  if (!isRecord(samples)) return [];
  const out: LiquidityInputEvidence[] = [];
  const covered = new Set<string>();
  for (const leg of legsOf(entry)) {
    if (covered.has(leg.contractId)) continue;
    for (const byContract of Object.values(samples)) {
      if (!isRecord(byContract) || covered.has(leg.contractId)) continue;
      const sample = byContract[leg.contractId];
      if (!isRecord(sample)) continue;
      const { bidCents, askCents, bidSize, askSize, quotedAt, brokerQuotedAt } = sample;
      if (typeof bidCents === "number" && typeof askCents === "number" && typeof bidSize === "number" && typeof askSize === "number" && typeof quotedAt === "string" && typeof brokerQuotedAt === "string") {
        out.push({ contractId: leg.contractId, bidCents, askCents, bidSize, askSize, quotedAt, brokerQuotedAt, snapshotSeq: preceding.seq });
        covered.add(leg.contractId);
      }
    }
  }
  return out;
}

/**
 * The defined-risk shape of an entry INTENT: at least two legs on one underlying and one expiry, the total bought
 * ratio equal to the total sold ratio, and per right no more sold than bought (exact integer sums; G4-K5, G5-L5).
 */
function definedRiskShape(entry: JournalEntry): boolean {
  const legs = fullLegsOf(entry);
  const ratioOf = (side: string, right: string | null): bigint => legs.filter(leg => leg.side === side && (right === null || leg.right === right)).reduce((sum, leg) => sum + BigInt(leg.ratio), 0n);
  const buys = ratioOf("buy", null);
  const sells = ratioOf("sell", null);
  const oneUnderlying = new Set(legs.map(leg => leg.underlying)).size === 1;
  const oneExpiry = new Set(legs.map(leg => leg.expiry)).size === 1;
  const coveredPerRight = ["call", "put"].every(right => ratioOf("sell", right) <= ratioOf("buy", right));
  return legs.length >= 2 && buys > 0n && sells > 0n && buys === sells && oneUnderlying && oneExpiry && coveredPerRight;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function creditAcceptanceFrom(inputs: CertificateInputs, failures: string[]): CreditAcceptanceEvidence | null {
  const intents = inputs.journal.filter(entry => isEntryIntent(entry) && isRecord(entry["submittedLimit"]) && entry["submittedLimit"]["kind"] === "credit");
  if (intents.length === 0) {
    failures.push("no credit entry INTENT was journaled");
    return null;
  }
  for (const intent of intents) {
    const clientOrderId = intent["clientOrderId"];
    if (typeof clientOrderId !== "string") continue;
    if (!definedRiskShape(intent)) {
      failures.push(`credit lifecycle ${clientOrderId}: a credit structure without a bought protective leg on the same underlying and expiry, one per sold leg, is not defined-risk`);
      return null;
    }
    if (!gatePassed(intent, "G1")) {
      failures.push(`credit lifecycle ${clientOrderId}: the INTENT does not carry a passed G1 defined-risk verdict`);
      return null;
    }
    const observations = inputs.orderObservations.filter(item => item.order.clientOrderId === clientOrderId);
    const submittedInstants = new Set(observations.map(item => item.order.brokerTimestamps["submitted_at"]).filter((value): value is string => value !== undefined));
    if (submittedInstants.size > 1) {
      failures.push(`credit lifecycle ${clientOrderId}: the broker observations disagree on the submission instant`);
      return null;
    }
    const accepted = observations.find(item => positiveAcceptanceStatuses().includes(item.order.status));
    const outcome = inputs.journal.filter(entry => entry.type === "OUTCOME" && entry.seq > intent.seq && entry["clientOrderId"] === clientOrderId).sort((a, b) => b.seq - a.seq)[0];
    if (outcome !== undefined && outcome["status"] === "rejected") {
      failures.push(`credit lifecycle ${clientOrderId} was rejected by the broker`);
      return null;
    }
    if (accepted === undefined || outcome === undefined) continue;
    const terminal = outcome["status"];
    if (terminal !== "filled" && terminal !== "canceled") continue;
    const harnessRequestedCancel = inputs.harnessCancels.includes(clientOrderId);
    if (terminal === "canceled" && !harnessRequestedCancel) {
      failures.push(`credit lifecycle ${clientOrderId} was canceled without a harness request`);
      return null;
    }
    const brokerOrderId = typeof outcome["brokerOrderId"] === "string" ? outcome["brokerOrderId"] : accepted.order.brokerOrderId;
    const timestamps = isRecord(outcome["brokerTimestamps"]) ? outcome["brokerTimestamps"] : {};
    const terminalField = terminal === "filled" ? "filled_at" : "canceled_at";
    const terminalAt = typeof timestamps[terminalField] === "string" ? timestamps[terminalField] : null;
    const acceptedAt = accepted.order.brokerTimestamps["submitted_at"] ?? null;
    if (terminalAt === null || acceptedAt === null) {
      failures.push(`credit lifecycle ${clientOrderId}: the broker's submission and terminal timestamps are required evidence; local times do not substitute`);
      return null;
    }
    const acceptedMs = instantOf(acceptedAt);
    const terminalMs = instantOf(terminalAt);
    if (acceptedMs === null || terminalMs === null || acceptedMs > terminalMs) {
      failures.push(`credit lifecycle ${clientOrderId}: the acceptance instant ${acceptedAt} does not precede the terminal instant ${terminalAt}`);
      return null;
    }
    if (outsideWindow(inputs.window, intent.at, outcome.at, acceptedAt, terminalAt)) {
      failures.push(`credit lifecycle ${clientOrderId}: its instants lie outside the test window`);
      return null;
    }
    return {
      clientOrderId,
      exposureLifecycleId: typeof intent["exposureLifecycleId"] === "string" ? intent["exposureLifecycleId"] : "",
      intentSeq: intent.seq,
      brokerOrderId,
      acceptedStatus: accepted.order.status,
      acceptedAt,
      terminalStatus: terminal,
      terminalAt,
      outcomeSeq: outcome.seq,
      harnessRequestedCancel,
    };
  }
  failures.push("no credit entry lifecycle reached a positive broker acceptance followed by a filled or harness-canceled OUTCOME");
  return null;
}

function fillFrom(inputs: CertificateInputs, failures: string[]): FillEvidence | null {
  const fills = inputs.journal.filter(entry => entry.type === "OUTCOME" && entry["status"] === "filled" && typeof entry["filledQuantity"] === "number" && entry["filledQuantity"] > 0 && typeof entry["avgFillPriceCents"] === "number");
  for (const fill of fills) {
    const clientOrderId = fill["clientOrderId"];
    if (typeof clientOrderId !== "string") continue;
    const intent = inputs.journal.find(entry => isEntryIntent(entry) && entry.seq < fill.seq && entry["clientOrderId"] === clientOrderId);
    if (intent === undefined) continue;
    // The filled entry must itself be a defined-risk, G1-passed structure (G5-L2): an unrelated naked fill is no evidence.
    if (!definedRiskShape(intent) || !gatePassed(intent, "G1")) continue;
    const legs = legsOf(intent);
    if (legs.length === 0) continue;
    // Reconciliation: a later snapshot-bearing entry whose broker positions carry every filled leg with the sign its side implies.
    const later = inputs.journal.filter(entry => entry.seq > fill.seq && snapshotOf(entry) !== null).find(entry => {
      const positions = snapshotOf(entry)?.["positions"];
      if (!Array.isArray(positions)) return false;
      return legs.every(leg => positions.some(position => isRecord(position) && position["contractId"] === leg.contractId && typeof position["quantity"] === "number" && (leg.side === "sell" ? position["quantity"] < 0 : position["quantity"] > 0)));
    });
    if (later === undefined) continue;
    const timestamps = isRecord(fill["brokerTimestamps"]) ? fill["brokerTimestamps"] : {};
    const filledAtInstant = typeof timestamps["filled_at"] === "string" ? timestamps["filled_at"] : null;
    if (filledAtInstant === null || !nonBlank(fill["brokerOrderId"])) continue;
    if (outsideWindow(inputs.window, intent.at, fill.at, filledAtInstant, later.at)) continue;
    return {
      clientOrderId,
      brokerOrderId: fill["brokerOrderId"],
      filledQuantity: fill["filledQuantity"] as number,
      avgFillPriceCents: fill["avgFillPriceCents"] as number,
      filledAt: filledAtInstant,
      outcomeSeq: fill.seq,
      reconciledSnapshotSeq: later.seq,
    };
  }
  failures.push("no minimal defined-risk entry was filled and reconciled through a later broker snapshot");
  return null;
}

function fenceFrom(inputs: CertificateInputs, failures: string[]): FenceDrillEvidence | null {
  if (inputs.fence === null) {
    failures.push("the credential-fence drill was not performed");
    return null;
  }
  if (inputs.fence.httpStatus !== 401 && inputs.fence.httpStatus !== 403) failures.push(`the fence drill observed HTTP ${String(inputs.fence.httpStatus)}, not a 401/403 credential rejection`);
  const halt = inputs.journal.find(entry => entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE");
  if (halt === undefined) {
    failures.push("no AUTH_FAILURE halt was journaled by the fence drill");
    return null;
  }
  const unhalt = inputs.journal.find(entry => entry.type === "UNHALT" && entry.seq > halt.seq);
  if (unhalt === undefined) {
    failures.push("the AUTH_FAILURE halt was not cleared by the documented fence procedure (manual un-halt after reconciliation)");
    return null;
  }
  if (outsideWindow(inputs.window, halt.at, unhalt.at)) {
    failures.push("the fence drill's halt and un-halt lie outside the test window");
    return null;
  }
  return { httpStatus: inputs.fence.httpStatus, haltSeq: halt.seq, unhaltSeq: unhalt.seq, workingOrdersAtFence: inputs.fence.workingOrdersAtFence, canceledAtFence: inputs.fence.canceledAtFence };
}

function finalSnapshotFrom(inputs: CertificateInputs, failures: string[]): FinalSnapshotEvidence | null {
  const snapshot = inputs.finalSnapshot;
  if (snapshot === null) {
    failures.push("no final fully paginated dev snapshot was taken");
    return null;
  }
  const evidence: FinalSnapshotEvidence = {
    at: snapshot.at,
    accountId: snapshot.accountId,
    cashCents: snapshot.cashCents,
    equityCents: snapshot.equityCents,
    positionCount: snapshot.positions.filter(position => position.quantity !== 0).length,
    nonTerminalOrderCount: snapshot.nonTerminalOrders.length,
    orderPagesFetched: snapshot.orderPagesFetched,
    pagesComplete: snapshot.pagesComplete,
  };
  if (snapshot.accountId !== inputs.accountId) failures.push("the final snapshot reports a different account than the certificate binds");
  if (outsideWindow(inputs.window, snapshot.at)) failures.push("the final snapshot lies outside the test window");
  if (!snapshot.pagesComplete) failures.push("the final order history pagination is incomplete");
  if (evidence.positionCount !== 0) failures.push(`the final snapshot holds ${String(evidence.positionCount)} open position(s)`);
  if (evidence.nonTerminalOrderCount !== 0) failures.push(`the final snapshot holds ${String(evidence.nonTerminalOrderCount)} non-terminal order(s)`);
  return evidence;
}

/** Build the certificate: every S-ARM-01 clause is either evidenced or named as a failure; the verdict is PASS only with zero failures. */
export function buildCertificate(inputs: CertificateInputs): PreArmCertificate {
  const failures: string[] = [];
  if (inputs.tradingOrigin !== inputs.canonicalTradingOrigin) failures.push("the trading origin is not the canonical paper origin");
  if (inputs.accountId.length === 0) failures.push("the dev account ID is empty");
  if (!inputs.mcpInventoryAccepted) failures.push("the pinned MCP runtime/inventory verification did not pass");
  const windowStart = instantOf(inputs.window.startedAt);
  const windowEnd = instantOf(inputs.window.endedAt);
  if (windowStart === null || windowEnd === null || !(windowStart < windowEnd)) failures.push("the test window is not a pair of ordered UTC instants");
  if (!isSha256(inputs.runtimeDigest)) failures.push("runtimeDigest is malformed");
  if (!isSha256(inputs.policyDigest)) failures.push("policyDigest is malformed");
  for (const entry of inputs.journal) {
    if (entry.type === "OUTCOME" && entry["status"] === "rejected") failures.push(`OUTCOME seq ${String(entry.seq)} (${String(entry["clientOrderId"])}) is a broker rejection`);
  }

  const creditAcceptance = creditAcceptanceFrom(inputs, failures);
  const fill = fillFrom(inputs, failures);
  const intentForLiquidity = creditAcceptance === null ? undefined : inputs.journal.find(entry => entry.seq === creditAcceptance.intentSeq);
  const liquidity = intentForLiquidity === undefined ? [] : liquidityFor(intentForLiquidity, inputs.journal);
  if (intentForLiquidity !== undefined) {
    if (!gatePassed(intentForLiquidity, "G5")) failures.push("the credit INTENT does not carry a passed G5 liquidity verdict");
    const snapshotEntry = liquidity[0] === undefined ? undefined : inputs.journal.find(entry => entry.seq === liquidity[0]?.snapshotSeq);
    if (snapshotEntry !== undefined && outsideWindow(inputs.window, snapshotEntry.at)) failures.push("the snapshot consumed by the liquidity gate lies outside the test window");
    if (liquidity.some(item => outsideWindow(inputs.window, item.quotedAt, brokerInstantToIso(item.brokerQuotedAt) ?? undefined))) failures.push("a liquidity quote sample carries a timestamp outside the test window");
    if (liquidity.some(item => brokerInstantToIso(item.brokerQuotedAt) !== item.quotedAt)) failures.push("a liquidity quote sample's recorded instant does not equal its broker timestamp");
    const legIds = new Set(legsOf(intentForLiquidity).map(leg => leg.contractId));
    if ([...legIds].some(id => !liquidity.some(item => item.contractId === id))) failures.push("the snapshot consumed by the liquidity gate lacks a quote sample with sizes and timestamps for every credit leg");
  }
  const fence = fenceFrom(inputs, failures);
  const finalSnapshot = finalSnapshotFrom(inputs, failures);
  const body = {
    schemaVersion: CERTIFICATE_SCHEMA_VERSION as 1,
    role: "dev" as const,
    accountId: inputs.accountId,
    tradingOrigin: inputs.tradingOrigin,
    window: inputs.window,
    runtimeDigest: inputs.runtimeDigest,
    policyDigest: inputs.policyDigest,
    fieldClassificationVersion: CONFIG_FIELD_CLASSIFICATION_VERSION,
    mcpInventoryAccepted: inputs.mcpInventoryAccepted,
    evidence: { liquidity, creditAcceptance, fill, fence, finalSnapshot },
  };
  return { ...body, verdict: failures.length === 0 ? "PASS" : "FAIL", failures, evidenceDigest: certificateEvidenceDigest(body) };
}

// ---------------------------------------------------------------------------
// Arming-time validation (S-CYC-11 competition path: WIN-7, WIN-10, WIN-17)
// ---------------------------------------------------------------------------

export interface ArmingExpectations {
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly canonicalTradingOrigin: string;
}

export type CertificateValidation = { readonly ok: true; readonly successfulDevLiveTestAt: string } | { readonly ok: false; readonly violations: readonly string[] };

function certificateKeys(): readonly string[] {
  return ["schemaVersion", "verdict", "role", "accountId", "tradingOrigin", "window", "runtimeDigest", "policyDigest", "fieldClassificationVersion", "mcpInventoryAccepted", "evidence", "failures", "evidenceDigest"];
}

/** A certificate is trusted only as a whole: exact schema, PASS, dev role, canonical origin, and both digests equal to the deployment's own. */
export function validateArmingCertificate(raw: unknown, expectations: ArmingExpectations): CertificateValidation {
  const violations: string[] = [];
  if (!isRecord(raw)) return { ok: false, violations: ["certificate is not an object"] };
  const keys = Object.keys(raw).sort();
  const expectedKeys = [...certificateKeys()].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) violations.push("certificate schema mismatch: unexpected or missing fields");
  if (raw["schemaVersion"] !== CERTIFICATE_SCHEMA_VERSION) violations.push("certificate schemaVersion is not supported");
  if (raw["verdict"] !== "PASS") violations.push("certificate verdict is not PASS");
  if (raw["role"] !== "dev") violations.push("certificate role is not the dev role");
  if (raw["tradingOrigin"] !== expectations.canonicalTradingOrigin) violations.push("certificate origin is not the canonical paper origin");
  if (raw["fieldClassificationVersion"] !== CONFIG_FIELD_CLASSIFICATION_VERSION) violations.push("certificate field-classification version differs from this build");
  if (raw["mcpInventoryAccepted"] !== true) violations.push("certificate does not record an accepted MCP inventory");
  if (raw["runtimeDigest"] !== expectations.runtimeDigest) violations.push("runtimeDigest mismatch: a covered runtime change invalidates the certificate");
  if (raw["policyDigest"] !== expectations.policyDigest) violations.push("policyDigest mismatch: a role-neutral policy change invalidates the certificate");
  if (typeof raw["accountId"] !== "string" || raw["accountId"].length === 0) violations.push("certificate account ID is malformed");
  const window = raw["window"];
  const startedAt = isRecord(window) && isUtcIso(window["startedAt"]) ? window["startedAt"] : null;
  const endedAt = isRecord(window) && isUtcIso(window["endedAt"]) ? window["endedAt"] : null;
  if (startedAt === null || endedAt === null || !((utcIsoToEpochMs(startedAt) ?? 0) < (utcIsoToEpochMs(endedAt) ?? 0)) || !hasExactKeys(window, ["startedAt", "endedAt"])) violations.push("certificate window is malformed");
  if (!Array.isArray(raw["failures"])) violations.push("certificate failures is not an array");
  else if (raw["failures"].length > 0) violations.push("certificate carries failures");
  const evidence = raw["evidence"];
  if (!isRecord(evidence) || Object.keys(evidence).sort().join(",") !== "creditAcceptance,fence,fill,finalSnapshot,liquidity") violations.push("certificate evidence is malformed");
  else {
    const shapes = evidenceClauseShapes();
    const windowMs = startedAt !== null && endedAt !== null ? { startMs: utcIsoToEpochMs(startedAt) ?? 0, endMs: utcIsoToEpochMs(endedAt) ?? 0 } : null;
    const liquidity = evidence["liquidity"];
    if (!Array.isArray(liquidity) || liquidity.length === 0) violations.push("certificate liquidity evidence is absent or malformed");
    else for (const item of liquidity) violations.push(...clauseViolations("liquidity", item, shapes["liquidity"] ?? {}, windowMs));
    for (const clause of ["creditAcceptance", "fill", "fence", "finalSnapshot"]) violations.push(...clauseViolations(clause, evidence[clause], shapes[clause] ?? {}, windowMs));
    const finalSnapshot = evidence["finalSnapshot"];
    if (isRecord(finalSnapshot) && (finalSnapshot["positionCount"] !== 0 || finalSnapshot["nonTerminalOrderCount"] !== 0 || finalSnapshot["pagesComplete"] !== true)) violations.push("certificate final snapshot is not flat and fully paginated");
    if (isRecord(finalSnapshot) && (finalSnapshot["accountId"] !== raw["accountId"] || !(Number.isSafeInteger(finalSnapshot["orderPagesFetched"]) && (finalSnapshot["orderPagesFetched"] as number) >= 1))) violations.push("certificate final snapshot is not on the certificate's account or was not paginated");
    const fence = evidence["fence"];
    if (isRecord(fence) && fence["httpStatus"] !== 401 && fence["httpStatus"] !== 403) violations.push("certificate fence evidence is not a credential rejection");
    if (isRecord(fence) && !(Number.isSafeInteger(fence["haltSeq"]) && Number.isSafeInteger(fence["unhaltSeq"]) && (fence["haltSeq"] as number) > 0 && (fence["haltSeq"] as number) < (fence["unhaltSeq"] as number))) violations.push("certificate fence sequence is not ordered");
    const credit = evidence["creditAcceptance"];
    if (isRecord(credit)) {
      if (!positiveAcceptanceStatuses().includes(String(credit["acceptedStatus"])) || (credit["terminalStatus"] !== "filled" && credit["terminalStatus"] !== "canceled")) violations.push("certificate credit acceptance states are not the positive/terminal states S-ARM-01 names");
      if (credit["terminalStatus"] === "canceled" && credit["harnessRequestedCancel"] !== true) violations.push("certificate credit acceptance ended in a cancel the harness did not request");
      if (!(Number.isSafeInteger(credit["intentSeq"]) && Number.isSafeInteger(credit["outcomeSeq"]) && (credit["intentSeq"] as number) > 0 && (credit["intentSeq"] as number) < (credit["outcomeSeq"] as number))) violations.push("certificate credit acceptance sequence is not ordered");
      if ((instantOf(credit["acceptedAt"]) ?? 0) > (instantOf(credit["terminalAt"]) ?? 0)) violations.push("certificate credit acceptance does not precede its terminal instant");
      if (!nonBlank(credit["clientOrderId"]) || !nonBlank(credit["brokerOrderId"]) || !nonBlank(credit["exposureLifecycleId"])) violations.push("certificate credit acceptance lacks order identities");
    }
    const fill = evidence["fill"];
    if (isRecord(fill)) {
      if (!(Number.isSafeInteger(fill["filledQuantity"]) && (fill["filledQuantity"] as number) >= 1) || !(Number.isSafeInteger(fill["avgFillPriceCents"]) && (fill["avgFillPriceCents"] as number) >= 0)) violations.push("certificate fill quantity or price is not a real fill");
      if (!(Number.isSafeInteger(fill["outcomeSeq"]) && Number.isSafeInteger(fill["reconciledSnapshotSeq"]) && (fill["outcomeSeq"] as number) > 0 && (fill["outcomeSeq"] as number) < (fill["reconciledSnapshotSeq"] as number))) violations.push("certificate fill reconciliation sequence is not ordered");
      if (!nonBlank(fill["clientOrderId"]) || !nonBlank(fill["brokerOrderId"])) violations.push("certificate fill lacks order identities");
    }
    if (Array.isArray(liquidity)) {
      for (const item of liquidity) {
        if (!isRecord(item)) continue;
        const brokerIso = typeof item["brokerQuotedAt"] === "string" ? brokerInstantToIso(item["brokerQuotedAt"]) : null;
        if (brokerIso === null || brokerIso !== item["quotedAt"]) violations.push("certificate liquidity sample's broker timestamp does not match its recorded instant");
        if (!(Number.isSafeInteger(item["bidSize"]) && (item["bidSize"] as number) > 0 && Number.isSafeInteger(item["askSize"]) && (item["askSize"] as number) > 0 && Number.isSafeInteger(item["bidCents"]) && (item["bidCents"] as number) >= 0 && Number.isSafeInteger(item["askCents"]) && (item["askCents"] as number) >= (item["bidCents"] as number))) violations.push("certificate liquidity sample is not a two-sided sized quote");
        if (!nonBlank(item["contractId"]) || !(Number.isSafeInteger(item["snapshotSeq"]) && (item["snapshotSeq"] as number) > 0)) violations.push("certificate liquidity sample lacks a contract or a snapshot sequence");
      }
    }
  }
  // The self-digest: every field above except verdict and failures must hash to the recorded value.
  if (typeof raw["evidenceDigest"] !== "string" || containsNonCanonical(raw["evidence"]) || containsNonCanonical(raw["window"])) violations.push("certificate evidence digest is absent or the material is not canonical");
  else {
    const recomputed = sha256Text(canonicalJson({ schemaVersion: raw["schemaVersion"], role: raw["role"], accountId: raw["accountId"], tradingOrigin: raw["tradingOrigin"], window: raw["window"], runtimeDigest: raw["runtimeDigest"], policyDigest: raw["policyDigest"], fieldClassificationVersion: raw["fieldClassificationVersion"], mcpInventoryAccepted: raw["mcpInventoryAccepted"], evidence: raw["evidence"] }));
    if (recomputed !== raw["evidenceDigest"]) violations.push("certificate evidence digest mismatch: the certificate was edited after it was produced");
  }
  if (violations.length > 0 || endedAt === null) return { ok: false, violations };
  return { ok: true, successfulDevLiveTestAt: endedAt };
}
