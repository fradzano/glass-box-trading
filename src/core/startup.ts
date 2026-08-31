// Pure startup core (P4: S-CYC-11, S-G12-06): fail-closed validation of the
// §0 configuration record, the analyst MCP capability manifest and runtime
// lock, the pre-spawn launch verification and post-start inventory acceptance,
// the constructed child environment, and the credential-fence classification.
// Missing configuration is indistinguishable from wrong configuration — both
// produce violations, and a single violation refuses to arm. Everything here
// is a decision over data handed in by the shell; nothing reads the world.
import { validateSchedulingBounds } from "./authority.js";
import type { BindingConfig, SchedulingBounds } from "./authority.js";
import { integerUnit } from "./domain.js";
import type { DecisionConfig } from "./domain.js";
import { utcIsoToEpochMs, validateKillThreshold } from "./execution.js";
import type { ExecutionConfig } from "./execution.js";
import type { JournalDraft } from "./journal.js";

// ---------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------

export type StartupViolationCode =
  | "MISSING"
  | "WRONG_TYPE"
  | "OUT_OF_BOUNDS"
  | "UNKNOWN_FIELD"
  | "UNKNOWN_PROFILE"
  | "ORIGIN_NOT_CANONICAL"
  | "SCHEDULING_BOUNDS_VIOLATED"
  | "ALERT_SLA_EXCEEDED"
  | "STALENESS_COUPLING_VIOLATED"
  | "WHITELIST_UNKNOWN_STRUCTURE"
  | "SHORT_CAPABILITY_FLAG_MISSING"
  | "QUALIFICATION_UNORDERED"
  | "QUALIFICATION_CAP_NOT_BELOW_SLEEVE_CAP"
  | "KILL_THRESHOLD_INVALID"
  | "STATE_DIR_NOT_ABSOLUTE"
  | "TIMEOUT_EXCEEDS_WALLTIME"
  | "CERTIFICATE_MISSING";

export interface StartupViolation {
  readonly field: string;
  readonly code: StartupViolationCode;
  readonly detail: string;
}

type Violations = StartupViolation[];

function violation(violations: Violations, field: string, code: StartupViolationCode, detail: string): void {
  violations.push({ field, code, detail });
}

// ---------------------------------------------------------------------------
// Raw-field readers: absence and malformation land in the same violations list
// ---------------------------------------------------------------------------

type Raw = Readonly<Record<string, unknown>>;

function readInteger(raw: Raw, field: string, violations: Violations, bounds: { readonly min?: number; readonly max?: number }): number | null {
  const value = raw[field];
  if (value === undefined || value === null) {
    violation(violations, field, "MISSING", "required configuration symbol is absent");
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    violation(violations, field, "WRONG_TYPE", "must be a safe integer");
    return null;
  }
  if (bounds.min !== undefined && value < bounds.min) {
    violation(violations, field, "OUT_OF_BOUNDS", `must be >= ${String(bounds.min)}`);
    return null;
  }
  if (bounds.max !== undefined && value > bounds.max) {
    violation(violations, field, "OUT_OF_BOUNDS", `must be <= ${String(bounds.max)}`);
    return null;
  }
  return value;
}

function readString(raw: Raw, field: string, violations: Violations): string | null {
  const value = raw[field];
  if (value === undefined || value === null) {
    violation(violations, field, "MISSING", "required configuration symbol is absent");
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    violation(violations, field, "WRONG_TYPE", "must be a non-empty string");
    return null;
  }
  return value;
}

function readStringArray(raw: Raw, field: string, violations: Violations): readonly string[] | null {
  const value = raw[field];
  if (value === undefined || value === null) {
    violation(violations, field, "MISSING", "required configuration symbol is absent");
    return null;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every(item => typeof item === "string" && item.length > 0)) {
    violation(violations, field, "WRONG_TYPE", "must be a non-empty array of non-empty strings");
    return null;
  }
  return value as readonly string[];
}

function readUtcIso(raw: Raw, field: string, violations: Violations): number | null {
  const text = readString(raw, field, violations);
  if (text === null) return null;
  const ms = utcIsoToEpochMs(text);
  if (ms === null) {
    violation(violations, field, "WRONG_TYPE", "must be a UTC ISO timestamp (YYYY-MM-DDTHH:MM:SS[.mmm]Z)");
    return null;
  }
  return ms;
}

// ---------------------------------------------------------------------------
// The closed §0 field set P4 arms with (later phases extend this set here)
// ---------------------------------------------------------------------------

