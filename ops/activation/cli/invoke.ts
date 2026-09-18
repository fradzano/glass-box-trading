// One invocation of the activation CLI, from the command line to the exit code (unit 10).
//
// This is the imperative shell of the activation: it holds the lease, spends the reads,
// applies what the core decided and appends what happened. It decides nothing about the
// activation itself — `decide()` does that — and it performs no I/O of its own: every
// port arrives as a parameter, which is what lets the whole orchestration be tested
// against fakes long before unit 13 binds it to this host.
//
// Two orderings in here are deliberate and must not be tidied away:
//
//   * The owner's abort disables both tasks **before** it takes the lease (spec §5,
//     ACT-27). A deliberate stop that waits for a running invocation's lease is a stop
//     that did not happen when it was typed.
//   * `disarm` fails **safe**, not closed: a ledger it cannot read disables both tasks
//     rather than aborting. Residual G1 (an unparseable `ledger.lock`) would otherwise
//     turn the one command whose job is to disable into the one command that cannot.
import { applyAction } from "../actions/apply.ts";
import type { ActionContext, ActionPorts } from "../actions/apply.ts";
import { abortTeardown, decide, fullTeardown } from "../core/decide.ts";
import { foldLedgerSnapshot, stepDone } from "../core/fold.ts";
import type { LedgerFold } from "../core/fold.ts";
import { LedgerStoreError, withActivationLedger } from "../store/ledger-store.ts";
import type { ActivationLedgerSession, ActivationLedgerSnapshot, LedgerLockOwner } from "../store/ledger-store.ts";
import type { LedgerDraft } from "../core/ledger.ts";
import type { ObservationPlan } from "../readers/observe.ts";
import type { Observations, Schedule, TaskName, WorldAction } from "../core/types.ts";
import type { ActivationInvocation } from "./args.ts";
import { buildSchedule } from "./schedule.ts";
import type { DeploymentFacts, ToLocal } from "./schedule.ts";
import {
  abortDraft,
  classifyStoreFailure,
  intentDraft,
  monotonicStamp,
  nextAttemptId,
  observationPlanFor,
  openingDraft,
  ownerAbortDraft,
  ownerAbortWithoutAttemptDraft,
  recordDraft,
  resultDraft,
  systemDraftFactory,
  teardownClauseOrSilence,
  waitNoteDraft,
} from "./plan.ts";
import type { ActionReport, InvocationOutcome, StampAt } from "./plan.ts";

const BOTH_TASKS: readonly TaskName[] = ["cycle", "watchdog"];

export interface InvocationDeps {
  readonly now: () => number;
  /** A UTC instant as the ledger wants it: local time with its offset. */
  readonly stampAt: StampAt;
  readonly toLocal: ToLocal;
  readonly owner: LedgerLockOwner;
  /**
   * The two paths every command knows without reading anything: the checkout the
   * compiled entry point lives in, and the `--state-root` it was given. They used to be
   * reached through `facts`, which meant a command that needs no measured fact still
   * could not run without the file that carries them.
   */
  readonly repoRoot: string;
  readonly activationRoot: string;
  /**
   * What had to be **measured off this host** — the masked long-run account, the coverage
   * date, the disk floor, the expected preconditions. `null` when
   * `ops/activation/deployment.json` is absent or unreadable.
   *
   * It is nullable because three commands consume none of it and must not be held
   * hostage by it: `status` reads the ledger, `abort` is the owner's typed stop, and
   * `disarm` is the 15:05 one-shot whose entire purpose is to make the deployment safe.
   * A missing host file used to refuse all five commands alike, so the two that exist to
   * end a run could be stopped by the file that describes it.
   */
  readonly facts: DeploymentFacts | null;
  /** The `.env` the certificate line lives in. */
  readonly envFile: string;
  /** Unit 7's observation path, already bound to this host and the activation root. */
  readonly observe: (plan: ObservationPlan) => Promise<Observations>;
  /**
   * Unit 8's action ports. `null` until unit 13 binds them to this host (DECISIONS,
   * 2026-09-14): with no bindings the CLI reads, decides and records, and refuses to
   * claim any action it cannot perform.
   */
  readonly actions: ActionPorts | null;
  readonly print: (line: string) => void;
  /** Reading the ledger without taking the lease — `status` only. */
  readonly readLedger?: (root: string) => Promise<ActivationLedgerSnapshot>;
  readonly withLedger?: typeof withActivationLedger;
}

