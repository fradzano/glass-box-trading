// Pure admission rule for the externally stateful certificate CLI. Runtime
// construction acquires writer authority, so the role check must happen before
// even preflight builds the runtime.
export type CertificateCommandAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

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

export function admitCertificateCommand(input: { readonly profile: string | undefined; readonly ownerGo: boolean; readonly preflight: boolean }): CertificateCommandAdmission {
  if (input.profile !== "dev") return { ok: false, reason: "every certificate command, including preflight, uses the dev account only" };
  if (!input.ownerGo && !input.preflight) return { ok: false, reason: "the dev live test starts only with an explicit owner go (--owner-go)" };
  return { ok: true };
}
