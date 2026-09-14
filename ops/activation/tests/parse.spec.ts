// Unit 7: the pure parsers behind the activation's readers. Wherever this host could
// produce the input, the fixture below is its real output, taken read-only on
// 2026-09-14 — the task list with its stale direct-node registration, the verifier's
// failure, the watchdog log's lines, the session probe. The `.env` parser is held to
// the runtime's own `parseDotEnv` by running both over the same texts: the latch is
// what the runtime reads, not what this module believes it reads.
import { describe, expect, it } from "vitest";
import { buildCertificate, validateArmingCertificate } from "../../../src/core/certificate.ts";
import { parseDotEnv } from "../../../src/shell/runtime-config.ts";
import { inputs, ORIGIN } from "../../../tests/arm01-fixtures.ts";
import { definitionFindings } from "../core/decide.ts";
import { berlinLocal, parseAlertConfirmations, parseBootInstant, parseCertificateFile, parseDisarm, parseDotEnvAsRuntime, parseEnv, parseIsoInstant, parsePreflightOutput, parseSessionProbe, parseTasks, parseVerifierOutput, parseWrapperLogs } from "../readers/parse.ts";

const NAMES = { cycle: "GlassBoxTrading-AgentCycle", watchdog: "GlassBoxTrading-Watchdog", disarm: "GlassBoxTrading-Disarm" };

/** `Get-ScheduledTask -TaskPath '\GlassBoxTrading\'` on this host, 2026-09-14 02:15, as the reader renders it. */
const HOST_TASKS = `[
    {
        "TaskName":  "GlassBoxTrading-AgentCycle",
        "State":  "Disabled",
        "Actions":  [
                        {
                            "Execute":  "C:\\\\Program Files\\\\nodejs\\\\node.exe",
                            "Arguments":  "\\"C:\\\\Users\\\\felix\\\\source\\\\repos\\\\glass-box-trading\\\\dist\\\\shell\\\\agent-cli.js\\""
                        }
                    ],
        "Triggers":  [
                         {
                             "Type":  "MSFT_TaskWeeklyTrigger",
                             "StartBoundary":  "2026-09-02T15:30:00+02:00",
                             "Enabled":  true
                         }
                     ]
    },
    {
        "TaskName":  "GlassBoxTrading-Watchdog",
        "State":  "Disabled",
        "Actions":  [
                        {
                            "Execute":  "powershell.exe",
                            "Arguments":  "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \\"C:\\\\Users\\\\felix\\\\source\\\\repos\\\\glass-box-trading\\\\tools\\\\watchdog-run.ps1\\" -RepoRoot \\"C:\\\\Users\\\\felix\\\\source\\\\repos\\\\glass-box-trading\\" -NodePath \\"C:\\\\Program Files\\\\nodejs\\\\node.exe\\" -WatchdogIntervalMinutes 5"
                        }
                    ],
        "Triggers":  [
                         {
                             "Type":  "MSFT_TaskWeeklyTrigger",
                             "StartBoundary":  "2026-09-02T15:30:00+02:00",
                             "Enabled":  true
                         }
                     ]
    }
]`;

/** `tools/verify-scheduled-tasks.ps1` on this host, 2026-09-14, exit 1. */
const HOST_VERIFIER_FAILED = `[FAIL] GlassBoxTrading-AgentCycle runs powershell.exe -- Execute=C:\\Program Files\\nodejs\\node.exe
[FAIL] GlassBoxTrading-AgentCycle -File is exactly tools\\cycle-run.ps1 -- -File resolves to (absent); expected C:\\Users\\felix\\source\\repos\\glass-box-trading\\tools\\cycle-run.ps1
SCHEDULER CHECK FAILED: 2 of 51 checks. Failed:
  [FAIL] GlassBoxTrading-AgentCycle runs powershell.exe -- Execute=C:\\Program Files\\nodejs\\node.exe
  [FAIL] GlassBoxTrading-AgentCycle -File is exactly tools\\cycle-run.ps1 -- -File resolves to (absent); expected C:\\Users\\felix\\source\\repos\\glass-box-trading\\tools\\cycle-run.ps1`;

