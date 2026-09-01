// S-CYC-11 analyst boundary — the pinned MCP build/launch verifier and the
// exact post-start inventory (WIN-6, WIN-10, WIN-19). The tracked config
// artifacts are validated as shipped; the launch variants run against fake
// evidence/child ports and must fail BEFORE spawn (pre-spawn violations) or
// before any analyst release (inventory violations).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAnalystChildEnv,
  validateAnalystManifest,
  validateChildEnvironment,
  validateRuntimeLock,
  verifyManifestLockAgreement,
  verifyMcpInventory,
  verifyMcpLaunch,
} from "../src/core/startup.js";
import type { AnalystManifest, McpLaunchObservation, RuntimeLock } from "../src/core/startup.js";
import { launchVerifiedAnalystChild } from "../src/shell/analyst-mcp-launcher.js";
import type { McpChildHandle, McpLaunchPorts } from "../src/shell/analyst-mcp-launcher.js";
import { createEnvironmentPorts, dependencySiteSha256, isolatedMcpTransportEnvironment, mcpPythonBootstrap } from "../src/shell/mcp-environment.js";

const ROOT = process.cwd();

function trackedManifest(): AnalystManifest {
  const validated = validateAnalystManifest(JSON.parse(readFileSync(path.join(ROOT, "config", "analyst-mcp-readonly.json"), "utf8")));
  if (!validated.ok) throw new Error(validated.issues.join("; "));
  return validated.value;
}

function trackedLock(): RuntimeLock {
  const validated = validateRuntimeLock(JSON.parse(readFileSync(path.join(ROOT, "config", "analyst-runtime-lock.json"), "utf8")));
  if (!validated.ok) throw new Error(validated.issues.join("; "));
  return validated.value;
}

const OS_ALLOWLIST = ["PATH", "SYSTEMROOT", "TEMP", "TMP"] as const;

function matchingObservation(lock: RuntimeLock, manifest: AnalystManifest, overrides: Partial<McpLaunchObservation> = {}): McpLaunchObservation {
  return {
    sourceRepository: lock.source.repository,
    sourceCommit: lock.source.commit,
    packageName: lock.source.package,
    packageVersion: lock.source.version,
    dependencyLockMatchesPin: true,
    dependencyContentMatchesPin: true,
    interpreterLauncherSha256: lock.interpreter.launcherSha256,
    interpreterRuntimeSha256: lock.interpreter.runtimeSha256,
    hashProvenance: "runtime_lock",
    immutableFileMismatches: [],
    bytecodeArtifactsPresent: [],
    bytecodeWritesDisabled: true,
    childEnvironment: buildAnalystChildEnv(manifest, { devKeyId: "TEST_ONLY_KEY", devSecretKey: "TEST_ONLY_SECRET" }),
    ...overrides,
  };
}