export interface InvocationResult {
  readonly outcome: InvocationOutcome;
  /** What the invocation did to the world, in order; empty when it touched nothing. */
  readonly applied: readonly ActionReport[];
  readonly fold: LedgerFold | null;
  readonly schedule: Schedule | null;
}

function refuse(reason: string): InvocationResult {
  return { outcome: { kind: "refused", reason }, applied: [], fold: null, schedule: null };
}

function storeFailure(error: unknown): InvocationOutcome {
  if (error instanceof LedgerStoreError) return classifyStoreFailure(error.stage, error.reason);
  return { kind: "work-failed", reason: "the invocation failed outside the store's own stages" };
}

/**
 * Applies actions in order. `stopAtFirstFailure` separates the two contracts this CLI
 * has to honour and which are not the same: an `act` stops at the first failure, because
 * the steps after it were decided against a world that no longer holds
 * (`core/types.ts`), while a teardown does **all** of its parts — a disable that failed
 * is no reason to leave the certificate line in place.
 *
 * Without bindings, or in a dry run, nothing is applied and every action is reported as
 * refused with the reason — never as applied.
 */
export async function applyAll(
  actions: readonly WorldAction[],
  ports: ActionPorts | null,
  context: ActionContext,
  dryRun: boolean,
  print: (line: string) => void,
  stopAtFirstFailure: boolean,
): Promise<readonly ActionReport[]> {
  const reports: ActionReport[] = [];
  for (const action of actions) {
    if (dryRun || ports === null) {
      const reason = dryRun ? "DRY_RUN" : "NO_HOST_BINDINGS";
      print(`would ${action.kind}${action.kind === "enable-tasks" || action.kind === "disable-tasks" ? ` ${action.tasks.join(", ")}` : ""}`);
      reports.push({ kind: action.kind, applied: false, detail: null, reason, completion: null });
      // A dry run prints *every* intended action (spec §9): the rehearsal exists to show
      // the owner the whole step, not its first line, so the loop deliberately runs on.
      // Without bindings there is nothing to be careful about either, since nothing is
      // attempted at all.
      continue;
    }
    const result = await applyAction(action, ports, context);
    if (result.ok) {
      reports.push({ kind: action.kind, applied: true, detail: result.value.detail, reason: null, completion: result.value.completion });
      continue;
    }
    reports.push({ kind: action.kind, applied: false, detail: null, reason: result.reason, completion: null });
    if (stopAtFirstFailure) break;
  }
  return reports;
}

/**
 * Applies the teardown a decision owes the world.
 *
 * The list comes from the core — `abortTeardown` in `core/decide.ts` — and is not
 * rebuilt here. It used to be: the core returned a boolean and this file turned it back
 * into `[{ disable-tasks }]`, one action where spec §5 names two, so every automatic
 * abort left `PRE_ARM_CERTIFICATE` in `.env` while reporting a completed teardown. The
 * shell's job is to apply what it is handed, and `stopAtFirstFailure: false` because a
 * disable that failed is no reason to leave the certificate line in place.
 */
export async function applyTeardown(teardown: readonly WorldAction[], ports: ActionPorts | null, context: ActionContext, dryRun: boolean, print: (line: string) => void): Promise<readonly ActionReport[]> {
  return applyAll(teardown, ports, context, dryRun, print, false);
}

function contextFor(deps: InvocationDeps, schedule: Schedule, observations: Observations | null): ActionContext | null {
  const boundary = observations?.executionBoundary;
  if (boundary === undefined || !boundary.known) return null;
  return {
    envFile: deps.envFile,
    repoRoot: schedule.repoRoot,
    activationRoot: schedule.activationRoot,
    anchorDay: schedule.anchorDay,
    nodePath: boundary.value.nodePath,
    taskUserId: boundary.value.taskUserId,
    taskUserSid: boundary.value.taskUserSid,
  };
}

/**
 * A context for the actions an abort or a disarm owes even when no observation was taken
 * — disabling a task needs the task's name, not this host's identity. The fields that
 * only matter to the certificate write are empty on purpose: `applyAction` refuses a
 * certificate write without them, which is the safe direction.
 */
