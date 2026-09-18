// Preconditions the activation asserts before it dispatches a certificate
// command, as pure predicates over facts the shell established.
//
// Why this file exists. A gate refused to countersign the residual for the
// certificate guard's ENOENT branch (R2-23) on one ground above the others: the
// declaration hung on a condition — that the declared long-run state directory
// exists — which nothing on the host observed. Deleting it, renaming it, or
// restoring the machine from a backup taken before it was created produced no
// error, no alert and no failing check; the first thing to notice would have
// been a certificate command silently taking the wrong branch of the identity
// derivation, where several spellings of one absent directory compare unequal.
//
// A residual may hang on a condition. It may not hang on an unobserved one.
// This is that condition, made machine-checked, on the `ops/` side of the digest
// boundary so that nothing in the frozen runtime surface had to change for it.
//
// What it does NOT do, said here so the file is not mistaken for the repair: it
// does not fix the guard. The guard still derives directory identity the way it
// does. This only refuses to *start* a certificate command in the state where
// that derivation is known to be weak, and makes the state visible when it
// occurs instead of silent.
import type { Reading } from "./types.ts";

export type PreconditionVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * A drive-rooted local path: `C:\…` or `C:/…`. Deliberately narrower than "is
 * absolute" — a UNC spelling (`\\host\share\…`) is absolute and is exactly the
 * shape whose physical identity the certificate guard cannot establish, so a
 * state directory has no business being one.
 *
 * Written with character tests rather than a pattern because this file sits
 * under an architecture gate that restricts what a core may reach for; the
 * comparison is the same one, spelled so the gate can see through it.
 */
export function isDriveRootedPath(candidate: string): boolean {
  if (candidate.length < 3) return false;
  const drive = candidate[0] ?? "";
  const isLetter = (drive >= "A" && drive <= "Z") || (drive >= "a" && drive <= "z");
  const separator = candidate[2] ?? "";
  return isLetter && candidate[1] === ":" && (separator === "\\" || separator === "/");
}

/**
 * May a certificate command be dispatched at all?
 *
 * Both answers are refusals to start, never a verdict about the deployment: the
 * caller reports the reason and takes no step. `unknown` is refused as firmly as
 * a known absence, because "we could not tell whether the directory is there" is
 * precisely the state the condition exists to exclude — the guard's weak branch
 * is entered on absence, and a reader that cannot establish presence cannot rule
 * absence out.
 */
export function certificateDispatchPrecondition(input: {
  readonly declaredLongRunStateDir: string;
  readonly longRunPresent: Reading<boolean>;
}): PreconditionVerdict {
  if (!isDriveRootedPath(input.declaredLongRunStateDir)) {
    return { ok: false, reason: `the deployment declares a long-run state directory that is not drive-rooted (${input.declaredLongRunStateDir}); a certificate command cannot be told apart from the long run on such a path` };
  }
  if (!input.longRunPresent.known) {
    return { ok: false, reason: `whether the declared long-run state directory exists could not be established (${input.longRunPresent.reason}); the certificate guard's identity derivation is weakest on an absent directory, so this is refused rather than assumed` };
  }
  if (!input.longRunPresent.value) {
    return { ok: false, reason: `the declared long-run state directory does not exist (${input.declaredLongRunStateDir}); create it before a certificate command runs, because several spellings of an absent directory compare unequal to the guard` };
  }
  return { ok: true };
}