/** The first three lines of `glass-box-state\dev\watchdog-run.log`, with the byte-order mark PowerShell 5.1 writes. */
const HOST_WATCHDOG_LOG = "\uFEFF2026-09-02T08:32:51.9260914Z run: instanceId=watchdog-DESKTOP-V6EGFDV-48496 nowMs=1788337971916 opensAtMs=1788355800000 closesAtMs=1788379200000 deadManBoundMs=3000000 stateDir=C:\\Users\\felix\\glass-box-state\\dev\r\n"
  + "2026-09-02T08:32:52.0190546Z output: {\"assessment\":{\"kind\":\"quiet\",\"reason\":\"OUTSIDE_SESSION\"},\"acquired\":null}\r\n"
  + "2026-09-02T08:32:52.0235672Z exit: 0\r\n";

describe("parse — instants and the local clock", () => {
  it("reads PowerShell's seven fraction digits, an offset, and refuses what could mean two instants", () => {
    expect(parseIsoInstant("2026-09-02T08:32:51.9260914Z")).toBe(Date.UTC(2026, 8, 2, 8, 32, 51, 926));
    expect(parseIsoInstant("2026-09-02T15:30:00+02:00")).toBe(Date.UTC(2026, 8, 2, 13, 30, 0));
    expect(parseIsoInstant("2026-09-02T09:30:00-04:00")).toBe(Date.UTC(2026, 8, 2, 13, 30, 0));
    expect(parseIsoInstant("2026-09-09T05:32:12.5000000+02:00")).toBe(Date.UTC(2026, 8, 9, 3, 32, 12, 500));
    expect(parseIsoInstant("2026-09-02T15:30:00")).toBeNull();
    expect(parseIsoInstant("2026-09-02 08:32:51Z")).toBeNull();
    expect(parseIsoInstant("2026-02-30T08:00:00Z")).toBeNull();
    expect(parseIsoInstant("2026-09-02T24:00:00Z")).toBeNull();
    expect(parseIsoInstant("2026-09-02T08:00:00+15:00")).toBeNull();
  });

  it("converts to Europe/Berlin across both clock changes of 2026", () => {
    expect(berlinLocal(Date.UTC(2026, 9, 25, 0, 59))).toEqual({ date: "2026-10-25", minute: 2 * 60 + 59 });
    expect(berlinLocal(Date.UTC(2026, 9, 25, 1, 0))).toEqual({ date: "2026-10-25", minute: 2 * 60 });
    expect(berlinLocal(Date.UTC(2026, 2, 29, 1, 0))).toEqual({ date: "2026-03-29", minute: 3 * 60 });
    expect(berlinLocal(Date.UTC(2026, 8, 21, 22, 10))).toEqual({ date: "2026-09-22", minute: 10 });
  });

  it("reads the boot time as the reader prints it, and nothing else", () => {
    expect(parseBootInstant("2026-09-09T03:32:12.5000000Z\r\n")).toEqual({ known: true, value: Date.UTC(2026, 8, 9, 3, 32, 12, 500) });
    expect(parseBootInstant("09.09.2026 05:32:12").known).toBe(false);
  });
});