function teardownContext(deps: InvocationDeps, anchorDay: string): ActionContext {
  return { envFile: deps.envFile, repoRoot: deps.repoRoot, activationRoot: deps.activationRoot, anchorDay, nodePath: "", taskUserId: "", taskUserSid: "" };
}

/**
 * The owner's abort knows no anchor day: it is typed at a keyboard, not scheduled, and
 * it names no day on its command line. None of its four actions may use one —
 * `register-disarm` is the only action that reads `anchorDay`, and it is not among them
 * — so the field is empty rather than guessed. `applyAction` refuses a registration
 * without it, which is the safe direction.
 */
function ownerContext(deps: InvocationDeps): ActionContext {
  return { envFile: deps.envFile, repoRoot: deps.repoRoot, activationRoot: deps.activationRoot, anchorDay: "", nodePath: "", taskUserId: "", taskUserSid: "" };
}

async function append(session: ActivationLedgerSession, draft: LedgerDraft): Promise<void> {
  await session.append(draft);
}

/** `status`: the one command that takes no lease and appends nothing. */
async function status(invocation: ActivationInvocation, deps: InvocationDeps): Promise<InvocationResult> {
  const read = deps.readLedger;
  if (read === undefined) return refuse("no ledger reader is bound");
  const snapshot = await read(invocation.stateRoot);
  const fold = foldLedgerSnapshot(snapshot);
  const anchorDay = fold.currentAttempt?.anchorDay ?? null;
  // The schedule is only a projection for the reader. Without the measured facts there
  // is nothing to project and the ledger still reports in full.
  const facts = deps.facts;
  const built = anchorDay === null || facts === null ? null : buildSchedule(anchorDay, facts, deps.toLocal);
  return { outcome: { kind: "reported" }, applied: [], fold, schedule: built !== null && built.ok ? built.schedule : null };
}

/**
 * `run`: what the scheduled task invokes every five minutes.
 *
 * `carried` is the caller's array, not a copy: a teardown that ran inside the lease has to
 * reach the caller even when the invocation leaves through a throw, and a return value
 * cannot carry anything past one.
 */
