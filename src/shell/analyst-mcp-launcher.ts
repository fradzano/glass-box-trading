// The pinned MCP build/launch verifier (S-CYC-11, WIN-6, WIN-10, WIN-19).
// Order is the contract: gather evidence against the tracked runtime lock
// (hashes come from the lock, never from the installed environment), remove
// every generated executable artifact and verify its recursive absence, run
// the pure pre-spawn gate, and only then spawn the child — with bytecode
// writes disabled and the constructed minimal environment. After spawn, the
// offered tool inventory must equal the manifest's positive list exactly
// before any analyst request is released: the analyst handle simply does not
// exist until acceptance. Every effect sits behind a port so P4 drives the
// drift variants with fakes; the real filesystem/process ports arrive with
// the dedicated environment build (pre-arming, S-CYC-11).
import {
  buildAnalystChildEnv,
  verifyManifestLockAgreement,
  verifyMcpInventory,
  verifyMcpLaunch,
} from "../core/startup.js";
import type { AnalystCredentials, AnalystManifest, McpLaunchObservation, McpViolation, RuntimeLock } from "../core/startup.js";
import { withOperationTimeout } from "./operation-timeout.js";

export const MCP_CHILD_OPERATION_TIMEOUT_MS = 30_000;

/** Evidence about the dedicated environment, computed by the port against the lock's expectations. */
export interface McpEvidencePort {
  /** Digest and identity evidence; `hashProvenance` must state where the EXPECTED values came from. */
  gather(lock: RuntimeLock, operationTimeoutMs: number): Promise<Omit<McpLaunchObservation, "childEnvironment">>;
  /** Remove every artifact matching the lock's removeBeforeSpawn patterns; returns the paths removed. */
  removeBytecode(patterns: readonly string[], operationTimeoutMs: number): Promise<readonly string[]>;
  /** Recursive scan for surviving artifacts after removal; must return an empty list for the launch to proceed. */
  scanBytecode(patterns: readonly string[], operationTimeoutMs: number): Promise<readonly string[]>;
}

export interface McpChildHandle {
  listTools(): Promise<readonly string[]>;
  stop(): Promise<void>;
}

export interface McpChildPort {
  spawn(env: Readonly<Record<string, string>>, operationTimeoutMs: number): Promise<McpChildHandle>;
}

export interface McpLaunchPorts {
  readonly lock: RuntimeLock;
  readonly manifest: AnalystManifest;
  readonly credentials: AnalystCredentials;
  /** OS variables the child process additionally receives (interpreter necessities only); validated, never inherited wholesale. */
  readonly osEnvAllowlist: readonly string[];
  readonly osEnv: Readonly<Record<string, string>>;
  readonly evidence: McpEvidencePort;
  readonly child: McpChildPort;
  /** Test seam; production uses the runtime-digested constant. */
  readonly operationTimeoutMs?: number;
}

export type McpLaunchResult =
  | { readonly ok: true; readonly child: McpChildHandle; readonly inventory: readonly string[] }
  | { readonly ok: false; readonly stage: "agreement" | "pre_spawn" | "inventory"; readonly violations: readonly McpViolation[]; readonly issues: readonly string[] };

export async function launchVerifiedAnalystChild(ports: McpLaunchPorts): Promise<McpLaunchResult> {
  const timeoutMs = ports.operationTimeoutMs ?? MCP_CHILD_OPERATION_TIMEOUT_MS;
  const agreement = verifyManifestLockAgreement(ports.manifest, ports.lock);
  if (!agreement.ok) return { ok: false, stage: "agreement", violations: [], issues: agreement.issues };

  const patterns = ports.lock.installPolicy.removeBeforeSpawn;
  await withOperationTimeout(() => ports.evidence.removeBytecode(patterns, timeoutMs), timeoutMs, "MCP_REMOVE_TIMEOUT");
  const surviving = await withOperationTimeout(() => ports.evidence.scanBytecode(patterns, timeoutMs), timeoutMs, "MCP_SCAN_TIMEOUT");

  const childEnvironment: Readonly<Record<string, string>> = { ...ports.osEnv, ...buildAnalystChildEnv(ports.manifest, ports.credentials) };
  const gathered = await withOperationTimeout(() => ports.evidence.gather(ports.lock, timeoutMs), timeoutMs, "MCP_EVIDENCE_TIMEOUT");
  const observation: McpLaunchObservation = { ...gathered, bytecodeArtifactsPresent: [...gathered.bytecodeArtifactsPresent, ...surviving], childEnvironment };

  const preSpawn = verifyMcpLaunch(ports.lock, observation, ports.osEnvAllowlist);
  if (!preSpawn.ok) return { ok: false, stage: "pre_spawn", violations: preSpawn.violations, issues: [] };

  const child = await withOperationTimeout(() => ports.child.spawn(childEnvironment, timeoutMs), timeoutMs, "MCP_CONNECT_TIMEOUT");
  let inventory: readonly string[];
  try {
    inventory = await withOperationTimeout(() => child.listTools(), timeoutMs, "MCP_LIST_TOOLS_TIMEOUT");
  } catch (error) {
    try {
      await withOperationTimeout(() => child.stop(), timeoutMs, "MCP_STOP_TIMEOUT");
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "MCP inventory failed and child cleanup did not complete", { cause: cleanupError });
    }
    throw error;
  }
  const accepted = verifyMcpInventory(ports.manifest, inventory);
  if (!accepted.ok) {
    try {
      await withOperationTimeout(() => child.stop(), timeoutMs, "MCP_STOP_TIMEOUT");
    } catch (cleanupError) {
      const inventoryError = new Error(`MCP_INVENTORY_REJECTED: ${accepted.violations.map(item => `${item.code}: ${item.detail}`).join("; ")}`);
      throw new AggregateError([inventoryError, cleanupError], "MCP inventory was rejected and child cleanup did not complete", { cause: cleanupError });
    }
    return { ok: false, stage: "inventory", violations: accepted.violations, issues: [] };
  }
  return { ok: true, child, inventory };
}
