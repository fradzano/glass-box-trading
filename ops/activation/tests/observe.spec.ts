// Unit 7: the whole observation, composed from the readers. The ports below replay this host's
// own output, taken read-only on 2026-09-14 by ops/activation/readers/host/*.ps1 — the task list
// with its stale direct-node registration and its principals, the boot time, the session probe,
// the §3 preconditions, the empty environment shadow, the verifier's failure. What the host could
// not give without side effects is synthetic and says so: the healthchecks.io answers, the
// broker, the preflight report, the probe, the certificate (built by the runtime's own builder).
//
// The acceptance question of unit 7 is whether a complete `Observations` can be built from the
// readers. The first test answers it field by field; the third feeds the result to `decide`.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCertificate, validateArmingCertificate } from "../../../src/core/certificate.ts";
import { parseJournalText } from "../../../src/core/journal.ts";
import { inputs, ORIGIN } from "../../../tests/arm01-fixtures.ts";
import { decide } from "../core/decide.ts";
import { foldLedger } from "../core/fold.ts";
import { parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import type { Observations, Reading, Schedule } from "../core/types.ts";
import type { HealthchecksReading } from "../readers/healthchecks-io.ts";
import type { CommandResult, FileRead, HostScript, ObservationConfig, ObservationPlan, ObservationPorts } from "../readers/observe.ts";
import { ALERT_CONFIRMATIONS, SESSION_SAMPLE_LOG, readObservations } from "../readers/observe.ts";
import { sessionSampleLine } from "../readers/parse-host.ts";

const REPO = "C:\\Users\\felix\\source\\repos\\glass-box-trading";
const ACTIVATION_ROOT = "C:\\Users\\felix\\glass-box-state\\activation-1";
const LONG_RUN = "C:\\Users\\felix\\glass-box-state\\longrun-1";
const CONFIG: ObservationConfig = {
  repoRoot: REPO,
  activationRoot: ACTIVATION_ROOT,
  longRunStateDir: LONG_RUN,
  taskNames: { cycle: "GlassBoxTrading-AgentCycle", watchdog: "GlassBoxTrading-Watchdog", disarm: "GlassBoxTrading-Disarm" },
  canonicalTradingOrigin: ORIGIN,
};
const ALL: ObservationPlan = { preflight: true, analystProbe: true, devAccount: true };
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const USER_SID = "S-1-5-21-1000";
const NOW = Date.UTC(2026, 8, 21, 13, 30);

/** `host/read-tasks.ps1` on this host, 2026-09-14. */
const HOST_TASKS = JSON.stringify([
  { TaskName: "GlassBoxTrading-AgentCycle", State: "Disabled", Actions: [{ Execute: "C:\\Program Files\\nodejs\\node.exe", Arguments: "\"C:\\Users\\felix\\source\\repos\\glass-box-trading\\dist\\shell\\agent-cli.js\"" }], Triggers: [{ StartBoundary: "2026-09-02T15:30:00+02:00" }], RunLevel: "Limited", LogonType: "S4U", StartWhenAvailable: true, UserId: "felix", UserSid: USER_SID },
  { TaskName: "GlassBoxTrading-Watchdog", State: "Disabled", Actions: [{ Execute: "powershell.exe", Arguments: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\\Users\\felix\\source\\repos\\glass-box-trading\\tools\\watchdog-run.ps1\" -RepoRoot \"C:\\Users\\felix\\source\\repos\\glass-box-trading\" -NodePath \"C:\\Program Files\\nodejs\\node.exe\" -WatchdogIntervalMinutes 5" }], Triggers: [{ StartBoundary: "2026-09-02T15:30:00+02:00" }], RunLevel: "Limited", LogonType: "S4U", StartWhenAvailable: true, UserId: "felix", UserSid: USER_SID },
], null, 4);
const HOST_BOOT = "2026-09-09T03:32:12.5000000Z\r\n";
const HOST_SESSIONS = "{\"sessions\":[{\"type\":2,\"accounts\":[\"DESKTOP-V6EGFDV\\\\felix\"]},{\"type\":2,\"accounts\":[\"DESKTOP-V6EGFDV\\\\felix\"]}],\"explorer\":1}\r\n";
const HOST_PRECONDITIONS = "{\"SleepAcSeconds\":\"0\",\"HibernateAcSeconds\":\"0\",\"HiberbootEnabled\":\"0\",\"ActiveHoursStart\":\"9\",\"ActiveHoursEnd\":\"3\",\"AutoAdminLogon\":\"0\",\"DisableAutomaticRestartSignOn\":\"absent\",\"ShutdownPrivilege\":\"present\",\"AdministratorsMember\":\"yes\"}\r\n";
const HOST_ENVIRONMENT = "{\"user\":{},\"machine\":{}}\r\n";
const HOST_VERIFIER_FAILED = "SCHEDULER CHECK FAILED: 2 of 51 checks. Failed:\r\n  [FAIL] GlassBoxTrading-AgentCycle runs powershell.exe -- Execute=C:\\Program Files\\nodejs\\node.exe\r\n";

/** Synthetic: the secret below must never reach the snapshot, and the account number only masked. */
const DOT_ENV = `ALPACA_PROFILE=competition\nSTATE_DIR=${LONG_RUN}\nALPACA_COMP_SECRET_KEY=test-only-secret-value\nHEALTHCHECK_IO_API_KEY=test-only-api-key\n`;
const ACCOUNT_NUMBER = "PA9TESTACCT7";
const CERTIFICATE = buildCertificate(inputs());
const PREFLIGHT_REPORT = `2026-09-21T13:29:00.000Z bound account\n${JSON.stringify({ profile: "dev", accountId: "PA34…KZ1", tradingDay: "2026-09-21", mcpTools: 32, runtimeDigest: CERTIFICATE.runtimeDigest, policyDigest: CERTIFICATE.policyDigest, epoch: 4 }, null, 2)}\n`;

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function healthy(): HealthchecksReading {
  const flips = { known: true as const, value: [{ utcMs: Date.UTC(2026, 8, 11, 23, 30, 1), up: true }, { utcMs: Date.UTC(2026, 8, 11, 20, 1), up: false }] };
  return {
    summaries: { known: true, value: { liveness: { fingerprint: "hc:a685fe10", status: "paused", lastPingUtcMs: null }, readiness: { fingerprint: "hc:c4ad5b69", status: "paused", lastPingUtcMs: null }, watchdog: { fingerprint: "hc:b76072aa", status: "paused", lastPingUtcMs: null } } },
    flips: { liveness: flips, readiness: flips, watchdog: flips },
    independent: { known: true, value: true },
  };
}

interface Calls {
  readonly names: string[];
}

/** A host that answers the way this one did, with overrides per test. Files live in a map; appends go into it. */
function host(overrides: Partial<ObservationPorts> & { readonly scripts?: Partial<Record<HostScript, CommandResult>>; readonly files?: Readonly<Record<string, string>>; readonly absentDirectories?: readonly string[] } = {}): { readonly ports: ObservationPorts; readonly calls: Calls; readonly files: Map<string, string> } {
  const calls: Calls = { names: [] };
  const files = new Map<string, string>(Object.entries({
    [`${REPO}\\.env`]: DOT_ENV,
    [`${REPO}\\.node-version`]: "24.9.0\n",
    [`${REPO}\\tools\\cycle-run.ps1`]: "# cycle wrapper\n",
    [`${REPO}\\tools\\watchdog-run.ps1`]: "# watchdog wrapper\n",
    [`${REPO}\\evidence\\pre-arm\\2026-09-02T16-11-12-318Z.json`]: "{}",
    [`${REPO}\\evidence\\pre-arm\\2026-09-21T14-05-00-000Z.json`]: JSON.stringify(CERTIFICATE),
    ...overrides.files,
  }));
  const scripts: Record<HostScript, CommandResult> = {
    tasks: { exitCode: 0, stdout: HOST_TASKS },
    boot: { exitCode: 0, stdout: HOST_BOOT },
    sessions: { exitCode: 0, stdout: HOST_SESSIONS },
    preconditions: { exitCode: 0, stdout: HOST_PRECONDITIONS },
    environment: { exitCode: 0, stdout: HOST_ENVIRONMENT },
    ...overrides.scripts,
  };
  // A directory that exists and is empty is NOT the same fact as one that is not
  // there, and this stub used to answer `null` for both — the very confusion the
  // production readers were found to make. The long run's state directory is
  // empty on a healthy host right up to the anchor day, so a fixture that cannot
  // say "present and empty" cannot exercise the normal case at all. Directories
  // are present here unless a test names them absent.
  const absentDirectories = new Set(overrides.absentDirectories ?? []);
  const directory = (name: string): readonly string[] | null => {
    if (absentDirectories.has(name)) return null;
    const prefix = `${name}\\`;
    return [...files.keys()].filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length)).filter(rest => !rest.includes("\\"));
  };
  const read = (file: string): FileRead => {
    const text = files.get(file);
    return text === undefined ? { kind: "absent" } : { kind: "text", text, sha256: sha(text) };
  };
  const ports: ObservationPorts = {
    now: () => NOW,
    runtimeIdentity: () => ({ execPath: NODE, nodeVersion: "v24.9.0", powerShellPath: POWERSHELL, taskUserId: "DESKTOP-V6EGFDV\\felix", taskUserSid: USER_SID }),
    runHostScript: script => { calls.names.push(`script:${script}`); return Promise.resolve(scripts[script]); },
    runVerifier: expectEnabled => { calls.names.push(`verifier:${String(expectEnabled)}`); return Promise.resolve({ exitCode: 1, stdout: HOST_VERIFIER_FAILED }); },
    readText: file => Promise.resolve(read(file)),
    readFirstLine: file => {
      const value = read(file);
      return Promise.resolve(value.kind === "text" ? { ...value, terminated: value.text.endsWith("\n") } : value);
    },
    listDirectory: name => Promise.resolve({ ok: true, value: directory(name) }),
    appendLine: (file, line) => { files.set(file, `${files.get(file) ?? ""}${line}`); return Promise.resolve({ ok: true, value: true }); },
    freeDiskBytes: () => Promise.resolve({ ok: true, value: 1_100_000_000_000 }),
    healthchecks: () => { calls.names.push("healthchecks"); return Promise.resolve(healthy()); },
    competitionAccountNumber: () => { calls.names.push("competition-account"); return Promise.resolve({ ok: true, value: ACCOUNT_NUMBER }); },
    devAccountBook: () => { calls.names.push("dev-account"); return Promise.resolve({ ok: true, value: { positions: 0, nonTerminalOrders: 0 } }); },
    preflight: () => { calls.names.push("preflight"); return Promise.resolve({ exitCode: 0, stdout: PREFLIGHT_REPORT }); },
    analystTokenPresent: () => Promise.resolve(true),
    analystProbe: () => { calls.names.push("probe"); return Promise.resolve({ ok: true }); },
    validateCertificate: validateArmingCertificate,
    parseJournal: parseJournalText,
    ...overrides,
  };
  return { ports, calls, files };
}

