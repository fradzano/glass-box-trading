// Pure admission rule for the externally stateful certificate CLI. Runtime
// construction acquires writer authority, so the role check must happen before
// even preflight builds the runtime.
export type CertificateCommandAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export function admitCertificateCommand(input: { readonly profile: string | undefined; readonly ownerGo: boolean; readonly preflight: boolean }): CertificateCommandAdmission {
  if (input.profile !== "dev") return { ok: false, reason: "every certificate command, including preflight, uses the dev account only" };
  if (!input.ownerGo && !input.preflight) return { ok: false, reason: "the dev live test starts only with an explicit owner go (--owner-go)" };
  return { ok: true };
}