function knownFields(): readonly string[] {
  return [
  "EXPECTED_ACCOUNT_ID",
  "ALPACA_PROFILE",
  "ALPACA_TRADING_ORIGIN",
  "STATE_DIR",
  "BOOTSTRAP_DIAGNOSTIC_SINK",
  "INCOME_BUDGET_CENTS",
  "CONVEX_BUDGET_CENTS",
  "INITIAL_CAPITAL_CENTS",
  "MAX_LOSS_PER_POSITION_BPS",
  "MAX_UNDERLYING_EXPOSURE_CENTS",
  "MAX_REL_SPREAD_BPS",
  "MIN_QUOTE_SIZE",
  "QUOTE_MAX_AGE_MS",
  "SNAPSHOT_STALENESS_BOUND_MS",
  "KILL_EQUITY_THRESHOLD_CENTS",
  "DEAD_MAN_BOUND_MS",
  "ALERT_DELIVERY_BUDGET_MS",
  "CYCLE_INTERVAL_MS",
  "UNDERLYING_UNIVERSE",
  "STRUCTURE_WHITELIST",
  "EXPIRY_MIN_SESSIONS",
  "EXPIRY_MAX_SESSIONS",
  "MAX_STRIKE_DISTANCE_BPS",
  "MAX_CANDIDATE_QTY",
  "LIMIT_TOLERANCE_CENTS",
  "CLOSE_ESCALATION_STEP_CENTS",
  "RESIDUE_MAX_SESSIONS",
  "ANALYST_TIMEOUT_MS",
  "CYCLE_WALLTIME_BUDGET_MS",
  "LOCK_TAKEOVER_BOUND_MS",
  "ANALYST_MCP_CAPABILITY_MANIFEST",
  "ANALYST_MCP_RUNTIME_LOCK",
  "ANALYST_ALPACA_PROFILE",
  "QUALIFYING_ACTIVITY_CHECKPOINT",
  "QUALIFICATION_WINDOW_END",
  "QUALIFICATION_MAX_LOSS_CENTS",
  "SHORT_ASSIGNMENT_CAPABILITY",
  "PRE_ARM_CERTIFICATE",
  ];
}

function structureTypes(): readonly string[] {
  return ["long_option", "vertical_debit", "vertical_credit", "iron_condor"];
}

/** Any structure carrying a short leg can be assigned; only the pure long option is exempt (S-X-06). */
export function isShortCapableStructure(structureType: string): boolean {
  return structureTypes().includes(structureType) && structureType !== "long_option";
}

/** Pure absolute-path-literal check (§0 STATE_DIR): Windows drive, UNC, or POSIX root. */
export function isAbsolutePathLiteral(candidate: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\") || candidate.startsWith("/");
}

/**
 * S-CYC-11 origin rule: the configured order-capable origin must be exactly
 * the canonical paper origin — HTTPS, default port, no path, query, fragment,
 * userinfo, alias, or normalization headroom. Only the byte-exact canonical
 * literal passes; every lookalike differs from it and fails.
 */
