// The owner's stop, as a decision rather than as an ordering (unit 10, revision of
// 2026-09-19). `docs/P12-STOP-AND-LOG-CONTRACTS.md`, part I.
//
// The problem this module exists for: `abort --confirm` disarms **before** it takes the
// activation lease, deliberately — a stop that waits for a running invocation's lease is
// a stop that did not happen when it was typed (spec §5, ACT-27). The price was R2-03: a
// tick that is already inside `act` holds the lease, decided its actions a minute before
// the abort, and applies them afterwards. Measured by a gate as two real OS processes:
// after an owner abort both trading tasks stood **enabled**, the disarm one-shot was
// deleted, and the terminal ledger entry asserted `disable-tasks applied: true`.
//
// Serialising the two commands cannot fix it without giving up the ordering that makes a
// stop immediate. So the stop leaves a **mark** instead, and every action asks the mark
// whether it may still arm anything. The mark is the fact; the ordering stays.
import type { WorldAction } from "./types.ts";

/**
 * What the owner's stop wrote down. It is the whole mark: a reader that can produce these
 * four fields knows a stop stands, who typed it and when, without reading the ledger.
 */
export interface StopMark {
  readonly operator: string;
  /** Local time with its offset, the same shape every ledger entry carries. */
  readonly at: string;
  readonly atUtcMs: number;
  readonly reason: string;
}

/**
 * What a reader of the mark may find. `unreadable` is a third state on purpose: an answer
 * that cannot be obtained is not an absence, and the whole point of the mark is that
 * "there is no stop" must be *established* rather than assumed.
 */
export type StopMarkState =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly mark: StopMark }
  | { readonly kind: "unreadable"; readonly reason: string };

/**
 * Does this action arm the deployment, or disarm it?
 *
 * The distinction is the whole of SC-3. A stop must never block another stop: the disarm
 * one-shot still has to disable both tasks at 15:05 after an owner abort at 14:00, and an
 * automatic abort still has to remove the certificate line. What a stop forbids is
 * everything that puts the deployment back into a state where it can trade or reboot.
 *
 * `install-tasks` counts as arming although the installer registers both tasks disabled:
 * it rewrites the definitions the gate later asserts by value, and after a stop nothing
 * should be rewriting them. `register-disarm` counts as arming because it belongs to the
 * attempt's own progression; the one-shot it registers is deleted by the stop's teardown
 * and re-registering it would put a trigger back on a stopped deployment.
 */
export function armsDeployment(kind: WorldAction["kind"]): boolean {
  switch (kind) {
    case "enable-tasks":
    case "write-certificate-line":
    case "install-tasks":
    case "register-disarm":
    case "restart":
      return true;
    case "disable-tasks":
    case "remove-certificate-line":
    case "delete-disarm":
    case "clear-checks":
      return false;
  }
}

/**
 * May this action be applied, given what the state root says about a stop?
 *
 * Returns `null` when it may, and the credential-free reason when it may not. The reason
 * is what lands in the action report, in the ledger and in the line the owner reads, so
 * it names the stop rather than describing a policy.
 *
 * An unreadable mark refuses every arming action. That is the safe direction and it is a
 * real cost, named here rather than discovered later: a state root whose `stop.json`
 * cannot be read stops the activation from arming anything, loudly, until someone looks.
 * The alternative — treating an unreadable answer as "no stop" — is the exact shape of
 * the defect this module exists to close.
 */
export function stopRefusal(kind: WorldAction["kind"], state: StopMarkState): string | null {
  if (!armsDeployment(kind)) return null;
  if (state.kind === "present") {
    return `STOPPED_BY_OWNER: ${state.mark.operator} stopped this deployment at ${state.mark.at} (${state.mark.reason}). Run 'activation open' to continue it.`;
  }
  if (state.kind === "unreadable") {
    return `STOP_MARK_UNREADABLE: ${state.reason}. Whether the owner stopped this deployment cannot be established, so nothing is armed.`;
  }
  return null;
}

/** The one sentence `status` prints about a stop, built from the state and nothing else. */
export function stopMarkLine(state: StopMarkState): string {
  switch (state.kind) {
    case "absent":
      return "stop         none: no owner stop stands over this state root";
    case "present":
      return `STOPPED      by ${state.mark.operator} at ${state.mark.at} (${state.mark.reason}); nothing will be armed until 'activation open' clears it`;
    case "unreadable":
      return `STOP UNKNOWN the stop mark could not be read (${state.reason}); every arming action refuses while this stands`;
  }
}
