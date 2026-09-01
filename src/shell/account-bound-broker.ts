// S-J-06 at the real mutation boundary: the configured account identity and
// the account reported by the active credentials are independent sources.
// The wrapper re-observes that identity before every broker mutation; a
// successful startup observation is not a lifetime credential guarantee.
import { bindAccount } from "../core/authority.js";
import type { BindingConfig, BindingResult } from "../core/authority.js";
import type { AccountBinding } from "../core/journal.js";
import { AccountBindingError } from "./broker-errors.js";
import type { BrokerMutationPort } from "./mutation-gateway.js";

export interface AccountBindingObservationPort {
  readonly profile: string;
  readonly requestedOrigin: string;
  readonly observedOrigin: string;
  readonly config: BindingConfig;
  readonly brokerReportedAccountId: (deadlineAtMs?: number) => Promise<string | undefined>;
}

export async function verifyActiveAccount(port: AccountBindingObservationPort, deadlineAtMs?: number): Promise<BindingResult> {
  const brokerReportedAccountId = await port.brokerReportedAccountId(deadlineAtMs);
  return bindAccount(port.config, {
    profile: port.profile,
    requestedOrigin: port.requestedOrigin,
    observedOrigin: port.observedOrigin,
    brokerReportedAccountId,
  });
}

export function createAccountBoundBrokerPort(options: AccountBindingObservationPort & { readonly expectedBinding: AccountBinding; readonly delegate: BrokerMutationPort; readonly clock?: () => number }): BrokerMutationPort {
  return {
    async mutate(mutation) {
      const observed = await verifyActiveAccount(options, mutation.notAfterMs);
      if (!observed.ok) throw new AccountBindingError(observed.reason);
      const binding = observed.binding;
      if (binding.profile !== options.expectedBinding.profile || binding.tradingOrigin !== options.expectedBinding.tradingOrigin || binding.accountId !== options.expectedBinding.accountId) {
        throw new AccountBindingError("VERIFIED_BINDING_CHANGED");
      }
      if (mutation.notAfterMs !== undefined && (options.clock ?? Date.now)() >= mutation.notAfterMs) throw new Error("CYCLE_WALLTIME_EXCEEDED");
      return options.delegate.mutate(mutation);
    },
  };
}
