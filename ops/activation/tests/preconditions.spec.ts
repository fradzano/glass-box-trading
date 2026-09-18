// P12 unit 12, round 2: the precondition the activation asserts before it
// dispatches a certificate command.
//
// A gate refused to countersign a residual for the certificate guard's ENOENT
// branch because the declaration hung on a condition nothing observed — that the
// declared long-run state directory exists. Deleting it, renaming it, or
// restoring a backup taken before it was created produced no error and no alert;
// the first thing to notice would have been a certificate command silently
// taking the branch where several spellings of one absent directory compare
// unequal. These tests hold that condition to being checked rather than assumed.
//
// The two refusal directions that matter are not symmetric in an obvious way, so
// both are pinned: an absent directory is refused, and a presence that could not
// be *established* is refused just as firmly. The second is the one a future
// edit is most likely to soften, because "we could not read it" reads like a
// lesser problem than "it is not there" — and it is not, because the weak branch
// is entered on absence and an unreadable answer cannot rule absence out.
import { describe, expect, it } from "vitest";
import { certificateDispatchPrecondition, isDriveRootedPath } from "../core/preconditions.ts";
import type { Reading } from "../core/types.ts";

const present: Reading<boolean> = { known: true, value: true };
const absent: Reading<boolean> = { known: true, value: false };
const unreadable: Reading<boolean> = { known: false, reason: "EPERM" };

const LONG_RUN = "C:\\Users\\felix\\glass-box-state\\longrun-2026-09-22";

describe("isDriveRootedPath", () => {
  it("accepts a drive-rooted path in both separator spellings", () => {
    expect(isDriveRootedPath(LONG_RUN)).toBe(true);
    expect(isDriveRootedPath("C:/Users/felix/glass-box-state/longrun-2026-09-22")).toBe(true);
    expect(isDriveRootedPath("d:\\x")).toBe(true);
  });

  it("refuses a UNC path, which is absolute but has no establishable physical identity for the guard", () => {
    expect(isDriveRootedPath("\\\\localhost\\C$\\Users\\felix")).toBe(false);
    expect(isDriveRootedPath("\\\\?\\C:\\Users\\felix")).toBe(false);
  });

  it("refuses a posix root, a relative path, and anything too short to carry a drive", () => {
    expect(isDriveRootedPath("/glass-box-state/longrun")).toBe(false);
    expect(isDriveRootedPath("glass-box-state")).toBe(false);
    expect(isDriveRootedPath("C:")).toBe(false);
    expect(isDriveRootedPath("")).toBe(false);
  });

  it("refuses a drive letter that is not a letter", () => {
    expect(isDriveRootedPath("1:\\x")).toBe(false);
    expect(isDriveRootedPath("_:\\x")).toBe(false);
  });
});

describe("certificateDispatchPrecondition", () => {
  it("passes when the declared directory is drive-rooted and present", () => {
    expect(certificateDispatchPrecondition({ declaredLongRunStateDir: LONG_RUN, longRunPresent: present })).toEqual({ ok: true });
  });

  it("refuses when the declared directory does not exist, and names it", () => {
    const verdict = certificateDispatchPrecondition({ declaredLongRunStateDir: LONG_RUN, longRunPresent: absent });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain(LONG_RUN);
    expect(verdict.reason).toContain("does not exist");
  });

  it("refuses just as firmly when presence could not be established, and carries the reason through", () => {
    const verdict = certificateDispatchPrecondition({ declaredLongRunStateDir: LONG_RUN, longRunPresent: unreadable });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("EPERM");
    expect(verdict.reason).toContain("could not be established");
  });

  it("refuses a non-drive-rooted declaration before it even asks whether it exists", () => {
    // Present, and still refused: the shape of the path is the objection, and a
    // UNC directory that happens to be there is exactly the case the guard
    // cannot resolve to one physical identity.
    const verdict = certificateDispatchPrecondition({ declaredLongRunStateDir: "\\\\nas\\share\\longrun", longRunPresent: present });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("not drive-rooted");
  });
});