async function run(invocation: ActivationInvocation, deps: InvocationDeps, schedule: Schedule, carried: ActionReport[] = []): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const anchorDay = schedule.anchorDay;
  let applied: readonly ActionReport[] = [];
  let fold: LedgerFold | null = null;

  const result = await withLedger<InvocationOutcome>(
    {
      root: invocation.stateRoot,
      owner: deps.owner,
      makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], anchorDay), anchorDay }),
    },
    async session => {
      const snapshot = await session.read();
      fold = foldLedgerSnapshot(snapshot);
      const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
      const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);

      // Spec §4: an absent or empty ledger disables both tasks, pages, and opens a new
      // attempt whose first entry records what was found. It does not also act: the next
      // invocation decides, against a ledger that now says where the attempt starts.
      //
      // The second case is the retry of spec §5. An ended attempt for an *earlier* anchor
      // day is history: the new day resets steps 4 and 7 to 11 anyway, so this invocation
      // opens the new day's attempt itself. An ended attempt for *this* anchor day is not
      // reopened here — a same-day retry is the owner's decision and needs
      // `activation open`, or an abort at 22:30 would be undone by the tick at 22:35.
      const ended = fold.attemptEnded !== null;
      const otherDay = fold.currentAttempt !== null && fold.currentAttempt.anchorDay !== anchorDay;
      if (fold.currentAttempt === null || (ended && otherDay)) {
        const found = fold.currentAttempt !== null
          ? `PREVIOUS_ATTEMPT_ENDED_${fold.currentAttempt.anchorDay}`
          : snapshot.state === "absent" ? "LEDGER_ABSENT" : snapshot.state === "empty" ? "LEDGER_EMPTY" : `LEDGER_${snapshot.state.toUpperCase()}`;
        if (fold.currentAttempt === null && snapshot.state !== "absent" && snapshot.state !== "empty") {
          return { kind: "ledger-defect", stage: "read-ledger", reason: found };
        }
        // `fullTeardown`, not `abortTeardown`, and for the same reason as
        // `SCHEDULE_NOT_FOR_THIS_ATTEMPT`: the fold's answer about the gate belongs to the
        // attempt being left behind, not to the day being opened. A previous attempt that
        // reached step 10 and then aborted at step 11 reads `stepDone(fold, "10-gate")`
        // true, so `abortTeardown` would owe **nothing** — and a new anchor day would
        // start on top of the old day's enabled tasks and certificate line. A new day
        // begins clean or it does not begin.
        applied = await applyTeardown(fullTeardown(), deps.actions, teardownContext(deps, schedule.anchorDay), invocation.dryRun, deps.print);
        const attempt = nextAttemptId(snapshot.entries, anchorDay);
        if (!invocation.dryRun) {
          await append(session, openingDraft(found, attempt, anchorDay, stamp, { teardown: applied.map(report => ({ kind: report.kind, applied: report.applied, reason: report.reason })) }));
        }
        return { kind: "opened", attempt, found };
      }

      const attempt = fold.currentAttempt.id;
      const observations = await deps.observe(observationPlanFor(fold));
      const decision = decide(fold, observations, schedule);

      switch (decision.kind) {
        case "wait": {
          const drafted = waitNoteDraft(decision.reason, fold, attempt, anchorDay, stamp);
          if (drafted !== null && !invocation.dryRun) await append(session, drafted);
          return { kind: "waited", reason: decision.reason, noted: drafted !== null && !invocation.dryRun };
        }
        case "ended":
          return { kind: "ended", seq: decision.seq, reason: decision.reason };
        case "done":
          return { kind: "done", reason: decision.reason };
        case "record": {
          if (!invocation.dryRun) await append(session, recordDraft(decision, attempt, anchorDay, stamp));
          return { kind: "recorded", step: decision.step, outcome: decision.outcome };
        }
        case "abort": {
          applied = await applyTeardown(decision.teardown, deps.actions, contextFor(deps, schedule, observations) ?? teardownContext(deps, schedule.anchorDay), invocation.dryRun, deps.print);
          if (!invocation.dryRun) await append(session, abortDraft(decision, attempt, anchorDay, stamp));
          return { kind: "aborted", step: decision.step, reason: decision.reason, teardown: applied, nextOwnerAction: decision.nextOwnerAction };
        }
        case "act": {
          const context = contextFor(deps, schedule, observations);
          if (context === null) {
            return { kind: "work-failed", reason: "the execution boundary could not be read, so no action may be attributed to this host" };
          }
          if (!invocation.dryRun) await append(session, intentDraft(decision, attempt, anchorDay, stamp));
          applied = await applyAll(decision.actions, deps.actions, context, invocation.dryRun, deps.print, true);
          const closing = monotonicStamp(deps.stampAt(deps.now()), { lastSeq: tail.lastSeq + 1, lastAtUtcMs: stamp.atUtcMs }, deps.stampAt);
          const drafted = resultDraft(decision, applied, attempt, anchorDay, closing);
          if (drafted !== null && !invocation.dryRun) {
            // Axiom A4: "an append that fails is itself an abort — disable both tasks,
            // page, exit" (ACT-44, ACT-60). This is the one place where that matters
            // most and where it was not done: the actions above have already landed on
            // the host, so at step 10 the certificate line is durably written, and an
            // append that throws here used to escape to the outermost catch — which
            // applies no teardown at all. The invocation that armed the deployment tore
            // nothing down, and the abort on the next tick, deciding from a ledger that
            // shows an intent and no result, owes only what `abortTeardown` gives it.
            //
            // The teardown runs here, inside the session, because that is where the
            // lease is still held and the action context is still in scope. The store
            // failure is then reported as it was, with what the teardown managed in the
            // outcome rather than a claim that it ran.
            try {
              await append(session, drafted);
            } catch (error) {
              const teardown = await applyTeardown(abortTeardown(fold), deps.actions, context, invocation.dryRun, deps.print);
              applied = [...applied, ...teardown];
              carried.push(...teardown);
              throw error;
            }
          }
          const outcome = drafted === null ? "ok" : (drafted.outcome ?? "unknown");
          return { kind: "acted", step: decision.step, outcome, deferred: drafted === null };
        }
      }
    },
  );

  if (result.kind === "contended") {
    return { outcome: { kind: "yielded", reason: "another invocation holds the activation lease; one note was written and nothing else was done" }, applied: [], fold, schedule };
  }
  return { outcome: result.value, applied, fold, schedule };
}