export function validateTradingOrigin(configured: string, canonical: string): { readonly ok: boolean; readonly detail: string } {
  if (configured !== configured.trim() || configured !== configured.toLowerCase()) return { ok: false, detail: "origin must be a lowercase literal without surrounding whitespace" };
  if (!configured.startsWith("https://")) return { ok: false, detail: "origin must use HTTPS" };
  const rest = configured.slice("https://".length);
  if (rest.length === 0 || /[/?#@:]/.test(rest)) return { ok: false, detail: "origin must carry no path, query, fragment, port, or userinfo" };
  if (configured !== canonical) return { ok: false, detail: `origin must be exactly the canonical paper origin ${canonical}` };
  return { ok: true, detail: "canonical" };
}

// ---------------------------------------------------------------------------
// Validated bundle
// ---------------------------------------------------------------------------

export interface QualificationConfig {
  readonly checkpointIso: string;
  readonly windowEndIso: string;
  readonly maxLossCents: number;
}

export interface ValidatedStartup {
  readonly profile: "dev" | "competition";
  readonly binding: BindingConfig;
  readonly stateDir: string;
  readonly diagnosticSink: string;
  readonly decision: DecisionConfig;
  readonly execution: ExecutionConfig;
  readonly scheduling: SchedulingBounds;
  readonly alertDeliveryBudgetMs: number;
  readonly analystTimeoutMs: number;
  readonly closeEscalationStepCents: number;
  readonly residueMaxSessions: number;
  readonly qualification: QualificationConfig;
  readonly shortAssignmentCapability: boolean;
  readonly manifestPath: string;
  readonly runtimeLockPath: string;
  readonly analystProfile: "dev";
}

export interface StartupExpectations {
  /** The canonical paper trading origin the configured value must equal (a shell literal, per §0 not hardcoded here). */
  readonly canonicalTradingOrigin: string;
  /** The absolute alerting SLA in ms (60 min per §0/KGV-17); `DEAD_MAN_BOUND + ALERT_DELIVERY_BUDGET` must stay at or under it. */
  readonly alertSlaMs: number;
}

export type StartupValidation =
  | { readonly ok: true; readonly value: ValidatedStartup }
  | { readonly ok: false; readonly violations: readonly StartupViolation[] };

export function validateStartupConfig(raw: Raw, expectations: StartupExpectations): StartupValidation {
  const violations: Violations = [];

  const known = knownFields();
  for (const field of Object.keys(raw)) {
    if (!known.includes(field)) violation(violations, field, "UNKNOWN_FIELD", "field is not part of the closed configuration set; unknown fields are rejected, not ignored");
  }

  const expectedAccountId = readString(raw, "EXPECTED_ACCOUNT_ID", violations);
  const profileRaw = readString(raw, "ALPACA_PROFILE", violations);
  const profile: "dev" | "competition" | null = profileRaw === "dev" || profileRaw === "competition" ? profileRaw : null;
  if (profileRaw !== null && profile === null) violation(violations, "ALPACA_PROFILE", "UNKNOWN_PROFILE", "must be exactly 'dev' or 'competition'; there is no default or fallback");

  const origin = readString(raw, "ALPACA_TRADING_ORIGIN", violations);
  if (origin !== null) {
    const parsed = validateTradingOrigin(origin, expectations.canonicalTradingOrigin);
    if (!parsed.ok) violation(violations, "ALPACA_TRADING_ORIGIN", "ORIGIN_NOT_CANONICAL", parsed.detail);
  }

  const stateDir = readString(raw, "STATE_DIR", violations);
  if (stateDir !== null && !isAbsolutePathLiteral(stateDir)) violation(violations, "STATE_DIR", "STATE_DIR_NOT_ABSOLUTE", "must be an absolute path literal");
  const diagnosticSink = readString(raw, "BOOTSTRAP_DIAGNOSTIC_SINK", violations);

  const incomeBudgetCents = readInteger(raw, "INCOME_BUDGET_CENTS", violations, { min: 1 });
  const convexBudgetCents = readInteger(raw, "CONVEX_BUDGET_CENTS", violations, { min: 1 });
  const initialCapitalCents = readInteger(raw, "INITIAL_CAPITAL_CENTS", violations, { min: 1 });
  const maxLossPerPositionBps = readInteger(raw, "MAX_LOSS_PER_POSITION_BPS", violations, { min: 1, max: 10_000 });
  const maxUnderlyingExposureCents = readInteger(raw, "MAX_UNDERLYING_EXPOSURE_CENTS", violations, { min: 1 });
  const maxRelativeSpreadBps = readInteger(raw, "MAX_REL_SPREAD_BPS", violations, { min: 1 });
  const minQuoteSize = readInteger(raw, "MIN_QUOTE_SIZE", violations, { min: 1 });
  const quoteMaxAgeMs = readInteger(raw, "QUOTE_MAX_AGE_MS", violations, { min: 1 });
  const snapshotStalenessBoundMs = readInteger(raw, "SNAPSHOT_STALENESS_BOUND_MS", violations, { min: 1 });
  const killEquityThresholdCents = readInteger(raw, "KILL_EQUITY_THRESHOLD_CENTS", violations, { min: 1 });
  const deadManBoundMs = readInteger(raw, "DEAD_MAN_BOUND_MS", violations, { min: 1 });
  const alertDeliveryBudgetMs = readInteger(raw, "ALERT_DELIVERY_BUDGET_MS", violations, { min: 1 });
  const cycleIntervalMs = readInteger(raw, "CYCLE_INTERVAL_MS", violations, { min: 1 });
  const underlyingUniverse = readStringArray(raw, "UNDERLYING_UNIVERSE", violations);
  const structureWhitelist = readStringArray(raw, "STRUCTURE_WHITELIST", violations);
  const expiryMinSessions = readInteger(raw, "EXPIRY_MIN_SESSIONS", violations, { min: 2 });
  const expiryMaxSessions = readInteger(raw, "EXPIRY_MAX_SESSIONS", violations, { min: 2 });
  const maxStrikeDistanceBps = readInteger(raw, "MAX_STRIKE_DISTANCE_BPS", violations, { min: 1, max: 10_000 });
  const maxCandidateQuantity = readInteger(raw, "MAX_CANDIDATE_QTY", violations, { min: 1 });
  const limitToleranceCents = readInteger(raw, "LIMIT_TOLERANCE_CENTS", violations, { min: 0 });
  const closeEscalationStepCents = readInteger(raw, "CLOSE_ESCALATION_STEP_CENTS", violations, { min: 1 });
  const residueMaxSessions = readInteger(raw, "RESIDUE_MAX_SESSIONS", violations, { min: 1 });
  const analystTimeoutMs = readInteger(raw, "ANALYST_TIMEOUT_MS", violations, { min: 1 });
  const cycleWalltimeBudgetMs = readInteger(raw, "CYCLE_WALLTIME_BUDGET_MS", violations, { min: 1 });
  const lockTakeoverBoundMs = readInteger(raw, "LOCK_TAKEOVER_BOUND_MS", violations, { min: 1 });
  const manifestPath = readString(raw, "ANALYST_MCP_CAPABILITY_MANIFEST", violations);
  const runtimeLockPath = readString(raw, "ANALYST_MCP_RUNTIME_LOCK", violations);
  const analystProfile = readString(raw, "ANALYST_ALPACA_PROFILE", violations);
  if (analystProfile !== null && analystProfile !== "dev") violation(violations, "ANALYST_ALPACA_PROFILE", "OUT_OF_BOUNDS", "the analyst child receives dev data credentials only; must be exactly 'dev'");
  const checkpointMs = readUtcIso(raw, "QUALIFYING_ACTIVITY_CHECKPOINT", violations);
  const windowEndMs = readUtcIso(raw, "QUALIFICATION_WINDOW_END", violations);
  const qualificationMaxLossCents = readInteger(raw, "QUALIFICATION_MAX_LOSS_CENTS", violations, { min: 1 });
  const capabilityRaw = raw["SHORT_ASSIGNMENT_CAPABILITY"];
  const shortAssignmentCapability = capabilityRaw === true;
  if (capabilityRaw !== undefined && typeof capabilityRaw !== "boolean") violation(violations, "SHORT_ASSIGNMENT_CAPABILITY", "WRONG_TYPE", "must be a boolean when present");

  // Couplings — each is checked only when both sides parsed; the parse failures are already violations.
  if (structureWhitelist !== null) {
    const unknown = structureWhitelist.filter(structureType => !structureTypes().includes(structureType));
    if (unknown.length > 0) violation(violations, "STRUCTURE_WHITELIST", "WHITELIST_UNKNOWN_STRUCTURE", `unknown structure type(s): ${unknown.join(", ")}`);
    if (structureWhitelist.some(isShortCapableStructure) && !shortAssignmentCapability) {
      violation(violations, "SHORT_ASSIGNMENT_CAPABILITY", "SHORT_CAPABILITY_FLAG_MISSING", "STRUCTURE_WHITELIST contains a short-capable structure but the S-X-06 capability flag is absent");
    }
  }
  if (expiryMinSessions !== null && expiryMaxSessions !== null && expiryMaxSessions < expiryMinSessions) {
    violation(violations, "EXPIRY_MAX_SESSIONS", "OUT_OF_BOUNDS", "must be >= EXPIRY_MIN_SESSIONS");
  }
  if (snapshotStalenessBoundMs !== null && cycleWalltimeBudgetMs !== null && cycleIntervalMs !== null) {
    if (snapshotStalenessBoundMs < cycleWalltimeBudgetMs || snapshotStalenessBoundMs > cycleIntervalMs) {
      violation(violations, "SNAPSHOT_STALENESS_BOUND_MS", "STALENESS_COUPLING_VIOLATED", "must satisfy CYCLE_WALLTIME_BUDGET <= SNAPSHOT_STALENESS_BOUND <= CYCLE_INTERVAL");
    }
  }
  if (analystTimeoutMs !== null && cycleWalltimeBudgetMs !== null && analystTimeoutMs > cycleWalltimeBudgetMs) {
    violation(violations, "ANALYST_TIMEOUT_MS", "TIMEOUT_EXCEEDS_WALLTIME", "every timeout lives under CYCLE_WALLTIME_BUDGET");
  }
  let scheduling: SchedulingBounds | null = null;
  if (lockTakeoverBoundMs !== null && cycleWalltimeBudgetMs !== null && cycleIntervalMs !== null && deadManBoundMs !== null) {
    scheduling = { lockTakeoverBoundMs, cycleWalltimeBudgetMs, cycleIntervalMs, deadManBoundMs };
    const bounds = validateSchedulingBounds(scheduling);
    if (!bounds.ok) {
      violation(violations, "LOCK_TAKEOVER_BOUND_MS", "SCHEDULING_BOUNDS_VIOLATED", bounds.violations.join(", "));
      scheduling = null;
    }
  }
  if (deadManBoundMs !== null && alertDeliveryBudgetMs !== null && deadManBoundMs + alertDeliveryBudgetMs > expectations.alertSlaMs) {
    violation(violations, "DEAD_MAN_BOUND_MS", "ALERT_SLA_EXCEEDED", `DEAD_MAN_BOUND + ALERT_DELIVERY_BUDGET must stay <= ${String(expectations.alertSlaMs)} ms`);
  }
  if (checkpointMs !== null && windowEndMs !== null && checkpointMs >= windowEndMs) {
    violation(violations, "QUALIFYING_ACTIVITY_CHECKPOINT", "QUALIFICATION_UNORDERED", "the qualifying checkpoint must precede QUALIFICATION_WINDOW_END");
  }
  if (qualificationMaxLossCents !== null && maxLossPerPositionBps !== null && incomeBudgetCents !== null && convexBudgetCents !== null) {
    const strictlyBelowCap = (budgetCents: number): boolean => BigInt(qualificationMaxLossCents) * 10_000n < BigInt(budgetCents) * BigInt(maxLossPerPositionBps);
    if (!strictlyBelowCap(incomeBudgetCents) || !strictlyBelowCap(convexBudgetCents)) {
      violation(violations, "QUALIFICATION_MAX_LOSS_CENTS", "QUALIFICATION_CAP_NOT_BELOW_SLEEVE_CAP", "must be strictly below the per-position cap of both sleeves");
    }
  }
  if (profile === "competition" && raw["PRE_ARM_CERTIFICATE"] === undefined) {
    violation(violations, "PRE_ARM_CERTIFICATE", "CERTIFICATE_MISSING", "competition arming requires the S-ARM-01 certificate; it is never manually supplied");
  }

  let execution: ExecutionConfig | null = null;
  if (limitToleranceCents !== null && killEquityThresholdCents !== null && initialCapitalCents !== null) {
    execution = {
      limitToleranceCents: integerUnit(limitToleranceCents, "OptionPriceCents"),
      killEquityThresholdCents: integerUnit(killEquityThresholdCents, "MoneyCents"),
      initialCapitalCents: integerUnit(initialCapitalCents, "MoneyCents"),
    };
  }
  let decision: DecisionConfig | null = null;
  if (
    incomeBudgetCents !== null && convexBudgetCents !== null && maxLossPerPositionBps !== null && maxUnderlyingExposureCents !== null &&
    maxRelativeSpreadBps !== null && minQuoteSize !== null && quoteMaxAgeMs !== null && snapshotStalenessBoundMs !== null &&
    cycleIntervalMs !== null && underlyingUniverse !== null && structureWhitelist !== null && expiryMinSessions !== null &&
    expiryMaxSessions !== null && maxStrikeDistanceBps !== null && maxCandidateQuantity !== null
  ) {
    decision = {
      incomeBudgetCents: integerUnit(incomeBudgetCents, "MoneyCents"),
      convexBudgetCents: integerUnit(convexBudgetCents, "MoneyCents"),
      maxLossPerPositionBps: integerUnit(maxLossPerPositionBps, "BasisPoints"),
      maxUnderlyingExposureCents: integerUnit(maxUnderlyingExposureCents, "MoneyCents"),
      maxRelativeSpreadBps: integerUnit(maxRelativeSpreadBps, "BasisPoints"),
      minQuoteSize: integerUnit(minQuoteSize, "Quantity"),
      quoteMaxAgeMs: integerUnit(quoteMaxAgeMs, "EpochMilliseconds"),
      snapshotStalenessBoundMs: integerUnit(snapshotStalenessBoundMs, "EpochMilliseconds"),
      cycleIntervalMs: integerUnit(cycleIntervalMs, "EpochMilliseconds"),
      underlyingUniverse,
      structureWhitelist,
      expiryMinSessions: integerUnit(expiryMinSessions, "Quantity"),
      expiryMaxSessions: integerUnit(expiryMaxSessions, "Quantity"),
      maxStrikeDistanceBps: integerUnit(maxStrikeDistanceBps, "BasisPoints"),
      maxCandidateQuantity: integerUnit(maxCandidateQuantity, "Quantity"),
    };
  }
  // S-G13-02 as an arming check: a threshold that would fire on planned convex decay never arms.
  if (execution !== null && decision !== null) {
    const kill = validateKillThreshold(execution, decision);
    if (!kill.ok) violation(violations, "KILL_EQUITY_THRESHOLD_CENTS", "KILL_THRESHOLD_INVALID", kill.violations.join(", "));
  }

  if (violations.length > 0) return { ok: false, violations };
  // Every read above either succeeded or recorded a violation, so the non-null assertions below are guarded by the return.
  if (
    profile === null || expectedAccountId === null || origin === null || stateDir === null || diagnosticSink === null ||
    decision === null || execution === null || scheduling === null || alertDeliveryBudgetMs === null || analystTimeoutMs === null ||
    closeEscalationStepCents === null || residueMaxSessions === null || checkpointMs === null || windowEndMs === null ||
    qualificationMaxLossCents === null || manifestPath === null || runtimeLockPath === null || analystProfile !== "dev"
  ) {
    return { ok: false, violations: [{ field: "*", code: "MISSING", detail: "internal guard: unvalidated field survived without a violation" }] };
  }
  return {
    ok: true,
    value: {
      profile,
      binding: { canonicalTradingOrigin: origin, expectedAccountId },
      stateDir,
      diagnosticSink,
      decision,
      execution,
      scheduling,
      alertDeliveryBudgetMs,
      analystTimeoutMs,
      closeEscalationStepCents,
      residueMaxSessions,
      qualification: { checkpointIso: raw["QUALIFYING_ACTIVITY_CHECKPOINT"] as string, windowEndIso: raw["QUALIFICATION_WINDOW_END"] as string, maxLossCents: qualificationMaxLossCents },
      shortAssignmentCapability,
      manifestPath,
      runtimeLockPath,
      analystProfile: "dev",
    },
  };
}

// ---------------------------------------------------------------------------
// Analyst MCP: manifest and runtime-lock schemas (single positive sources)
// ---------------------------------------------------------------------------

export interface AnalystManifest {
  readonly schemaVersion: 1;
  readonly server: { readonly package: string; readonly version: string; readonly runtimeLock: string };
  readonly analystProfile: "dev";
  readonly inventoryPolicy: "exact";
  readonly alpacaToolsets: readonly string[];
  readonly allowedTools: readonly string[];
}

export interface RuntimeLock {
  readonly schemaVersion: 1;
  readonly source: {
    readonly repository: string;
    readonly commit: string;
    readonly package: string;
    readonly version: string;
    readonly dependencyLockAtCommit: string;
  };
  readonly interpreter: {
    readonly implementation: string;
    readonly version: string;
    readonly launcherSha256: string;
    readonly runtimeSha256: string;
  };
  readonly installPolicy: {
    readonly dedicatedEnvironment: true;
    readonly buildFromPinnedCommit: true;
    readonly frozenDependencyLock: true;
    readonly learnHashesFromInstalledEnvironment: false;
    readonly verifyImmutableSourceAndPackageFilesBeforeSpawn: true;
    readonly removeBeforeSpawn: readonly string[];
    readonly requireRemovedFilesAbsentBeforeSpawn: true;
    readonly disableBytecodeWritesInChild: true;
  };
}

export type DocumentValidation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly string[] };

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

export function validateAnalystManifest(raw: unknown): DocumentValidation<AnalystManifest> {
  const issues: string[] = [];
  if (!isRecord(raw)) return { ok: false, issues: ["manifest is not an object"] };
  if (raw["schemaVersion"] !== 1) issues.push("schemaVersion must be 1");
  const server = raw["server"];
  if (!isRecord(server) || typeof server["package"] !== "string" || server["package"].length === 0 || typeof server["version"] !== "string" || server["version"].length === 0 || typeof server["runtimeLock"] !== "string" || server["runtimeLock"].length === 0) {
    issues.push("server must name package, version, and runtimeLock");
  }
  if (raw["analystProfile"] !== "dev") issues.push("analystProfile must be exactly 'dev'");
  if (raw["inventoryPolicy"] !== "exact") issues.push("inventoryPolicy must be exactly 'exact'");
  const toolsets = raw["alpacaToolsets"];
  if (!Array.isArray(toolsets) || toolsets.length === 0 || !toolsets.every(item => typeof item === "string" && item.length > 0)) issues.push("alpacaToolsets must be a non-empty string array");
  const tools = raw["allowedTools"];
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every(item => typeof item === "string" && item.length > 0)) issues.push("allowedTools must be a non-empty string array");
  else if (new Set(tools as readonly string[]).size !== tools.length) issues.push("allowedTools must not contain duplicates");
  const known = ["schemaVersion", "server", "analystProfile", "inventoryPolicy", "alpacaToolsets", "allowedTools"];
  for (const field of Object.keys(raw)) if (!known.includes(field)) issues.push(`unknown manifest field: ${field}`);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: raw as unknown as AnalystManifest };
}

