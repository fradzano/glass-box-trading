// The one human path that clears the halt flag (S-G12-04). It is not
// reachable from the cycle runtime: no agent code imports this module, and
// the gateway's ordinary dispatch refuses UNHALT outright. The action is
// journaled with the operator and reason before the flag changes.
import { createMutationGateway, NO_BROKER_PORT } from "./mutation-gateway.js";
import type { DispatchResult } from "./mutation-gateway.js";
import type { StatePaths } from "./state-dir.js";

export interface ManualUnhaltOptions {
  readonly paths: StatePaths;
  readonly operator: string;
  readonly reason: string;
  readonly clock: () => number;
  readonly secrets: readonly string[];
  readonly instanceId: string;
  readonly lockTakeoverBoundMs: number;
}

export async function manualUnhalt(options: ManualUnhaltOptions): Promise<DispatchResult> {
  const gateway = createMutationGateway({
    paths: options.paths,
    secrets: options.secrets,
    clock: options.clock,
    brokerPort: NO_BROKER_PORT,
    instanceId: options.instanceId,
    lockTakeoverBoundMs: options.lockTakeoverBoundMs,
  });
  return gateway.dispatchManualUnhalt({ operator: options.operator, reason: options.reason });
}
