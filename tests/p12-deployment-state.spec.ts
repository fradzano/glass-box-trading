// P12 unit 12: the deployment's state directories are declared in one place and
// read by both sides.
//
// This test exists because of the shape of the defect it replaces. The
// activation used to derive the long run's directory from the repository's own
// location, climbing two levels where three were needed, so every long-run read
// landed one directory beside the truth. Exercising the *reader* could never
// catch that: the host ports map a missing directory to a known-empty listing,
// the fixtures supply the correct path themselves, and both produce a green
// `{ known: true, value: [] }`. What catches it is comparing the value the code
// will actually use against the deployment as it exists — which is what the
// cases below do.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDeployment, parseDeployment } from "../src/shell/deployment.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

describe("the deployment's state directories are declared once", () => {
  it("reads the file the activation reads, field for field", () => {
    // The activation has its own reader, because `ops/` never imports from
    // `src/`. What must not diverge is the fact, not the code, so the fact lives
    // in one file — and this asserts that this side takes every field from it
    // rather than keeping a second opinion anywhere.
    const declared = JSON.parse(readFileSync(path.join(REPO_ROOT, "config", "deployment.json"), "utf8")) as Record<string, string>;
    expect(loadDeployment(REPO_ROOT, "win32")).toEqual({
      longRunStateDir: declared["longRunStateDir"],
      devStateDir: declared["devStateDir"],
      devDiagnosticSink: declared["devDiagnosticSink"],
    });
  });

  it("names directories that exist on the host this deployment runs on", () => {
    // The assertion the old derivation would have failed. It is deliberately a
    // statement about the host and not about the code: a path to data is a fact,
    // and a fact that nothing checks is how the two came apart unnoticed.
    const { longRunStateDir, devStateDir } = loadDeployment(REPO_ROOT, "win32");
    expect(existsSync(longRunStateDir), `long run missing: ${longRunStateDir}`).toBe(true);
    expect(existsSync(devStateDir), `dev state missing: ${devStateDir}`).toBe(true);
  });

  it("keeps the long run and the dev sandbox apart, and refuses a file that does not", () => {
    const { longRunStateDir, devStateDir } = loadDeployment(REPO_ROOT, "win32");
    expect(path.resolve(longRunStateDir).toLowerCase()).not.toBe(path.resolve(devStateDir).toLowerCase());
    const collapsed = { longRunStateDir: "C:\\state\\one", devStateDir: "C:\\state\\one", devDiagnosticSink: "C:\\state\\one\\diagnostics" };
    expect(() => parseDeployment(collapsed, "win32")).toThrow(/name the same directory/u);
  });

  it("refuses a declaration that is relative, empty, missing a field, or a network path", () => {
    const good = { longRunStateDir: "C:\\state\\long", devStateDir: "C:\\state\\dev", devDiagnosticSink: "C:\\state\\dev\\diagnostics" };
    expect(parseDeployment(good, "win32")).toEqual(good);
    expect(() => parseDeployment({ ...good, longRunStateDir: "state\\long" }, "win32")).toThrow(/absolute path literal/u);
    expect(() => parseDeployment({ ...good, longRunStateDir: "   " }, "win32")).toThrow(/non-empty string/u);
    expect(() => parseDeployment({ devStateDir: good.devStateDir }, "win32")).toThrow(/longRunStateDir/u);
    expect(() => parseDeployment([], "win32")).toThrow(/not an object/u);
    // The same rule the state root itself is held to: one directory, one identity.
    expect(() => parseDeployment({ ...good, longRunStateDir: "\\\\localhost\\C$\\state\\long" }, "win32")).toThrow(/drive-rooted/u);
  });

  it("is the only place the long run's directory is written down in code", () => {
    // A second literal is how the fixture and the production constant came to
    // disagree in the first place. The declaration is data; code reads it.
    const sources = [
      path.join(REPO_ROOT, "ops", "activation", "cli.ts"),
      path.join(REPO_ROOT, "src", "shell", "certificate-admission.ts"),
      path.join(REPO_ROOT, "src", "shell", "certificate-command-guard.ts"),
    ];
    for (const source of sources) {
      expect(readFileSync(source, "utf8"), source).not.toMatch(/glass-box-state/u);
    }
  });
});