export function validateRuntimeLock(raw: unknown): DocumentValidation<RuntimeLock> {
  const issues: string[] = [];
  if (!isRecord(raw)) return { ok: false, issues: ["runtime lock is not an object"] };
  if (raw["schemaVersion"] !== 1) issues.push("schemaVersion must be 1");
  const source = raw["source"];
  if (!isRecord(source) || typeof source["repository"] !== "string" || !source["repository"].startsWith("https://") || !isCommitSha(source["commit"]) || typeof source["package"] !== "string" || source["package"].length === 0 || typeof source["version"] !== "string" || source["version"].length === 0 || typeof source["dependencyLockAtCommit"] !== "string" || source["dependencyLockAtCommit"].length === 0) {
    issues.push("source must pin repository (https), a full 40-hex commit, package, version, and the dependency lock file at that commit");
  }
  const interpreter = raw["interpreter"];
  if (!isRecord(interpreter) || typeof interpreter["implementation"] !== "string" || interpreter["implementation"].length === 0 || typeof interpreter["version"] !== "string" || interpreter["version"].length === 0 || !isSha256(interpreter["launcherSha256"]) || !isSha256(interpreter["runtimeSha256"])) {
    issues.push("interpreter must name implementation, version, and two sha256 digests");
  }
  const policy = raw["installPolicy"];
  if (!isRecord(policy)) issues.push("installPolicy missing");
  else {
    // Every policy switch has exactly one safe value; the lock documents them, this schema enforces them.
    if (policy["dedicatedEnvironment"] !== true) issues.push("installPolicy.dedicatedEnvironment must be true");
    if (policy["buildFromPinnedCommit"] !== true) issues.push("installPolicy.buildFromPinnedCommit must be true");
    if (policy["frozenDependencyLock"] !== true) issues.push("installPolicy.frozenDependencyLock must be true");
    if (policy["learnHashesFromInstalledEnvironment"] !== false) issues.push("installPolicy.learnHashesFromInstalledEnvironment must be false: expected hashes may never be learned from the installed environment");
    if (policy["verifyImmutableSourceAndPackageFilesBeforeSpawn"] !== true) issues.push("installPolicy.verifyImmutableSourceAndPackageFilesBeforeSpawn must be true");
    const patterns = policy["removeBeforeSpawn"];
    if (!Array.isArray(patterns) || patterns.length === 0 || !patterns.every(item => typeof item === "string" && item.length > 0)) issues.push("installPolicy.removeBeforeSpawn must be a non-empty string array");
    if (policy["requireRemovedFilesAbsentBeforeSpawn"] !== true) issues.push("installPolicy.requireRemovedFilesAbsentBeforeSpawn must be true");
    if (policy["disableBytecodeWritesInChild"] !== true) issues.push("installPolicy.disableBytecodeWritesInChild must be true");
  }
  const known = ["schemaVersion", "source", "interpreter", "installPolicy"];
  for (const field of Object.keys(raw)) if (!known.includes(field)) issues.push(`unknown runtime-lock field: ${field}`);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: raw as unknown as RuntimeLock };
}

