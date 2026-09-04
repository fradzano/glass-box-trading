// P8 — the competition arming gate (S-ARM-01 / S-CYC-11: WIN-7, WIN-10).
// Startup only proves that PRE_ARM_CERTIFICATE is present; this suite proves
// that a competition runtime arms exclusively under a certificate the real
// builder produced, whose runtime digest, policy digest, and canonical origin
// name this deployment, and whose self-digest still covers its own body.
// Every negative is fail-closed: a digest mismatch, an edit, an absent file, a
// malformed document, and a FAIL verdict each refuse. The dev profile is
// unaffected and issues no read at all.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCertificate } from "../src/core/certificate.js";
import { evaluateArmingGate, resolveCertificatePath } from "../src/shell/arming-gate.js";
import type { ArmingGateInput } from "../src/shell/arming-gate.js";
import { DIGEST_A, DIGEST_B, inputs, ORIGIN } from "./arm01-fixtures.js";

const CERTIFICATE_RELATIVE_PATH = "evidence/pre-arm/run.json";
const FAKE_REPO_ROOT = path.join(tmpdir(), "gbt-p8-unused-root");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryRepoRoot(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p8-arming-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** The exact document the dev live-test driver writes: the core's certificate, serialized. */
function certificateDocument(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildCertificate(inputs()))) as Record<string, unknown>;
}

/** A competition gate input whose only impure dependency is the injected read. */
function gateInput(overrides: Partial<ArmingGateInput> = {}): ArmingGateInput {
  return {
    profile: "competition",
    repoRoot: FAKE_REPO_ROOT,
    rawConfig: { PRE_ARM_CERTIFICATE: CERTIFICATE_RELATIVE_PATH },
    runtimeDigest: DIGEST_A,
    policyDigest: DIGEST_B,
    canonicalTradingOrigin: ORIGIN,
    ...overrides,
  };
}

function reasonsOf(input: ArmingGateInput): readonly string[] {
  const verdict = evaluateArmingGate(input);
  return verdict.armed ? [] : verdict.reasons;
}

function servingDocument(document: unknown): (file: string) => string {
  return () => `${JSON.stringify(document, null, 2)}\n`;
}

