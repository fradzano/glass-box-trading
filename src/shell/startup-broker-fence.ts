// Durable refusal after configuration validation but before the real broker
// gateway exists. This gateway has no broker capability. It first uses the
// monotonic safety interlock so a fresh rival holder cannot suppress the halt;
// only an absent store needs authority acquisition to establish an epoch.
import type { HaltReason, JournalDraft } from "../core/journal.js";
import { epochMsToUtcIso } from "../core/execution.js";
import { releaseHolder } from "./epoch-store.js";
import { createMutationGateway, NO_BROKER_PORT } from "./mutation-gateway.js";
import type { PingPort } from "./cycle-runner.js";
import type { StatePaths } from "./state-dir.js";

export interface StartupBrokerFenceOptions {
  readonly paths: StatePaths;
  readonly secrets: readonly string[];
  readonly clock: () => number;
  readonly instanceId: string;
  readonly lockTakeoverBoundMs: number;
  readonly reason: Extract<HaltReason, "AUTH_FAILURE" | "ACCOUNT_BINDING_MISMATCH">;
  readonly detail: string;
  readonly ping: PingPort;
}

export async function recordStartupBrokerFence(options: StartupBrokerFenceOptions): Promise<boolean> {
  const gateway = createMutationGateway({
    paths: options.paths,
    secrets: options.secrets,
    clock: options.clock,
    brokerPort: NO_BROKER_PORT,
    instanceId: options.instanceId,
    lockTakeoverBoundMs: options.lockTakeoverBoundMs,
  });
  const safetyAction = { reason: options.reason, detail: options.detail } as const;
  let journaled = (await gateway.dispatchSafetyHalt(safetyAction)).ok;
  if (!journaled) {
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    if (acquired.kind === "WON" || acquired.kind === "GAP_HALT") {
      const entry: JournalDraft = { at: epochMsToUtcIso(options.clock()), epoch: acquired.epoch, type: "HALT", reason: options.reason, detail: options.detail, sticky: false };
      const appended = await gateway.dispatch({
        class: "authoritative",
        epoch: acquired.epoch,
        action: { kind: "journal_append", entry },
      });
      journaled = appended.ok;
    } else {
      // The store may have appeared or changed between the first interlock
      // attempt and acquisition. Retry without disturbing the winning holder.
      journaled = (await gateway.dispatchSafetyHalt(safetyAction)).ok;
    }
  }
  try {
    await options.ping.fail([options.reason]);
  } catch {
    // The durable local fence remains authoritative when alert delivery fails.
  }
  await releaseHolder(options.paths, options.instanceId);
  return journaled;
}
