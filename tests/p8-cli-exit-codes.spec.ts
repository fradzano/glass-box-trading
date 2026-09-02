// P8 — the three CLI exit-code tables (S-G12-01). The convention the spec
// states is a contrast, not a single rule: the scheduled second instance
// (agent-cli) exits 0 on suppression because a suppressed scheduled run is a
// normal outcome, while the owner-driven one-shot tools exit non-zero so the
// operator learns that the run they asked for did not happen — the certificate
// CLI with 1, the deadline CLI with its own 3. Those numbers were unproven by
// any test until this suite; each table is asserted here stage by stage, and
// the `Record<Stage, number>` shape makes a new refusal stage in either
// composition root a typecheck failure rather than a silent 1.
import { describe, expect, it } from "vitest";
import {
  agentBuildRefusalChannel,
  agentCliExitCode,
  certificateCliExitCode,
  deadlineCliExitCode,
} from "../src/shell/cli-exit-codes.js";
import type { RuntimeBuildRefusalStage } from "../src/shell/cli-exit-codes.js";
import type { DeadlineRefusalStage } from "../src/shell/deadline-runtime.js";

/** Every refusal stage of the agent composition root, with the code the scheduled entry point must exit with. */
const AGENT_BUILD_STAGE_CODES: Readonly<Record<RuntimeBuildRefusalStage, number>> = {
  startup: 1,
  credentials: 1,
  suppressed: 0,
  account_binding: 1,
  calendar: 1,
  authority: 1,
  analyst: 1,
  digest: 1,
  arming: 1,
};

/** The same stages seen by the owner-driven certificate CLI: suppression is a failure of the requested run. */
const CERTIFICATE_BUILD_STAGE_CODES: Readonly<Record<RuntimeBuildRefusalStage, number>> = {
  startup: 1,
  credentials: 1,
  suppressed: 1,
  account_binding: 1,
  calendar: 1,
  authority: 1,
  analyst: 1,
  digest: 1,
  arming: 1,
};

/** Every refusal stage of the deadline composition root; suppression has its own distinguishable code. */
const DEADLINE_COMPOSITION_STAGE_CODES: Readonly<Record<DeadlineRefusalStage, number>> = {
  configuration: 1,
  state_dir: 1,
  credentials: 1,
  binding: 1,
  suppressed: 3,
  authority: 1,
  calendar: 1,
};

function stagesOf<Stage extends string>(table: Readonly<Record<Stage, number>>): readonly [Stage, number][] {
  return Object.entries(table) as [Stage, number][];
}

describe("S-G12-01 — the scheduled agent CLI exits 0 on suppression", () => {
  it("maps every build refusal stage to its exit code, and only suppression to 0", () => {
    const stages = stagesOf(AGENT_BUILD_STAGE_CODES);
    expect(stages).toHaveLength(9);
    for (const [stage, code] of stages) {
      expect({ stage, code: agentCliExitCode({ kind: "build_refused", stage }) }).toEqual({ stage, code });
    }
    expect(stages.filter(([, code]) => code === 0).map(([stage]) => stage)).toEqual(["suppressed"]);
  });

  it("reports a suppressed scheduled run on stdout as `suppressed`, every other refusal on stderr as `refused`", () => {
    expect(agentBuildRefusalChannel("suppressed")).toEqual({ stream: "stdout", prefix: "suppressed" });
    for (const [stage] of stagesOf(AGENT_BUILD_STAGE_CODES).filter(([name]) => name !== "suppressed")) {
      expect(agentBuildRefusalChannel(stage)).toEqual({ stream: "stderr", prefix: "refused" });
    }
  });

  it("exits 0 only for a cycle whose journal append succeeded", () => {
    expect(agentCliExitCode({ kind: "cycle_finished", journalFailed: false })).toBe(0);
    expect(agentCliExitCode({ kind: "cycle_finished", journalFailed: true })).toBe(1);
    expect(agentCliExitCode({ kind: "cycle_aborted" })).toBe(1);
  });
});

describe("S-G12-01 — the owner-driven certificate CLI exits non-zero on suppression", () => {
  it("maps every build refusal stage, suppression included, to 1", () => {
    const stages = stagesOf(CERTIFICATE_BUILD_STAGE_CODES);
    expect(stages).toHaveLength(9);
    for (const [stage, code] of stages) {
      expect({ stage, code: certificateCliExitCode({ kind: "build_refused", stage }) }).toEqual({ stage, code });
    }
    // The line the operator reads for that exit is `refused at suppressed: …` — by spec, not by accident.
    expect(certificateCliExitCode({ kind: "build_refused", stage: "suppressed" })).toBe(1);
  });

  it("keeps 2 for the admission refusals that happen before any runtime exists", () => {
    expect(certificateCliExitCode({ kind: "command_refused" })).toBe(2);
    expect(certificateCliExitCode({ kind: "smoke_cycle_inside_session" })).toBe(2);
    expect(certificateCliExitCode({ kind: "outside_session" })).toBe(2);
  });

  it("exits 0 for a completed preflight, a completed smoke cycle, and a PASS certificate only", () => {
    expect(certificateCliExitCode({ kind: "preflight_reported" })).toBe(0);
    expect(certificateCliExitCode({ kind: "smoke_cycle_finished" })).toBe(0);
    expect(certificateCliExitCode({ kind: "certificate_finished", verdict: "PASS" })).toBe(0);
    expect(certificateCliExitCode({ kind: "certificate_finished", verdict: "FAIL" })).toBe(1);
    expect(certificateCliExitCode({ kind: "runtime_construction_failed" })).toBe(1);
    expect(certificateCliExitCode({ kind: "run_aborted" })).toBe(1);
  });
});

describe("S-G12-01 — the owner-driven deadline CLI exits 3 on suppression", () => {
  it("maps every composition refusal stage to its exit code, and only suppression to 3", () => {
    const stages = stagesOf(DEADLINE_COMPOSITION_STAGE_CODES);
    expect(stages).toHaveLength(7);
    for (const [stage, code] of stages) {
      expect({ stage, code: deadlineCliExitCode({ kind: "composition_refused", stage }) }).toEqual({ stage, code });
    }
    expect(stages.filter(([, code]) => code === 3).map(([stage]) => stage)).toEqual(["suppressed"]);
    expect(stages.some(([, code]) => code === 0)).toBe(false);
  });

  it("keeps usage, an already standing TERMINAL, and a missing entry distinguishable", () => {
    expect(deadlineCliExitCode({ kind: "usage_refused" })).toBe(2);
    expect(deadlineCliExitCode({ kind: "entry_already_stands" })).toBe(4);
    expect(deadlineCliExitCode({ kind: "entry_finished", appended: true })).toBe(0);
    expect(deadlineCliExitCode({ kind: "entry_finished", appended: false })).toBe(1);
    expect(deadlineCliExitCode({ kind: "entry_aborted" })).toBe(1);
  });

  it("gives the three CLIs three different codes for the one suppression the spec contrasts", () => {
    expect([
      agentCliExitCode({ kind: "build_refused", stage: "suppressed" }),
      certificateCliExitCode({ kind: "build_refused", stage: "suppressed" }),
      deadlineCliExitCode({ kind: "composition_refused", stage: "suppressed" }),
    ]).toEqual([0, 1, 3]);
  });
});