describe("S-CYC-11 — the tracked manifest and runtime lock are valid and agree", () => {
  it("neutralizes the SDK default host environment and scrubs it before MCP package import", () => {
    const transport = isolatedMcpTransportEnvironment({ EXPLICIT_ONLY: "yes", SYSTEMROOT: "C:\\Windows" });
    expect(transport).toMatchObject({ EXPLICIT_ONLY: "yes", SYSTEMROOT: "C:\\Windows", APPDATA: "", PATH: "", USERPROFILE: "" });
    const bootstrap = mcpPythonBootstrap("alpaca_mcp_server", { EXPLICIT_ONLY: "yes", SYSTEMROOT: "C:\\Windows", PYTHONPATH: "PINNED_SITE", ALPACA_API_KEY: "TEST_ONLY_SECRET_VALUE", ALPACA_SECRET_KEY: "TEST_ONLY_SECRET_VALUE_2" });
    expect(bootstrap).toContain("os.environ.clear()");
    expect(bootstrap).toContain("PINNED_SITE");
    expect(bootstrap).not.toContain("TEST_ONLY_SECRET_VALUE");
    expect(bootstrap.indexOf("os.environ.clear()")).toBeLessThan(bootstrap.indexOf("from alpaca_mcp_server.cli import main"));
    expect(() => mcpPythonBootstrap("bad;import host", {})).toThrow("invalid MCP package module name");
  });

  it("binds dependency bytes while excluding project and installer-only files", () => {
    const site = mkdtempSync(path.join(tmpdir(), "gbt-mcp-site-digest-"));
    try {
      mkdirSync(path.join(site, "dependency"));
      mkdirSync(path.join(site, "alpaca_mcp_server"));
      mkdirSync(path.join(site, "dependency-1.0.dist-info"));
      mkdirSync(path.join(site, "bin"));
      writeFileSync(path.join(site, "dependency", "module.py"), "trusted\n", "utf8");
      writeFileSync(path.join(site, "alpaca_mcp_server", "server.py"), "project-a\n", "utf8");
      writeFileSync(path.join(site, "dependency-1.0.dist-info", "RECORD"), "installer-a\n", "utf8");
      writeFileSync(path.join(site, "bin", "tool.exe"), "installer-a\n", "utf8");
      writeFileSync(path.join(site, ".lock"), "installer-a\n", "utf8");
      const expected = dependencySiteSha256(site);
      writeFileSync(path.join(site, "alpaca_mcp_server", "server.py"), "project-b\n", "utf8");
      writeFileSync(path.join(site, "dependency-1.0.dist-info", "RECORD"), "installer-b\n", "utf8");
      writeFileSync(path.join(site, "bin", "tool.exe"), "installer-b\n", "utf8");
      expect(dependencySiteSha256(site)).toBe(expected);
      writeFileSync(path.join(site, "dependency", "module.py"), "patched\n", "utf8");
      expect(dependencySiteSha256(site)).not.toBe(expected);
    } finally {
      rmSync(site, { recursive: true, force: true });
    }
  });

  it("removes the installer bin tree before Python can import its scripts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "gbt-mcp-bin-removal-"));
    const site = path.join(root, "site");
    const source = path.join(root, "source");
    try {
      mkdirSync(path.join(site, "bin"), { recursive: true });
      mkdirSync(path.join(site, "dependency", "bin"), { recursive: true });
      mkdirSync(path.join(source, "bin"), { recursive: true });
      writeFileSync(path.join(site, "bin", "helper.py"), "raise RuntimeError('must not import')\n", "utf8");
      writeFileSync(path.join(site, "kept.py"), "VALUE = 1\n", "utf8");
      writeFileSync(path.join(site, "dependency", "bin", "module.py"), "VALUE = 2\n", "utf8");
      writeFileSync(path.join(source, "bin", "tracked.py"), "VALUE = 3\n", "utf8");
      const ports = createEnvironmentPorts({ root, site, source, runtime: path.join(root, "python.exe"), launcher: path.join(root, "launcher.exe") });
      await ports.evidence.removeBytecode(["site/bin/**"]);
      expect(existsSync(path.join(site, "bin"))).toBe(false);
      expect(existsSync(path.join(site, "kept.py"))).toBe(true);
      expect(existsSync(path.join(site, "dependency", "bin", "module.py"))).toBe(true);
      expect(existsSync(path.join(source, "bin", "tracked.py"))).toBe(true);
      await expect(ports.evidence.scanBytecode(["site/bin/**"])).resolves.toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the shipped config artifacts pass their schemas and name the same server identity", () => {
    const manifest = trackedManifest();
    const lock = trackedLock();
    expect(manifest.allowedTools).toHaveLength(32);
    expect(manifest.inventoryPolicy).toBe("exact");
    expect(lock.installPolicy.learnHashesFromInstalledEnvironment).toBe(false);
    expect(lock.installPolicy.removeBeforeSpawn).toContain("site/bin/**");
    expect(verifyManifestLockAgreement(manifest, lock)).toEqual({ ok: true });
  });

  it("manifest schema: duplicates, loose policy, a competition analyst profile, and unknown fields are all issues", () => {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "config", "analyst-mcp-readonly.json"), "utf8")) as Record<string, unknown>;
    expect(validateAnalystManifest({ ...raw, allowedTools: [...(raw["allowedTools"] as string[]), "get_asset"] }).ok).toBe(false);
    expect(validateAnalystManifest({ ...raw, inventoryPolicy: "subset" }).ok).toBe(false);
    expect(validateAnalystManifest({ ...raw, analystProfile: "competition" }).ok).toBe(false);
    expect(validateAnalystManifest({ ...raw, extraKnob: 1 }).ok).toBe(false);
  });

  it("runtime-lock schema: every unsafe policy value and a short commit are issues (WIN-19 self-learned hashes included)", () => {
    const raw = JSON.parse(readFileSync(path.join(ROOT, "config", "analyst-runtime-lock.json"), "utf8")) as Record<string, unknown>;
    const policy = raw["installPolicy"] as Record<string, unknown>;
    expect(validateRuntimeLock({ ...raw, installPolicy: { ...policy, learnHashesFromInstalledEnvironment: true } }).ok).toBe(false);
    expect(validateRuntimeLock({ ...raw, installPolicy: { ...policy, disableBytecodeWritesInChild: false } }).ok).toBe(false);
    expect(validateRuntimeLock({ ...raw, installPolicy: { ...policy, requireRemovedFilesAbsentBeforeSpawn: false } }).ok).toBe(false);
    const interpreter = raw["interpreter"] as Record<string, unknown>;
    expect(validateRuntimeLock({ ...raw, interpreter: { ...interpreter, wheelPlatformTag: "win-amd64;linux" } }).ok).toBe(false);
    const source = raw["source"] as Record<string, unknown>;
    expect(validateRuntimeLock({ ...raw, source: { ...source, dependencySiteSha256: "self-learned" } }).ok).toBe(false);
    expect(validateRuntimeLock({ ...raw, source: { ...source, commit: "872abbf" } }).ok).toBe(false);
  });

  it("a manifest naming a different package or version than the lock is an ambiguous identity (WIN-10)", () => {
    const manifest = trackedManifest();
    const lock = trackedLock();
    expect(verifyManifestLockAgreement({ ...manifest, server: { ...manifest.server, package: "alpaca-mcp" } }, lock).ok).toBe(false);
    expect(verifyManifestLockAgreement({ ...manifest, server: { ...manifest.server, version: "2.3.1" } }, lock).ok).toBe(false);
  });
});

