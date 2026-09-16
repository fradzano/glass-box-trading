// The deployment file (unit 10). It carries measurements — the host preconditions of
// spec §3 and the long-run account's masked id — and the core compares them without ever
// asking where they came from. A half-read file would therefore put a plausible-looking
// wrong expectation in front of the gate, which is why every field is required and every
// refusal names the field it refused.
import { describe, expect, it } from "vitest";
import { parseDeploymentFacts } from "../cli/deployment.ts";

const REPO = "C:\\Users\\felix\\source\\repos\\glass-box-trading";
const ROOT = "C:\\Users\\felix\\glass-box-state\\activation-1";

const COMPLETE = {
  longRunAccountMasked: "PA3L…U97",
  coverageThroughDate: "2026-12-16",
  minFreeDiskBytes: 10_000_000_000,
  expectedHostPreconditions: { HiberbootEnabled: "0", DisableAutomaticRestartSignOn: "1" },
};

function parse(value: unknown) {
  return parseDeploymentFacts(JSON.stringify(value), REPO, ROOT);
}

function reason(value: unknown): string {
  const parsed = parse(value);
  if (parsed.ok) throw new Error("expected a refusal");
  return parsed.reason;
}

describe("the deployment file", () => {
  it("reads a complete file and takes the roots from the invocation, not from the file", () => {
    const parsed = parse(COMPLETE);
    expect(parsed).toEqual({
      ok: true,
      facts: {
        repoRoot: REPO,
        activationRoot: ROOT,
        longRunAccountMasked: "PA3L…U97",
        coverageThroughDate: "2026-12-16",
        expectedHostPreconditions: { HiberbootEnabled: "0", DisableAutomaticRestartSignOn: "1" },
        minFreeDiskBytes: 10_000_000_000,
      },
    });
  });

  it("ignores a byte-order mark, which every Windows editor is happy to add", () => {
    expect(parseDeploymentFacts(`\uFEFF${JSON.stringify(COMPLETE)}`, REPO, ROOT).ok).toBe(true);
  });

  it("refuses text that is not JSON, and JSON that is not an object", () => {
    expect(parseDeploymentFacts("{", REPO, ROOT)).toEqual({ ok: false, reason: "the deployment file is not JSON" });
    expect(reason([COMPLETE])).toBe("the deployment file is not a JSON object");
  });

  it("names the missing field rather than falling back to a default", () => {
    expect(reason({ ...COMPLETE, longRunAccountMasked: undefined })).toBe("longRunAccountMasked is missing");
    expect(reason({ ...COMPLETE, longRunAccountMasked: "  " })).toBe("longRunAccountMasked is missing");
    for (const bad of ["16.12.2026", "2026-12", "20261216", "2026-12-16T00:00:00+01:00"]) {
      expect(reason({ ...COMPLETE, coverageThroughDate: bad })).toBe("coverageThroughDate is missing or is not YYYY-MM-DD");
    }
    expect(reason({ ...COMPLETE, minFreeDiskBytes: "10000000000" })).toBe("minFreeDiskBytes is missing or is not a positive whole number of bytes");
    expect(reason({ ...COMPLETE, minFreeDiskBytes: 0 })).toBe("minFreeDiskBytes is missing or is not a positive whole number of bytes");
    expect(reason({ ...COMPLETE, minFreeDiskBytes: 1.5 })).toBe("minFreeDiskBytes is missing or is not a positive whole number of bytes");
  });

  it("refuses preconditions that are not text, because the reader returns text", () => {
    expect(reason({ ...COMPLETE, expectedHostPreconditions: { HiberbootEnabled: 0 } }))
      .toBe("expectedHostPreconditions is missing or is not an object of text values");
  });

  it("refuses an empty precondition set, which step 0 would compare against nothing", () => {
    expect(reason({ ...COMPLETE, expectedHostPreconditions: {} }))
      .toBe("expectedHostPreconditions is empty, so step 0 would compare against nothing");
  });
});