/**
 * `run`, with its own reports carried out of a failure.
 *
 * The A4 teardown at step 10 runs inside the lease and the store failure is rethrown after
 * it. Without this the throw reached the dispatcher's catch, which knows nothing about what
 * was applied and reports `applied: []` — so an invocation that had just disabled both tasks
 * and removed the certificate line told the owner only that it had failed.
 */
async function runCarryingTeardown(invocation: ActivationInvocation, deps: InvocationDeps, schedule: Schedule): Promise<InvocationResult> {
  const carried: ActionReport[] = [];
  try {
    return await run(invocation, deps, schedule, carried);
  } catch (error) {
    const failure = storeFailure(error);
    return { outcome: failure.kind === "work-failed" ? { ...failure, teardown: carried } : failure, applied: carried, fold: null, schedule };
  }
}

/**
 * `abort --confirm` (spec §5, ACT-27). The teardown runs first and is idempotent; the
 * terminal entry is written afterwards, under a bounded wait. If the entry cannot be
 * written the command says so and exits non-zero, because an owner who typed the abort
 * and got a shrug would go to bed believing the run was stopped.
 */
async function abort(invocation: ActivationInvocation, deps: InvocationDeps): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const context = ownerContext(deps);
  // Every part of the teardown is attempted, whatever the part before it did: the owner
  // typed a stop, and a failed disable is a reason to keep going, not to stop halfway.
  const applied = await applyAll(
    [{ kind: "disable-tasks", tasks: BOTH_TASKS }, { kind: "remove-certificate-line" }, { kind: "delete-disarm" }, { kind: "clear-checks" }],
    deps.actions,
    context,
    invocation.dryRun,
    deps.print,
    false,
  );

  let fold: LedgerFold | null = null;
  // Only used when the ledger has no entry at all to take an attempt from — a ledger on
  // which there is nothing to abort in the first place.
  const today = deps.stampAt(deps.now()).at.slice(0, 10);
  const result = await withLedger<InvocationOutcome>(
    {
      root: invocation.stateRoot,
      owner: deps.owner,
      makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], today), anchorDay: today }),
      contentionTimeoutMs: 30_000,
    },
    async session => {
      const snapshot = await session.read();
      fold = foldLedgerSnapshot(snapshot);
      const attempt = fold.currentAttempt;
      const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
      const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);
      if (attempt === null) {
        // The teardown has already run — it runs before the lease, deliberately — and this
        // branch used to append nothing at all, so a deliberate stop against a fresh or
        // rotated state root left no trace in the append-only record: both tasks disabled,
        // the certificate line gone, the disarm deleted, and a console line in a context
        // that may never show one. A note, not a terminal entry: there is no attempt to end.
        const today = stamp.at.slice(0, 10);
        if (!invocation.dryRun) await append(session, ownerAbortWithoutAttemptDraft(invocation.operator ?? "", nextAttemptId(snapshot.entries, today), today, stamp, applied));
        return { kind: "refused", reason: `no attempt is open, so there is nothing to end; ${teardownClauseOrSilence(applied)}` };
      }
      if (fold.attemptEnded !== null) {
        return { kind: "ended", seq: fold.attemptEnded.seq, reason: `attempt ${attempt.id} was already ended at seq ${String(fold.attemptEnded.seq)}; ${teardownClauseOrSilence(applied)}` };
      }
      if (!invocation.dryRun) await append(session, ownerAbortDraft(invocation.operator ?? "", attempt.id, attempt.anchorDay, stamp, applied));
      return { kind: "aborted", step: null, reason: "OWNER_ABORT", teardown: applied, nextOwnerAction: "The attempt is ended. Open a new one when the run is to continue." };
    },
  );

  if (result.kind === "contended") {
    return { outcome: { kind: "work-failed", reason: "another invocation holds the lease, so the terminal entry was not written. Retry the abort.", teardown: applied }, applied, fold, schedule: null };
  }
  return { outcome: result.value, applied, fold, schedule: null };
}

/**
 * `disarm` — the 15:05 one-shot of spec §6. The rule is one sentence: disable both tasks
 * unless the ledger shows a green gate for this anchor day, and disable them when the
 * ledger cannot be read at all.
 */
