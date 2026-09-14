// The observation ports, bound to this host (build log, unit 7). Thin on purpose: each one
// runs one command, reads one file or makes one request, and reduces every failure to a
// reason that cannot carry a credential — an error code, an HTTP status, an error name.
// Nothing here parses what it read; `observe.ts` hands that to the parsers.
//
// The runtime's own modules come from `dist/`, the build the scheduled tasks run: the
// certificate validator, the journal codec, the environment loader and the broker adapter.
// `createHostPorts` loads them once and fails if the build is missing, so an invocation never
// half-observes with a stale or absent build.
//
// Two ports are costly and run only when the plan asks (see observe.ts): the dev
// `--preflight`, which builds a whole dev runtime with its verified MCP child, and the
// live-token probe, one Claude call. The preflight runs with the dev profile, the dev
// STATE_DIR and the dev diagnostic sink (spec §5, step 2) and with every ping URL emptied —
// `createPingPort` treats an empty URL as silence — so a refused preflight cannot page the
// owner through the long run's live checks.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as CertificateCore from "../../../src/core/certificate.ts";
import type * as JournalCore from "../../../src/core/journal.ts";
import type * as RuntimeConfig from "../../../src/shell/runtime-config.ts";
import type { ProbeQuery } from "./analyst-probe.ts";
import { runAnalystProbe } from "./analyst-probe.ts";
import { readHealthchecks } from "./healthchecks-io.ts";
import type { CommandResult, FileRead, FirstLineRead, HostScript, ObservationPorts, PortResult } from "./observe.ts";
import { TRUSTED_WINDOWS_POWERSHELL } from "./observe.ts";

export interface HostPortOptions {
  readonly repoRoot: string;
  readonly activationRoot: string;
  readonly taskPath: string;
  readonly canonicalTradingOrigin: string;
  /** The dev STATE_DIR and diagnostic sink the preflight must use, so that it writes nothing into the long run's (spec §5, step 2). */
  readonly devStateDir: string;
  readonly devDiagnosticSink: string;
}

/**
 * The part of `dist/shell/alpaca-broker.js` these ports use: the read-only account, positions and open
 * orders. Declared here rather than imported as a type, because the adapter's types pull in
 * `broker-errors.ts`, whose parameter properties the activation's strip-only TypeScript refuses.
 */
interface BuiltBroker {
  readonly read: {
    account(deadlineAtMs?: number): Promise<{ readonly accountId: string }>;
    positions(deadlineAtMs?: number): Promise<readonly unknown[]>;
    openOrders(deadlineAtMs?: number): Promise<readonly unknown[]>;
  };
}

interface BuiltBrokerModule {
  createAlpacaBroker(options: { readonly credentials: { readonly keyId: string; readonly secretKey: string }; readonly tradingOrigin: string; readonly dataOrigin: string; readonly clock: () => number; readonly requestTimeoutMs: number }): BuiltBroker;
}

/** The market-data origin the runtime itself uses (`dist/shell/agent-runtime.js`), for the same reason declared here. */
interface BuiltAgentRuntime {
  readonly MARKET_DATA_ORIGIN: string;
}

const FIRST_LINE_LIMIT_BYTES = 4 * 1024 * 1024;

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "failed";
}

/** A broker failure reduced to its HTTP status when it has one (`BrokerHttpError`), otherwise to the error's name. */
function brokerReason(error: unknown): string {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") return `HTTP ${String(error.status)}`;
  return error instanceof Error ? error.name : "failed";
}

function run(file: string, args: readonly string[], options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs: number }): Promise<CommandResult> {
  return new Promise(resolve => {
    execFile(file, [...args], { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error === null) {
        resolve({ exitCode: 0, stdout });
        return;
      }
      resolve({ exitCode: typeof error.code === "number" && error.killed !== true ? error.code : null, stdout });
    });
  });
}