describe("P8 arming gate — a competition runtime arms only under an intact certificate for this deployment", () => {
  it("arms on the certificate the real builder produced, read once from the configured path, and reports the dev live-test instant", () => {
    const reads: string[] = [];
    const verdict = evaluateArmingGate(gateInput({
      readFile: target => {
        reads.push(target);
        return `${JSON.stringify(certificateDocument(), null, 2)}\n`;
      },
    }));
    expect(verdict).toEqual({ armed: true, certificateChecked: true, successfulDevLiveTestAt: "2026-09-01T15:10:00.000Z" });
    expect(reads).toEqual([path.resolve(FAKE_REPO_ROOT, CERTIFICATE_RELATIVE_PATH)]);
  });

  it("refuses a runtime digest that is not this deployment's", () => {
    const reasons = reasonsOf(gateInput({ runtimeDigest: DIGEST_B, readFile: servingDocument(certificateDocument()) }));
    expect(reasons).toContain("runtimeDigest mismatch: a covered runtime change invalidates the certificate");
  });

  it("refuses a policy digest that is not this deployment's", () => {
    const reasons = reasonsOf(gateInput({ policyDigest: DIGEST_A, readFile: servingDocument(certificateDocument()) }));
    expect(reasons).toContain("policyDigest mismatch: a role-neutral policy change invalidates the certificate");
  });

  it("refuses tampered evidence whose self-digest was not recomputed", () => {
    const document = certificateDocument();
    const evidence = document["evidence"] as Record<string, unknown>;
    const finalSnapshot = evidence["finalSnapshot"] as Record<string, unknown>;
    const tampered = { ...document, evidence: { ...evidence, finalSnapshot: { ...finalSnapshot, equityCents: 99_999_999 } } };
    expect(reasonsOf(gateInput({ readFile: servingDocument(tampered) }))).toContain("certificate evidence digest mismatch: the certificate was edited after it was produced");
  });

  it("refuses a certificate whose failures were appended without recomputing its digest", () => {
    const forged = { ...certificateDocument(), failures: ["the fence drill never ran"] };
    const reasons = reasonsOf(gateInput({ readFile: servingDocument(forged) }));
    expect(reasons).toContain("certificate carries failures");
    expect(reasons).toContain("certificate evidence digest mismatch: the certificate was edited after it was produced");
  });

  it("refuses an unreadable file, a malformed document, and a path the configuration does not name", () => {
    expect(reasonsOf(gateInput({ readFile: () => { throw new Error("ENOENT: no such file or directory"); } }))[0]).toMatch(/^certificate file could not be read/);
    expect(reasonsOf(gateInput({ readFile: () => "{ not json" }))[0]).toMatch(/^certificate file is not valid JSON/);
    expect(reasonsOf(gateInput({ readFile: () => "null" }))).toEqual(["certificate is not an object"]);
    expect(reasonsOf(gateInput({ readFile: () => "\"a certificate\"" }))).toEqual(["certificate is not an object"]);
    expect(reasonsOf(gateInput({ readFile: () => "[]" }))).toEqual(["certificate is not an object"]);
    expect(reasonsOf(gateInput({ rawConfig: {} }))).toEqual(["PRE_ARM_CERTIFICATE does not name a certificate file"]);
    expect(reasonsOf(gateInput({ rawConfig: { PRE_ARM_CERTIFICATE: "   " } }))).toEqual(["PRE_ARM_CERTIFICATE does not name a certificate file"]);
    // The startup validator accepts any present value, so a non-string placeholder reaches the gate and is refused here.
    expect(reasonsOf(gateInput({ rawConfig: { PRE_ARM_CERTIFICATE: { placeholder: true } } }))).toEqual(["PRE_ARM_CERTIFICATE does not name a certificate file"]);
  });

  it("refuses a FAIL-verdict certificate the builder itself produced", () => {
    const failing = JSON.parse(JSON.stringify(buildCertificate(inputs({ finalSnapshot: null })))) as Record<string, unknown>;
    expect(failing["verdict"]).toBe("FAIL");
    const reasons = reasonsOf(gateInput({ readFile: servingDocument(failing) }));
    expect(reasons).toContain("certificate verdict is not PASS");
    expect(reasons).toContain("certificate carries failures");
  });

  it("reads the real file at the configured repository-relative path: absent refuses, intact arms, truncated refuses", () => {
    const repoRoot = temporaryRepoRoot();
    const onDisk: ArmingGateInput = {
      profile: "competition",
      repoRoot,
      rawConfig: { PRE_ARM_CERTIFICATE: "certificate.json" },
      runtimeDigest: DIGEST_A,
      policyDigest: DIGEST_B,
      canonicalTradingOrigin: ORIGIN,
    };
    expect(reasonsOf(onDisk)[0]).toMatch(/^certificate file could not be read/);
    writeFileSync(path.join(repoRoot, "certificate.json"), `${JSON.stringify(certificateDocument(), null, 2)}\n`, "utf8");
    expect(evaluateArmingGate(onDisk)).toEqual({ armed: true, certificateChecked: true, successfulDevLiveTestAt: "2026-09-01T15:10:00.000Z" });
    writeFileSync(path.join(repoRoot, "certificate.json"), "{ truncated", "utf8");
    expect(reasonsOf(onDisk)[0]).toMatch(/^certificate file is not valid JSON/);
  });

  it("never reads the certificate on the dev profile, whatever the configured path and digests say", () => {
    let reads = 0;
    const verdict = evaluateArmingGate(gateInput({
      profile: "dev",
      rawConfig: { PRE_ARM_CERTIFICATE: "evidence/pre-arm/does-not-exist.json" },
      runtimeDigest: "not-a-digest",
      policyDigest: "not-a-digest",
      readFile: () => { reads += 1; return "{}"; },
    }));
    expect(verdict).toEqual({ armed: true, certificateChecked: false, successfulDevLiveTestAt: null });
    expect(reads).toBe(0);
  });

  it("resolves the configured path against the repository root and takes an absolute path as given", () => {
    const absolute = path.resolve(path.join(tmpdir(), "pre-arm", "run.json"));
    expect(resolveCertificatePath(FAKE_REPO_ROOT, CERTIFICATE_RELATIVE_PATH)).toBe(path.resolve(FAKE_REPO_ROOT, CERTIFICATE_RELATIVE_PATH));
    expect(resolveCertificatePath(FAKE_REPO_ROOT, absolute)).toBe(absolute);
    expect(resolveCertificatePath(FAKE_REPO_ROOT, "")).toBeNull();
    expect(resolveCertificatePath(FAKE_REPO_ROOT, 7)).toBeNull();
    expect(resolveCertificatePath(FAKE_REPO_ROOT, null)).toBeNull();
  });
});
