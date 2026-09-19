// The stop mark on disk (`docs/P12-STOP-AND-LOG-CONTRACTS.md`, SC-2, SC-8; R4-01).
//
// The compare-and-delete is the whole repair, so it is measured here directly rather than
// only through the CLI: what a continuation is allowed to remove, and what it must leave
// exactly where it found it.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStopMark, readStopMark, stopMarkPath, writeStopMark } from "../store/stop-mark.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async item => { await rm(item, { recursive: true, force: true, maxRetries: 3 }); }));
});

async function root(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "gbt-stop-store-"));
  roots.push(created);
  return created;
}

const MARK = { id: "stop-1", operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1_790_000_000_000, reason: "OWNER_ABORT" };

describe("what a continuation may lift", () => {
  it("lifts the stop it names", async () => {
    const stateRoot = await root();
    await writeStopMark(stateRoot, MARK);

    expect(await clearStopMark(stateRoot, "stop-1")).toEqual({ kind: "cleared", id: "stop-1" });
    expect((await readStopMark(stateRoot)).kind).toBe("absent");
  });

  it("leaves a different stop standing and says whose it is", async () => {
    const stateRoot = await root();
    await writeStopMark(stateRoot, { ...MARK, id: "stop-2", operator: "felix-later" });

    const result = await clearStopMark(stateRoot, "stop-1");

    expect(result.kind).toBe("superseded");
    if (result.kind !== "superseded") throw new Error("the newer stop was removed");
    expect(result.standing.operator).toBe("felix-later");
    expect((await readStopMark(stateRoot)).kind).toBe("present");
  });

  it("reports an absent stop as absent rather than as a lift", async () => {
    const stateRoot = await root();
    expect(await clearStopMark(stateRoot, "stop-1")).toEqual({ kind: "absent" });
  });

  // The same defect one level down: a mark that cannot be read is not a mark that is not
  // there, and deleting it would throw away the one fact that keeps the deployment from
  // arming itself. A mutation that deletes it anyway used to survive the whole suite.
  it("refuses to remove a mark it cannot read, and leaves the bytes where they are", async () => {
    const stateRoot = await root();
    await writeFile(stopMarkPath(stateRoot), "{ this is not json", "utf8");

    const result = await clearStopMark(stateRoot, "stop-1");

    expect(result.kind).toBe("unreadable");
    expect(await readFile(stopMarkPath(stateRoot), "utf8")).toBe("{ this is not json");
    expect((await readStopMark(stateRoot)).kind).toBe("unreadable");
  });

  it("keeps the newest stop when two are written in a row, because the latest word counts", async () => {
    const stateRoot = await root();
    await writeStopMark(stateRoot, MARK);
    await writeStopMark(stateRoot, { ...MARK, id: "stop-2", at: "2026-09-21T22:35:00+02:00" });

    const state = await readStopMark(stateRoot);
    expect(state.kind).toBe("present");
    if (state.kind !== "present") throw new Error("no mark stands");
    expect(state.mark.id).toBe("stop-2");
    // And the older id no longer lifts anything.
    expect((await clearStopMark(stateRoot, "stop-1")).kind).toBe("superseded");
  });
});
