// Fail-closed startup (S-CYC-11): validate the whole §0 configuration before
// any broker call, refuse to arm on any violation, and keep the two refusal
// paths distinct — an unopenable STATE_DIR replaces the impossible local
// journal narrowly (redacted OS diagnostic, failure-only ping, nonzero exit),
// while every other violation journals a CONFIG_INVALID halt and fail-pings.
// The decisions live in the pure core (`src/core/startup.ts`); this shell
// resolves paths, probes the sink, appends, and pings. No broker port exists
// in this module's dependency surface, so "no orders ever" holds by
// construction.
import { epochMsToUtcIso, haltDraft } from "../core/execution.js";
import type { JournalDraft } from "../core/journal.js";
import { importedDiagnosticDraft, redactedViolationSummary, validateStartupConfig } from "../core/startup.js";
import type { StartupViolation, ValidatedStartup } from "../core/startup.js";
import type { DiagnosticSink } from "./diagnostic-sink.js";
import { readEpochStore } from "./epoch-store.js";
import { resolveStateDir } from "./state-dir.js";
import type { StatePaths } from "./state-dir.js";

/** The exact canonical order-capable paper origin (§0). A shell literal on purpose: the core receives it as an expectation. */
export const CANONICAL_PAPER_TRADING_ORIGIN = "https://paper-api.alpaca.markets";

/** The absolute alerting SLA (§0, KGV-17): detection plus delivery stays at or under 60 minutes. */
export const ALERT_SLA_MS = 3_600_000;

export interface StartupJournalPort {
  /** Acquire authority in the resolved STATE_DIR and append one entry under the acquired epoch. */
  append(paths: StatePaths, draft: (context: { readonly atIso: string; readonly epoch: number }) => JournalDraft): Promise<boolean>;
}

export interface StartupPorts {
  readonly rawConfig: Readonly<Record<string, unknown>>;
  readonly openSink: (sinkName: string) => DiagnosticSink | null;
  /** Failure-only ping to the dead-man check; valid before any journal exists (S-G14-03). */
  readonly failPing: (code: "CONFIG_INVALID" | "CONFIG_INVALID_STATE_DIR") => Promise<void>;
  readonly journal: StartupJournalPort;
  readonly clock: () => number;
}

export interface StartupOutcome {
  readonly armed: boolean;
  readonly exitCode: 0 | 1;
  readonly refusal: "CONFIG_INVALID" | "CONFIG_INVALID_STATE_DIR" | null;
  readonly violations: readonly StartupViolation[];
  readonly config: ValidatedStartup | null;
  readonly paths: StatePaths | null;
  /** Diagnostics imported from the sink into the journal on a successful arm (S-CYC-11 repair path). */
  readonly importedDiagnostics: number;
  /**
   * R44-B7 / A31: whether this outcome already sent the invocation's readiness
   * failure. One scheduled invocation reports readiness once; the CLI entry
   * point sends its own `STARTUP_REFUSED` signal only when this is false, so a
   * refusal cannot arrive twice under two different names.
   */
  readonly failurePinged: boolean;
}

function sinkNameOf(raw: Readonly<Record<string, unknown>>): string | null {
  const value = raw["BOOTSTRAP_DIAGNOSTIC_SINK"];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** The sink is diagnostics, never state authority: a failing sink must not block a refusal path (the fail ping still fires). */
function tryWrite(sink: DiagnosticSink | null, record: Parameters<DiagnosticSink["write"]>[0]): void {
  try {
    sink?.write(record);
  } catch {
    // Deliberately swallowed — the refusal outcome and the failure-only ping carry the signal.
  }
}

export async function runStartup(ports: StartupPorts): Promise<StartupOutcome> {
  const validation = validateStartupConfig(ports.rawConfig, { canonicalTradingOrigin: CANONICAL_PAPER_TRADING_ORIGIN, alertSlaMs: ALERT_SLA_MS });
  const violations = validation.ok ? [] : validation.violations;

  // STATE_DIR is resolved first: whether the local-journal requirement can be met decides which refusal path applies.
  const stateDirRaw = ports.rawConfig["STATE_DIR"];
  const resolved = resolveStateDir(typeof stateDirRaw === "string" ? stateDirRaw : "");
  if (!resolved.ok) {
    // The narrow replacement path: redacted OS diagnostic, failure-only ping, nonzero exit — before any broker access.
    const sinkName = sinkNameOf(ports.rawConfig);
    const sink = sinkName === null ? null : ports.openSink(sinkName);
    tryWrite(sink, { at: epochMsToUtcIso(ports.clock()), code: "CONFIG_INVALID_STATE_DIR", detail: resolved.detail });
    await ports.failPing("CONFIG_INVALID_STATE_DIR");
    return { armed: false, exitCode: 1, refusal: "CONFIG_INVALID_STATE_DIR", violations, config: null, paths: null, importedDiagnostics: 0, failurePinged: true };
  }

  // The installed sink must be writable at startup (S-CYC-11); an unwritable sink is a config violation like any other.
  const sinkName = sinkNameOf(ports.rawConfig);
  const sink = sinkName === null ? null : ports.openSink(sinkName);
  const sinkViolations: StartupViolation[] =
    sinkName !== null && (sink === null || !sink.probeWritable())
      ? [{ field: "BOOTSTRAP_DIAGNOSTIC_SINK", code: "OUT_OF_BOUNDS", detail: "the installed diagnostic sink is not writable" }]
      : [];

  // The journal takes an authoritative append only over a present, unencumbered epoch store. Startup must not
  // classify the account at the broker (S-CYC-11 validates BEFORE any broker call), so an absent store is never
  // seeded here (S-CYC-09) and no acquisition side effect may mislabel a virgin install as a reset.
  const store = readEpochStore(resolved.value);
  const journalable = store.kind === "present" && !store.seedPending && !store.resetPending;

  const allViolations = [...violations, ...sinkViolations];
  if (allViolations.length > 0 || !validation.ok) {
    const summary = redactedViolationSummary(allViolations);
    const journaled = journalable && (await ports.journal.append(resolved.value, context => haltDraft(context, "CONFIG_INVALID", `refusing to arm: ${summary}`)));
    if (!journaled) {
      // No journalable store without the broker call S-CYC-11 forbids; the OS sink carries the record instead.
      tryWrite(sink, { at: epochMsToUtcIso(ports.clock()), code: "CONFIG_INVALID_UNJOURNALABLE", detail: summary });
    }
    await ports.failPing("CONFIG_INVALID");
    return { armed: false, exitCode: 1, refusal: "CONFIG_INVALID", violations: allViolations, config: null, paths: resolved.value, importedDiagnostics: 0, failurePinged: true };
  }

  // Armed: import any diagnostics an earlier failed run left in the sink. While no journalable store exists yet
  // (no cycle has bootstrapped), the records stay pending in the sink; a record whose append fails goes back too —
  // the diagnostic survives until the first run that can journal it (S-CYC-11 repair path).
  let imported = 0;
  if (journalable) {
    for (const record of sink?.drainPending() ?? []) {
      if (await ports.journal.append(resolved.value, context => importedDiagnosticDraft(context, record))) imported += 1;
      else tryWrite(sink, record);
    }
  }
  return { armed: true, exitCode: 0, refusal: null, violations: [], config: validation.value, paths: resolved.value, importedDiagnostics: imported, failurePinged: false };
}
