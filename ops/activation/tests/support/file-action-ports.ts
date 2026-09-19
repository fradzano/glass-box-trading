// Isolated action doubles, backed by a file, so that **competing effects** can be
// measured before unit 13 binds the real host (R4-01's other half, and the reviewer's
// explicit note of 2026-09-19: "isolated, file-backed action doubles can test competing
// effects before Unit 13").
//
// Why a file and not an object: the two invocations that compete for one world are two
// operating-system processes, and an in-process double proves nothing about them. The
// world lives in one JSON file; every port reads it, changes one field and writes it
// back. The file is also the assertion surface — the test reads the final world rather
// than believing either process's report about it.
//
// What this is not: a host binding. It applies no scheduled-task change, sends no ping
// and touches no `.env`. It is the smallest thing that has the property under test — an
// effect that two processes can overwrite for each other.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createAuthorizedEnvReplacePort } from "../../actions/apply.ts";
import type { ActionPorts } from "../../actions/apply.ts";
import type { CheckName, CheckObservation, TaskName } from "../../core/types.ts";

export interface FileWorld {
  /** Task states, the field the stop and the arming step fight over. */
  readonly tasks: Record<TaskName, boolean>;
  readonly disarmRegistered: boolean;
  readonly certificateLine: string | null;
  /** Every effect in the order it was applied, by whichever process applied it. */
  readonly effects: string[];
  /**
   * How long `setTaskEnabled` takes, in milliseconds. A real `Enable-ScheduledTask` is
   * not instantaneous, and the window it opens is exactly where a competing stop lands.
   */
  readonly enableDelayMs: number;
}

export function freshFileWorld(enableDelayMs = 0): FileWorld {
  return { tasks: { cycle: false, watchdog: false }, disarmRegistered: true, certificateLine: null, effects: [], enableDelayMs };
}

export function readFileWorld(file: string): FileWorld {
  return JSON.parse(readFileSync(file, "utf8")) as FileWorld;
}

function mutate(file: string, change: (world: FileWorld) => void): void {
  const world = readFileWorld(file);
  change(world);
  writeFileSync(file, JSON.stringify(world, null, 2), "utf8");
}

const ok = <T,>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });

/**
 * `pid` goes into every effect line, so the record says which process applied what. That
 * is the difference between "both tasks are disabled at the end" and "the stop is what
 * disabled them".
 */
export function createFileActionPorts(file: string, label: string): ActionPorts {
  const note = (text: string): void => { mutate(file, world => { world.effects.push(`${label}:${text}`); }); };
  return {
    now: () => Date.now(),
    readChecks: () => Promise.resolve({ known: true, value: {} as Readonly<Record<CheckName, CheckObservation>> }),
    readEnv: (target: string) => {
      const text = readFileSync(target, "utf8");
      return Promise.resolve(ok({ text, sha256: createHash("sha256").update(text, "utf8").digest("hex") }));
    },
    validateCertificate: () => Promise.resolve(ok({ runtimeDigest: "", policyDigest: "" })),
    readDeploymentDigests: () => Promise.resolve(ok({ runtimeDigest: "", policyDigest: "" })),
    replaceEnv: createAuthorizedEnvReplacePort({
      nowAtLinearisation: () => Date.now(),
      // A real compare-and-swap against a real file: `replaceCertificate` verifies the
      // digest before the write, the digest it got back, and the content it re-reads, so
      // a double that only remembers a string is refused by the production path — which
      // is the right way round.
      compareAndSwap: (target, expectedSha256, text) => {
        const current = readFileSync(target, "utf8");
        if (createHash("sha256").update(current, "utf8").digest("hex") !== expectedSha256) {
          return Promise.resolve({ ok: false as const, reason: "ENV_CHANGED", effect: "not-applied" as const });
        }
        writeFileSync(target, text, "utf8");
        mutate(file, world => { world.effects.push(`${label}:env=${text.includes("PRE_ARM_CERTIFICATE") ? "written" : "cleared"}`); });
        return Promise.resolve(ok(createHash("sha256").update(text, "utf8").digest("hex")));
      },
    }),
    setTaskEnabled: async (task: TaskName, enabled: boolean) => {
      // The window. An effect that takes time is the only way a second process can land
      // between the decision to apply it and the world that results.
      const delay = readFileWorld(file).enableDelayMs;
      if (enabled && delay > 0) await new Promise(resolve => { setTimeout(resolve, delay); });
      mutate(file, world => {
        world.tasks[task] = enabled;
        world.effects.push(`${label}:${task}=${String(enabled)}`);
      });
      return ok(undefined);
    },
    installTasks: () => { note("install-tasks"); return Promise.resolve(ok(undefined)); },
    verifyInstalledTasks: () => Promise.resolve(ok({ passed: true, checkCount: 0, failedChecks: 0 })),
    registerDisarm: () => { mutate(file, world => { (world as { disarmRegistered: boolean }).disarmRegistered = true; world.effects.push(`${label}:register-disarm`); }); return Promise.resolve(ok(undefined)); },
    deleteDisarm: () => { mutate(file, world => { (world as { disarmRegistered: boolean }).disarmRegistered = false; world.effects.push(`${label}:delete-disarm`); }); return Promise.resolve(ok(undefined)); },
    restart: () => { note("restart"); return Promise.resolve(ok(undefined)); },
    clearReadiness: () => { note("clear-readiness"); return Promise.resolve(ok(undefined)); },
    pingSuccess: (check: "liveness" | "watchdog") => { note(`ping:${check}`); return Promise.resolve(ok(undefined)); },
  } as unknown as ActionPorts;
}