describe("parse — wrapper logs", () => {
  it("reads the host's watchdog log despite its byte-order mark, in local time and by shape", () => {
    const reading = parseWrapperLogs([{ name: "watchdog-run.log", text: HOST_WATCHDOG_LOG }]);
    expect(reading.known).toBe(true);
    if (!reading.known) return;
    expect(reading.value.map(line => [line.shape, line.local.date, line.local.minute])).toEqual([
      ["run", "2026-09-02", 10 * 60 + 32],
      ["other", "2026-09-02", 10 * 60 + 32],
      ["other", "2026-09-02", 10 * 60 + 32],
    ]);
    expect(reading.value[0]?.utcMs).toBe(Date.UTC(2026, 8, 2, 8, 32, 51, 926));
  });

  it("merges the rotation file and the current file in time order, and tolerates an absent rotation file", () => {
    const older = "2026-09-22T12:00:01.0000000Z skip: outside the exchange session\n";
    const newer = "2026-09-22T12:15:01.0000000Z skip: outside the exchange session\n";
    const reading = parseWrapperLogs([{ name: "cycle-run.log", text: newer }, { name: "cycle-run.log.1", text: older }]);
    expect(reading.known && reading.value.map(line => [line.file, line.shape, line.local.minute])).toEqual([["cycle-run.log.1", "skip", 14 * 60], ["cycle-run.log", "skip", 14 * 60 + 15]]);
    expect(parseWrapperLogs([{ name: "cycle-run.log.1", text: null }, { name: "cycle-run.log", text: newer }]).known).toBe(true);
  });

  it("tells the watchdog's armed composition line from its degraded one, and every other line from both (spec §8.12)", () => {
    // Shapes from src/shell/watchdog-runtime.ts as watchdog-run.ps1 logs the child's output; no host log has held one yet.
    const log = [
      "2026-09-22T12:40:00.1000000Z run: instanceId=watchdog-HOST-1 nowMs=1 opensAtMs=2 closesAtMs=3 deadManBoundMs=3000000 stateDir=C:\\state",
      "2026-09-22T12:40:00.5000000Z output: watchdog composed for the competition profile over C:\\Users\\felix\\glass-box-state\\longrun-1; book recovery armed",
      "2026-09-21T20:30:00.5000000Z output: watchdog book recovery unavailable, fencing and halting only: configuration refused to arm: PRE_ARM_CERTIFICATE missing",
      "2026-09-22T12:40:01.0000000Z output: {\"assessment\":{\"kind\":\"quiet\",\"reason\":\"OUTSIDE_SESSION\"},\"acquired\":null}",
      "2026-09-22T12:40:02.0000000Z output: watchdog composed for the competition profile over C:\\state; book recovery armed -- and then something else",
      "2026-09-22T12:40:03.0000000Z exit: 0; heartbeat sent",
    ].join("\r\n");
    const reading = parseWrapperLogs([{ name: "watchdog-run.log", text: log }]);
    expect(reading.known && reading.value.map(line => [line.shape, line.composition])).toEqual([["other", "degraded"], ["run", null], ["other", "armed"], ["other", null], ["other", null], ["other", null]]);
  });

  it("makes the whole log unknown when one line has no leading instant — the drill's discriminator must see every line", () => {
    const torn = `${HOST_WATCHDOG_LOG}2026-09-02T08:3`;
    expect(parseWrapperLogs([{ name: "watchdog-run.log", text: torn }])).toEqual({ known: false, reason: "watchdog-run.log:4 has no leading ISO instant" });
  });
});