function readings(snapshot: Observations): Readonly<Record<string, Reading<unknown>>> {
  const result: Record<string, Reading<unknown>> = {};
  for (const [name, value] of Object.entries(snapshot)) {
    if (typeof value === "object" && value !== null && "known" in value) result[name] = value as Reading<unknown>;
  }
  return result;
}

function unknownNames(snapshot: Observations): readonly string[] {
  return Object.entries(readings(snapshot)).filter(([, reading]) => !reading.known).map(([name, reading]) => `${name}: ${reading.known ? "" : reading.reason}`);
}

describe("observe — a complete snapshot from the readers", () => {
  it("builds every field of Observations from this host's recorded output, and every reading is known", async () => {
    const { ports } = host();
    const snapshot = await readObservations(ports, CONFIG, ALL);
    // Every field the core consumes, by name: a field added to Observations without a reader fails here.
    expect(Object.keys(snapshot).sort()).toEqual([
      "alertConfirmation", "analyst", "apiIndependentRead", "bootUtcMs", "bootstrapEntry", "certificate", "checks", "checksObservedAtUtcMs", "cycleLog", "deploymentDigests", "devAccount", "disarm", "env", "executionBoundary",
      "freeDiskBytes", "hostPreconditions", "logFilesSearched", "longRunArtefacts", "nowLocal", "nowUtcMs", "resolvedAccountMasked", "schedulerCheck", "schedulerCheckExpectEnabled",
      "sessionSamples", "tasks", "watchdogLog", "wrapperHashes",
    ]);
    expect(Object.keys(readings(snapshot))).toHaveLength(22);
    expect(unknownNames(snapshot)).toEqual([]);

    expect(snapshot).toMatchObject({
      nowLocal: { date: "2026-09-21", minute: 15 * 60 + 30 },
      tasks: { known: true, value: { cycle: { state: "Disabled", execute: "C:\\Program Files\\nodejs\\node.exe" }, watchdog: { state: "Disabled", execute: "powershell.exe" } } },
      disarm: { known: true, value: { registered: false } },
      bootUtcMs: { known: true, value: Date.UTC(2026, 8, 9, 3, 32, 12, 500) },
      hostPreconditions: { known: true, value: { DisableAutomaticRestartSignOn: "absent", HiberbootEnabled: "0" } },
      env: { known: true, value: { certificatePath: null, profile: "competition", hash: sha(DOT_ENV), duplicateKeys: [], shadowedKeys: [] } },
      resolvedAccountMasked: { known: true, value: "PA9T…CT7" },
      deploymentDigests: { known: true, value: { runtimeDigest: CERTIFICATE.runtimeDigest, policyDigest: CERTIFICATE.policyDigest } },
      certificate: { known: true, value: { path: `${REPO}\\evidence\\pre-arm\\2026-09-21T14-05-00-000Z.json`, verdict: "PASS" } },
      analyst: { known: true, value: { oauthTokenPresent: true, childStartVerified: true, tokenLive: true, tokenProbeClass: null } },
      schedulerCheck: { known: true, value: { passed: false, checkCount: 51, failedChecks: 2 } },
      wrapperHashes: { known: true, value: { "cycle-run.ps1": sha("# cycle wrapper\n"), "watchdog-run.ps1": sha("# watchdog wrapper\n") } },
      alertConfirmation: { known: true, value: null },
      longRunArtefacts: { known: true, value: [] },
      cycleLog: { known: true, value: [] },
      bootstrapEntry: { known: true, value: null },
      devAccount: { known: true, value: { positions: 0, nonTerminalOrders: 0 } },
    });
    expect(snapshot.sessionSamples).toEqual([{ utcMs: NOW, local: { date: "2026-09-21", minute: 15 * 60 + 30 }, interactiveSessions: 1, explorerProcesses: 1 }]);
  });

  it("lets no secret of .env and no unmasked account number into the snapshot", async () => {
    const text = JSON.stringify(await readObservations(host().ports, CONFIG, ALL));
    expect(text).not.toContain("test-only-secret-value");
    expect(text).not.toContain("test-only-api-key");
    expect(text).not.toContain(ACCOUNT_NUMBER);
  });

  it("carries this host's state through the core: step 0 is red for what the host still lacks, named one by one", async () => {
    const snapshot = await readObservations(host().ports, CONFIG, ALL);
    const opened = planLedgerAppend({ lastSeq: 0, lastAtUtcMs: null }, { at: "2026-09-21T15:00:00+02:00", atUtcMs: NOW - 1_800_000, attempt: "a1", anchorDay: "2026-09-22", step: null, kind: "note", outcome: null, evidence: {}, nextOwnerAction: null });
    if (!opened.ok) throw new Error(opened.reason);
    const expectedHost = { SleepAcSeconds: "0", HibernateAcSeconds: "0", HiberbootEnabled: "0", ActiveHoursStart: "9", ActiveHoursEnd: "3", AutoAdminLogon: "0", DisableAutomaticRestartSignOn: "1", ShutdownPrivilege: "present", AdministratorsMember: "yes" };
    const schedule: Schedule = { certificateDay: "2026-09-21", drillNightDay: "2026-09-22", anchorDay: "2026-09-22", gateNotAfterUtcMs: Date.UTC(2026, 8, 22, 12, 55), longRunAccountMasked: "PA9T…CT7", coverageThroughDate: "2026-12-16", expectedHostPreconditions: expectedHost, minFreeDiskBytes: 10_000_000_000, repoRoot: REPO, activationRoot: ACTIVATION_ROOT };
    const decision = decide(foldLedger(parseLedgerText(opened.line)), snapshot, schedule);
    // ARSO is still on (spec §3: the elevated step must switch it off), and gate condition 4 has not been recorded. Nothing else.
    expect(decision).toMatchObject({ kind: "abort", step: "0-preflight", reason: "PREFLIGHT_RED", teardown: true, evidence: { unknown: [], red: ["host.DisableAutomaticRestartSignOn", "alert-confirmation.absent"] } });
  });
});

