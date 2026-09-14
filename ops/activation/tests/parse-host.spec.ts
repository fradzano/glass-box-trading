// Unit 7, the parsers behind the host readers. Where this host could produce the input, the
// fixture is its real output, taken read-only on 2026-09-14 by ops/activation/readers/host/*.ps1:
// the host preconditions, the empty environment shadow, the certificate directory's names. The
// journal's first entry is judged by the runtime's own codec, not by a copy of its schema.
import { describe, expect, it } from "vitest";
import { parseJournalText } from "../../../src/core/journal.ts";
import { passingJournal } from "../../../tests/arm01-fixtures.ts";
import { parseEnv } from "../readers/parse.ts";
import { analystObservation, expectedNodePath, latestCertificateName, maskAccountId, parseEnvironmentShadow, parseHostPreconditions, parseIndependentRead, parseJournalHead, parseSessionSampleLog, sessionSampleLine } from "../readers/parse-host.ts";

/** `host/read-preconditions.ps1` on this host, 2026-09-14, unelevated. ARSO is still active (absent), as spec §3 measured. */
const HOST_PRECONDITIONS = "{\"SleepAcSeconds\":\"0\",\"HibernateAcSeconds\":\"0\",\"HiberbootEnabled\":\"0\",\"ActiveHoursStart\":\"9\",\"ActiveHoursEnd\":\"3\",\"AutoAdminLogon\":\"0\",\"DisableAutomaticRestartSignOn\":\"absent\",\"ShutdownPrivilege\":\"present\",\"AdministratorsMember\":\"yes\"}\r\n";

/** `host/read-environment.ps1` on this host, 2026-09-14: none of the three keys is set outside .env. */
const HOST_ENVIRONMENT = "{\"user\":{},\"machine\":{}}\r\n";

describe("parse-host — host preconditions", () => {
  it("reads this host's preconditions as text, name by name", () => {
    expect(parseHostPreconditions(HOST_PRECONDITIONS)).toEqual({
      known: true,
      value: { SleepAcSeconds: "0", HibernateAcSeconds: "0", HiberbootEnabled: "0", ActiveHoursStart: "9", ActiveHoursEnd: "3", AutoAdminLogon: "0", DisableAutomaticRestartSignOn: "absent", ShutdownPrivilege: "present", AdministratorsMember: "yes" },
    });
    expect(parseHostPreconditions(`${String.fromCharCode(0xfeff)}${HOST_PRECONDITIONS}`).known).toBe(true);
  });

  it("refuses a value that is not text, an empty object and output that is not JSON", () => {
    expect(parseHostPreconditions("{\"HiberbootEnabled\":0}")).toEqual({ known: false, reason: "host preconditions are not an object of text values" });
    expect(parseHostPreconditions("{}")).toEqual({ known: false, reason: "host preconditions are empty" });
    expect(parseHostPreconditions("host preconditions unreadable: NotSpecified")).toEqual({ known: false, reason: "host preconditions are not JSON" });
    expect(parseHostPreconditions("[\"0\"]").known).toBe(false);
  });
});

describe("parse-host — the environment outside .env", () => {
  it("reads this host's empty shadow, and a set key feeds parseEnv's shadowed keys", () => {
    expect(parseEnvironmentShadow(HOST_ENVIRONMENT)).toEqual({ known: true, value: { user: {}, machine: {} } });
    const shadow = parseEnvironmentShadow("{\"user\":{\"PRE_ARM_CERTIFICATE\":\"C:\\\\old.json\"},\"machine\":{\"ALPACA_PROFILE\":\"dev\"}}");
    expect(shadow.known).toBe(true);
    if (!shadow.known) return;
    expect(parseEnv({ dotEnvText: "ALPACA_PROFILE=competition\n", sha256: "h", userEnvironment: shadow.value.user, machineEnvironment: shadow.value.machine })).toMatchObject({ certificatePath: "C:\\old.json", profile: "dev", shadowedKeys: ["PRE_ARM_CERTIFICATE", "ALPACA_PROFILE"] });
  });

  it("refuses a key it did not ask for without repeating its value, a missing scope and a value that is not text", () => {
    const leaking = parseEnvironmentShadow("{\"user\":{\"CLAUDE_CODE_OAUTH_TOKEN\":\"sk-ant-oat01-test-only\"},\"machine\":{}}");
    expect(leaking).toEqual({ known: false, reason: "environment reading carries a key it was not asked for" });
    expect(JSON.stringify(leaking)).not.toContain("sk-ant");
    expect(parseEnvironmentShadow("{\"user\":{}}").known).toBe(false);
    expect(parseEnvironmentShadow("{\"user\":{\"STATE_DIR\":1},\"machine\":{}}").known).toBe(false);
  });
});