describe("parse — scheduled tasks", () => {
  it("reads the host's registration, and the core finds the stale direct-node action in it", () => {
    const reading = parseTasks(HOST_TASKS, NAMES);
    expect(reading.known).toBe(true);
    if (!reading.known) return;
    expect(reading.value.cycle).toEqual({ state: "Disabled", execute: "C:\\Program Files\\nodejs\\node.exe", argumentLine: "\"C:\\Users\\felix\\source\\repos\\glass-box-trading\\dist\\shell\\agent-cli.js\"" });
    expect(definitionFindings("cycle", reading.value.cycle)).toContain("cycle.execute");
    expect(definitionFindings("watchdog", reading.value.watchdog)).toEqual([]);
  });

  it("accepts PowerShell 5.1's unwrapped one-element arrays", () => {
    const unwrapped = JSON.stringify([
      { TaskName: NAMES.cycle, State: "Ready", Actions: { Execute: "powershell.exe", Arguments: "-File x" }, Triggers: { StartBoundary: "2026-09-02T14:00:00+02:00" } },
      { TaskName: NAMES.watchdog, State: "Disabled", Actions: { Execute: "powershell.exe", Arguments: null }, Triggers: [] },
    ]);
    expect(parseTasks(unwrapped, NAMES)).toEqual({ known: true, value: { cycle: { state: "Ready", execute: "powershell.exe", argumentLine: "-File x" }, watchdog: { state: "Disabled", execute: "powershell.exe", argumentLine: "" } } });
  });

  it("refuses a second action, a missing task, a task registered twice, and output that is not JSON", () => {
    const twoActions = JSON.stringify([
      { TaskName: NAMES.cycle, State: "Ready", Actions: [{ Execute: "powershell.exe", Arguments: "" }, { Execute: "cmd.exe", Arguments: "/c x" }], Triggers: [] },
      { TaskName: NAMES.watchdog, State: "Ready", Actions: [{ Execute: "powershell.exe", Arguments: "" }], Triggers: [] },
    ]);
    expect(parseTasks(twoActions, NAMES)).toEqual({ known: false, reason: "GlassBoxTrading-AgentCycle has 2 actions" });
    expect(parseTasks(JSON.stringify({ TaskName: NAMES.cycle, State: "Ready", Actions: { Execute: "powershell.exe" } }), NAMES)).toEqual({ known: false, reason: "GlassBoxTrading-Watchdog is not registered" });
    const twice = JSON.stringify([{ TaskName: NAMES.cycle, State: "Ready", Actions: { Execute: "a" } }, { TaskName: NAMES.cycle, State: "Ready", Actions: { Execute: "a" } }]);
    expect(parseTasks(twice, NAMES)).toEqual({ known: false, reason: "GlassBoxTrading-AgentCycle is registered 2 times" });
    expect(parseTasks("Get-ScheduledTask : Access denied", NAMES).known).toBe(false);
  });

  it("reads the disarm's principal and settings in the shape this host prints them, absent ones as null, and refuses a changed shape (review 2026-09-14, point 4)", () => {
    // `[string]$task.Principal.RunLevel`, `[string]$task.Principal.LogonType` and `$task.Settings.StartWhenAvailable`
    // as they read back for the two registered tasks on 2026-09-14: "Limited", "S4U", true.
    const shaped = (fields: Readonly<Record<string, unknown>>): string => JSON.stringify([{ TaskName: NAMES.disarm, State: "Ready", Actions: { Execute: "C:\\Program Files\\nodejs\\node.exe", Arguments: "x" }, Triggers: { StartBoundary: "2026-09-22T15:05:00+02:00" }, ...fields }]);
    expect(parseDisarm(shaped({ RunLevel: "Highest", LogonType: "S4U", StartWhenAvailable: true }), NAMES)).toMatchObject({ known: true, value: { runLevel: "Highest", logonType: "S4U", startWhenAvailable: true } });
    expect(parseDisarm(shaped({ RunLevel: "Limited", LogonType: "Interactive", StartWhenAvailable: false }), NAMES)).toMatchObject({ known: true, value: { runLevel: "Limited", logonType: "Interactive", startWhenAvailable: false } });
    expect(parseDisarm(shaped({}), NAMES)).toMatchObject({ known: true, value: { runLevel: null, logonType: null, startWhenAvailable: null } });
    expect(parseDisarm(shaped({ RunLevel: 1 }), NAMES)).toEqual({ known: false, reason: "GlassBoxTrading-Disarm: RunLevel is not text" });
    expect(parseDisarm(shaped({ StartWhenAvailable: "True" }), NAMES)).toEqual({ known: false, reason: "GlassBoxTrading-Disarm: StartWhenAvailable is not a boolean" });
  });

  it("reads the disarm as absent, as registered for its zoned start, and refuses an unzoned or doubled trigger", () => {
    const absent = { registered: false, fires: null, state: null, actions: [], runLevel: null, logonType: null, startWhenAvailable: null };
    expect(parseDisarm(HOST_TASKS, NAMES)).toEqual({ known: true, value: absent });
    expect(parseDisarm("", NAMES)).toEqual({ known: true, value: absent });
    const disarm = (triggers: unknown): string => JSON.stringify([{ TaskName: NAMES.disarm, State: "Ready", Actions: { Execute: "powershell.exe" }, Triggers: triggers }]);
    expect(parseDisarm(disarm({ StartBoundary: "2026-09-22T15:05:00+02:00" }), NAMES)).toEqual({ known: true, value: { registered: true, fires: { date: "2026-09-22", minute: 15 * 60 + 5 }, state: "Ready", actions: [{ execute: "powershell.exe", argumentLine: "" }], runLevel: null, logonType: null, startWhenAvailable: null } });
    // A second action and a disabled state are facts for the core to judge, not reasons to stop reading (review 2026-09-14, point 2).
    const doubled = JSON.stringify([{ TaskName: NAMES.disarm, State: "Disabled", Actions: [{ Execute: "node.exe", Arguments: "a" }, { Execute: "cmd.exe", Arguments: "/c b" }], Triggers: { StartBoundary: "2026-09-22T15:05:00+02:00" } }]);
    expect(parseDisarm(doubled, NAMES)).toMatchObject({ known: true, value: { state: "Disabled", actions: [{ execute: "node.exe", argumentLine: "a" }, { execute: "cmd.exe", argumentLine: "/c b" }] } });
    expect(parseDisarm(disarm({ StartBoundary: "2026-09-22T15:05:00" }), NAMES).known).toBe(false);
    expect(parseDisarm(disarm([{ StartBoundary: "2026-09-22T15:05:00+02:00" }, { StartBoundary: "2026-09-23T15:05:00+02:00" }]), NAMES).known).toBe(false);
  });
});