describe("S-CYC-11 pre-spawn gate — every identity drift fails before any child code runs", () => {
  const lock = trackedLock();
  const manifest = trackedManifest();

  function violationCodes(overrides: Partial<McpLaunchObservation>): readonly string[] {
    const verdict = verifyMcpLaunch(lock, matchingObservation(lock, manifest, overrides), [...OS_ALLOWLIST]);
    return verdict.ok ? [] : verdict.violations.map(item => item.code);
  }

  it("a matching observation passes", () => {
    expect(verifyMcpLaunch(lock, matchingObservation(lock, manifest), [...OS_ALLOWLIST])).toEqual({ ok: true });
  });

  it("WIN-10: the same tool inventory from a wrong commit, package, version, or repository fails", () => {
    expect(violationCodes({ sourceCommit: "0".repeat(40) })).toContain("SOURCE_MISMATCH");
    expect(violationCodes({ sourceRepository: "https://github.com/evil/alpaca-mcp-server.git" })).toContain("SOURCE_MISMATCH");
    expect(violationCodes({ packageName: "alpaca-mcp" })).toContain("PACKAGE_MISMATCH");
    expect(violationCodes({ packageVersion: "2.3.1" })).toContain("PACKAGE_MISMATCH");
  });

  it("WIN-10/WIN-19: a different checked/launched interpreter fails", () => {
    expect(violationCodes({ interpreterLauncherSha256: "f".repeat(64) })).toContain("INTERPRETER_MISMATCH");
    expect(violationCodes({ interpreterRuntimeSha256: "f".repeat(64) })).toContain("INTERPRETER_MISMATCH");
  });

  it("WIN-19: unpinned dependencies, patched immutable files, surviving bytecode, enabled bytecode writes, and self-learned hashes all fail", () => {
    expect(violationCodes({ dependencyLockMatchesPin: false })).toContain("DEPENDENCY_LOCK_DRIFT");
    expect(violationCodes({ dependencyContentMatchesPin: false })).toContain("DEPENDENCY_CONTENT_MISMATCH");
    expect(violationCodes({ immutableFileMismatches: ["src/alpaca_mcp_server/server.py"] })).toContain("IMMUTABLE_CONTENT_MISMATCH");
    expect(violationCodes({ bytecodeArtifactsPresent: ["src/__pycache__/server.cpython-314.pyc"] })).toContain("BYTECODE_PRESENT");
    expect(violationCodes({ bytecodeWritesDisabled: false })).toContain("BYTECODE_WRITES_ENABLED");
    expect(violationCodes({ hashProvenance: "installed_environment" })).toContain("HASH_PROVENANCE_INVALID");
  });

  it("WIN-6: a leaked competition or executor secret in the child environment fails, as does any variable outside the constructed set", () => {
    const base = buildAnalystChildEnv(manifest, { devKeyId: "k", devSecretKey: "s" });
    expect(violationCodes({ childEnvironment: { ...base, ALPACA_COMP_KEY_ID: "leak" } })).toContain("ENVIRONMENT_LEAK");
    expect(violationCodes({ childEnvironment: { ...base, CLAUDE_CODE_OAUTH_TOKEN: "leak" } })).toContain("ENVIRONMENT_LEAK");
    expect(violationCodes({ childEnvironment: { ...base, ANTHROPIC_API_KEY: "leak" } })).toContain("ENVIRONMENT_LEAK");
    expect(violationCodes({ childEnvironment: { ...base, RANDOM_INHERITED_VAR: "leak" } })).toContain("ENVIRONMENT_LEAK");
    expect(violationCodes({ childEnvironment: { ...base, PATH: "C:\\bin" } })).toEqual([]);
  });

  it("the constructed environment is exactly the four analyst variables, with toolsets generated from the manifest", () => {
    const env = buildAnalystChildEnv(manifest, { devKeyId: "k", devSecretKey: "s" });
    expect(Object.keys(env).sort()).toEqual(["ALPACA_API_KEY", "ALPACA_SECRET_KEY", "ALPACA_TOOLSETS", "PYTHONDONTWRITEBYTECODE"]);
    expect(env["ALPACA_TOOLSETS"]).toBe("assets,stock-data,options-data");
    expect(validateChildEnvironment(env, [])).toEqual([]);
    // A forbidden name fails even when a caller put it on the OS allowlist.
    expect(validateChildEnvironment({ ...env, ALPACA_COMP_SECRET_KEY: "x" }, ["ALPACA_COMP_SECRET_KEY"]).map(item => item.code)).toContain("ENVIRONMENT_LEAK");
  });
});