describe("parse-host — accounts", () => {
  it("masks an account number to its first four and last three characters", () => {
    expect(maskAccountId("PA349COOGKZ1")).toEqual({ known: true, value: "PA34…KZ1" });
  });

  it("refuses anything that is not an account number, and never repeats it", () => {
    for (const text of ["", "pa349coogkz1", "PA34 9COOGKZ1", "unauthorized", "PA3", "0f6c1b2e-0000-4000-8000-000000000001"]) {
      const reading = maskAccountId(text);
      expect(reading.known, text).toBe(false);
      if (text.length > 3) expect(JSON.stringify(reading)).not.toContain(text);
    }
  });
});

describe("parse-host — the session sample log", () => {
  const sample = { utcMs: Date.UTC(2026, 8, 22, 11, 55), local: { date: "2026-09-22", minute: 13 * 60 + 55 }, interactiveSessions: 0, explorerProcesses: 0 };

  it("reads back what it writes, with the local time derived again", () => {
    const later = { ...sample, utcMs: Date.UTC(2026, 8, 22, 12, 5), local: { date: "2026-09-22", minute: 14 * 60 + 5 }, interactiveSessions: 1, explorerProcesses: 1 };
    expect(parseSessionSampleLog(`${sessionSampleLine(sample)}${sessionSampleLine(later)}`)).toEqual([sample, later]);
    expect(parseSessionSampleLog("")).toEqual([]);
  });

  it("reads nothing at all when one line does not read, so step 9 cannot prove from a partial log", () => {
    expect(parseSessionSampleLog(`${sessionSampleLine(sample)}{"utcMs":`)).toEqual([]);
    expect(parseSessionSampleLog(`${sessionSampleLine(sample)}{"utcMs":1,"interactiveSessions":-1,"explorerProcesses":0}\n`)).toEqual([]);
    expect(parseSessionSampleLog(`{"utcMs":1,"interactiveSessions":0}\n${sessionSampleLine(sample)}`)).toEqual([]);
  });
});

describe("parse-host — the long-run journal's first entry", () => {
  const bootstrap = { seq: 1, at: "2026-09-22T13:15:20.000Z", epoch: 1, type: "BOOTSTRAP", epochSeeded: true, snapshot: { accountId: "TEST_ONLY_ACCOUNT", snapshotAt: "2026-09-22T13:15:19.000Z", cashCents: 10_000_000, equityCents: 10_000_000, positions: [], openOrders: [], quoteSamples: {} } };

  it("reads a BOOTSTRAP entry through the runtime's own codec", () => {
    expect(parseJournalHead(JSON.stringify(bootstrap), parseJournalText)).toEqual({ known: true, value: { seq: 1, utcMs: Date.UTC(2026, 8, 22, 13, 15, 20) } });
  });

  it("keeps a syntactically complete first journal line torn when the file had no LF terminator", () => {
    const line = JSON.stringify(bootstrap);
    const parseWithBoundary = parseJournalHead as unknown as (text: string, codec: typeof parseJournalText, terminated: boolean) => unknown;
    expect(parseWithBoundary(line, parseJournalText, false)).toEqual({ known: false, reason: "the journal's first line is not LF-terminated" });
    expect(parseWithBoundary(line, parseJournalText, true)).toMatchObject({ known: true, value: { seq: 1 } });
  });

  it("reads no journal and an empty one as not started", () => {
    expect(parseJournalHead(null, parseJournalText)).toEqual({ known: true, value: null });
    expect(parseJournalHead("", parseJournalText)).toEqual({ known: true, value: null });
  });

  it("is unknown when the first entry is not a valid BOOTSTRAP", () => {
    // A schema-valid entry of another type, from the runtime's certificate fixtures: the codec accepts it, so only the type check can refuse it.
    const cycle = { ...passingJournal()[1], seq: 1 };
    expect(parseJournalText(`${JSON.stringify(cycle)}\n`).entries).toHaveLength(1);
    expect(parseJournalHead(JSON.stringify(cycle), parseJournalText)).toEqual({ known: false, reason: "the journal starts with CYCLE, not BOOTSTRAP" });
    expect(parseJournalHead(JSON.stringify({ ...bootstrap, epochSeeded: "yes" }), parseJournalText)).toEqual({ known: false, reason: "the journal's first line does not read as an entry" });
    expect(parseJournalHead("{\"seq\":1,", parseJournalText).known).toBe(false);
  });
});