describe("parse — the scheduler verifier", () => {
  it("reads the host's failure with its counts", () => {
    expect(parseVerifierOutput(HOST_VERIFIER_FAILED, 1)).toEqual({ known: true, value: { passed: false, checkCount: 51, failedChecks: 2 } });
  });

  it("reads a pass only with exit code 0, and refuses a verdict the exit code contradicts", () => {
    expect(parseVerifierOutput("[OK] a\nSCHEDULER CHECK PASSED: 53 checks.\n", 0)).toEqual({ known: true, value: { passed: true, checkCount: 53, failedChecks: 0 } });
    expect(parseVerifierOutput("SCHEDULER CHECK PASSED: 53 checks.", 1).known).toBe(false);
    expect(parseVerifierOutput(HOST_VERIFIER_FAILED, 0).known).toBe(false);
  });

  it("refuses no verdict, two verdicts and an impossible count", () => {
    expect(parseVerifierOutput("The term 'verify-scheduled-tasks.ps1' is not recognized", 1)).toEqual({ known: false, reason: "verifier printed 0 verdict lines" });
    expect(parseVerifierOutput("SCHEDULER CHECK PASSED: 53 checks.\nSCHEDULER CHECK PASSED: 53 checks.", 0).known).toBe(false);
    expect(parseVerifierOutput("SCHEDULER CHECK FAILED: 0 of 51 checks.", 1).known).toBe(false);
    expect(parseVerifierOutput("SCHEDULER CHECK FAILED: 52 of 51 checks.", 1).known).toBe(false);
  });
});

