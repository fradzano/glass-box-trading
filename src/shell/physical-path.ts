// One rule for "is this path a canonical local root?", used wherever a state
// directory's physical identity has to be established.
//
// It exists because `realpathSync.native` is canonical for some Windows alias
// classes and not for others. `\\?\C:\x`, a junction and a `subst` drive all
// collapse to `C:\x`; a UNC spelling does not — `\\localhost\C$\x`,
// `\\127.0.0.1\C$\x`, the machine name, any share and any DFS path each survive
// as their own string. One physical directory therefore has unboundedly many
// identities, which was measured to break two invariants at once: the
// certificate guard admitted a UNC spelling of the directory it protects, and
// two processes started under a drive spelling and a UNC spelling of one state
// directory each won the same epoch and planned the same journal sequence
// number — twelve times out of twelve, against a control that was correct
// twelve times out of twelve.
//
// The alias family is open, so no list of spellings can close it. The rule is
// positive instead: a state root is canonical only if it is drive-rooted, and
// anything else is refused rather than carried along in whatever spelling
// arrived. A competition or certificate state directory has no business being a
// network path.
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/u;

/** True for a physical path that names one directory under one spelling on this platform. */
export function isCanonicalLocalRoot(physical: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return physical.startsWith("/") && !physical.startsWith("//");
  return WINDOWS_DRIVE_ROOT.test(physical);
}

/** Why a non-canonical root is refused, in words an operator can act on. */
export const NON_CANONICAL_ROOT_DETAIL = "STATE_DIR must resolve to a drive-rooted local path; a UNC or network spelling names the same directory under more than one identity, which would give two processes separate writer mutexes over one journal";
