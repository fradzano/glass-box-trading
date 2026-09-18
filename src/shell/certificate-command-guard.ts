// Pure admission rule for the externally stateful certificate CLI. Runtime
// construction acquires writer authority, so the role check must happen before
// even preflight builds the runtime.
export type CertificateCommandAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * What the shell could establish about one directory. The third state is the
 * point: a directory whose physical identity could not be read is not a
 * different directory, and treating it as one admitted a command that a
 * readable host refuses.
 */
export type StateDirIdentity =
  | { readonly kind: "none" }
  | { readonly kind: "key"; readonly value: string }
  | { readonly kind: "unknown"; readonly code: string };

/**
 * The directories a certificate command would touch, as facts the shell
 * established (`certificate-admission.ts`): one physical directory has one key,
 * whatever its spelling. `none` means no usable absolute path; runtime
 * construction refuses that on its own.
 */
export interface CertificateStateDirs {
  /** Whether `.env` could be read at all — an unreadable file is not an absent one. */
  readonly dotEnvRead: "parsed" | "absent" | "unreadable";
  /** Keys `.env` assigns more than once, so that what it names is not a matter of line order. */
  readonly duplicateKeys: readonly string[];
  /** `ALPACA_PROFILE` as the `.env` file says it, before process variables win. */
  readonly dotEnvProfile: string | undefined;
  /** The identity of `STATE_DIR` as the `.env` file names it. */
  readonly dotEnvStateDir: StateDirIdentity;
  /** The identity of `STATE_DIR` as the command will resolve it (process variables win). */
  readonly effectiveStateDir: StateDirIdentity;
}

/** The `.env` keys whose ambiguity would decide this admission, so a second line for one of them is refused rather than resolved. */
const DECIDING_KEYS = ["ALPACA_PROFILE", "STATE_DIR"] as const;

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
  const { dotEnvRead, duplicateKeys, dotEnvProfile, dotEnvStateDir, effectiveStateDir } = input.stateDirs;
  if (dotEnvRead === "unreadable") return { ok: false, reason: ".env exists but could not be read, so the competition state directory cannot be ruled out; retry once the file is readable" };
  const ambiguous = DECIDING_KEYS.filter(key => duplicateKeys.includes(key));
  if (ambiguous.length > 0) return { ok: false, reason: `.env assigns ${ambiguous.join(" and ")} on more than one line; what it names must not depend on line order` };
  if (dotEnvProfile === "competition") {
    if (dotEnvStateDir.kind === "unknown" || effectiveStateDir.kind === "unknown") return { ok: false, reason: "the state directory's physical identity could not be established, so it cannot be told apart from the competition one" };
    if (dotEnvStateDir.kind === "key" && effectiveStateDir.kind === "key" && effectiveStateDir.value === dotEnvStateDir.value) {
      return { ok: false, reason: "STATE_DIR resolves to the competition state directory that .env names; set the dev STATE_DIR for this command" };
    }
  }
  if (!input.ownerGo && !input.preflight) return { ok: false, reason: "the dev live test starts only with an explicit owner go (--owner-go)" };
  return { ok: true };
}