describe("parse — session samples", () => {
  it("counts the host's signed-in user once although it holds two type-2 sessions", () => {
    const probe = JSON.stringify({ sessions: [{ type: 2, accounts: ["DESKTOP-V6EGFDV\\felix"] }, { type: 2, accounts: "DESKTOP-V6EGFDV\\felix" }], explorer: 1 });
    const reading = parseSessionProbe(probe, Date.UTC(2026, 8, 14, 0, 20));
    expect(reading).toEqual({ known: true, value: { utcMs: Date.UTC(2026, 8, 14, 0, 20), local: { date: "2026-09-14", minute: 2 * 60 + 20 }, interactiveSessions: 1, explorerProcesses: 1 } });
  });

  it("does not count the window manager, the font driver, or other logon types as people", () => {
    const probe = JSON.stringify({ sessions: [{ type: 2, accounts: ["Window Manager\\DWM-1"] }, { type: 2, accounts: ["Font Driver Host\\UMFD-0"] }, { type: 5, accounts: ["NT AUTHORITY\\SYSTEM"] }], explorer: 0 });
    expect(parseSessionProbe(probe, 0)).toMatchObject({ known: true, value: { interactiveSessions: 0, explorerProcesses: 0 } });
    expect(parseSessionProbe(JSON.stringify({ sessions: { type: 10, accounts: ["HOST\\visitor"] }, explorer: 0 }), 0)).toMatchObject({ value: { interactiveSessions: 1 } });
  });

  it("refuses a probe without an explorer count or with an untyped session", () => {
    expect(parseSessionProbe(JSON.stringify({ sessions: [] }), 0).known).toBe(false);
    expect(parseSessionProbe(JSON.stringify({ sessions: [{ accounts: ["HOST\\felix"] }], explorer: 1 }), 0).known).toBe(false);
  });
});

describe("parse — .env as the runtime reads it", () => {
  const corpus: readonly string[] = [
    "ALPACA_PROFILE=competition\nPRE_ARM_CERTIFICATE=C:\\evidence\\cert.json\n",
    "PRE_ARM_CERTIFICATE=a\r\nPRE_ARM_CERTIFICATE=b\r\n",
    "  # comment\n\nexport PRE_ARM_CERTIFICATE=x\n=novalue\nNOEQUALS\n",
    "QUOTED=\"with spaces\"\nSINGLE='x'\nHALF=\"open\nEMPTY=\n",
    "\uFEFFPRE_ARM_CERTIFICATE=hidden-by-bom\nSTATE_DIR = C:\\state \n",
    "KEY=a=b=c\n  SPACED  =  value  \n",
  ];

  it("agrees with the runtime's parseDotEnv on every text of the corpus", () => {
    for (const text of corpus) expect(parseDotEnvAsRuntime(text).values, JSON.stringify(text)).toEqual(parseDotEnv(text));
  });

  it("reports duplicates and lets the last one win, as the runtime does", () => {
    expect(parseDotEnvAsRuntime(corpus[1] ?? "")).toEqual({ values: { PRE_ARM_CERTIFICATE: "b" }, duplicateKeys: ["PRE_ARM_CERTIFICATE"] });
  });

  it("does not read an exported line as the certificate, but does read one behind a byte-order mark — exactly as the runtime does", () => {
    expect(parseEnv({ dotEnvText: corpus[2] ?? "", sha256: "h", userEnvironment: {}, machineEnvironment: {} }).certificatePath).toBeNull();
    // String.prototype.trim removes U+FEFF, so the runtime sees this key; an earlier draft claimed the opposite and this test refuted it.
    expect(parseEnv({ dotEnvText: corpus[4] ?? "", sha256: "h", userEnvironment: {}, machineEnvironment: {} }).certificatePath).toBe("hidden-by-bom");
  });

  it("treats an empty value as present", () => {
    expect(parseEnv({ dotEnvText: "PRE_ARM_CERTIFICATE=\n", sha256: "h", userEnvironment: {}, machineEnvironment: {} }).certificatePath).toBe("");
  });

  it("sees a certificate path or profile set outside .env, which the runtime would prefer, and names it", () => {
    const reading = parseEnv({ dotEnvText: "ALPACA_PROFILE=competition\n", sha256: "h", userEnvironment: { PRE_ARM_CERTIFICATE: "C:\\old.json" }, machineEnvironment: { ALPACA_PROFILE: "dev" } });
    expect(reading).toEqual({ certificatePath: "C:\\old.json", profile: "dev", hash: "h", duplicateKeys: [], shadowedKeys: ["PRE_ARM_CERTIFICATE", "ALPACA_PROFILE"] });
    expect(parseEnv({ dotEnvText: "", sha256: "h", userEnvironment: { ALPACA_PROFILE: "competition" }, machineEnvironment: { ALPACA_PROFILE: "dev" } }).profile).toBe("competition");
  });
});

