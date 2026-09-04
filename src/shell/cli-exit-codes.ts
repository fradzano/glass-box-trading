// The exit-code tables of the three entry points, as pure functions over a
// closed outcome per CLI. They live in one module because S-G12-01 states a
// *contrast* rather than a single rule: a suppressed run means the same thing
// in all three processes — another instance holds writer authority — but it is
// a normal outcome for the scheduled second instance and a failed request for
// the owner-driven one-shot tools:
//
//   agent-cli        suppression → 0 (the scheduler must not see a failure)
//   certificate-cli  suppression → 1 (the owner asked for a run that did not happen)
//   deadline-cli     suppression → 3 (same, with its own distinguishable code)
//
// Keeping the three tables side by side makes that contrast reviewable, and
// keeping them out of the entry points makes them testable without spawning a
// process: an entry point is a top-level-await script whose exit code is
// otherwise only observable through a real OS process.
import type { RuntimeBuild } from "./agent-runtime.js";
import type { DeadlineRefusalStage } from "./deadline-runtime.js";

/** Every stage at which the agent/certificate composition root can refuse, derived so a new stage cannot bypass these tables. */
export type RuntimeBuildRefusalStage = Extract<RuntimeBuild, { readonly ok: false }>["stage"];

/** Where a refusal line goes and how it is labelled. Suppression is not an error for the scheduled entry. */
export interface RefusalChannel {
  readonly stream: "stdout" | "stderr";
  readonly prefix: "suppressed" | "refused";
}

export type AgentCliOutcome =
  | { readonly kind: "build_refused"; readonly stage: RuntimeBuildRefusalStage }
  | { readonly kind: "cycle_finished"; readonly journalFailed: boolean }
  | { readonly kind: "cycle_aborted" };

export type CertificateCliOutcome =
  | { readonly kind: "command_refused" }
  | { readonly kind: "runtime_construction_failed" }
  | { readonly kind: "build_refused"; readonly stage: RuntimeBuildRefusalStage }
  | { readonly kind: "preflight_reported" }
  | { readonly kind: "smoke_cycle_inside_session" }
  | { readonly kind: "smoke_cycle_finished" }
  | { readonly kind: "outside_session" }
  | { readonly kind: "certificate_finished"; readonly verdict: "PASS" | "FAIL" }
  | { readonly kind: "run_aborted" };

export type DeadlineCliOutcome =
  | { readonly kind: "usage_refused" }
  | { readonly kind: "composition_refused"; readonly stage: DeadlineRefusalStage }
  | { readonly kind: "entry_already_stands" }
  | { readonly kind: "entry_finished"; readonly appended: boolean }
  | { readonly kind: "entry_aborted" };

/**
 * The scheduled agent instance (S-G12-01): a suppressed start is a normal
 * scheduled outcome and exits 0, so the Windows Scheduled Task history does
 * not fill with failures for a system that is working exactly as designed.
 * Everything else — an unusable deployment, a lost cycle, a journal append
 * that did not land — exits 1.
 */
export function agentCliExitCode(outcome: AgentCliOutcome): number {
  switch (outcome.kind) {
    case "build_refused":
      return outcome.stage === "suppressed" ? 0 : 1;
    case "cycle_finished":
      return outcome.journalFailed ? 1 : 0;
    case "cycle_aborted":
      return 1;
  }
}

/** The same decision for the refusal line itself: a suppressed scheduled run is reported on stdout, every real refusal on stderr. */
export function agentBuildRefusalChannel(stage: RuntimeBuildRefusalStage): RefusalChannel {
  return stage === "suppressed" ? { stream: "stdout", prefix: "suppressed" } : { stream: "stderr", prefix: "refused" };
}

/**
 * The owner-driven certificate CLI (S-G12-01): every build refusal exits 1,
 * suppression included — the operator typed a command and must learn that the
 * requested dev live test did not run. Code 2 is reserved for the refusals
 * decided before or beside the runtime (wrong role, no owner go, a smoke cycle
 * inside the session, a live test outside it); 0 means the requested work
 * completed and, for a full run, that the certificate says PASS.
 */
export function certificateCliExitCode(outcome: CertificateCliOutcome): number {
  switch (outcome.kind) {
    case "command_refused":
    case "smoke_cycle_inside_session":
    case "outside_session":
      return 2;
    case "build_refused":
    case "runtime_construction_failed":
    case "run_aborted":
      return 1;
    case "preflight_reported":
    case "smoke_cycle_finished":
      return 0;
    case "certificate_finished":
      return outcome.verdict === "PASS" ? 0 : 1;
  }
}

/**
 * The owner-driven deadline CLI (S-G11-03/04, S-G12-01). Its codes are
 * distinguishable on purpose so a Friday entry that did not land can be told
 * apart at a glance: 2 usage, 3 a live writer holds authority, 4 a TERMINAL
 * that already stands, 1 everything else, 0 only when the entry is in the
 * journal.
 */
export function deadlineCliExitCode(outcome: DeadlineCliOutcome): number {
  switch (outcome.kind) {
    case "usage_refused":
      return 2;
    case "composition_refused":
      return outcome.stage === "suppressed" ? 3 : 1;
    case "entry_already_stands":
      return 4;
    case "entry_finished":
      return outcome.appended ? 0 : 1;
    case "entry_aborted":
      return 1;
  }
}
