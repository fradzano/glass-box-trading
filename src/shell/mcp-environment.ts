// The real ports behind the pinned MCP launcher (P7, S-CYC-11): evidence
// about the dedicated environment measured against the tracked runtime lock
// (expected values come from the lock; this module only observes), the
// bytecode removal and scan, and the stdio child. The dedicated environment
// is a target-directory install of the pinned commit's frozen dependency
// lock, executed by the pinned runtime interpreter with `-S` (no site
// packages of the base installation) and PYTHONPATH pointing at that
// directory only — so nothing outside the verified files is importable.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { DEFAULT_INHERITED_ENV_VARS, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpLaunchObservation, RuntimeLock } from "../core/startup.js";
import type { McpChildHandle, McpChildPort, McpEvidencePort } from "./analyst-mcp-launcher.js";
import { withOperationTimeout } from "./operation-timeout.js";
import type { AnalystEnvironmentPaths } from "./runtime-config.js";

export interface VerifiedChildHandle extends McpChildHandle {
  listToolDefinitions(): Promise<readonly { readonly name: string; readonly description: string; readonly inputSchema: unknown }[]>;
  callTool(name: string, args: Readonly<Record<string, unknown>>): Promise<{ readonly content: readonly unknown[]; readonly isError: boolean }>;
}

export interface EnvironmentEvidence {
  readonly launchArtifactsSha256: string;
}

/** Override the SDK's implicit host allowlist before it merges with our env. */
export function isolatedMcpTransportEnvironment(validated: Readonly<Record<string, string>>): Record<string, string> {
  return { ...Object.fromEntries(DEFAULT_INHERITED_ENV_VARS.map(name => [name, ""])), ...validated };
}