function powershell(script: string, args: readonly string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return run(TRUSTED_WINDOWS_POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { cwd, timeoutMs });
}

async function importBuilt<T>(repoRoot: string, relative: string): Promise<T> {
  return (await import(pathToFileURL(path.join(repoRoot, "dist", relative)).href)) as T;
}

async function readText(file: string): Promise<FileRead> {
  try {
    const bytes = await readFile(file);
    return { kind: "text", text: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "absent" } : { kind: "error", reason: errorCode(error) };
  }
}

async function readFirstLine(file: string): Promise<FirstLineRead> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(file, "r");
    const buffer = Buffer.alloc(FIRST_LINE_LIMIT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, FIRST_LINE_LIMIT_BYTES, 0);
    const chunk = buffer.subarray(0, bytesRead);
    const newline = chunk.indexOf(0x0a);
    if (newline < 0 && bytesRead === FIRST_LINE_LIMIT_BYTES) return { kind: "error", reason: "first line longer than the read limit" };
    const line = newline < 0 ? chunk : chunk.subarray(0, newline);
    return { kind: "text", text: line.toString("utf8"), sha256: createHash("sha256").update(line).digest("hex"), terminated: newline >= 0 };
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { kind: "absent" } : { kind: "error", reason: errorCode(error) };
  } finally {
    await handle?.close();
  }
}

