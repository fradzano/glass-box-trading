// The live-token probe (owner ruling 2026-09-14; the owner's review the same day,
// point 4).
//
// `buildRuntime` checks CLAUDE_CODE_OAUTH_TOKEN for presence only
// (`src/shell/agent-runtime.ts:428`), so a token that died after step 0 would arm a
// run whose every analyst call fails. This probe proves the token works now, under
// the conditions the analyst runs in: the same pinned Agent SDK `query`, the
// configured ANALYST_MODEL, one turn, no tools, no settings, a hard deadline, and the
// environment `src/shell/analyst-claude.ts` constructs — the token and the OS
// necessities, never ANTHROPIC_API_KEY, so that a key in the operator's environment
// cannot stand in for a dead token.
//
// Success is a `result` message of subtype `success` with `is_error` false. The SDK
// reports a turn that ended on an API error as `success` with `is_error` true, so the
// subtype alone is not a success. The reply text proves nothing and is never kept.
// Outwardly there is only `ok` or a normalised failure class that carries no text
// from the SDK, so no credential can travel through it.
//
// The `query` function is handed in: the shell passes the SDK's own, the tests a
// fake. Messages are read by shape, so this module names no SDK type it has not seen.

export type ProbeOutcome = { readonly ok: true } | { readonly ok: false; readonly failureClass: string };

export interface ProbeQueryOptions {
  readonly model: string;
  readonly systemPrompt: string;
  readonly tools: string[];
  readonly allowedTools: string[];
  readonly permissionMode: "dontAsk";
  readonly maxTurns: number;
  readonly cwd: string;
  readonly settingSources: [];
  readonly env: Record<string, string>;
  readonly abortController: AbortController;
}

export type ProbeQuery = (request: { readonly prompt: string; readonly options: ProbeQueryOptions }) => AsyncIterable<unknown>;

export interface ProbeInput {
  readonly query: ProbeQuery;
  readonly model: string;
  readonly oauthToken: string;
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  readonly deadlineMs: number;
  /** An empty working directory: the probe reads no project files and no settings. */
  readonly cwd: string;
}

function fail(failureClass: string): ProbeOutcome {
  return { ok: false, failureClass };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The OS variables `analyst-claude.ts` passes through, and nothing that could carry another credential. */
function osVariableNames(): readonly string[] {
  return ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "SystemDrive", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "COMSPEC", "ComSpec", "PATHEXT", "PROGRAMDATA", "ProgramData", "USERNAME", "HOME"];
}

/** The probe's environment, built from nothing: the token, the client markers the analyst sets, the OS necessities. */
export function probeEnvironment(oauthToken: string, processEnv: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = { CLAUDE_CODE_OAUTH_TOKEN: oauthToken, CLAUDE_AGENT_SDK_CLIENT_APP: "glass-box-trading/0.1.0", DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1" };
  for (const name of osVariableNames()) {
    const value = processEnv[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/** One `result` message, reduced to `ok` or a class. Only closed values of the SDK's own fields enter the class. */
export function classifyResultMessage(message: Readonly<Record<string, unknown>>): ProbeOutcome {
  const subtype = message["subtype"];
  if (subtype === "success") {
    if (message["is_error"] === false) return { ok: true };
    const status = message["api_error_status"];
    if (status === 401 || status === 403) return fail("AUTH_REJECTED");
    if (status === 429) return fail("RATE_LIMITED");
    if (typeof status === "number" && status >= 500) return fail("API_UNAVAILABLE");
    return fail("API_ERROR");
  }
  if (subtype === "error_during_execution" || subtype === "error_max_turns" || subtype === "error_max_budget_usd" || subtype === "error_max_structured_output_retries") {
    return fail(`RESULT_${subtype.toUpperCase()}`);
  }
  return fail("RESULT_UNRECOGNISED");
}

const PROBE_PROMPT = "Reply with the single word: ok";

export async function runAnalystProbe(input: ProbeInput): Promise<ProbeOutcome> {
  if (input.oauthToken.length === 0) return fail("TOKEN_ABSENT");
  const abort = new AbortController();
  const timer = setTimeout(() => { abort.abort(); }, input.deadlineMs);
  let outcome: ProbeOutcome | null = null;
  try {
    const messages = input.query({
      prompt: PROBE_PROMPT,
      options: {
        model: input.model,
        systemPrompt: "Answer in one word.",
        tools: [],
        allowedTools: [],
        permissionMode: "dontAsk",
        maxTurns: 1,
        cwd: input.cwd,
        settingSources: [],
        env: probeEnvironment(input.oauthToken, input.processEnv),
        abortController: abort,
      },
    });
    for await (const message of messages) {
      if (isRecord(message) && message["type"] === "result") outcome = classifyResultMessage(message);
    }
  } catch {
    return abort.signal.aborted ? fail("TIMEOUT") : fail("SDK_ERROR");
  } finally {
    clearTimeout(timer);
  }
  if (abort.signal.aborted) return fail("TIMEOUT");
  return outcome ?? fail("NO_RESULT");
}