/** WIN-10: the manifest and the lock must agree on the single server identity before either is trusted. */
export function verifyManifestLockAgreement(manifest: AnalystManifest, lock: RuntimeLock): { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] } {
  const issues: string[] = [];
  if (manifest.server.package !== lock.source.package) issues.push(`package identity ambiguous: manifest '${manifest.server.package}' vs lock '${lock.source.package}'`);
  if (manifest.server.version !== lock.source.version) issues.push(`package version ambiguous: manifest '${manifest.server.version}' vs lock '${lock.source.version}'`);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// ---------------------------------------------------------------------------
// Analyst MCP: pre-spawn launch verification and post-start inventory
// ---------------------------------------------------------------------------

export type McpViolationCode =
  | "SOURCE_MISMATCH"
  | "PACKAGE_MISMATCH"
  | "DEPENDENCY_LOCK_DRIFT"
  | "INTERPRETER_MISMATCH"
  | "HASH_PROVENANCE_INVALID"
  | "IMMUTABLE_CONTENT_MISMATCH"
  | "BYTECODE_PRESENT"
  | "BYTECODE_WRITES_ENABLED"
  | "ENVIRONMENT_LEAK"
  | "ENVIRONMENT_INCOMPLETE"
  | "EXTRA_TOOL"
  | "MISSING_TOOL"
  | "DUPLICATE_TOOL";

export interface McpViolation {
  readonly code: McpViolationCode;
  readonly detail: string;
}

export interface McpLaunchObservation {
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  /** The dedicated environment's dependency lock is byte-identical to the one at the pinned commit. */
  readonly dependencyLockMatchesPin: boolean;
  readonly interpreterLauncherSha256: string;
  readonly interpreterRuntimeSha256: string;
  /** Where the expected digests came from; anything but the tracked runtime lock is a WIN-19 violation. */
  readonly hashProvenance: "runtime_lock" | "installed_environment";
  /** Immutable source/package files whose content digest differs from the pinned expectation. */
  readonly immutableFileMismatches: readonly string[];
  /** Generated executable artifacts (__pycache__/, *.pyc) still present after the removal pass. */
  readonly bytecodeArtifactsPresent: readonly string[];
  readonly bytecodeWritesDisabled: boolean;
  readonly childEnvironment: Readonly<Record<string, string>>;
}

/** The variables the constructed child environment consists of — nothing else is ever inherited (S-CYC-11). */
export function analystEnvVariables(): readonly string[] {
  return ["ALPACA_API_KEY", "ALPACA_SECRET_KEY", "ALPACA_TOOLSETS", "PYTHONDONTWRITEBYTECODE"];
}

/** Name fragments that identify executor/competition secrets; none may appear in the child environment (WIN-6). */
function forbiddenEnvFragments(): readonly string[] {
  return ["COMP_", "ANTHROPIC", "OAUTH", "CLAUDE"];
}

export interface AnalystCredentials {
  readonly devKeyId: string;
  readonly devSecretKey: string;
}

/** The constructed minimal child environment: dev data credentials, toolsets generated from the manifest, bytecode writes disabled. */
export function buildAnalystChildEnv(manifest: AnalystManifest, credentials: AnalystCredentials): Readonly<Record<string, string>> {
  return {
    ALPACA_API_KEY: credentials.devKeyId,
    ALPACA_SECRET_KEY: credentials.devSecretKey,
    ALPACA_TOOLSETS: manifest.alpacaToolsets.join(","),
    PYTHONDONTWRITEBYTECODE: "1",
  };
}

/**
 * WIN-6: the child sees the constructed variables plus an explicit OS
 * allowlist and nothing else; a variable named like an executor or
 * competition secret fails even if a caller put it on the allowlist.
 */
export function validateChildEnvironment(env: Readonly<Record<string, string>>, osAllowlist: readonly string[]): readonly McpViolation[] {
  const violations: McpViolation[] = [];
  const constructed = analystEnvVariables();
  const forbidden = forbiddenEnvFragments();
  for (const name of Object.keys(env)) {
    const upper = name.toUpperCase();
    if (forbidden.some(fragment => upper.includes(fragment))) {
      violations.push({ code: "ENVIRONMENT_LEAK", detail: `variable '${name}' matches an executor/competition secret pattern` });
      continue;
    }
    if (!constructed.includes(name) && !osAllowlist.includes(name)) {
      violations.push({ code: "ENVIRONMENT_LEAK", detail: `variable '${name}' is outside the constructed environment and the OS allowlist` });
    }
  }
  for (const name of constructed) {
    if (env[name] === undefined || env[name].length === 0) violations.push({ code: "ENVIRONMENT_INCOMPLETE", detail: `constructed variable '${name}' is missing or empty` });
  }
  if (env["PYTHONDONTWRITEBYTECODE"] !== undefined && env["PYTHONDONTWRITEBYTECODE"] !== "1") {
    violations.push({ code: "BYTECODE_WRITES_ENABLED", detail: "PYTHONDONTWRITEBYTECODE must be '1'" });
  }
  return violations;
}

/** The pre-spawn gate (S-CYC-11, WIN-10, WIN-19): every identity is verified against the lock before any child code runs. */
export function verifyMcpLaunch(lock: RuntimeLock, observation: McpLaunchObservation, osAllowlist: readonly string[]): { readonly ok: true } | { readonly ok: false; readonly violations: readonly McpViolation[] } {
  const violations: McpViolation[] = [];
  if (observation.hashProvenance !== "runtime_lock") {
    violations.push({ code: "HASH_PROVENANCE_INVALID", detail: "expected digests were learned from the installed environment; they must come from the tracked runtime lock" });
  }
  if (observation.sourceRepository !== lock.source.repository || observation.sourceCommit !== lock.source.commit) {
    violations.push({ code: "SOURCE_MISMATCH", detail: `built from ${observation.sourceRepository}@${observation.sourceCommit}, pinned ${lock.source.repository}@${lock.source.commit}` });
  }
  if (observation.packageName !== lock.source.package || observation.packageVersion !== lock.source.version) {
    violations.push({ code: "PACKAGE_MISMATCH", detail: `installed ${observation.packageName}@${observation.packageVersion}, pinned ${lock.source.package}@${lock.source.version}` });
  }
  if (!observation.dependencyLockMatchesPin) {
    violations.push({ code: "DEPENDENCY_LOCK_DRIFT", detail: `dependency lock differs from ${lock.source.dependencyLockAtCommit} at the pinned commit` });
  }
  if (observation.interpreterLauncherSha256 !== lock.interpreter.launcherSha256 || observation.interpreterRuntimeSha256 !== lock.interpreter.runtimeSha256) {
    violations.push({ code: "INTERPRETER_MISMATCH", detail: "interpreter launcher/runtime digests differ from the pinned interpreter identity" });
  }
  for (const file of observation.immutableFileMismatches) {
    violations.push({ code: "IMMUTABLE_CONTENT_MISMATCH", detail: `immutable file differs from pinned content: ${file}` });
  }
  for (const artifact of observation.bytecodeArtifactsPresent) {
    violations.push({ code: "BYTECODE_PRESENT", detail: `generated executable artifact survived the removal pass: ${artifact}` });
  }
  if (!observation.bytecodeWritesDisabled) {
    violations.push({ code: "BYTECODE_WRITES_ENABLED", detail: "the child must start with Python bytecode writes disabled" });
  }
  violations.push(...validateChildEnvironment(observation.childEnvironment, osAllowlist));
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/** Post-start inventory acceptance: the offered tools must equal the manifest's positive list exactly (WIN-6, WIN-10). */
export function verifyMcpInventory(manifest: AnalystManifest, offeredTools: readonly string[]): { readonly ok: true } | { readonly ok: false; readonly violations: readonly McpViolation[] } {
  const violations: McpViolation[] = [];
  const offered = new Set<string>();
  for (const tool of offeredTools) {
    if (offered.has(tool)) violations.push({ code: "DUPLICATE_TOOL", detail: `tool offered twice: ${tool}` });
    offered.add(tool);
  }
  const allowed = new Set(manifest.allowedTools);
  for (const tool of offered) if (!allowed.has(tool)) violations.push({ code: "EXTRA_TOOL", detail: `offered tool outside the positive manifest: ${tool}` });
  for (const tool of allowed) if (!offered.has(tool)) violations.push({ code: "MISSING_TOOL", detail: `manifest tool not offered: ${tool}` });
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// ---------------------------------------------------------------------------
// Journal material for the fail-closed startup paths
// ---------------------------------------------------------------------------

/** Violation summary safe for the journal and the OS diagnostic sink: field names and codes, never configured values. */
export function redactedViolationSummary(violations: readonly StartupViolation[]): string {
  return violations.map(item => `${item.field}:${item.code}`).join("; ");
}

export interface BootstrapDiagnostic {
  readonly at: string;
  /**
   * `CONFIG_INVALID_STATE_DIR`: STATE_DIR itself could not open (S-CYC-11's
   * narrow replacement path). `CONFIG_INVALID_UNJOURNALABLE`: STATE_DIR opened
   * but no durable authoritative append was possible without a broker call —
   * a virgin/absent epoch store cannot be seeded before account
   * classification (S-CYC-09), and S-CYC-11 forbids the broker call that
   * would classify it, so the diagnostic goes to the OS sink instead.
   */
  readonly code: "CONFIG_INVALID_STATE_DIR" | "CONFIG_INVALID_UNJOURNALABLE";
  readonly detail: string;
}

/** S-CYC-11 repair path: once STATE_DIR opens again, the first append imports the OS-sink diagnostic as `CONFIG_INVALID`. */
export function importedDiagnosticDraft(context: { readonly atIso: string; readonly epoch: number }, record: BootstrapDiagnostic): JournalDraft {
  return {
    at: context.atIso,
    epoch: context.epoch,
    type: "RECONCILIATION",
    reasonCodes: ["CONFIG_INVALID"],
    items: [{ kind: "imported_bootstrap_diagnostic", recordedAt: record.at, code: record.code, detail: record.detail }],
  };
}

// ---------------------------------------------------------------------------
// Credential fence (S-G12-06)
// ---------------------------------------------------------------------------

/**
 * An HTTP 401/403 from the broker is a credential-fence event: a
 * distinguishable `AUTH_FAILURE`, never generic world unavailability. Every
 * other failure stays in the world-degradation classes of S-CYC-02.
 */
export function classifyBrokerFailure(httpStatus: number | null): "AUTH_FAILURE" | "WORLD_DEGRADED" {
  return httpStatus === 401 || httpStatus === 403 ? "AUTH_FAILURE" : "WORLD_DEGRADED";
}
