// Shell half of the certificate command admission: reads `.env` and the
// process environment, turns both STATE_DIR spellings into physical-directory
// keys, and hands the facts to the pure rule. It creates nothing — unlike
// `resolveStateDir`, which makes `quarantine/` on every read — because a
// refused command must leave the competition directory exactly as it found it.
import { realpathSync } from "node:fs";
import path from "node:path";
import { admitCertificateCommand } from "./certificate-command-guard.js";
import type { CertificateCommandAdmission } from "./certificate-command-guard.js";
import { loadEnvironment, readDotEnv } from "./runtime-config.js";
import type { EnvRecord } from "./runtime-config.js";

/**
 * One key per physical directory: the same identity `resolveStateDir` uses
 * (`realpathSync.native`, so `C:\x`, `c:\X\` and `\\?\C:\x` agree), with the
 * case folded on Windows for a directory that does not exist yet.
 */
export function stateDirKey(raw: string | undefined, platform: NodeJS.Platform): string | null {
  if (raw === undefined || raw.trim().length === 0 || !path.isAbsolute(raw)) return null;
  const resolved = path.resolve(raw);
  let physical = resolved;
  try {
    physical = realpathSync.native(resolved);
  } catch {
    // A directory that does not exist cannot be the competition directory
    // unless its spelling is; the spelling is compared instead.
  }
  return platform === "win32" ? physical.toLowerCase() : physical;
}

export function admitCertificateInvocation(input: { readonly repoRoot: string; readonly processEnv: EnvRecord; readonly args: readonly string[]; readonly platform: NodeJS.Platform }): CertificateCommandAdmission {
  const dotEnv = readDotEnv(input.repoRoot);
  const effective = loadEnvironment(input.repoRoot, input.processEnv);
  return admitCertificateCommand({
    profile: effective["ALPACA_PROFILE"],
    ownerGo: input.args.includes("--owner-go"),
    preflight: input.args.includes("--preflight"),
    stateDirs: {
      dotEnvProfile: dotEnv["ALPACA_PROFILE"],
      dotEnvStateDirKey: stateDirKey(dotEnv["STATE_DIR"], input.platform),
      effectiveStateDirKey: stateDirKey(effective["STATE_DIR"], input.platform),
    },
  });
}