/** Reconstruct the exact validated env before importing any verified MCP package code. */
export function mcpPythonBootstrap(packageModuleDir: string, validated: Readonly<Record<string, string>>): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(packageModuleDir)) throw new Error("invalid MCP package module name");
  const secretNames = ["ALPACA_API_KEY", "ALPACA_SECRET_KEY"].filter(name => validated[name] !== undefined);
  const exactNonSecrets = Object.fromEntries(Object.entries(validated).filter(([name]) => !secretNames.includes(name)).sort(([left], [right]) => left.localeCompare(right)));
  // Secret values stay in the child environment and never enter argv. All
  // non-secret values are safe literals, restoring any interpreter rewrite
  // (notably PYTHONPATH) before the verified package sees it.
  return `import os; _secret_names=${JSON.stringify(secretNames)}; _secrets={_name: os.environ[_name] for _name in _secret_names}; _exact=${JSON.stringify(exactNonSecrets)}; os.environ.clear(); os.environ.update(_exact); os.environ.update(_secrets); from ${packageModuleDir}.cli import main; main()`;
}

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function gitBlobSha1(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${String(bytes.length)}\0`).update(bytes).digest("hex");
}

function walkFiles(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, out);
    else out.push(absolute);
  }
}

function remainingMs(deadlineMs: number, label: string): number {
  const remaining = deadlineMs - Date.now();
  if (remaining < 1) throw new Error(`${label}: deadline exceeded`);
  return remaining;
}

function gitAsync(cwd: string, args: readonly string[], deadlineMs: number): Promise<string> {
  const timeout = remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
  return new Promise<string>((resolve, reject) => {
    execFile("git", [...args], { cwd, encoding: "utf8", timeout, windowsHide: true }, (error, stdout) => {
      if (error !== null) reject(error instanceof Error ? error : new Error("git command failed", { cause: error }));
      else resolve(stdout.trim());
    });
  });
}

async function walkFilesAsync(directory: string, out: string[], deadlineMs: number): Promise<void> {
  remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walkFilesAsync(absolute, out, deadlineMs);
    else out.push(absolute);
  }
}

async function walkDirectoriesAsync(directory: string, out: string[], deadlineMs: number): Promise<void> {
  remainingMs(deadlineMs, "MCP_REMOVE_TIMEOUT");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    remainingMs(deadlineMs, "MCP_REMOVE_TIMEOUT");
    const absolute = path.join(directory, entry.name);
    out.push(absolute);
    await walkDirectoriesAsync(absolute, out, deadlineMs);
  }
}

async function sha256OfAsync(file: string, deadlineMs: number): Promise<string> {
  remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
  return createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

function matchesPattern(relative: string, pattern: string): boolean {
  // Directory-removal patterns such as `**/__pycache__/**`, plus suffix
  // patterns such as `**/*.pyc`. The exact site/bin scope is handled apart.
  if (pattern.endsWith("/**")) {
    const name = pattern.slice(0, -3).replace(/^\*\*\//, "");
    return relative.split("/").includes(name);
  }
  const suffix = pattern.replace(/^\*\*\/\*/, "");
  return relative.endsWith(suffix);
}

interface DistInfo {
  readonly name: string;
  readonly version: string;
}

async function installedDistributionsAsync(site: string, deadlineMs: number): Promise<readonly DistInfo[]> {
  const out: DistInfo[] = [];
  for (const entry of await fs.readdir(site, { withFileTypes: true })) {
    remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
    if (!entry.isDirectory() || !entry.name.endsWith(".dist-info")) continue;
    const metadata = await fs.readFile(path.join(site, entry.name, "METADATA"), "utf8");
    const name = /^Name:\s*(.+)$/m.exec(metadata)?.[1]?.trim();
    const version = /^Version:\s*(.+)$/m.exec(metadata)?.[1]?.trim();
    if (name !== undefined && version !== undefined) out.push({ name: name.toLowerCase().replace(/[-_.]+/g, "-"), version });
  }
  return out;
}

function lockedPackages(uvLock: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const pattern = /\[\[package\]\]\s*\nname = "([^"]+)"\s*\nversion = "([^"]+)"/g;
  for (;;) {
    const match = pattern.exec(uvLock);
    if (match === null) break;
    out.set((match[1] as string).toLowerCase().replace(/[-_.]+/g, "-"), match[2] as string);
  }
  return out;
}

const INSTALLER_METADATA = new Set(["INSTALLER", "RECORD", "REQUESTED", "direct_url.json"]);
const SITE_BIN_PATTERN = "site/bin/**";

/** Canonical importable dependency bytes; project files have the stronger git-blob check. */
export function dependencySiteSha256(site: string, packageModuleDir = "alpaca_mcp_server"): string {
  const files: string[] = [];
  walkFiles(site, files);
  const projectPrefix = `${packageModuleDir.toLowerCase()}-`;
  const lines = files.flatMap(file => {
    const relative = path.relative(site, file).split(path.sep).join("/");
    const parts = relative.split("/");
    const first = (parts[0] ?? "").toLowerCase();
    if (relative === ".lock" || first === "bin") return [];
    if (parts.includes("__pycache__") || relative.endsWith(".pyc")) return [];
    if (first === packageModuleDir.toLowerCase() || (first.startsWith(projectPrefix) && first.endsWith(".dist-info"))) return [];
    if ((parts.at(-2) ?? "").endsWith(".dist-info") && INSTALLER_METADATA.has(parts.at(-1) ?? "")) return [];
    return [`${relative} ${sha256Of(file)}`];
  });
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

async function dependencySiteSha256Async(site: string, packageModuleDir: string, deadlineMs: number): Promise<string> {
  const files: string[] = [];
  await walkFilesAsync(site, files, deadlineMs);
  const projectPrefix = `${packageModuleDir.toLowerCase()}-`;
  const lines: string[] = [];
  for (const file of files) {
    remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
    const relative = path.relative(site, file).split(path.sep).join("/");
    const parts = relative.split("/");
    const first = (parts[0] ?? "").toLowerCase();
    if (relative === ".lock" || first === "bin") continue;
    if (parts.includes("__pycache__") || relative.endsWith(".pyc")) continue;
    if (first === packageModuleDir.toLowerCase() || (first.startsWith(projectPrefix) && first.endsWith(".dist-info"))) continue;
    if ((parts.at(-2) ?? "").endsWith(".dist-info") && INSTALLER_METADATA.has(parts.at(-1) ?? "")) continue;
    lines.push(`${relative} ${await sha256OfAsync(file, deadlineMs)}`);
  }
  return createHash("sha256").update(lines.sort().join("\n")).digest("hex");
}

export type LaunchObservation = Omit<McpLaunchObservation, "childEnvironment">;

export function createEnvironmentPorts(paths: AnalystEnvironmentPaths, packageModuleDir = "alpaca_mcp_server"): { readonly evidence: McpEvidencePort; readonly child: McpChildPort; readonly extra: () => EnvironmentEvidence; readonly lastObservation: () => LaunchObservation | null } {
  let launchArtifactsSha256 = "";
  let lastObservation: LaunchObservation | null = null;

  const evidence: McpEvidencePort = {
    async gather(lock: RuntimeLock, operationTimeoutMs: number): Promise<Omit<McpLaunchObservation, "childEnvironment">> {
      const deadlineMs = Date.now() + operationTimeoutMs;
      const sourceRepository = (await gitAsync(paths.source, ["remote", "get-url", "origin"], deadlineMs)).replace(/\/?$/, "").replace(/\.git$/, "") + ".git";
      const sourceCommit = await gitAsync(paths.source, ["rev-parse", "HEAD"], deadlineMs);
      const installed = await installedDistributionsAsync(paths.site, deadlineMs);
      const project = installed.find(item => item.name === lock.source.package.toLowerCase().replace(/[-_.]+/g, "-"));
      // Dependency lock: the pinned commit's lock (from git objects, not the working tree) must cover every installed distribution at the same version.
      const pinnedLock = await gitAsync(paths.source, ["show", `${lock.source.commit}:${lock.source.dependencyLockAtCommit}`], deadlineMs);
      const locked = lockedPackages(pinnedLock);
      const dependencyLockMatchesPin = installed.every(item => item.name === project?.name || locked.get(item.name) === item.version);
      const dependencyContentMatchesPin = await dependencySiteSha256Async(paths.site, packageModuleDir, deadlineMs) === lock.source.dependencySiteSha256;
      // Immutable package files: every tracked file of the package at the pinned commit must be byte-identical in the installed copy, and nothing else may be there.
      const treeRoot = `src/${packageModuleDir}`;
      const tree = await gitAsync(paths.source, ["ls-tree", "-r", lock.source.commit, "--", treeRoot], deadlineMs);
      const expected = new Map<string, string>();
      for (const line of tree.split("\n")) {
        const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line);
        if (match !== null) expected.set((match[2] as string).slice(treeRoot.length + 1), match[1] as string);
      }
      const installedRoot = path.join(paths.site, packageModuleDir);
      const observedFiles: string[] = [];
      await walkFilesAsync(installedRoot, observedFiles, deadlineMs);
      const mismatches: string[] = [];
      const seen = new Set<string>();
      for (const file of observedFiles) {
        const relative = path.relative(installedRoot, file).split(path.sep).join("/");
        if (relative.split("/").includes("__pycache__") || relative.endsWith(".pyc")) continue;
        seen.add(relative);
        remainingMs(deadlineMs, "MCP_EVIDENCE_TIMEOUT");
        const blob = gitBlobSha1(await fs.readFile(file));
        if (expected.get(relative) !== blob) mismatches.push(`${relative}: installed ${blob}, pinned ${expected.get(relative) ?? "absent"}`);
      }
      for (const [relative, blob] of expected) if (!seen.has(relative)) mismatches.push(`${relative}: pinned ${blob}, installed absent`);
      // Bind the complete importable site tree, including third-party dependency bytes, into the runtime digest.
      // The pinned package still gets the stronger independent git-object comparison above; this tree digest
      // closes the gap where a dependency kept its locked version metadata but its installed bytes changed.
      const siteFiles: string[] = [];
      await walkFilesAsync(paths.site, siteFiles, deadlineMs);
      const artifactLines: string[] = [];
      for (const file of siteFiles) {
        const relative = path.relative(paths.site, file).split(path.sep).join("/");
        if (relative.split("/").includes("__pycache__") || relative.endsWith(".pyc")) continue;
        artifactLines.push(`${relative} ${await sha256OfAsync(file, deadlineMs)}`);
      }
      launchArtifactsSha256 = createHash("sha256").update(artifactLines.sort().join("\n")).digest("hex");
      const observed: LaunchObservation = {
        sourceRepository,
        sourceCommit,
        packageName: project?.name ?? "",
        packageVersion: project?.version ?? "",
        dependencyLockMatchesPin,
        dependencyContentMatchesPin,
        interpreterLauncherSha256: await sha256OfAsync(paths.launcher, deadlineMs),
        interpreterRuntimeSha256: await sha256OfAsync(paths.runtime, deadlineMs),
        hashProvenance: "runtime_lock",
        immutableFileMismatches: mismatches,
        bytecodeArtifactsPresent: [],
        bytecodeWritesDisabled: true,
      };
      lastObservation = observed;
      return observed;
    },
    async removeBytecode(patterns: readonly string[], operationTimeoutMs: number): Promise<readonly string[]> {
      const deadlineMs = Date.now() + operationTimeoutMs;
      const removed: string[] = [];
      if (patterns.includes(SITE_BIN_PATTERN)) {
        const siteBin = path.join(paths.site, "bin");
        try {
          if ((await fs.stat(siteBin)).isDirectory()) {
            await fs.rm(siteBin, { recursive: true, force: true });
            removed.push(siteBin);
          }
        } catch {
          // Exact site/bin is already absent.
        }
      }
      const recursivePatterns = patterns.filter(pattern => pattern !== SITE_BIN_PATTERN);
      for (const root of [paths.site, paths.source]) {
        const directories: string[] = [];
        await walkDirectoriesAsync(root, directories, deadlineMs);
        for (const directory of directories) {
          remainingMs(deadlineMs, "MCP_REMOVE_TIMEOUT");
          const relative = path.relative(root, directory).split(path.sep).join("/");
          if (recursivePatterns.some(pattern => pattern.endsWith("/**") && matchesPattern(`${relative}/x`, pattern))) {
            await fs.rm(directory, { recursive: true, force: true });
            removed.push(directory);
          }
        }
        const files: string[] = [];
        try {
          await walkFilesAsync(root, files, deadlineMs);
        } catch {
          // directories removed above may vanish from the listing; the scan below is the authority
        }
        for (const file of files) {
          remainingMs(deadlineMs, "MCP_REMOVE_TIMEOUT");
          const relative = path.relative(root, file).split(path.sep).join("/");
          if (recursivePatterns.some(pattern => !pattern.endsWith("/**") && matchesPattern(relative, pattern))) {
            await fs.rm(file, { force: true });
            removed.push(file);
          }
        }
      }
      return removed;
    },
    async scanBytecode(patterns: readonly string[], operationTimeoutMs: number): Promise<readonly string[]> {
      const deadlineMs = Date.now() + operationTimeoutMs;
      const surviving: string[] = [];
      if (patterns.includes(SITE_BIN_PATTERN)) {
        const siteBin = path.join(paths.site, "bin");
        try {
          if ((await fs.stat(siteBin)).isDirectory()) surviving.push(siteBin);
        } catch {
          // Exact site/bin is absent as required.
        }
      }
      const recursivePatterns = patterns.filter(pattern => pattern !== SITE_BIN_PATTERN);
      for (const root of [paths.site, paths.source]) {
        const files: string[] = [];
        await walkFilesAsync(root, files, deadlineMs);
        for (const file of files) {
          remainingMs(deadlineMs, "MCP_SCAN_TIMEOUT");
          const relative = path.relative(root, file).split(path.sep).join("/");
          if (recursivePatterns.some(pattern => matchesPattern(relative, pattern))) surviving.push(file);
        }
      }
      return surviving;
    },
  };

  const child: McpChildPort = {
    async spawn(env: Readonly<Record<string, string>>, operationTimeoutMs: number): Promise<VerifiedChildHandle> {
      const transportEnvironment = isolatedMcpTransportEnvironment(env);
      const transport = new StdioClientTransport({
        command: paths.runtime,
        // `-P` prevents Python from prepending cwd to sys.path; imports can come only from the explicitly
        // constructed PYTHONPATH whose package bytes were verified immediately before this spawn.
        args: ["-P", "-S", "-c", mcpPythonBootstrap(packageModuleDir, env), "--transport", "stdio"],
        // SDK 1.30 merges a fixed host allowlist even when env is supplied.
        // Empty overrides prevent value inheritance; the Python bootstrap then
        // removes those names before importing the verified server package.
        env: transportEnvironment,
        cwd: paths.site,
        stderr: "pipe",
      });
      const client = new Client({ name: "glass-box-trading", version: "0.1.0" });
      try {
        await withOperationTimeout(() => client.connect(transport), operationTimeoutMs, "MCP_CONNECT_TIMEOUT");
      } catch (error) {
        try {
          await withOperationTimeout(() => client.close(), operationTimeoutMs, "MCP_STOP_TIMEOUT");
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], "MCP connect failed and transport cleanup did not complete", { cause: cleanupError });
        }
        throw error;
      }
      return {
        async listTools(): Promise<readonly string[]> {
          const result = await withOperationTimeout(() => client.listTools(), operationTimeoutMs, "MCP_LIST_TOOLS_TIMEOUT");
          return result.tools.map(tool => tool.name);
        },
        async listToolDefinitions() {
          const result = await withOperationTimeout(() => client.listTools(), operationTimeoutMs, "MCP_LIST_TOOLS_TIMEOUT");
          return result.tools.map(tool => ({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema }));
        },
        async callTool(name, args) {
          const result = await withOperationTimeout(() => client.callTool({ name, arguments: { ...args } }), operationTimeoutMs, "MCP_CALL_TOOL_TIMEOUT");
          const content = Array.isArray(result["content"]) ? (result["content"] as readonly unknown[]) : [];
          return { content, isError: result["isError"] === true };
        },
        async stop(): Promise<void> {
          await withOperationTimeout(() => client.close(), operationTimeoutMs, "MCP_STOP_TIMEOUT");
        },
      };
    },
  };

  return { evidence, child, extra: () => ({ launchArtifactsSha256 }), lastObservation: () => lastObservation };
}

/** The OS variables the child additionally receives: interpreter necessities only, never the executor's secrets (WIN-6). */
export function analystOsAllowlist(): readonly string[] {
  return ["SYSTEMROOT", "TEMP", "TMP", "PYTHONPATH"];
}

/** PYTHONPATH names the dedicated directory (and the pywin32 subdirectories its `.pth` would add, since `-S` processes none). */
export function dedicatedPythonPath(paths: AnalystEnvironmentPaths): string {
  const site = paths.site;
  return [site, path.join(site, "win32"), path.join(site, "win32", "lib"), path.join(site, "pythonwin")].join(path.delimiter);
}

export function analystOsEnv(processEnv: Readonly<Record<string, string | undefined>>, paths: AnalystEnvironmentPaths): Readonly<Record<string, string>> {
  const out: Record<string, string> = { PYTHONPATH: dedicatedPythonPath(paths) };
  for (const name of ["SYSTEMROOT", "TEMP", "TMP"]) {
    const value = processEnv[name] ?? processEnv[name.toLowerCase()] ?? processEnv[name.charAt(0) + name.slice(1).toLowerCase()];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

export function environmentExists(paths: AnalystEnvironmentPaths): boolean {
  try {
    return statSync(paths.site).isDirectory() && statSync(paths.source).isDirectory() && statSync(paths.runtime).isFile() && statSync(paths.launcher).isFile();
  } catch {
    return false;
  }
}
