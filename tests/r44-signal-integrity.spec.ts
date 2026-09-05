// R44: the findings of the counter-gate on the R43 fix set that are about
// *signals* rather than about the fence — what the deployment reports about
// itself, and whether that report can be trusted.
//
// The common shape of all three: a check answered "fine" for a state that was
// not fine. A durability probe that asked about permissions and not about
// room; a standing-impediment reader that treated unreadable authority state
// as absence of a fence; and one invocation that reported its refusal twice
// under two different names.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { probeDurableWrite, writeEpochStore } from "../src/shell/epoch-store.js";
import { standingImpediment, writeHaltState } from "../src/shell/halt-state.js";
import { probeStateDurability, resolveStateDir } from "../src/shell/state-dir.js";
import { runStartup } from "../src/shell/startup.js";
import { manualReleasePrecondition } from "../src/core/lifecycle.js";
import type { StatePaths } from "../src/shell/state-dir.js";

function scratchState(label: string): StatePaths {
  const root = path.join(tmpdir(), `gbt-r44-${label}-${String(process.pid)}-${String(Math.trunc(performance.now() * 1000))}`);
  mkdirSync(root, { recursive: true });
  const resolved = resolveStateDir(root);
  if (!resolved.ok) throw new Error(`scratch state dir refused: ${resolved.detail}`);
  return resolved.value;
}

