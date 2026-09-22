import { describe, expect, it, vi } from "vitest";
import { deliverActivationAlert, runCliEntry } from "../cli.ts";
import type { ActivationPager } from "../actions/host.ts";

function pager(calls: string[]): ActivationPager {
  return {
    fail: reason => { calls.push(`fail:${reason}`); return Promise.resolve({ ok: true, value: undefined }); },
    success: () => { calls.push("success"); return Promise.resolve({ ok: true, value: undefined }); },
  };
}

describe("activation CLI top-level failure boundary", () => {
  it("sends failure outcomes through fail and clears only a clean owner-opened outcome", async () => {
    const calls: string[] = [];
    const bound = pager(calls);
    const signal = new AbortController().signal;
    await deliverActivationAlert({ kind: "opened", attempt: "a", found: "LEDGER_EMPTY" }, bound, signal);
    await deliverActivationAlert({ kind: "opened", attempt: "a", found: "OWNER_OPENED", stopStanding: null }, bound, signal);
    await deliverActivationAlert({ kind: "waited", reason: "NOT_DUE", noted: false }, bound, signal);
    expect(calls).toEqual(["fail:ACTIVATION_LEDGER_EMPTY", "success"]);
  });

  it("pages an unexpected production failure and returns the partial-failure code", async () => {
    const calls: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const code = await runCliEntry({
        argv: ["run"],
        runMain: () => Promise.reject(new Error("TEST_ONLY unexpected")),
        pager: pager(calls),
      });
      expect(code).toBe(4);
      expect(calls).toEqual(["fail:ACTIVATION_UNEXPECTED_FAILURE"]);
      expect(stderr).toHaveBeenCalledWith("activation invocation failed unexpectedly; no result was claimed\n");
    } finally {
      stderr.mockRestore();
    }
  });

  it("never pages from the same unexpected failure during a dry run", async () => {
    const calls: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const code = await runCliEntry({
        argv: ["run", "--dry-run"],
        runMain: () => Promise.reject(new Error("TEST_ONLY unexpected")),
        pager: pager(calls),
      });
      expect(code).toBe(4);
      expect(calls).toEqual([]);
    } finally {
      stderr.mockRestore();
    }
  });
});