async function disarm(invocation: ActivationInvocation, deps: InvocationDeps, anchorDay: string): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const context = teardownContext(deps, anchorDay);
  let fold: LedgerFold | null = null;

  try {
    const result = await withLedger<InvocationOutcome>(
      {
        root: invocation.stateRoot,
        owner: deps.owner,
        makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], anchorDay), anchorDay: anchorDay }),
        // The one-shot fires at 15:05 and owes its answer in seconds, not in the store's
        // default five. Whatever it cannot resolve in that time it resolves by disabling,
        // which is the direction this command exists for.
        contentionTimeoutMs: 2_000,
      },
      async session => {
        const snapshot = await session.read();
        fold = foldLedgerSnapshot(snapshot);
        const attempt = fold.currentAttempt;
        // `stepDone` is this codebase's definition of a finished step, and the disarm
        // uses it rather than inventing a stricter second one: a gate recorded as
        // `already_in_target_state` met the same conjunction as one recorded `ok`.
        const green = attempt !== null
          && attempt.anchorDay === anchorDay
          && fold.attemptEnded === null
          && stepDone(fold, "10-gate");
        const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
        const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);
        const id = attempt?.id ?? nextAttemptId(snapshot.entries, anchorDay);
        const day = attempt?.anchorDay ?? anchorDay;

        if (green) {
          if (!invocation.dryRun) {
            await append(session, { at: stamp.at, atUtcMs: stamp.atUtcMs, attempt: id, anchorDay: day, step: null, kind: "note", outcome: null, evidence: { disarm: "GATE_GREEN", tasksLeftEnabled: true }, nextOwnerAction: null });
          }
          return { kind: "recorded", step: "10-gate", outcome: "already_in_target_state" };
        }
        const reports = await applyTeardown(fullTeardown(), deps.actions, context, invocation.dryRun, deps.print);
        if (!invocation.dryRun) {
          await append(session, { at: stamp.at, atUtcMs: stamp.atUtcMs, attempt: id, anchorDay: day, step: null, kind: "note", outcome: null, evidence: { disarm: "NO_GREEN_GATE", actions: reports.map(report => ({ kind: report.kind, applied: report.applied, reason: report.reason })) }, nextOwnerAction: null });
        }
        return { kind: "aborted", step: null, reason: "DISARMED", teardown: reports, nextOwnerAction: `The disarm one-shot found no green gate: ${teardownClauseOrSilence(reports)}. Read the ledger before the next attempt.` };
      },
    );
    if (result.kind === "contended") {
      // A live invocation may be mid-gate. The one-shot still owes the world its
      // disable: the gate either wrote its result before 15:05 or it did not.
      const reports = await applyTeardown(fullTeardown(), deps.actions, context, invocation.dryRun, deps.print);
      return { outcome: { kind: "aborted", step: null, reason: "DISARMED_UNDER_CONTENTION", teardown: reports, nextOwnerAction: `The disarm ran while another invocation held the lease: ${teardownClauseOrSilence(reports)}. Read the ledger.` }, applied: reports, fold, schedule: null };
    }
    // What the disarm applied travels in `applied` like every other command's does; it
    // used to live only inside the outcome, so a caller reading `result.applied` was told
    // nothing had happened by the one command whose whole purpose is to act.
    return { outcome: result.value, applied: result.value.kind === "aborted" ? result.value.teardown : [], fold, schedule: null };
  } catch (error) {
    // Fail safe, not closed: a ledger that cannot be read is exactly the case the
    // disarm exists for (spec §6; residual G1, an unparseable `ledger.lock`).
    const reports = await applyTeardown(fullTeardown(), deps.actions, context, invocation.dryRun, deps.print);
    const failure = storeFailure(error);
    const detail = failure.kind === "ledger-defect" ? `${failure.stage}:${failure.reason}` : failure.kind;
    return {
      outcome: { kind: "aborted", step: null, reason: `DISARMED_LEDGER_UNREADABLE (${detail})`, teardown: reports, nextOwnerAction: `The disarm could not read the ledger: ${teardownClauseOrSilence(reports)}. Read the activation state root by hand before anything else.` },
      applied: reports,
      fold,
      schedule: null,
    };
  }
}