describe("parse — certificate and preflight", () => {
  // A real PASS certificate from the runtime's own builder and fixtures (tests/arm01-fixtures.ts), judged by the runtime's own validator.
  const real = buildCertificate(inputs());
  const expectations = { runtimeDigest: real.runtimeDigest, policyDigest: real.policyDigest, canonicalTradingOrigin: ORIGIN };
  const PATH = "C:\\evidence\\pre-arm\\run-4.json";
  const read = (document: unknown, against = expectations): ReturnType<typeof parseCertificateFile> => parseCertificateFile(JSON.stringify(document), PATH, { expectations: against, validate: validateArmingCertificate });
  const verdictOf = (document: unknown, against = expectations): string => {
    const reading = read(document, against);
    return reading.known ? reading.value.verdict : `unknown: ${reading.reason}`;
  };

  it("reads PASS for a certificate the runtime's validator accepts", () => {
    expect(real.verdict).toBe("PASS");
    expect(read(real)).toEqual({ known: true, value: { path: PATH, verdict: "PASS", digests: { runtimeDigest: real.runtimeDigest, policyDigest: real.policyDigest }, violations: [] } });
  });

  it("never reads PASS for a document whose flat fields merely say so (review 2026-09-14, point 1)", () => {
    expect(verdictOf({ schemaVersion: 2, role: "dev", verdict: "PASS", runtimeDigest: real.runtimeDigest, policyDigest: real.policyDigest })).toBe("REJECTED");
    const fill = real.evidence.fill;
    if (fill === null) throw new Error("fixture certificate has no fill evidence");
    expect(verdictOf({ ...real, evidence: { ...real.evidence, fill: { ...fill, filledQuantity: fill.filledQuantity + 1 } } })).toBe("REJECTED");
    expect(verdictOf({ ...real, operatorNote: "checked by hand" })).toBe("REJECTED");
    expect(verdictOf({ ...real, tradingOrigin: "https://api.alpaca.markets" })).toBe("REJECTED");
    expect(verdictOf(real, { ...expectations, runtimeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" })).toBe("REJECTED");
    expect(verdictOf(real, { ...expectations, policyDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" })).toBe("REJECTED");
  });

  it("carries the validator's violations, and keeps a certificate that says FAIL a FAIL", () => {
    const edited = read({ ...real, operatorNote: "checked by hand" });
    expect(edited.known && edited.value.violations).toContain("certificate schema mismatch: unexpected or missing fields");
    const failed = buildCertificate(inputs({ orderObservations: [] }));
    expect(verdictOf(failed, { ...expectations, runtimeDigest: failed.runtimeDigest, policyDigest: failed.policyDigest })).toBe("FAIL");
  });

  it("is unknown for a file that is not a dev certificate at all", () => {
    expect(parseCertificateFile("{\"schemaVersion\":2,", PATH, { expectations, validate: validateArmingCertificate }).known).toBe(false);
    expect(read({ ...real, schemaVersion: 1 }).known).toBe(false);
    expect(read({ ...real, role: "competition" }).known).toBe(false);
    expect(read({ ...real, verdict: "pass" }).known).toBe(false);
  });

  const report = (fields: Record<string, unknown>): string => JSON.stringify({ profile: "dev", accountId: "PA34…KZ1", mcpTools: 72, runtimeDigest: "sha256:r", policyDigest: "sha256:p", epoch: 3, ...fields }, null, 2);

  it("reads the report after the construction log, and requires the dev profile and an MCP inventory", () => {
    const stdout = `2026-09-21T13:40:00.000Z bound account\r\n2026-09-21T13:40:02.000Z runtimeDigest sha256:r policyDigest sha256:p; analyst inventory 72 tools\r\n${report({}).replace(/\n/g, "\r\n")}\r\n`;
    expect(parsePreflightOutput(stdout)).toEqual({ known: true, value: { digests: { runtimeDigest: "sha256:r", policyDigest: "sha256:p" }, mcpTools: 72 } });
    expect(parsePreflightOutput(report({ profile: "competition" })).known).toBe(false);
    expect(parsePreflightOutput(report({ mcpTools: 0 })).known).toBe(false);
    expect(parsePreflightOutput("refused at analyst: CLAUDE_CODE_OAUTH_TOKEN is not set\n")).toEqual({ known: false, reason: "preflight printed no report" });
  });
});

describe("parse — the confirmation of gate condition 4", () => {
  const perCheck = (iso: string): Record<string, string> => ({ liveness: iso, readiness: iso, watchdog: iso });
  const line = (fields: Record<string, unknown>): string => JSON.stringify({
    operator: "felix",
    alertReceivedAt: perCheck("2026-09-11T22:02:00+02:00"),
    bundledAlert: true,
    reminderReceivedAt: "2026-09-12T00:58:00+02:00",
    reminderListed: ["liveness", "readiness", "watchdog"],
    fingerprints: { liveness: "hc:a685fe10", readiness: "hc:c4ad5b69", watchdog: "hc:b76072aa" },
    downFlips: perCheck("2026-09-11T22:01:00+02:00"),
    crossCheck: "passed",
    ...fields,
  });

  it("reads the latest line with every receipt, the reminder's list and the assigned down flips", () => {
    const alert = Date.UTC(2026, 8, 11, 20, 2);
    const down = Date.UTC(2026, 8, 11, 20, 1);
    expect(parseAlertConfirmations(`${line({ operator: "earlier" })}\n${line({})}\n`)).toEqual({
      known: true,
      value: {
        operator: "felix",
        alertReceivedUtcMs: { liveness: alert, readiness: alert, watchdog: alert },
        bundledAlert: true,
        reminderReceivedUtcMs: Date.UTC(2026, 8, 11, 22, 58),
        reminderListed: ["liveness", "readiness", "watchdog"],
        fingerprints: { liveness: "hc:a685fe10", readiness: "hc:c4ad5b69", watchdog: "hc:b76072aa" },
        downFlipUtcMs: { liveness: down, readiness: down, watchdog: down },
      },
    });
    expect(parseAlertConfirmations("")).toEqual({ known: true, value: null });
  });

  it("does not fall back to an older line when the latest is malformed", () => {
    expect(parseAlertConfirmations(`${line({})}\n{"operator":`).known).toBe(false);
  });

  const refused: readonly (readonly [string, Record<string, unknown>])[] = [
    ["a failed cross-check", { crossCheck: "failed" }],
    ["one alert time for three checks without the checks named", { alertReceivedAt: "2026-09-11T22:02:00+02:00" }],
    ["no statement whether the alert was one mail", { bundledAlert: "yes" }],
    ["an unzoned reminder time", { reminderReceivedAt: "2026-09-12T00:58:00" }],
    ["a down flip missing for one check", { downFlips: { liveness: "2026-09-11T22:01:00+02:00", readiness: "2026-09-11T22:01:00+02:00" } }],
    ["a reminder listing something that is not a check", { reminderListed: ["liveness", "everything"] }],
    ["a reminder list that is not a list", { reminderListed: "all three" }],
    ["a fingerprint that is a UUID", { fingerprints: { liveness: "c4ad5b69-0000-4000-8000-000000000000", readiness: "hc:c4ad5b69", watchdog: "hc:b76072aa" } }],
    ["a missing operator", { operator: " " }],
  ];
  for (const [name, fields] of refused) {
    it(`refuses ${name}`, () => {
      expect(parseAlertConfirmations(line(fields)).known).toBe(false);
    });
  }
});
