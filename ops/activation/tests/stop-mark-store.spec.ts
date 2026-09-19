// The stop mark on disk (`docs/P12-STOP-AND-LOG-CONTRACTS.md`, SC-2, SC-8; R4-01).
//
// The compare-and-delete is the whole repair, so it is measured here directly rather than
// only through the CLI: what a continuation is allowed to remove, and what it must leave
// exactly where it found it.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStopMark, quarantineStopMark, readStopMark, stopMarkPath, writeStopMark } from "../store/stop-mark.ts";

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

// The lock the compare-and-delete rests on was shipped with no test at all, and an
// independent gate found the consequence within the hour: an unparseable lock made
// `writeStopMark` throw, so the owner's stop left no mark and the deployment was free to
// arm again — the exact harm the mark exists to prevent, through the resource introduced
// to protect it. These are the cases that were missing.
describe("the mark's own lock, which may never become the reason a stop fails", () => {
  const lockOf = (stateRoot: string): string => `${stopMarkPath(stateRoot)}.lock`;

  for (const [name, content] of [["zero bytes", ""], ["garbage", "not json at all"], ["no timestamp", "{\"pid\":1}"]] as const) {
    it(`writes the mark anyway when the lock holds ${name}`, async () => {
      const stateRoot = await root();
      await writeFile(lockOf(stateRoot), content, "utf8");

      await expect(writeStopMark(stateRoot, MARK)).resolves.toBeUndefined();

      const state = await readStopMark(stateRoot);
      expect(state.kind).toBe("present");
    }, 20_000);

    it(`lifts the mark anyway when the lock holds ${name}`, async () => {
      const stateRoot = await root();
      await writeStopMark(stateRoot, MARK);
      await writeFile(lockOf(stateRoot), content, "utf8");

      const result = await clearStopMark(stateRoot, "stop-1");

      // Either it took the lock over — a lock it cannot read is an expired lock — or it
      // reported that it is held. What it may never do is throw, and it may never leave
      // the owner without a way through.
      expect(["cleared", "locked"]).toContain(result.kind);
      if (result.kind === "cleared") expect((await readStopMark(stateRoot)).kind).toBe("absent");
    }, 20_000);
  }

  it("does not release a lock that another invocation took over", async () => {
    const stateRoot = await root();
    // A lock whose token is not ours and whose age is fresh: releasing it would be the
    // classic double free, and the second holder would lose its serialisation.
    await writeFile(lockOf(stateRoot), JSON.stringify({ token: "somebody-else", pid: 4242, atUtcMs: Date.now() }), "utf8");

    await writeStopMark(stateRoot, MARK);

    expect(await readFile(lockOf(stateRoot), "utf8")).toContain("somebody-else");
  }, 20_000);

  it("leaves no half-written mark behind when the rename fails", async () => {
    const stateRoot = await root();
    // A directory where the mark must go: the temporary file is written, the rename
    // cannot land, and what used to stay behind was `stop.json.writing-<pid>`.
    await mkdir(stopMarkPath(stateRoot), { recursive: true });

    await expect(writeStopMark(stateRoot, MARK)).rejects.toThrow();

    const leftovers = (await readdir(stateRoot)).filter(name => name.includes(".writing-"));
    expect(leftovers).toEqual([]);
  }, 20_000);

  it("sets an unreadable mark aside instead of leaving the deployment unable to arm for ever", async () => {
    const stateRoot = await root();
    await writeFile(stopMarkPath(stateRoot), "{ not json", "utf8");

    const quarantined = await quarantineStopMark(stateRoot);

    expect(quarantined).not.toBeNull();
    expect((await readStopMark(stateRoot)).kind).toBe("absent");
    // Renamed, never deleted: a stop nobody can read is exactly the case where the bytes
    // are the only evidence of whatever wrote them.
    expect(await readFile(quarantined as string, "utf8")).toBe("{ not json");
  }, 20_000);
});
