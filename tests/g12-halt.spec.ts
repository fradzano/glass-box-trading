import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import { haltStateAfter, haltStateFrom, parseJournalText } from "../src/core/journal.js";
import type { HaltState, JournalEntry } from "../src/core/journal.js";
import { planCloseLifecycle } from "../src/core/order-identity.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { manualUnhalt } from "../src/shell/manual-unhalt.js";
import { createMutationGateway, NO_BROKER_PORT } from "../src/shell/mutation-gateway.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, snapshot } from "./fixtures.js";
import { TEST_ONLY_AT, TEST_ONLY_AT_MS, cycleEntry, draftOf, haltEntry } from "./journal-fixtures.js";

const temporaryDirectories: string[] = [];
function temporaryStateDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p2-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const NOT_HALTED: HaltState = { halted: false, reason: null, sticky: false };
function unhaltEntry(seq: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return { seq, at: TEST_ONLY_AT, epoch: 1, type: "UNHALT", operator: "felix", reason: "resumed", actor: "human", ...overrides } as unknown as JournalEntry;
}

describe("S-G12-03 halt vetoes entries, management still runs", () => {
  it("S-G12-03 a halted snapshot yields zero entry actions with a HALT verdict while the full gate vector is still recorded and close planning is unaffected", () => {
    const halted = snapshot({ halt: true });
    const result = decide(halted, { kind: "candidates", candidates: [candidate()] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(result.actions).toEqual([]);
    expect(result.batchVerdicts).toContainEqual({ code: "HALT", reason: expect.any(String) });
    expect(result.candidateVerdicts).toHaveLength(1);
    expect(result.candidateVerdicts[0]?.gateVector).toHaveLength(8);
    const open = decide(snapshot({ halt: false }), { kind: "candidates", candidates: [candidate()] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(open.actions).toHaveLength(1);
    expect(open.batchVerdicts.some(verdict => verdict.code === "HALT")).toBe(false);
    // Management (a close lifecycle) has no halt input at all: it plans the same under halt.
    const plan = planCloseLifecycle({ exposureLifecycleId: "spread-1", route: "ordinary", currentExposureQuantity: integerUnit(2, "Quantity"), attempts: [] });
    expect(plan).toMatchObject({ kind: "SUBMIT", quantity: 2 });
  });
});

describe("S-G12-04 un-halt is manual and journaled", () => {
  it("S-G12-04 the pure halt transition clears only on a human UNHALT and never on any other entry", () => {
    const halted = haltStateAfter(NOT_HALTED, haltEntry(1));
    expect(halted).toEqual({ halted: true, reason: "MANUAL", sticky: false });
    expect(haltStateAfter(halted, cycleEntry(2))).toEqual(halted);
    expect(haltStateAfter(halted, { ...cycleEntry(2), type: "RECONCILIATION", reasonCodes: [], items: [] } as unknown as JournalEntry)).toEqual(halted);
    expect(haltStateAfter(halted, unhaltEntry(3))).toEqual(NOT_HALTED);
    expect(haltStateAfter(halted, unhaltEntry(3, { actor: "agent" }))).toEqual(halted);
    const sticky = haltStateAfter(NOT_HALTED, haltEntry(1, { reason: "PROVENANCE_BROKEN", sticky: true }));
    expect(haltStateAfter(sticky, unhaltEntry(2))).toEqual(sticky);
    expect(haltStateFrom([haltEntry(1), cycleEntry(2), unhaltEntry(3), cycleEntry(4)])).toEqual(NOT_HALTED);
    expect(haltStateFrom([haltEntry(1), cycleEntry(2)])).toEqual({ halted: true, reason: "MANUAL", sticky: false });
    expect(haltStateFrom([])).toEqual(NOT_HALTED);
  });

  it("S-G12-04 the gateway rejects UNHALT from the agent path; only the manual tool appends it, journaled with the operator", async () => {
    const paths = resolveStateDir(temporaryStateDir());
    if (!paths.ok) throw new Error(paths.reason);
    writeFileSync(paths.value.epoch, JSON.stringify({ epoch: 1, holderId: "writer-a", acquiredAt: TEST_ONLY_AT }), "utf8");
    const gateway = createMutationGateway({ paths: paths.value, secrets: [], clock: () => TEST_ONLY_AT_MS, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    expect(await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(haltEntry(1)) } })).toMatchObject({ ok: true, seq: 1 });
    expect(readHaltState(paths.value)).toEqual({ halted: true, reason: "MANUAL", sticky: false });
    expect(await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(cycleEntry(2)) } })).toMatchObject({ ok: true, seq: 2 });
    expect(readHaltState(paths.value).halted).toBe(true);
    expect(await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(unhaltEntry(3)) } })).toMatchObject({ ok: false, reason: "UNHALT_REQUIRES_MANUAL_PATH" });
    expect(readHaltState(paths.value).halted).toBe(true);
    // A fresh process sees the same persisted halt.
    const restarted = createMutationGateway({ paths: paths.value, secrets: [], clock: () => TEST_ONLY_AT_MS + 1_000, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    expect((await restarted.openJournal()).halt.halted).toBe(true);

    const unhalted = await manualUnhalt({ paths: paths.value, operator: "felix", reason: "reviewed positions, resuming", clock: () => TEST_ONLY_AT_MS + 2_000, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 });
    expect(unhalted).toMatchObject({ ok: true });
    expect(readHaltState(paths.value)).toEqual(NOT_HALTED);
    const entries = parseJournalText(readFileSync(paths.value.journal, "utf8")).entries;
    expect(entries.at(-1)).toMatchObject({ type: "UNHALT", operator: "felix", actor: "human", reason: "reviewed positions, resuming" });
    expect(await manualUnhalt({ paths: paths.value, operator: "", reason: "x", clock: () => TEST_ONLY_AT_MS + 3_000, secrets: [], instanceId: "manual", lockTakeoverBoundMs: 60_000 })).toMatchObject({ ok: false });
    // The sticky halt survives the manual tool as well.
    expect(await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(haltEntry(1, { reason: "PROVENANCE_BROKEN", sticky: true })) } })).toMatchObject({ ok: true });
    expect(await manualUnhalt({ paths: paths.value, operator: "felix", reason: "try", clock: () => TEST_ONLY_AT_MS + 4_000, secrets: [], instanceId: "manual-felix", lockTakeoverBoundMs: 60_000 })).toMatchObject({ ok: false, reason: "HALT_IS_STICKY" });
    expect(readHaltState(paths.value)).toEqual({ halted: true, reason: "PROVENANCE_BROKEN", sticky: true });
  });

  it("S-G12-04 no shell module besides the manual tool and the gateway's refusal mentions UNHALT", () => {
    const shellDirectory = path.resolve("src/shell");
    const mentioning = readdirSync(shellDirectory).filter(name => name.endsWith(".ts") && readFileSync(path.join(shellDirectory, name), "utf8").includes("UNHALT")).sort();
    expect(mentioning).toEqual(["manual-unhalt.ts", "mutation-gateway.ts"]);
    const fixtures = path.resolve("src/fixtures");
    expect(readdirSync(fixtures).filter(name => readFileSync(path.join(fixtures, name), "utf8").includes("UNHALT"))).toEqual([]);
  });
});