describe("parse-host — certificates, the independent read, the analyst, the node", () => {
  it("picks the newest certificate by its name, from this host's evidence/pre-arm, and ignores other files", () => {
    expect(latestCertificateName(["2026-09-02T16-11-12-318Z.json", "2026-09-02T16-20-48-944Z.json"])).toBe("2026-09-02T16-20-48-944Z.json");
    expect(latestCertificateName(["2026-09-21T14-05-00-000Z.json", "zz-notes.json", "2026-09-22T00-00-00-000Z.json.bak", "2026-09-02T16-20-48-944Z.json"])).toBe("2026-09-21T14-05-00-000Z.json");
    expect(latestCertificateName(["README.md"])).toBeNull();
  });

  it("accepts the independent read only in the channel list's shape", () => {
    expect(parseIndependentRead("{\"channels\":[{\"name\":\"mail\"}]}")).toEqual({ known: true, value: true });
    expect(parseIndependentRead("{\"channels\":null}").known).toBe(false);
    expect(parseIndependentRead("<html>").known).toBe(false);
  });

  it("builds the analyst reading from token, preflight and probe, and keeps an unreadable preflight unknown", () => {
    const preflight = { known: true as const, value: { digests: { runtimeDigest: "sha256:r", policyDigest: "sha256:p" }, mcpTools: 32 } };
    expect(analystObservation(true, preflight, { ok: true })).toEqual({ known: true, value: { oauthTokenPresent: true, childStartVerified: true, tokenLive: true, tokenProbeClass: null } });
    expect(analystObservation(true, preflight, { ok: false, failureClass: "AUTH_REJECTED" })).toEqual({ known: true, value: { oauthTokenPresent: true, childStartVerified: true, tokenLive: false, tokenProbeClass: "AUTH_REJECTED" } });
    expect(analystObservation(false, { known: false, reason: "preflight printed no report" }, { ok: false, failureClass: "TOKEN_ABSENT" })).toEqual({ known: false, reason: "preflight: preflight printed no report" });
  });

  it("names the expected node only when it is this node, absolute, and the pinned version (review 2026-09-14, point 4)", () => {
    expect(expectedNodePath("C:\\Program Files\\nodejs\\node.exe", "v24.9.0", "24.9.0\r\n")).toEqual({ known: true, value: "C:\\Program Files\\nodejs\\node.exe" });
    expect(expectedNodePath("C:\\Program Files\\nodejs\\node.exe", "v24.10.0", "24.9.0")).toEqual({ known: false, reason: "this node is v24.10.0; the repository pins v24.9.0" });
    expect(expectedNodePath("node.exe", "v24.9.0", "24.9.0").known).toBe(false);
    expect(expectedNodePath("C:\\tools\\node24\\bin\\node", "v24.9.0", "24.9.0").known).toBe(false);
    expect(expectedNodePath("C:\\Program Files\\nodejs\\node.exe", "v24.9.0", "lts/jod")).toEqual({ known: false, reason: ".node-version does not name a version" });
  });
});
