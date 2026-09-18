// P12 unit 12: the activation's reader for the one place that says where this
// deployment's state directories are.
//
// It replaces `const LONG_RUN_STATE_DIR = path.join(path.dirname(path.dirname(
// REPO_ROOT)), "glass-box-state", "longrun-1")`, which climbed two levels from
// the repository where three were needed and therefore named a directory that
// does not exist. Every long-run read went there: the contamination listing of
// step 2, the journal's first line, and both wrapper logs that gate condition
// "step 9 satisfied" depends on. Nothing caught it, because the host ports map a
// missing directory to a known-empty listing and the fixtures below used to
// supply the correct path themselves — so the suite exercised one directory
// while production read another.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeploymentStateDirs, readDeploymentStateDirs } from "../readers/deployment-state.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

describe("the activation reads its state directories instead of deriving them", () => {
  it("takes every field from config/deployment.json", () => {
    const declared = JSON.parse(readFileSync(path.join(REPO_ROOT, "config", "deployment.json"), "utf8")) as Record<string, string>;
    expect(readDeploymentStateDirs(REPO_ROOT)).toEqual({
      longRunStateDir: declared["longRunStateDir"],
      devStateDir: declared["devStateDir"],
      devDiagnosticSink: declared["devDiagnosticSink"],
    });
  });

  it("names directories that exist on this host", () => {
    // The assertion the old derivation would have failed, stated about the host
    // rather than about the code — a reader test cannot catch a wrong path,
    // because a missing directory and an empty one read the same.
    const { longRunStateDir, devStateDir } = readDeploymentStateDirs(REPO_ROOT);
    expect(existsSync(longRunStateDir), `long run missing: ${longRunStateDir}`).toBe(true);
    expect(existsSync(devStateDir), `dev state missing: ${devStateDir}`).toBe(true);
  });

  it("refuses a declaration that is relative, empty, incomplete, or collapses the two directories", () => {
    const good = { longRunStateDir: "C:\\state\\long", devStateDir: "C:\\state\\dev", devDiagnosticSink: "C:\\state\\dev\\diagnostics" };
    expect(parseDeploymentStateDirs(good)).toEqual(good);
    expect(() => parseDeploymentStateDirs({ ...good, longRunStateDir: "state\\long" })).toThrow(/absolute path literal/u);
    expect(() => parseDeploymentStateDirs({ ...good, devStateDir: "" })).toThrow(/non-empty string/u);
    expect(() => parseDeploymentStateDirs({ longRunStateDir: good.longRunStateDir })).toThrow(/devStateDir/u);
    expect(() => parseDeploymentStateDirs(null)).toThrow(/not an object/u);
    expect(() => parseDeploymentStateDirs({ ...good, devStateDir: good.longRunStateDir })).toThrow(/name the same directory/u);
  });

  it("leaves no second copy of the path in the activation's own code", () => {
    // The literal that used to live at cli.ts:38, and the one in the fixtures
    // that hid it. A path to data belongs in the declaration, not in a module.
    expect(readFileSync(path.join(REPO_ROOT, "ops", "activation", "cli.ts"), "utf8")).not.toMatch(/glass-box-state/u);
  });

  it("hands each declared directory to the slot it belongs in", () => {
    // This reads the entry point's source text, which is weaker than exercising
    // it, and the weakness is worth stating: `cli.ts` runs `main()` when
    // imported, so no test can call its composition. What this does catch is the
    // two mutations that survived everything else — reviving the derivation for
    // the dev directory, and passing the dev directory where the long run
    // belongs, which would point the contamination check at the sandbox and let
    // a certificate run seed the long run unseen. It does not catch a change
    // whose text still matches these shapes.
    const source = readFileSync(path.join(REPO_ROOT, "ops", "activation", "cli.ts"), "utf8");
    expect(source).toMatch(/devStateDir:\s*DEPLOYMENT_STATE\.devStateDir,/u);
    expect(source).toMatch(/devDiagnosticSink:\s*DEPLOYMENT_STATE\.devDiagnosticSink,/u);
    expect(source).toMatch(/longRunStateDir:\s*LONG_RUN_STATE_DIR,/u);
    expect(source).toMatch(/const LONG_RUN_STATE_DIR = DEPLOYMENT_STATE\.longRunStateDir;/u);
    // No `path.dirname` climb may reappear anywhere near these directories.
    expect(source).not.toMatch(/path\.dirname\(path\.dirname\(/u);
  });

  // R3-23, by the same method and for the same reason. The rule that decides whether two
  // spellings of an environment key are one variable takes the platform as a parameter, and
  // the four sites that supply it are reached by no test: `cli.ts` is imported by no spec and
  // the three context builders are module-private. A one-word edit at any of them — `"linux"`
  // is a valid `NodeJS.Platform`, so even the typecheck stays green — re-enters a class-A
  // finding through the wiring instead of through the rule, with the §6 latch as the stake.
  // This pins the text. It does not pin the behaviour, and a change whose text still matches
  // these shapes passes; the counter-verification that raised R3-23 measured all four by
  // mutation and is where that limit is written down.
  it("takes the platform from the host at every site that decides environment-key identity", () => {
    const cli = readFileSync(path.join(REPO_ROOT, "ops", "activation", "cli.ts"), "utf8");
    expect(cli).toMatch(/platform:\s*process\.platform,/u);
    const invoke = readFileSync(path.join(REPO_ROOT, "ops", "activation", "cli", "invoke.ts"), "utf8");
    expect(invoke.match(/platform:\s*process\.platform/gu) ?? []).toHaveLength(3);
    // And nowhere in the activation may a platform be asserted as a literal instead of read.
    for (const source of [cli, invoke]) expect(source).not.toMatch(/platform:\s*"(?:win32|linux|darwin)"/u);
  });
});
