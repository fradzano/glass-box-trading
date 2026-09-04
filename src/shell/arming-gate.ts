// The competition arming gate (S-ARM-01 / S-CYC-11: WIN-7, WIN-10). Startup
// validation only proves that `PRE_ARM_CERTIFICATE` is present; presence is
// not proof. This module resolves that path, reads the file, parses it fail
// closed, and hands the parsed document plus the deployment's own digests to
// the pure `validateArmingCertificate`. Every decision — schema, verdict,
// role, origin, evidence shapes, self-digest, digest equality — lives in the
// core; the shell here reads bytes and reports a closed verdict.
//
// The profile guard lives inside the gate on purpose: a competition runtime
// cannot skip the certificate by an edit at the call site, and the dev profile
// provably never touches the file (no read is issued at all).
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateArmingCertificate } from "../core/certificate.js";

/** The refusal code a competition runtime halts under when the certificate does not authorize this deployment. */
export const ARMING_CERTIFICATE_INVALID = "ARMING_CERTIFICATE_INVALID";

export type ArmingVerdict =
  | { readonly armed: true; readonly certificateChecked: boolean; readonly successfulDevLiveTestAt: string | null }
  | { readonly armed: false; readonly reasons: readonly string[] };

export interface ArmingGateInput {
  readonly profile: "dev" | "competition";
  /** Certificate paths are recorded repository-relative (`evidence/pre-arm/*.json`); an absolute path is taken as given. */
  readonly repoRoot: string;
  /** The §0 record the validator saw; `PRE_ARM_CERTIFICATE` is a deployment field and never reaches `ValidatedStartup`. */
  readonly rawConfig: Readonly<Record<string, unknown>>;
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly canonicalTradingOrigin: string;
  /** The one impure dependency, injectable so a test can prove the dev profile issues no read at all. */
  readonly readFile?: (file: string) => string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The configured certificate location as an absolute path, or null when the field does not name a file. */
export function resolveCertificatePath(repoRoot: string, configured: unknown): string | null {
  if (typeof configured !== "string") return null;
  const trimmed = configured.trim();
  if (trimmed.length === 0) return null;
  return path.resolve(repoRoot, trimmed);
}

/**
 * The competition arming decision. A dev runtime is unaffected and reads
 * nothing. A competition runtime arms only when the file exists, parses, and
 * the pure core accepts it against this deployment's runtime digest, policy
 * digest, and canonical trading origin. Every other outcome is a refusal
 * carrying the core's own violation list.
 */
export function evaluateArmingGate(input: ArmingGateInput): ArmingVerdict {
  if (input.profile !== "competition") return { armed: true, certificateChecked: false, successfulDevLiveTestAt: null };

  const file = resolveCertificatePath(input.repoRoot, input.rawConfig["PRE_ARM_CERTIFICATE"]);
  if (file === null) return { armed: false, reasons: ["PRE_ARM_CERTIFICATE does not name a certificate file"] };

  const read = input.readFile ?? ((target: string): string => readFileSync(target, "utf8"));
  let text: string;
  try {
    text = read(file);
  } catch (error) {
    return { armed: false, reasons: [`certificate file could not be read (${file}): ${describeError(error)}`] };
  }

  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
  } catch (error) {
    return { armed: false, reasons: [`certificate file is not valid JSON (${file}): ${describeError(error)}`] };
  }

  const validation = validateArmingCertificate(document, {
    runtimeDigest: input.runtimeDigest,
    policyDigest: input.policyDigest,
    canonicalTradingOrigin: input.canonicalTradingOrigin,
  });
  if (!validation.ok) return { armed: false, reasons: validation.violations };
  return { armed: true, certificateChecked: true, successfulDevLiveTestAt: validation.successfulDevLiveTestAt };
}