describe("S-G12-05 the halt flag is a persisted file and a core input", () => {
  it("S-G12-05 the flag lives in STATE_DIR, is read by the shell into the snapshot, and an unreadable flag counts as halted", async () => {
    const paths = resolveStateDir(temporaryStateDir());
    if (!paths.ok) throw new Error(paths.reason);
    expect(existsSync(paths.value.halt)).toBe(false);
    expect(readHaltState(paths.value)).toEqual(NOT_HALTED);
    writeFileSync(paths.value.epoch, JSON.stringify({ epoch: 1, holderId: "writer-a", acquiredAt: TEST_ONLY_AT }), "utf8");
    const gateway = createMutationGateway({ paths: paths.value, secrets: [], clock: () => TEST_ONLY_AT_MS, brokerPort: NO_BROKER_PORT, instanceId: "writer-a", lockTakeoverBoundMs: 60_000 });
    await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draftOf(haltEntry(1, { reason: "GAP", detail: "lost journal" })) } });
    expect(existsSync(paths.value.halt)).toBe(true);
    expect(path.dirname(paths.value.halt)).toBe(paths.value.root);
    const persisted = readHaltState(paths.value);
    expect(persisted).toEqual({ halted: true, reason: "GAP", sticky: false });
    const result = decide(snapshot({ halt: persisted.halted }), { kind: "candidates", candidates: [candidate()] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(result.actions).toEqual([]);
    writeFileSync(paths.value.halt, "{not json", "utf8");
    expect(readHaltState(paths.value)).toMatchObject({ halted: true, reason: "HALT_FLAG_UNREADABLE" });
    writeFileSync(paths.value.halt, JSON.stringify({ halted: "no" }), "utf8");
    expect(readHaltState(paths.value)).toMatchObject({ halted: true, reason: "HALT_FLAG_UNREADABLE" });
  });
});
