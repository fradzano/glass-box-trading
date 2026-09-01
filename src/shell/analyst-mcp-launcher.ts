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

/** Evidence about the dedicated environment, computed by the port against the lock's expectations. */
export interface McpEvidencePort {
  /** Digest and identity evidence; `hashProvenance` must state where the EXPECTED values came from. */
  gather(lock: RuntimeLock): Promise<Omit<McpLaunchObservation, "childEnvironment">>;
  /** Remove every artifact matching the lock's removeBeforeSpawn patterns; returns the paths removed. */
  removeBytecode(patterns: readonly string[]): Promise<readonly string[]>;
  /** Recursive scan for surviving artifacts after removal; must return an empty list for the launch to proceed. */
  scanBytecode(patterns: readonly string[]): Promise<readonly string[]>;
}

export interface McpChildHandle {
  listTools(): Promise<readonly string[]>;
  stop(): Promise<void>;
}

export interface McpChildPort {
  spawn(env: Readonly<Record<string, string>>): Promise<McpChildHandle>;
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
}

export type McpLaunchResult =
  | { readonly ok: true; readonly child: McpChildHandle; readonly inventory: readonly string[] }
  | { readonly ok: false; readonly stage: "agreement" | "pre_spawn" | "inventory"; readonly violations: readonly McpViolation[]; readonly issues: readonly string[] };

export async function launchVerifiedAnalystChild(ports: McpLaunchPorts): Promise<McpLaunchResult> {
  const agreement = verifyManifestLockAgreement(ports.manifest, ports.lock);
  if (!agreement.ok) return { ok: false, stage: "agreement", violations: [], issues: agreement.issues };

  const patterns = ports.lock.installPolicy.removeBeforeSpawn;
  await ports.evidence.removeBytecode(patterns);
  const surviving = await ports.evidence.scanBytecode(patterns);

  const childEnvironment: Readonly<Record<string, string>> = { ...ports.osEnv, ...buildAnalystChildEnv(ports.manifest, ports.credentials) };
  const gathered = await ports.evidence.gather(ports.lock);
  const observation: McpLaunchObservation = { ...gathered, bytecodeArtifactsPresent: [...gathered.bytecodeArtifactsPresent, ...surviving], childEnvironment };

  const preSpawn = verifyMcpLaunch(ports.lock, observation, ports.osEnvAllowlist);
  if (!preSpawn.ok) return { ok: false, stage: "pre_spawn", violations: preSpawn.violations, issues: [] };

  const child = await ports.child.spawn(childEnvironment);
  let inventory: readonly string[];
  try {
    inventory = await child.listTools();
  } catch (error) {
    await child.stop();
    throw error;
  }
  const accepted = verifyMcpInventory(ports.manifest, inventory);
  if (!accepted.ok) {
    await child.stop();
    return { ok: false, stage: "inventory", violations: accepted.violations, issues: [] };
  }
  return { ok: true, child, inventory };
}
