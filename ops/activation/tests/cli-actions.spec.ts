// The two action contracts of unit 10, which are not the same and must not converge:
//
//   * an `act` stops at the first failure, because everything after it was decided
//     against a world that no longer holds (`core/types.ts`);
//   * a teardown does all of its parts, because a disable that failed is a reason to keep
//     going, not to stop halfway (spec §5, the owner's abort).
//
// These need bound ports to show at all — with `actions: null` nothing ever reaches the
// failure branch — so this file fakes the ports rather than the store.
import { describe, expect, it } from "vitest";
import { applyAll, applyTeardown } from "../cli/invoke.ts";
import type { ApplyOptions } from "../cli/invoke.ts";
import type { StopMarkState } from "../core/stop.ts";
import type { ActionContext, ActionPorts } from "../actions/apply.ts";
import type { WorldAction } from "../core/types.ts";

const CONTEXT: ActionContext = {
  envFile: "C:\\Users\\felix\\source\\repos\\glass-box-trading\\.env",
  repoRoot: "C:\\Users\\felix\\source\\repos\\glass-box-trading",
  activationRoot: "C:\\Users\\felix\\glass-box-state\\activation-1",
  anchorDay: "2026-09-22",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  taskUserId: "felix",
  platform: "win32",
  taskUserSid: "S-1-5-21-1",
};

/** Only the members these actions touch; anything else would be a test that lies about its reach. */
function ports(options: { readonly disableFails?: boolean } = {}): ActionPorts {
  const attempted: string[] = [];
  const port = {
    now: () => 1_790_000_000_000,
    setTaskEnabled: async (task: string) => {
      attempted.push(`setTaskEnabled:${task}`);
      return Promise.resolve(options.disableFails === true ? { ok: false as const, reason: "TASK_NOT_FOUND" } : { ok: true as const, value: undefined });
    },
    deleteDisarm: async () => {
      attempted.push("deleteDisarm");
      return Promise.resolve({ ok: true as const, value: undefined });
    },
    clearReadiness: async () => {
      attempted.push("clearReadiness");
      return Promise.resolve({ ok: true as const, value: undefined });
    },
    pingSuccess: async (check: string) => {
      attempted.push(`pingSuccess:${check}`);
      return Promise.resolve({ ok: true as const, value: undefined });
    },
    attempted,
  };
  return port as unknown as ActionPorts;
}

const DISABLE: WorldAction = { kind: "disable-tasks", tasks: ["cycle", "watchdog"] };
const CLEAR: WorldAction = { kind: "clear-checks" };
const DELETE: WorldAction = { kind: "delete-disarm" };

/** No owner stop stands over these cases; the ones that need one say so themselves. */
const NO_STOP = (): Promise<StopMarkState> => Promise.resolve({ kind: "absent" });

function options(input: { readonly ports?: ActionPorts | null; readonly dryRun?: boolean; readonly print?: (line: string) => void; readonly stopAtFirstFailure?: boolean; readonly readStop?: () => Promise<StopMarkState> }): ApplyOptions {
  return {
    ports: input.ports === undefined ? null : input.ports,
    context: CONTEXT,
    dryRun: input.dryRun ?? false,
    print: input.print ?? ((): void => undefined),
    stopAtFirstFailure: input.stopAtFirstFailure ?? false,
    readStop: input.readStop ?? NO_STOP,
  };
}

describe("applying what was decided", () => {
  it("stops at the first failure when the caller is closing a step", async () => {
    const reports = await applyAll([DISABLE, DELETE, CLEAR], options({ ports: ports({ disableFails: true }), stopAtFirstFailure: true }));

    expect(reports).toHaveLength(1);
    expect(reports[0]?.applied).toBe(false);
    expect(reports[0]?.reason).toBe("DISABLE_TASKS:cycle:PORT_REFUSED,watchdog:PORT_REFUSED");
  });

  // The wiring, not the primitive. `applyAll` is tested above with `false` passed by
  // hand; nothing pinned that the teardown path *chooses* `false`, and a mutation probe
  // found it — flipping `applyTeardown`'s argument to `true` left the whole suite green.
  // That is the same shape as the defect this fix exists for: the contract was right and
  // nothing held the caller to it.
  it("the teardown path itself asks for every part, not only up to the first failure", async () => {
    const reports = await applyTeardown([DISABLE, DELETE, CLEAR], options({ ports: ports({ disableFails: true }) }));

    expect(reports.map(report => ({ kind: report.kind, applied: report.applied }))).toEqual([
      { kind: "disable-tasks", applied: false },
      { kind: "delete-disarm", applied: true },
      { kind: "clear-checks", applied: true },
    ]);
  });

  it("does every part of a teardown, although the first one failed", async () => {
    const reports = await applyAll([DISABLE, DELETE, CLEAR], options({ ports: ports({ disableFails: true }), stopAtFirstFailure: false }));

    expect(reports.map(report => ({ kind: report.kind, applied: report.applied }))).toEqual([
      { kind: "disable-tasks", applied: false },
      { kind: "delete-disarm", applied: true },
      { kind: "clear-checks", applied: true },
    ]);
  });

  it("applies everything in order when nothing fails", async () => {
    const reports = await applyAll([DISABLE, DELETE, CLEAR], options({ ports: ports(), stopAtFirstFailure: true }));

    expect(reports.every(report => report.applied)).toBe(true);
    expect(reports.map(report => report.kind)).toEqual(["disable-tasks", "delete-disarm", "clear-checks"]);
  });

  it("touches nothing in a dry run, whatever the ports would have done", async () => {
    const printed: string[] = [];
    const bound = ports();
    const reports = await applyAll([DISABLE, DELETE, CLEAR], options({ ports: bound, dryRun: true, print: (line: string) => printed.push(line), stopAtFirstFailure: true }));

    expect(reports.every(report => !report.applied && report.reason === "DRY_RUN")).toBe(true);
    expect(printed).toEqual(["would disable-tasks cycle, watchdog", "would delete-disarm", "would clear-checks"]);
    expect((bound as unknown as { attempted: string[] }).attempted).toEqual([]);
  });

  it("refuses every action with one reason when no host bindings exist", async () => {
    const reports = await applyAll([DISABLE, DELETE], options({ ports: null, stopAtFirstFailure: true }));

    expect(reports.map(report => report.reason)).toEqual(["NO_HOST_BINDINGS", "NO_HOST_BINDINGS"]);
    expect(reports.every(report => !report.applied)).toBe(true);
  });
});