describe("observe — failures and plans", () => {
  it("makes a failed reader's field unknown, and only that field", async () => {
    const snapshot = await readObservations(host({ scripts: { tasks: { exitCode: 3, stdout: "" }, preconditions: { exitCode: null, stdout: "" } } }).ports, CONFIG, ALL);
    expect(unknownNames(snapshot)).toEqual(["tasks: task reader exited 3", "hostPreconditions: host precondition reader did not finish", "disarm: task reader exited 3"]);
  });

  it("does not take the costly readings the plan leaves out, and says so instead of guessing", async () => {
    const { ports, calls } = host();
    const snapshot = await readObservations(ports, CONFIG, { preflight: false, analystProbe: true, devAccount: false });
    expect(calls.names).not.toContain("preflight");
    expect(calls.names).not.toContain("probe");
    expect(calls.names).not.toContain("dev-account");
    expect(unknownNames(snapshot)).toEqual([
      "deploymentDigests: digests: the preflight not taken in this invocation",
      "certificate: the certificate cannot be validated without the deployment's digests (digests: the preflight not taken in this invocation)",
      "devAccount: the dev account read not taken in this invocation",
      "analyst: the analyst probe not taken in this invocation",
    ]);
  });

  it("takes each costly reading on its own plan flag: a preflight does not bring the dev account read with it", async () => {
    const { ports, calls } = host();
    const snapshot = await readObservations(ports, CONFIG, { preflight: true, analystProbe: false, devAccount: false });
    expect(calls.names).toContain("preflight");
    expect(calls.names).not.toContain("dev-account");
    expect(calls.names).not.toContain("probe");
    expect(unknownNames(snapshot)).toEqual(["devAccount: the dev account read not taken in this invocation", "analyst: the analyst probe not taken in this invocation"]);
  });

  it("spends no probe on an analyst whose preflight printed no report", async () => {
    const { ports, calls } = host({ preflight: () => Promise.resolve({ exitCode: 1, stdout: "refused at analyst: CLAUDE_CODE_OAUTH_TOKEN is not set\n" }) });
    const snapshot = await readObservations(ports, CONFIG, ALL);
    expect(calls.names).not.toContain("probe");
    expect(snapshot.analyst).toEqual({ known: false, reason: "preflight: preflight printed no report" });
    expect(snapshot.deploymentDigests).toEqual({ known: false, reason: "digests: preflight printed no report" });
  });

  it("appends this invocation's session sample before reading the log back, and a failed append loses only that sample", async () => {
    const earlier = { utcMs: NOW - 300_000, local: { date: "2026-09-21", minute: 15 * 60 + 25 }, interactiveSessions: 0, explorerProcesses: 0 };
    const log = `${ACTIVATION_ROOT}\\${SESSION_SAMPLE_LOG}`;
    const appended = host({ files: { [log]: sessionSampleLine(earlier) } });
    const snapshot = await readObservations(appended.ports, CONFIG, ALL);
    expect(snapshot.sessionSamples.map(sample => sample.utcMs)).toEqual([NOW - 300_000, NOW]);
    expect(appended.files.get(log)?.split("\n").filter(line => line.length > 0)).toHaveLength(2);

    const refused = host({ files: { [log]: sessionSampleLine(earlier) }, appendLine: () => Promise.resolve({ ok: false, reason: "EPERM" }) });
    expect((await readObservations(refused.ports, CONFIG, ALL)).sessionSamples.map(sample => sample.utcMs)).toEqual([NOW - 300_000]);
  });

  it("timestamps the session sample at the session measurement and the decision snapshot after all reads", async () => {
    const measured = NOW + 120_000;
    const checksObserved = NOW + 299_000;
    const decided = NOW + 300_000;
    const moments = [NOW, measured, checksObserved, decided];
    const observed = host({ now: () => moments.shift() ?? decided });
    const snapshot = await readObservations(observed.ports, CONFIG, ALL);
    expect(snapshot.sessionSamples.at(-1)?.utcMs).toBe(measured);
    expect(snapshot.checksObservedAtUtcMs).toBe(checksObserved);
    expect(snapshot.nowUtcMs).toBe(decided);
    expect(snapshot.nowLocal).toEqual({ date: "2026-09-21", minute: 15 * 60 + 35 });
    expect(observed.calls.names.at(-1)).toBe("healthchecks");
  });

  it("makes the executable boundary unknown when process.execPath does not match the pinned Node version", async () => {
    const snapshot = await readObservations(host({ runtimeIdentity: () => ({ execPath: NODE, nodeVersion: "v24.10.0", powerShellPath: POWERSHELL, taskUserId: "DESKTOP-V6EGFDV\\felix", taskUserSid: USER_SID }) }).ports, CONFIG, ALL);
    expect(snapshot.executionBoundary).toEqual({ known: false, reason: "this node is v24.10.0; the repository pins v24.9.0" });
  });

  it("refuses a PowerShell trust root supplied by a spoofable environment boundary", async () => {
    const snapshot = await readObservations(host({ runtimeIdentity: () => ({
      execPath: NODE,
      nodeVersion: "v24.9.0",
      powerShellPath: "C:\\attacker\\WindowsPowerShell\\v1.0\\powershell.exe",
      taskUserId: "ATTACKER\\felix",
      taskUserSid: "S-1-5-21-attacker",
    }) }).ports, CONFIG, ALL);
    expect(snapshot.executionBoundary).toEqual({ known: false, reason: "the trusted Windows PowerShell path is unavailable" });
  });

  it("reads a confirmation file that does not parse as unknown, not as absent", async () => {
    const snapshot = await readObservations(host({ files: { [`${ACTIVATION_ROOT}\\${ALERT_CONFIRMATIONS}`]: "{\"operator\":" } }).ports, CONFIG, ALL);
    expect(snapshot.alertConfirmation).toEqual({ known: false, reason: "latest confirmation is not a JSON object" });
  });

  it("reads the long run's logs and journal from its state directory, and an unreadable log file as unknown", async () => {
    const journal = `${JSON.stringify({ seq: 1, at: "2026-09-22T13:15:20.000Z", epoch: 1, type: "BOOTSTRAP", epochSeeded: true, snapshot: { accountId: "TEST_ONLY_ACCOUNT", snapshotAt: "2026-09-22T13:15:19.000Z", cashCents: 10_000_000, equityCents: 10_000_000, positions: [], openOrders: [], quoteSamples: {} } })}\n`;
    const files = {
      [`${LONG_RUN}\\cycle-run.log`]: "2026-09-22T13:15:01.0000000Z run: pid=1 stateDir=x entry=y\n",
      [`${LONG_RUN}\\watchdog-run.log`]: `${String.fromCharCode(0xfeff)}2026-09-22T12:40:00.5000000Z output: watchdog composed for the competition profile over ${LONG_RUN}; book recovery armed\n`,
      [`${LONG_RUN}\\journal.jsonl`]: journal,
    };
    const snapshot = await readObservations(host({ files }).ports, CONFIG, ALL);
    expect(snapshot.cycleLog).toMatchObject({ known: true, value: [{ file: "cycle-run.log", shape: "run", local: { date: "2026-09-22", minute: 15 * 60 + 15 } }] });
    expect(snapshot.watchdogLog).toMatchObject({ known: true, value: [{ composition: "armed" }] });
    expect(snapshot.bootstrapEntry).toEqual({ known: true, value: { seq: 1, utcMs: Date.UTC(2026, 8, 22, 13, 15, 20) } });
    expect(snapshot.longRunArtefacts).toEqual({ known: true, value: ["cycle-run.log", "watchdog-run.log", "journal.jsonl"] });

    const locked = host({ files, readText: file => Promise.resolve(file.endsWith("cycle-run.log") ? { kind: "error", reason: "EBUSY" } : { kind: "absent" }) });
    expect((await readObservations(locked.ports, CONFIG, ALL)).cycleLog).toEqual({ known: false, reason: "cycle-run.log: EBUSY" });
  });

  it("searches the cycle log's rotation file as well, and orders both files' lines in time", async () => {
    const files = { [`${LONG_RUN}\\cycle-run.log`]: "2026-09-22T13:15:01.0000000Z run: pid=1 stateDir=x entry=y\n", [`${LONG_RUN}\\cycle-run.log.1`]: "2026-09-22T13:00:01.0000000Z skip: outside the exchange session\n" };
    const snapshot = await readObservations(host({ files }).ports, CONFIG, ALL);
    expect(snapshot.cycleLog).toMatchObject({ known: true, value: [{ file: "cycle-run.log.1", shape: "skip" }, { file: "cycle-run.log", shape: "run" }] });
  });

  it("reports a certificate line set outside .env, because the runtime would take it from there", async () => {
    const shadowed = { exitCode: 0, stdout: "{\"user\":{\"PRE_ARM_CERTIFICATE\":\"C:\\\\old.json\"},\"machine\":{}}" };
    const snapshot = await readObservations(host({ scripts: { environment: shadowed } }).ports, CONFIG, ALL);
    expect(snapshot.env).toMatchObject({ known: true, value: { certificatePath: "C:\\old.json", shadowedKeys: ["PRE_ARM_CERTIFICATE"] } });
    expect((await readObservations(host({ scripts: { environment: { exitCode: 3, stdout: "" } } }).ports, CONFIG, ALL)).env).toEqual({ known: false, reason: "environment: environment reader exited 3" });
  });

  it("does not take a preflight that did not finish at its word, even when it printed a report", async () => {
    const snapshot = await readObservations(host({ preflight: () => Promise.resolve({ exitCode: null, stdout: PREFLIGHT_REPORT }) }).ports, CONFIG, ALL);
    expect(snapshot.deploymentDigests).toEqual({ known: false, reason: "digests: the preflight did not finish" });
  });

  // The precondition of DECISIONS 2026-09-18 (R2-23): a certificate command is
  // not dispatched at all while the declared long-run directory is missing,
  // because that is the state in which the certificate guard's identity
  // derivation cannot tell one directory's spellings apart. The residual that
  // rested on this condition was refused countersignature precisely because
  // nothing observed it, so the observation is pinned here rather than trusted.
  it("does not dispatch a certificate preflight while the declared long-run directory is missing, and says so", async () => {
    const calls: string[] = [];
    const absent = host({ absentDirectories: [LONG_RUN], preflight: () => { calls.push("preflight"); return Promise.resolve({ exitCode: 0, stdout: PREFLIGHT_REPORT }); } });
    const snapshot = await readObservations(absent.ports, CONFIG, ALL);
    expect(calls).toEqual([]);
    expect(snapshot.deploymentDigests).toMatchObject({ known: false });
    if (snapshot.deploymentDigests.known) return;
    expect(snapshot.deploymentDigests.reason).toContain("was not dispatched");
    expect(snapshot.deploymentDigests.reason).toContain(LONG_RUN);
  });

  it("dispatches the preflight when the long-run directory is present and empty, which is the healthy state before the anchor day", async () => {
    const calls: string[] = [];
    const present = host({ preflight: () => { calls.push("preflight"); return Promise.resolve({ exitCode: 0, stdout: PREFLIGHT_REPORT }); } });
    const snapshot = await readObservations(present.ports, CONFIG, ALL);
    expect(calls).toEqual(["preflight"]);
    expect(snapshot.deploymentDigests.known).toBe(true);
    expect(snapshot.longRunArtefacts).toEqual({ known: true, value: [] });
  });
});