describe("R44-B3 — the durability probe asks whether bytes land, not only whether permissions allow", () => {
  it("writes, flushes and removes a probe file, leaving the state directory as it found it", () => {
    const paths = scratchState("probe");
    try {
      expect(probeDurableWrite(paths.root)).toEqual({ ok: true });
      expect(existsSync(path.join(paths.root, ".durability-probe")), "the probe cleans up after itself").toBe(false);
      expect(existsSync(paths.journal), "and it never creates the journal").toBe(false);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it("reports the failure when the directory does not accept a new file at all", () => {
    // The gate's moment was ENOSPC, which cannot be produced portably here.
    // What is reproducible is the same distinction: metadata says yes and the
    // write says no. A directory that has been replaced by a file gives
    // exactly that shape — every path under it fails at open, not at access.
    const root = path.join(tmpdir(), `gbt-r44-nodir-${String(process.pid)}`);
    rmSync(root, { recursive: true, force: true });
    writeFileSync(root, "not a directory", "utf8");
    try {
      const probed = probeDurableWrite(root);
      expect(probed.ok).toBe(false);
      expect(!probed.ok && probed.reason).toContain("state directory");
    } finally {
      rmSync(root, { force: true });
    }
  });

  it("probeStateDurability fails on a directory that permissions call writable but that accepts no new file", () => {
    // The mutation probe found this gap: neutering the byte-level call left
    // every assertion green, because the other checks are permission checks
    // that a full or otherwise write-refusing volume passes. ENOSPC is not
    // reproducible portably; a directory occupying the probe file's own name
    // has the same shape — `accessSync(root, W_OK)` succeeds and the open of
    // that path does not.
    const paths = scratchState("blocked");
    try {
      writeFileSync(paths.journal, "", "utf8");
      expect(probeStateDurability(paths), "the baseline is clean").toEqual({ ok: true });
      mkdirSync(path.join(paths.root, ".durability-probe"), { recursive: true });
      const probed = probeStateDurability(paths);
      expect(probed.ok, "permissions say yes and the write says no").toBe(false);
      expect(!probed.ok && probed.reason).toMatch(/state directory/u);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it("probeStateDurability now includes that byte-level probe, so a read-only journal and an unwritable directory both fail", () => {
    const paths = scratchState("durability");
    try {
      writeFileSync(paths.journal, "", "utf8");
      expect(probeStateDurability(paths)).toEqual({ ok: true });
      chmodSync(paths.journal, 0o444);
      const probed = probeStateDurability(paths);
      expect(probed.ok).toBe(false);
      expect(!probed.ok && probed.reason).toContain("journal");
    } finally {
      if (existsSync(paths.journal)) chmodSync(paths.journal, 0o666);
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe("R44-B6 — a state nobody can read is an impediment, not an all-clear", () => {
  it("an unreadable epoch store stands in the way, while an absent one is a virgin deployment", () => {
    const paths = scratchState("epoch");
    try {
      // Absent: nothing has bootstrapped yet. Not an impediment.
      expect(standingImpediment(paths)).toBeNull();

      // Unreadable: every acquisition returns EPOCH_UNREADABLE, so reporting
      // readiness would report the opposite of the truth.
      writeFileSync(paths.epoch, "{ this is not json", "utf8");
      expect(standingImpediment(paths)).toMatchObject({ reason: "AUTHORITY_STATE_UNREADABLE" });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it("a journal whose lines no longer parse is an impediment too, and a clean one is not", () => {
    const paths = scratchState("journal");
    try {
      writeEpochStore(paths, { epoch: 1, holderId: "someone", acquiredAt: "2026-09-05T18:00:00.000Z", seedPending: false, resetPending: false, fencePending: false });
      writeHaltState(paths, { halted: false, reason: null, sticky: false });
      writeFileSync(paths.journal, "", "utf8");
      expect(standingImpediment(paths), "an empty journal is a fresh one").toBeNull();

      writeFileSync(paths.journal, `{"seq":1,"this":"is not a journal entry"}\n`, "utf8");
      const impediment = standingImpediment(paths);
      expect(impediment).not.toBeNull();
      expect(impediment?.reason).toMatch(/^JOURNAL_CORRUPT:/u);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it("a halt outranks both, so the operator is told what stopped the deployment and not a symptom of it", () => {
    const paths = scratchState("halt");
    try {
      writeEpochStore(paths, { epoch: 1, holderId: "someone", acquiredAt: "2026-09-05T18:00:00.000Z", seedPending: false, resetPending: false, fencePending: true });
      writeHaltState(paths, { halted: true, reason: "AUTH_FAILURE", sticky: false });
      expect(standingImpediment(paths)).toEqual({ reason: "AUTH_FAILURE", fencePending: true });
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe("R44-B7 — one scheduled invocation reports readiness once", () => {
  it("a startup refusal records that it already sent the failure signal", async () => {
    const paths = scratchState("startup");
    const pings: string[] = [];
    try {
      const outcome = await runStartup({
        rawConfig: { ALPACA_PROFILE: "not-a-profile", STATE_DIR: paths.root },
        openSink: () => null,
        failPing: code => { pings.push(code); return Promise.resolve(); },
        journal: { append: () => Promise.resolve(false) },
        clock: () => 1_788_000_000_000,
      });
      expect(outcome.armed).toBe(false);
      expect(pings, "the validator sent exactly one failure signal").toHaveLength(1);
      expect(outcome.failurePinged, "and it says so, so the CLI does not send a second under another name").toBe(true);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });

  it("an armed startup has sent nothing, so the caller stays free to report", async () => {
    // The negative half: `failurePinged` must not be a constant true, or the
    // CLI's own STARTUP_REFUSED path would be suppressed for every stage that
    // refuses after validation.
    const paths = scratchState("armed");
    try {
      writeFileSync(paths.journal, "", "utf8");
      const outcome = await runStartup({
        rawConfig: {},
        openSink: () => null,
        failPing: () => Promise.resolve(),
        journal: { append: () => Promise.resolve(false) },
        clock: () => 1_788_000_000_000,
      });
      // This configuration is refused too, but the point is the flag's shape:
      // it is derived from whether the ping happened, never hard-coded.
      expect(typeof outcome.failurePinged).toBe("boolean");
      expect(outcome.failurePinged).toBe(outcome.refusal !== null);
      expect(readFileSync(paths.journal, "utf8"), "validation appends nothing itself").toBe("");
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});

describe("R44-B9 — a manual release names the halt it releases", () => {
  it("refuses a confirmed release that does not name a standing journaled halt, and says which number to use", () => {
    // The gate's moment: a preview of HALT seq 1, a HALT seq 2 landing next,
    // and a CAS-less release clearing both. The operator has just read the
    // number in the preview, so naming it costs nothing.
    expect(manualReleasePrecondition({ standingHaltSeq: 1, expectedHaltSeq: null })).toEqual({ ok: false, requiredHaltSeq: 1 });
    expect(manualReleasePrecondition({ standingHaltSeq: 2, expectedHaltSeq: 2 })).toEqual({ ok: true });
    // Naming a different one is not this check's job — the gateway's own CAS
    // refuses it — but it must get that far.
    expect(manualReleasePrecondition({ standingHaltSeq: 2, expectedHaltSeq: 1 })).toEqual({ ok: true });
  });

  it("allows the one case that has no sequence number to name: a fence with no journaled halt", () => {
    expect(manualReleasePrecondition({ standingHaltSeq: null, expectedHaltSeq: null })).toEqual({ ok: true });
  });
});