describe("S-CYC-11 post-start inventory — exact acceptance over the positive manifest (WIN-6)", () => {
  const manifest = trackedManifest();

  it("the exact 32-tool inventory passes; extra, missing, and duplicate tools fail", () => {
    expect(verifyMcpInventory(manifest, manifest.allowedTools)).toEqual({ ok: true });
    const extra = verifyMcpInventory(manifest, [...manifest.allowedTools, "place_order"]);
    expect(extra.ok ? [] : extra.violations.map(item => item.code)).toContain("EXTRA_TOOL");
    const missing = verifyMcpInventory(manifest, manifest.allowedTools.slice(1));
    expect(missing.ok ? [] : missing.violations.map(item => item.code)).toContain("MISSING_TOOL");
    const duplicate = verifyMcpInventory(manifest, [...manifest.allowedTools, manifest.allowedTools[0]!]);
    expect(duplicate.ok ? [] : duplicate.violations.map(item => item.code)).toContain("DUPLICATE_TOOL");
  });
});

describe("S-CYC-11 launcher — order of operations and the no-release-before-acceptance rule", () => {
  const lock = trackedLock();
  const manifest = trackedManifest();

  function fakePorts(options: { readonly observation?: Partial<McpLaunchObservation>; readonly offeredTools?: readonly string[]; readonly surviving?: readonly string[]; readonly inventoryError?: Error }): { readonly ports: McpLaunchPorts; readonly calls: readonly string[]; readonly stopped: { count: number } } {
    const calls: string[] = [];
    const stopped = { count: 0 };
    const child: McpChildHandle = {
      listTools: () => { calls.push("listTools"); return options.inventoryError === undefined ? Promise.resolve(options.offeredTools ?? manifest.allowedTools) : Promise.reject(options.inventoryError); },
      stop: () => { stopped.count += 1; return Promise.resolve(); },
    };
    const ports: McpLaunchPorts = {
      lock, manifest,
      credentials: { devKeyId: "TEST_ONLY_KEY", devSecretKey: "TEST_ONLY_SECRET" },
      osEnvAllowlist: [...OS_ALLOWLIST],
      osEnv: { PATH: "C:\\bin" },
      evidence: {
        gather: () => {
          calls.push("gather");
          const full = matchingObservation(lock, manifest, options.observation);
          const rest = Object.fromEntries(Object.entries(full).filter(([key]) => key !== "childEnvironment")) as Omit<McpLaunchObservation, "childEnvironment">;
          return Promise.resolve(rest);
        },
        removeBytecode: () => { calls.push("removeBytecode"); return Promise.resolve([]); },
        scanBytecode: () => { calls.push("scanBytecode"); return Promise.resolve(options.surviving ?? []); },
      },
      child: { spawn: () => { calls.push("spawn"); return Promise.resolve(child); } },
    };
    return { ports, calls, stopped };
  }

  it("the happy path removes bytecode, verifies, spawns, inventories — in that order — and releases the child", async () => {
    const { ports, calls } = fakePorts({});
    const result = await launchVerifiedAnalystChild(ports);
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["removeBytecode", "scanBytecode", "gather", "spawn", "listTools"]);
  });

  it("WIN-19: a pre-spawn violation (surviving bytecode) fails before spawn — the child is never started", async () => {
    const { ports, calls } = fakePorts({ surviving: ["lib/__pycache__/tools.cpython-314.pyc"] });
    const result = await launchVerifiedAnalystChild(ports);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("pre_spawn");
    expect(result.violations.map(item => item.code)).toContain("BYTECODE_PRESENT");
    expect(calls).not.toContain("spawn");
  });

  it("WIN-10: a wrong-distribution identity fails before spawn even with a perfect inventory", async () => {
    const { ports, calls } = fakePorts({ observation: { packageName: "alpaca-mcp" } });
    const result = await launchVerifiedAnalystChild(ports);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("pre_spawn");
    expect(calls).not.toContain("spawn");
  });

  it("WIN-6: an extra offered tool stops the child and releases nothing", async () => {
    const { ports, stopped } = fakePorts({ offeredTools: [...manifest.allowedTools, "place_order"] });
    const result = await launchVerifiedAnalystChild(ports);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("inventory");
    expect(result.violations.map(item => item.code)).toContain("EXTRA_TOOL");
    expect(stopped.count).toBe(1);
  });

  it("stops the spawned child when inventory transport fails exceptionally", async () => {
    const { ports, stopped } = fakePorts({ inventoryError: new Error("inventory transport lost") });
    await expect(launchVerifiedAnalystChild(ports)).rejects.toThrow("inventory transport lost");
    expect(stopped.count).toBe(1);
  });

  it("an ambiguous manifest/lock identity refuses before any port is touched", async () => {
    const { ports, calls } = fakePorts({});
    const result = await launchVerifiedAnalystChild({ ...ports, manifest: { ...manifest, server: { ...manifest.server, version: "9.9.9" } } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("agreement");
    expect(calls).toEqual([]);
  });
});
