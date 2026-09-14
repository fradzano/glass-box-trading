// The live-token probe (owner ruling and review, 2026-09-14, point 4). The SDK's
// `query` is replaced by a fake that records what it was asked and replays result
// messages shaped like the pinned SDK's `SDKResultSuccess` and `SDKResultError`
// (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`). The real call is exercised
// once on the host in unit 13, not here: a test may not spend the owner's quota.
import { describe, expect, it } from "vitest";
import { classifyResultMessage, probeEnvironment, runAnalystProbe } from "../readers/analyst-probe.ts";
import type { ProbeQuery } from "../readers/analyst-probe.ts";

type Request = Parameters<ProbeQuery>[0];

function replaying(messages: readonly unknown[], seen: { request: Request | null }): ProbeQuery {
  return request => {
    seen.request = request;
    return (async function* replay() {
      for (const message of messages) yield await Promise.resolve(message);
    })();
  };
}

const PROCESS_ENV = {
  PATH: "C:\\Windows\\System32",
  SystemRoot: "C:\\Windows",
  USERPROFILE: "C:\\Users\\felix",
  ANTHROPIC_API_KEY: "sk-ant-api03-test-only-must-not-pass",
  ANTHROPIC_AUTH_TOKEN: "test-only-must-not-pass",
  ALPACA_COMP_SECRET_KEY: "test-only-must-not-pass",
};

function probe(query: ProbeQuery, overrides: { readonly oauthToken?: string; readonly deadlineMs?: number } = {}): ReturnType<typeof runAnalystProbe> {
  return runAnalystProbe({ query, model: "claude-sonnet-5", oauthToken: overrides.oauthToken ?? "test-only-oauth-token", processEnv: PROCESS_ENV, deadlineMs: overrides.deadlineMs ?? 5_000, cwd: "C:\\probe-empty" });
}

const SUCCESS = { type: "result", subtype: "success", is_error: false, num_turns: 1, result: "ok", stop_reason: "end_turn" };

describe("analyst probe — what it asks and with what", () => {
  it("asks once, with the configured model, no tools, no settings, one turn, and a constructed environment", async () => {
    const seen: { request: Request | null } = { request: null };
    expect(await probe(replaying([SUCCESS], seen))).toEqual({ ok: true });
    const options = seen.request?.options;
    expect(options).toMatchObject({ model: "claude-sonnet-5", tools: [], allowedTools: [], settingSources: [], maxTurns: 1, permissionMode: "dontAsk", cwd: "C:\\probe-empty" });
    expect(options?.env).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: "test-only-oauth-token", CLAUDE_AGENT_SDK_CLIENT_APP: "glass-box-trading/0.1.0", DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1",
      PATH: "C:\\Windows\\System32", SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\felix",
    });
  });

  it("never passes an API key, an auth token or a broker secret through, whatever the process environment holds", () => {
    const env = probeEnvironment("t", PROCESS_ENV);
    expect(Object.keys(env)).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(JSON.stringify(env)).not.toContain("must-not-pass");
  });

  it("does not call the SDK at all without a token", async () => {
    const seen: { request: Request | null } = { request: null };
    expect(await probe(replaying([SUCCESS], seen), { oauthToken: "" })).toEqual({ ok: false, failureClass: "TOKEN_ABSENT" });
    expect(seen.request).toBeNull();
  });
});

describe("analyst probe — what counts as live", () => {
  const cases: readonly (readonly [string, readonly unknown[], string])[] = [
    ["a success subtype that ended on a 401", [{ ...SUCCESS, is_error: true, api_error_status: 401, result: "Invalid API key · Please run /login" }], "AUTH_REJECTED"],
    ["a success subtype that ended on a 403", [{ ...SUCCESS, is_error: true, api_error_status: 403 }], "AUTH_REJECTED"],
    ["a success subtype that ended on a 429", [{ ...SUCCESS, is_error: true, api_error_status: 429 }], "RATE_LIMITED"],
    ["a success subtype that ended on a 529", [{ ...SUCCESS, is_error: true, api_error_status: 529 }], "API_UNAVAILABLE"],
    ["a success subtype that ended on an API error without a status", [{ ...SUCCESS, is_error: true, api_error_status: null }], "API_ERROR"],
    ["a turn cut off at max turns", [{ type: "result", subtype: "error_max_turns", is_error: true, errors: [] }], "RESULT_ERROR_MAX_TURNS"],
    ["an execution error", [{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["spawn failed"] }], "RESULT_ERROR_DURING_EXECUTION"],
    ["a result subtype this SDK does not declare", [{ type: "result", subtype: "cancelled" }], "RESULT_UNRECOGNISED"],
    ["a session with no result message", [{ type: "assistant", message: { content: [] } }], "NO_RESULT"],
  ];
  for (const [name, messages, failureClass] of cases) {
    it(`is not live on ${name}`, async () => {
      expect(await probe(replaying(messages, { request: null }))).toEqual({ ok: false, failureClass });
    });
  }

  it("is not live when the SDK throws, and says SDK_ERROR without its message", async () => {
    const throwing: ProbeQuery = () => { throw new Error("spawn failed with CLAUDE_CODE_OAUTH_TOKEN=test-only-oauth-token"); };
    const outcome = await probe(throwing);
    expect(outcome).toEqual({ ok: false, failureClass: "SDK_ERROR" });
    expect(JSON.stringify(outcome)).not.toContain("test-only-oauth-token");
  });

  it("is not live when the deadline passes, and aborts the session", async () => {
    const seen: { aborted: boolean } = { aborted: false };
    const hanging: ProbeQuery = request => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<unknown>>((_resolve, reject) => {
          request.options.abortController.signal.addEventListener("abort", () => { seen.aborted = true; reject(new Error("aborted")); });
        }),
      }),
    });
    expect(await probe(hanging, { deadlineMs: 20 })).toEqual({ ok: false, failureClass: "TIMEOUT" });
    expect(seen.aborted).toBe(true);
  });

  it("carries no text of the SDK's in any class", () => {
    const outcome = classifyResultMessage({ type: "result", subtype: "error_during_execution", errors: ["token sk-ant-oat01-test-only leaked"] });
    expect(JSON.stringify(outcome)).not.toContain("sk-ant");
  });
});
