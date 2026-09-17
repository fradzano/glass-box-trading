// P12 unit 11 (docs/P12-ACTIVATION-BUILD.md, "Unit 11 brief", part 2): a
// certificate command refuses the competition STATE_DIR. `.env` on the host
// names the competition profile and its directory; every certificate command
// runs with ALPACA_PROFILE=dev from the process, and one that forgets the
// STATE_DIR override would build a dev runtime inside the competition's state.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitCertificateInvocation, stateDirKey } from "../src/shell/certificate-admission.js";
import { admitCertificateCommand } from "../src/shell/certificate-command-guard.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "p12-certificate-state-dir-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** A repository root whose `.env` names the competition profile and its directory, plus a separate dev directory. */
function host(profile = "competition"): { readonly repoRoot: string; readonly competition: string; readonly dev: string } {
  const base = temporaryDirectory();
  const repoRoot = path.join(base, "repo");
  const competition = path.join(base, "glass-box-state", "longrun-1");
  const dev = path.join(base, "glass-box-state", "dev");
  for (const directory of [repoRoot, competition, dev]) mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=${profile}\nSTATE_DIR=${competition}\nALPACA_DEV_KEY_ID=PKTEST\n`, "utf8");
  return { repoRoot, competition, dev };
}

const COMMANDS = [["--preflight"], ["--owner-go"], ["--smoke-cycle", "--owner-go"]] as const;
const REFUSAL = /competition state directory/u;

describe("P12 unit 11 — the certificate command refuses the competition STATE_DIR", () => {
  it("(1) admits a dev command whose STATE_DIR is a different directory", () => {
    const { repoRoot, dev } = host();
    for (const args of COMMANDS) {
      expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: dev }, args, platform: process.platform })).toEqual({ ok: true });
    }
    // The existing flag rules still read the real arguments: a smoke cycle needs the owner's go.
    expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: dev }, args: ["--smoke-cycle"], platform: process.platform }))
      .toMatchObject({ ok: false, reason: expect.stringContaining("--owner-go") as string });
  });

  it("(2) refuses every certificate command that forgot the STATE_DIR override", () => {
    const { repoRoot } = host();
    for (const args of COMMANDS) {
      const admission = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args, platform: process.platform });
      expect(admission.ok).toBe(false);
      expect(admission.ok ? "" : admission.reason).toMatch(REFUSAL);
    }
  });

  it("(3) refuses an override that is another spelling of the competition directory", () => {
    const { repoRoot, competition } = host();
    const base = path.dirname(path.dirname(competition));
    const junction = path.join(base, "alias-of-longrun");
    symlinkSync(competition, junction, "junction");
    const spellings = [
      `${competition}${path.sep}`,
      // Built by hand: path.join would normalise the `..` away before the guard saw it.
      [competition, "..", "longrun-1"].join(path.sep),
      junction,
      ...(process.platform === "win32" ? [competition.toUpperCase(), `\\\\?\\${competition}`] : []),
    ];
    for (const spelling of spellings) {
      const admission = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: spelling }, args: ["--preflight"], platform: process.platform });
      expect(admission, spelling).toMatchObject({ ok: false });
    }
  });

  it("(3b) on Windows, compares a competition directory that does not exist yet by its case-folded spelling", () => {
    if (process.platform !== "win32") return;
    const { repoRoot, competition } = host();
    rmSync(competition, { recursive: true, force: true });
    const admission = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition.toUpperCase() }, args: ["--preflight"], platform: "win32" });
    expect(admission).toMatchObject({ ok: false });
    expect(existsSync(competition)).toBe(false);
  });

  it("(1b) the dev-only rule still reads the effective profile: .env's competition profile without an override is refused", () => {
    const { repoRoot, dev } = host();
    expect(admitCertificateInvocation({ repoRoot, processEnv: { STATE_DIR: dev }, args: ["--preflight"], platform: process.platform }))
      .toEqual({ ok: false, reason: "every certificate command, including preflight, uses the dev account only" });
  });

  it("(4) does not couple when .env itself names the dev profile", () => {
    const { repoRoot } = host("dev");
    expect(admitCertificateInvocation({ repoRoot, processEnv: {}, args: ["--preflight"], platform: process.platform })).toEqual({ ok: true });
  });

  it("(5) has nothing to protect when .env names no usable STATE_DIR; runtime construction refuses that itself", () => {
    const { repoRoot } = host();
    for (const line of ["STATE_DIR=", "STATE_DIR=relative/longrun-1", ""]) {
      writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=competition\n${line}\n`, "utf8");
      expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args: ["--preflight"], platform: process.platform }), line).toEqual({ ok: true });
    }
  });

  it("(6) a refusal leaves the competition directory exactly as it was: no quarantine, no file", () => {
    const { repoRoot, competition } = host();
    const missingParent = path.join(path.dirname(competition), "not-yet-created");
    expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args: ["--preflight"], platform: process.platform })).toMatchObject({ ok: false });
    expect(readdirSync(competition)).toEqual([]);
    expect(stateDirKey(missingParent, process.platform)).not.toBeNull();
    expect(existsSync(missingParent)).toBe(false);
  });

  it("(7) names the rule, not the path", () => {
    const { repoRoot, competition } = host();
    const admission = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args: ["--preflight"], platform: process.platform });
    const reason = admission.ok ? "" : admission.reason;
    expect(reason).toMatch(REFUSAL);
    expect(reason.toLowerCase()).not.toContain(path.basename(path.dirname(path.dirname(competition))).toLowerCase());
    expect(reason).not.toContain("longrun-1");
  });

  it("(8) the pure rule: the profile rule still comes first, and the coupling needs all three facts", () => {
    const same = { dotEnvProfile: "competition", dotEnvStateDirKey: "k", effectiveStateDirKey: "k" } as const;
    expect(admitCertificateCommand({ profile: "competition", ownerGo: true, preflight: true, stateDirs: same })).toEqual({ ok: false, reason: "every certificate command, including preflight, uses the dev account only" });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: same })).toMatchObject({ ok: false, reason: expect.stringMatching(REFUSAL) as string });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, dotEnvProfile: "dev" } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, dotEnvProfile: undefined } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, effectiveStateDirKey: "other" } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, dotEnvStateDirKey: null, effectiveStateDirKey: null } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: false, stateDirs: { ...same, effectiveStateDirKey: "other" } })).toMatchObject({ ok: false, reason: expect.stringContaining("--owner-go") as string });
  });
});
