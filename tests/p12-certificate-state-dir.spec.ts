// P12 unit 11 (docs/P12-ACTIVATION-BUILD.md, "Unit 11 brief", part 2): a
// certificate command refuses the competition STATE_DIR. `.env` on the host
// names the competition profile and its directory; every certificate command
// runs with ALPACA_PROFILE=dev from the process, and one that forgets the
// STATE_DIR override would build a dev runtime inside the competition's state.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { admitCertificateInvocation, stateDirIdentity } from "../src/shell/certificate-admission.js";
import { isCanonicalLocalRoot } from "../src/shell/physical-path.js";
import { ambiguousDotEnvKeys, mergeEnvironment } from "../src/shell/runtime-config.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
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
      expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: dev }, args, platform: process.platform }).admission).toEqual({ ok: true });
    }
    // The existing flag rules still read the real arguments: a smoke cycle needs the owner's go.
    expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: dev }, args: ["--smoke-cycle"], platform: process.platform }).admission)
      .toMatchObject({ ok: false, reason: expect.stringContaining("--owner-go") as string });
  });

  it("(2) refuses every certificate command that forgot the STATE_DIR override", () => {
    const { repoRoot } = host();
    for (const args of COMMANDS) {
      const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args, platform: process.platform });
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
      const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: spelling }, args: ["--preflight"], platform: process.platform });
      expect(admission, spelling).toMatchObject({ ok: false });
    }
  });

  it("(3b) on Windows, compares a competition directory that does not exist yet by its case-folded spelling", () => {
    if (process.platform !== "win32") return;
    const { repoRoot, competition } = host();
    rmSync(competition, { recursive: true, force: true });
    const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition.toUpperCase() }, args: ["--preflight"], platform: "win32" });
    expect(admission).toMatchObject({ ok: false });
    expect(existsSync(competition)).toBe(false);
  });

  it("(1b) the dev-only rule still reads the effective profile: .env's competition profile without an override is refused", () => {
    const { repoRoot, dev } = host();
    expect(admitCertificateInvocation({ repoRoot, processEnv: { STATE_DIR: dev }, args: ["--preflight"], platform: process.platform }).admission)
      .toEqual({ ok: false, reason: "every certificate command, including preflight, uses the dev account only" });
  });

  it("(4) does not couple when .env itself names the dev profile", () => {
    const { repoRoot } = host("dev");
    expect(admitCertificateInvocation({ repoRoot, processEnv: {}, args: ["--preflight"], platform: process.platform }).admission).toEqual({ ok: true });
  });

  it("(5) has nothing to protect when .env names no usable STATE_DIR; runtime construction refuses that itself", () => {
    const { repoRoot } = host();
    for (const line of ["STATE_DIR=", "STATE_DIR=relative/longrun-1", ""]) {
      writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=competition\n${line}\n`, "utf8");
      expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args: ["--preflight"], platform: process.platform }).admission, line).toEqual({ ok: true });
    }
  });

  it("(6) a refusal leaves the competition directory exactly as it was: no quarantine, no file", () => {
    const { repoRoot, competition } = host();
    const missingParent = path.join(path.dirname(competition), "not-yet-created");
    expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args: ["--preflight"], platform: process.platform }).admission).toMatchObject({ ok: false });
    expect(readdirSync(competition)).toEqual([]);
    expect(stateDirIdentity(missingParent, process.platform)).toMatchObject({ kind: "key" });
    expect(existsSync(missingParent)).toBe(false);
  });

  it("(7) names the rule, not the path", () => {
    const { repoRoot, competition } = host();
    const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev" }, args: ["--preflight"], platform: process.platform });
    const reason = admission.ok ? "" : admission.reason;
    expect(reason).toMatch(REFUSAL);
    expect(reason.toLowerCase()).not.toContain(path.basename(path.dirname(path.dirname(competition))).toLowerCase());
    expect(reason).not.toContain("longrun-1");
  });

  it("(8) the pure rule: the profile rule still comes first, and the coupling needs all three facts", () => {
    const same = { dotEnvRead: "parsed", duplicateKeys: [], dotEnvProfile: "competition", dotEnvStateDir: { kind: "key", value: "k" }, effectiveStateDir: { kind: "key", value: "k" } } as const;
    expect(admitCertificateCommand({ profile: "competition", ownerGo: true, preflight: true, stateDirs: same })).toEqual({ ok: false, reason: "every certificate command, including preflight, uses the dev account only" });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: same })).toMatchObject({ ok: false, reason: expect.stringMatching(REFUSAL) as string });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, dotEnvProfile: "dev" } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, dotEnvProfile: undefined } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, effectiveStateDir: { kind: "key", value: "other" } } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...same, dotEnvStateDir: { kind: "none" }, effectiveStateDir: { kind: "none" } } })).toEqual({ ok: true });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: false, stateDirs: { ...same, effectiveStateDir: { kind: "key", value: "other" } } })).toMatchObject({ ok: false, reason: expect.stringContaining("--owner-go") as string });
  });

  // P12 unit 12 (the adversarial loop over units 1-11): four ways the guard's
  // facts used to degrade quietly, each of which admitted a command that the
  // same host refuses when everything is readable.
  it("(9) refuses when .env exists but cannot be read, instead of reading it as absent", () => {
    const { repoRoot, competition } = host();
    // A directory in its place is an EISDIR rather than an ENOENT: the file is
    // there in the sense that matters, and its contents are unavailable.
    rmSync(path.join(repoRoot, ".env"));
    mkdirSync(path.join(repoRoot, ".env"));
    const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition }, args: ["--preflight"], platform: process.platform });
    expect(admission.ok).toBe(false);
    const reason = admission.ok ? "" : admission.reason;
    expect(reason).toMatch(/could not be read/u);
    // The refusal names the file, never the directory it is protecting.
    expect(reason).not.toContain("longrun-1");
    expect(readdirSync(competition)).toEqual([]);
  });

  it("(10) refuses a .env that assigns a deciding key twice, whichever line comes last", () => {
    for (const [first, second] of [["competition", "dev"], ["dev", "competition"]] as const) {
      const { repoRoot, competition, dev } = host();
      writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=${first}\nALPACA_PROFILE=${second}\nSTATE_DIR=${competition}\n`, "utf8");
      const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: dev }, args: ["--preflight"], platform: process.platform });
      expect(admission.ok, `${first} then ${second}`).toBe(false);
      expect(admission.ok ? "" : admission.reason).toMatch(/more than one line/u);
    }
    // The ordering that used to slip through: the competition directory named
    // first, another absolute path last, and the command aimed at the former.
    const { repoRoot, competition, dev } = host();
    writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=competition\nSTATE_DIR=${competition}\nSTATE_DIR=${dev}\n`, "utf8");
    const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition }, args: ["--preflight"], platform: process.platform });
    expect(admission.ok).toBe(false);
    expect(admission.ok ? "" : admission.reason).toMatch(/more than one line/u);
  });

  it("(11) a directory whose identity cannot be read is unknown, and unknown refuses", () => {
    const denied = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
    denied.code = "EPERM";
    const absent = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    absent.code = "ENOENT";
    const absolute = path.resolve(path.join(tmpdir(), "p12-identity"));

    // A directory that is not there yet still compares by spelling; any other
    // failure means the identity was never established.
    expect(stateDirIdentity(absolute, "win32", () => { throw absent; })).toEqual({ kind: "key", value: absolute.toLowerCase() });
    expect(stateDirIdentity(absolute, "win32", () => { throw denied; })).toEqual({ kind: "unknown", code: "EPERM" });

    const unknown = { kind: "unknown", code: "EPERM" } as const;
    const key = { kind: "key", value: "k" } as const;
    const base = { dotEnvRead: "parsed", duplicateKeys: [], dotEnvProfile: "competition" } as const;
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...base, dotEnvStateDir: key, effectiveStateDir: unknown } }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/identity could not be established/u) as string });
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...base, dotEnvStateDir: unknown, effectiveStateDir: key } }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/identity could not be established/u) as string });
    // A dev .env has no coupling to protect, so an unreadable identity decides nothing.
    expect(admitCertificateCommand({ profile: "dev", ownerGo: false, preflight: true, stateDirs: { ...base, dotEnvProfile: "dev", dotEnvStateDir: key, effectiveStateDir: unknown } })).toEqual({ ok: true });
  });

  it("(12) the runtime is built from the environment the guard admitted, not from a second read", () => {
    const { repoRoot, competition, dev } = host();
    const { admission, environment } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: dev }, args: ["--preflight"], platform: process.platform });
    expect(admission).toEqual({ ok: true });
    // Exactly what the admission judged: the file underneath, the process on top.
    expect(environment["ALPACA_PROFILE"]).toBe("dev");
    expect(environment["STATE_DIR"]).toBe(dev);
    expect(environment["ALPACA_DEV_KEY_ID"]).toBe("PKTEST");
    // Rewriting .env afterwards cannot move what was admitted, because the
    // snapshot is a value and no longer a path to be read again.
    writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=competition\nSTATE_DIR=${competition}\n`, "utf8");
    expect(environment["STATE_DIR"]).toBe(dev);
    expect(environment["ALPACA_PROFILE"]).toBe("dev");
  });


  it("(13) a spelling that does not canonicalise to one directory is an unestablished identity, not another directory", () => {
    // Measured on this platform: `\\?\C:\x`, a junction and a `subst` drive all
    // collapse to `C:\x`, while every UNC spelling survives as its own string —
    // `\\localhost\C$\x`, `\\127.0.0.1\C$\x`, the machine name, any share. The
    // alias family is open, so the rule is positive rather than a list.
    for (const canonical of ["C:\\glass-box-state\\longrun-1", "c:/glass-box-state/longrun-1", "Z:\\x"]) {
      expect(isCanonicalLocalRoot(canonical, "win32"), canonical).toBe(true);
    }
    for (const alias of ["\\\\localhost\\C$\\glass-box-state\\longrun-1", "\\\\127.0.0.1\\C$\\x", "\\\\fileserver\\share\\x", "\\\\?\\UNC\\localhost\\C$\\x", "\\\\?\\C:\\x", "\\\\server\\share\\C:\\x"]) {
      expect(isCanonicalLocalRoot(alias, "win32"), alias).toBe(false);
    }
    expect(isCanonicalLocalRoot("/var/lib/glass-box", "linux")).toBe(true);
    expect(isCanonicalLocalRoot("//host/share/x", "linux")).toBe(false);

    // The guard sees it as an identity it could not establish, so the rule refuses.
    const unc = "\\\\localhost\\C$\\glass-box-state\\longrun-1";
    expect(stateDirIdentity(unc, "win32", () => unc)).toEqual({ kind: "unknown", code: "NOT_DRIVE_ROOTED" });
    const base = { dotEnvRead: "parsed", duplicateKeys: [], dotEnvProfile: "competition" } as const;
    expect(admitCertificateCommand({
      profile: "dev", ownerGo: true, preflight: false,
      stateDirs: { ...base, dotEnvStateDir: { kind: "key", value: "k" }, effectiveStateDir: { kind: "unknown", code: "NOT_DRIVE_ROOTED" } },
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/identity could not be established/u) as string });
  });

  it("(14) the runtime refuses such a root outright, so the writer mutex can never see two identities for one directory", () => {
    const { competition } = host();
    // The same physical directory, admitted under a drive spelling…
    const good = resolveStateDir(competition, "win32");
    expect(good.ok).toBe(true);
    // …and refused under one that resolves to a non-drive root. The resolver is
    // injected rather than provoked, because reaching the admin share depends on
    // the host; what is under test is the rule, and it is the rule that closed
    // the two-holder measurement.
    const refused = resolveStateDir(competition, "win32", () => "\\\\localhost\\C$\\glass-box-state\\longrun-1");
    expect(refused).toMatchObject({ ok: false, reason: "CONFIG_INVALID_STATE_DIR" });
    expect(refused.ok ? "" : refused.detail).toMatch(/drive-rooted/u);
  });

  it("(15) a process override wins whatever case the operator typed it in", () => {
    const dotEnv = { ALPACA_PROFILE: "competition", STATE_DIR: "C:\\comp" } as const;
    // The file names the key: the override lands on the file's slot, and the
    // record keeps one key for the variable rather than two that disagree.
    const folded = mergeEnvironment(dotEnv, { State_Dir: "C:\\dev" }, "win32");
    expect(folded["STATE_DIR"]).toBe("C:\\dev");
    expect(Object.keys(folded).filter(key => key.toLowerCase() === "state_dir")).toEqual(["STATE_DIR"]);
    // The file does not name it: the override still has to be findable under the
    // name the code looks up. This is the `PRE_ARM_CERTIFICATE` case, which the
    // runbook uses as a clearing gesture.
    expect(mergeEnvironment(dotEnv, { Pre_Arm_Certificate: "C:\\cert.json" }, "win32")["PRE_ARM_CERTIFICATE"]).toBe("C:\\cert.json");
    expect(mergeEnvironment(dotEnv, { STATE_DIR: "C:\\dev" }, "win32")["STATE_DIR"]).toBe("C:\\dev");
    // A file key in an odd case is canonicalised too, or the value would sit in
    // the record under a name nothing looks up.
    const oddFile = mergeEnvironment({ State_Dir: "C:\\comp" }, {}, "win32");
    expect(oddFile["STATE_DIR"]).toBe("C:\\comp");
    expect(Object.keys(oddFile)).toEqual(["STATE_DIR"]);
    expect(mergeEnvironment({ State_Dir: "C:\\comp" }, { STATE_DIR: "C:\\dev" }, "win32")["STATE_DIR"]).toBe("C:\\dev");
    // Elsewhere the environment really is case-sensitive, and two names stay two.
    const posix = mergeEnvironment({ STATE_DIR: "/comp" }, { State_Dir: "/dev" }, "linux");
    expect(posix["STATE_DIR"]).toBe("/comp");
    expect(posix["State_Dir"]).toBe("/dev");
  });


  it("(16) reads .env through the same canonicalisation the runtime uses", () => {
    // The regression this pins: the merged environment was canonicalised while
    // the guard still read the raw file, so a `.env` spelling the key
    // `State_Dir` set the competition directory for the run while the guard,
    // looking only at `STATE_DIR`, saw nothing to protect and admitted.
    for (const line of ["State_Dir", "state_dir", "StAtE_dIr"]) {
      const { repoRoot, competition } = host();
      writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=competition\n${line}=${competition}\n`, "utf8");
      const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition }, args: ["--owner-go"], platform: "win32" });
      expect(admission.ok, line).toBe(false);
      expect(admission.ok ? "" : admission.reason).toMatch(REFUSAL);
    }
    // The profile is read the same way, or the coupling rule never engages.
    const { repoRoot, competition } = host();
    writeFileSync(path.join(repoRoot, ".env"), `alpaca_profile=competition\nSTATE_DIR=${competition}\n`, "utf8");
    expect(admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition }, args: ["--owner-go"], platform: "win32" }).admission)
      .toMatchObject({ ok: false, reason: expect.stringMatching(REFUSAL) as string });
  });

  it("(17) two .env lines for one variable are ambiguous even when they differ only in case", () => {
    // On Windows `STATE_DIR` and `State_Dir` are one variable, so which value a
    // reader ends up with depends on insertion order rather than on the file —
    // exactly what the duplicate rule refuses to resolve.
    const { repoRoot, competition, dev } = host();
    writeFileSync(path.join(repoRoot, ".env"), `ALPACA_PROFILE=competition\nSTATE_DIR=${dev}\nState_Dir=${competition}\n`, "utf8");
    const { admission } = admitCertificateInvocation({ repoRoot, processEnv: { ALPACA_PROFILE: "dev", STATE_DIR: competition }, args: ["--owner-go"], platform: "win32" });
    expect(admission.ok).toBe(false);
    expect(admission.ok ? "" : admission.reason).toMatch(/more than one line/u);
    // Elsewhere the two really are different variables and nothing is ambiguous.
    expect(ambiguousDotEnvKeys({ values: { STATE_DIR: "a", State_Dir: "b" }, duplicateKeys: [] }, "linux")).toEqual([]);
    expect(ambiguousDotEnvKeys({ values: { STATE_DIR: "a", State_Dir: "b" }, duplicateKeys: [] }, "win32")).toEqual(["STATE_DIR"]);
  });

});