/**
 * `open --anchor-day <day> --operator <name>` — the owner's retry (spec §5, "Retry on the
 * next trading day"). An `abort` ends an attempt for good, and no tick may undo that on
 * its own; when the owner has read the ledger and wants the run continued, this is where
 * that decision is written down, with a name on it.
 *
 * It opens nothing while an attempt is still running: that would give one anchor day two
 * open attempts and make the fold ambiguous.
 */
async function open(invocation: ActivationInvocation, deps: InvocationDeps, schedule: Schedule): Promise<InvocationResult> {
  const withLedger = deps.withLedger ?? withActivationLedger;
  const anchorDay = schedule.anchorDay;
  let fold: LedgerFold | null = null;

  const result = await withLedger<InvocationOutcome>(
    {
      root: invocation.stateRoot,
      owner: deps.owner,
      makeSystemDraft: systemDraftFactory({ nowUtcMs: deps.now(), stampAt: deps.stampAt, attempt: nextAttemptId([], anchorDay), anchorDay }),
    },
    async session => {
      const snapshot = await session.read();
      fold = foldLedgerSnapshot(snapshot);
      if (snapshot.state === "corrupt") {
        return { kind: "ledger-defect", stage: "read-ledger", reason: "LEDGER_CORRUPT" };
      }
      if (fold.currentAttempt !== null && fold.attemptEnded === null) {
        return { kind: "refused", reason: `attempt ${fold.currentAttempt.id} is still open for anchor day ${fold.currentAttempt.anchorDay}; end it before opening another` };
      }
      const tail = { lastSeq: snapshot.entries.at(-1)?.seq ?? 0, lastAtUtcMs: snapshot.entries.at(-1)?.atUtcMs ?? null };
      const stamp = monotonicStamp(deps.stampAt(deps.now()), tail, deps.stampAt);
      const attempt = nextAttemptId(snapshot.entries, anchorDay);
      const previous = fold.currentAttempt?.id ?? null;
      if (!invocation.dryRun) {
        await append(session, openingDraft("OWNER_OPENED", attempt, anchorDay, stamp, { operator: invocation.operator ?? "", previousAttempt: previous }));
      }
      return { kind: "opened", attempt, found: "OWNER_OPENED" };
    },
  );

  if (result.kind === "contended") {
    return { outcome: { kind: "refused", reason: "another invocation holds the lease; nothing was opened. Try again in a moment." }, applied: [], fold, schedule };
  }
  return { outcome: result.value, applied: [], fold, schedule };
}

/** One invocation, end to end. Every failure that is not the CLI's own is classified, never thrown. */
export async function invoke(invocation: ActivationInvocation, deps: InvocationDeps): Promise<InvocationResult> {
  if (invocation.command === "status") {
    try {
      return await status(invocation, deps);
    } catch (error) {
      return { outcome: storeFailure(error), applied: [], fold: null, schedule: null };
    }
  }

  if (invocation.command === "abort") {
    try {
      return await abort(invocation, deps);
    } catch (error) {
      return { outcome: storeFailure(error), applied: [], fold: null, schedule: null };
    }
  }

  // `run`, `open` and `disarm` all carry an anchor day; the parser refuses them without one.
  const anchorDay = invocation.anchorDay;
  if (anchorDay === null) return refuse(`${invocation.command} needs an anchor day`);

  // The disarm is dispatched before the schedule is built, because it needs no measured
  // fact — only the day on its own command line and the two paths every command knows.
  // It used to share the schedule build with `run` and `open`, which meant the one
  // command whose whole purpose is to make the deployment safe could be stopped by a
  // missing or malformed host file. The 15:05 one-shot must not have a prerequisite it
  // does not consume.
  if (invocation.command === "disarm") {
    try {
      return await disarm(invocation, deps, anchorDay);
    } catch (error) {
      return { outcome: storeFailure(error), applied: [], fold: null, schedule: null };
    }
  }

  const facts = deps.facts;
  if (facts === null) return refuse("ops/activation/deployment.json could not be read, and this command needs the facts it carries");
  const built = buildSchedule(anchorDay, facts, deps.toLocal);
  if (!built.ok) return refuse(built.reason);
  const schedule = built.schedule;

  try {
    if (invocation.command === "run") return await runCarryingTeardown(invocation, deps, schedule);
    return await open(invocation, deps, schedule);
  } catch (error) {
    return { outcome: storeFailure(error), applied: [], fold: null, schedule };
  }
}
