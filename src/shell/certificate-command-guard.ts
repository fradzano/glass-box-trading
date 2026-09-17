// Pure admission rule for the externally stateful certificate CLI. Runtime
// construction acquires writer authority, so the role check must happen before
// even preflight builds the runtime.
export type CertificateCommandAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * The directories a certificate command would touch, as comparison keys the
 * shell derived (`certificate-admission.ts`): one physical directory has one
 * key, whatever its spelling. `null` means no usable absolute path; runtime
 * construction refuses that on its own.
 */
export interface CertificateStateDirs {
  /** `ALPACA_PROFILE` as the `.env` file says it, before process variables win. */
  readonly dotEnvProfile: string | undefined;
  /** The key of `STATE_DIR` as the `.env` file names it. */
  readonly dotEnvStateDirKey: string | null;
  /** The key of `STATE_DIR` as the command will resolve it (process variables win). */
  readonly effectiveStateDirKey: string | null;
}

/**
 * Supervised harness bounds are executable/runtime identity, not ambient
 * operator input. Changing one changes runtimeDigest and requires a new review.
 */
export const CERTIFICATE_RUN_LIMITS = Object.freeze({
  maxEntryCycles: 8,
  entryIntervalMs: 3 * 60_000,
  patienceCycles: 3,
  maxFlattenCycles: 20,
  flattenIntervalMs: 60_000,
});

export function admitCertificateCommand(input: { readonly profile: string | undefined; readonly ownerGo: boolean; readonly preflight: boolean; readonly stateDirs: CertificateStateDirs }): CertificateCommandAdmission {
  if (input.profile !== "dev") return { ok: false, reason: "every certificate command, including preflight, uses the dev account only" };
  const { dotEnvProfile, dotEnvStateDirKey, effectiveStateDirKey } = input.stateDirs;
  if (dotEnvProfile === "competition" && dotEnvStateDirKey !== null && effectiveStateDirKey === dotEnvStateDirKey) {
    return { ok: false, reason: "STATE_DIR resolves to the competition state directory that .env names; set the dev STATE_DIR for this command" };
  }
  if (!input.ownerGo && !input.preflight) return { ok: false, reason: "the dev live test starts only with an explicit owner go (--owner-go)" };
  return { ok: true };
}