export async function createHostPorts(options: HostPortOptions): Promise<ObservationPorts> {
  const certificateCore = await importBuilt<typeof CertificateCore>(options.repoRoot, "core/certificate.js");
  const journalCore = await importBuilt<typeof JournalCore>(options.repoRoot, "core/journal.js");
  const runtimeConfig = await importBuilt<typeof RuntimeConfig>(options.repoRoot, "shell/runtime-config.js");
  const brokerShell = await importBuilt<BuiltBrokerModule>(options.repoRoot, "shell/alpaca-broker.js");
  const agentRuntime = await importBuilt<BuiltAgentRuntime>(options.repoRoot, "shell/agent-runtime.js");
  const identityOutput = await run(TRUSTED_WINDOWS_POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", "$i=[Security.Principal.WindowsIdentity]::GetCurrent();[pscustomobject]@{UserId=$i.Name;UserSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Compress"], { cwd: options.repoRoot, timeoutMs: 10_000 });
  let taskUserId = "";
  let taskUserSid = "";
  if (identityOutput.exitCode === 0) {
    try {
      const identity = JSON.parse(identityOutput.stdout) as { readonly UserId?: unknown; readonly UserSid?: unknown };
      if (typeof identity.UserId === "string" && typeof identity.UserSid === "string") {
        taskUserId = identity.UserId;
        taskUserSid = identity.UserSid;
      }
    } catch {
      // Empty values below make the execution boundary unknown.
    }
  }

  const environment = (): RuntimeConfig.EnvRecord => runtimeConfig.loadEnvironment(options.repoRoot, process.env);
  const brokerFor = (profile: "dev" | "competition"): PortResult<BuiltBroker> => {
    const credentials = runtimeConfig.roleCredentials(environment(), profile);
    if (credentials.keyId.length === 0 || credentials.secretKey.length === 0) return { ok: false, reason: `no credentials for the ${profile} role` };
    return { ok: true, value: brokerShell.createAlpacaBroker({ credentials: { keyId: credentials.keyId, secretKey: credentials.secretKey }, tradingOrigin: options.canonicalTradingOrigin, dataOrigin: agentRuntime.MARKET_DATA_ORIGIN, clock: () => Date.now(), requestTimeoutMs: 30_000 }) };
  };
  const hostScript = (script: HostScript): string => path.join(options.repoRoot, "ops", "activation", "readers", "host", `read-${script}.ps1`);

  return {
    now: () => Date.now(),
    runtimeIdentity: () => {
      return {
        execPath: process.execPath,
        nodeVersion: process.version,
        powerShellPath: TRUSTED_WINDOWS_POWERSHELL,
        // A fixed, trusted Windows PowerShell process obtained both values from
        // WindowsIdentity, so environment variables never define the principal.
        taskUserId,
        taskUserSid,
      };
    },
    runHostScript: script => powershell(hostScript(script), script === "tasks" ? ["-TaskPath", options.taskPath] : [], options.repoRoot, 60_000),
    runVerifier: expectEnabled => powershell(path.join(options.repoRoot, "tools", "verify-scheduled-tasks.ps1"), ["-RepoRoot", options.repoRoot, ...(expectEnabled ? ["-ExpectEnabled"] : [])], options.repoRoot, 120_000),
    readText,
    readFirstLine,
    listDirectory: async directory => {
      try {
        return { ok: true, value: await readdir(directory) };
      } catch (error) {
        return errorCode(error) === "ENOENT" ? { ok: true, value: null } : { ok: false, reason: errorCode(error) };
      }
    },
    appendLine: async (file, line) => {
      try {
        await mkdir(path.dirname(file), { recursive: true });
        const handle = await open(file, "a");
        try {
          await handle.write(line);
          await handle.sync();
        } finally {
          await handle.close();
        }
        return { ok: true, value: true };
      } catch (error) {
        return { ok: false, reason: errorCode(error) };
      }
    },
    freeDiskBytes: async directory => {
      try {
        const stats = await statfs(path.parse(path.resolve(directory)).root);
        return { ok: true, value: stats.bavail * stats.bsize };
      } catch (error) {
        return { ok: false, reason: errorCode(error) };
      }
    },
    healthchecks: () => readHealthchecks({ fetchImpl: fetch, apiKey: environment()["HEALTHCHECK_IO_API_KEY"] ?? "", sleep: ms => new Promise(resolve => { setTimeout(resolve, ms); }) }),
    competitionAccountNumber: async () => {
      const broker = brokerFor("competition");
      if (!broker.ok) return broker;
      try {
        return { ok: true, value: (await broker.value.read.account(Date.now() + 30_000)).accountId };
      } catch (error) {
        return { ok: false, reason: brokerReason(error) };
      }
    },
    devAccountBook: async () => {
      const broker = brokerFor("dev");
      if (!broker.ok) return broker;
      try {
        const deadline = Date.now() + 30_000;
        const positions = await broker.value.read.positions(deadline);
        const orders = await broker.value.read.openOrders(deadline);
        return { ok: true, value: { positions: positions.length, nonTerminalOrders: orders.length } };
      } catch (error) {
        return { ok: false, reason: brokerReason(error) };
      }
    },
    preflight: () => run(process.execPath, [path.join(options.repoRoot, "dist", "shell", "certificate-cli.js"), "--preflight"], {
      cwd: options.repoRoot,
      env: { ...process.env, ALPACA_PROFILE: "dev", STATE_DIR: options.devStateDir, BOOTSTRAP_DIAGNOSTIC_SINK: options.devDiagnosticSink, HEALTHCHECK_PING_URL: "", HEALTHCHECK_LIVENESS_URL: "", HEALTHCHECK_WATCHDOG_URL: "" },
      timeoutMs: 180_000,
    }),
    analystTokenPresent: () => Promise.resolve((environment()["CLAUDE_CODE_OAUTH_TOKEN"] ?? "").length > 0),
    analystProbe: async () => {
      const env = environment();
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      const cwd = path.join(options.activationRoot, "probe-empty");
      await mkdir(cwd, { recursive: true });
      const query: ProbeQuery = sdk.query;
      return runAnalystProbe({ query, model: env["ANALYST_MODEL"] ?? "claude-sonnet-5", oauthToken: env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "", processEnv: process.env, deadlineMs: 60_000, cwd });
    },
    validateCertificate: (raw, expectations) => certificateCore.validateArmingCertificate(raw, expectations),
    parseJournal: text => journalCore.parseJournalText(text),
  };
}
