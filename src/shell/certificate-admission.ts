// Shell half of the certificate command admission: reads `.env` and the
// process environment, turns both STATE_DIR spellings into physical-directory
// identities, and hands the facts to the pure rule. It creates nothing — unlike
// `resolveStateDir`, which makes `quarantine/` on every read — because a
// refused command must leave the competition directory exactly as it found it.
// It also returns the environment it admitted: the runtime is built from that
// snapshot rather than from a second read of `.env`, so the profile the guard
// cleared is the profile the runtime binds.
import { realpathSync } from "node:fs";
import path from "node:path";
import { admitCertificateCommand } from "./certificate-command-guard.js";
import type { CertificateCommandAdmission, StateDirIdentity } from "./certificate-command-guard.js";
import { isCanonicalLocalRoot } from "./physical-path.js";
import { mergeEnvironment, readDotEnvStrict } from "./runtime-config.js";
import type { EnvRecord } from "./runtime-config.js";

/**
 * One key per physical directory: the same identity `resolveStateDir` uses
 * (`realpathSync.native`, so `C:\x`, `c:\X\` and `\\?\C:\x` agree), with the
 * case folded on Windows for a directory that does not exist yet. A directory
 * that is there but whose identity cannot be read is `unknown`, never a key:
 * falling back to the spelling would let a junction or `\\?\` alias of the
 * competition directory pass as somewhere else.
 */
export function stateDirIdentity(raw: string | undefined, platform: NodeJS.Platform, resolvePhysical: (value: string) => string = value => realpathSync.native(value)): StateDirIdentity {
  if (raw === undefined || raw.trim().length === 0 || !path.isAbsolute(raw)) return { kind: "none" };
  const resolved = path.resolve(raw);
  const fold = (value: string): string => platform === "win32" ? value.toLowerCase() : value;
  try {
    const physical = resolvePhysical(resolved);
    // A spelling `realpathSync.native` cannot collapse — a UNC or network path —
    // is not a second directory, it is one directory under a second identity.
    // Comparing it as a key would let an alias of the competition directory pass
    // as somewhere else, so it counts as an identity that was never established.
    if (!isCanonicalLocalRoot(physical, platform)) return { kind: "unknown", code: "NOT_DRIVE_ROOTED" };
    return { kind: "key", value: fold(physical) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    // A directory that does not exist cannot be the competition directory
    // unless its spelling is; the spelling is compared instead. Every other
    // failure — a permission bit, a stalled mount, too many handles — leaves
    // the identity genuinely unknown, and the rule refuses on that.
    return code === "ENOENT" ? { kind: "key", value: fold(resolved) } : { kind: "unknown", code };
  }
}

export interface CertificateInvocationAdmission {
  readonly admission: CertificateCommandAdmission;
  /** The environment the admission judged; the runtime is built from exactly this. */
  readonly environment: EnvRecord;
}

export function admitCertificateInvocation(input: { readonly repoRoot: string; readonly processEnv: EnvRecord; readonly args: readonly string[]; readonly platform: NodeJS.Platform }): CertificateInvocationAdmission {
  const dotEnv = readDotEnvStrict(input.repoRoot);
  const dotEnvValues = dotEnv.kind === "parsed" ? dotEnv.entries.values : {};
  const environment = mergeEnvironment(dotEnvValues, input.processEnv);
  const admission = admitCertificateCommand({
    profile: environment["ALPACA_PROFILE"],
    ownerGo: input.args.includes("--owner-go"),
    preflight: input.args.includes("--preflight"),
    stateDirs: {
      dotEnvRead: dotEnv.kind,
      duplicateKeys: dotEnv.kind === "parsed" ? dotEnv.entries.duplicateKeys : [],
      dotEnvProfile: dotEnvValues["ALPACA_PROFILE"],
      dotEnvStateDir: stateDirIdentity(dotEnvValues["STATE_DIR"], input.platform),
      effectiveStateDir: stateDirIdentity(environment["STATE_DIR"], input.platform),
    },
  });
  return { admission, environment };
}
