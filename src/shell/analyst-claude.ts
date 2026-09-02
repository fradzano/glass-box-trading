// The real analyst (P7): a Claude session through the Agent SDK whose only
// tools are the verified MCP child's read-only inventory, proxied in-process
// so the session never spawns anything itself and every call goes to the
// exact child the launcher accepted. The session has no file, shell, or web
// tools, loads no settings, and receives a constructed environment: the
// subscription token and the OS necessities, never a broker key. Its output
// is text; `parseAnalystOutput` in the core is the only validator, and the
// qualification brief and the observed market are carried in the prompt —
// never as gate parameters.
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DecisionConfig } from "../core/domain.js";
import type { AnalystInput } from "./cycle-runner.js";
import type { VerifiedChildHandle } from "./mcp-environment.js";

export interface ClaudeAnalystOptions {
  readonly child: VerifiedChildHandle;
  readonly oauthToken: string;
  readonly model: string;
  readonly decisionConfig: DecisionConfig;
  readonly workingDirectory: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** `certificate`: the supervised dev live test asks for one minimal, fillable credit vertical; `competition`: the ordinary brief. */
  readonly objective: "certificate" | "competition";
  readonly processEnv: Readonly<Record<string, string | undefined>>;
  /** Sessions remaining until an expiry (exclusive of today), from the shell's calendar; null when the expiry is outside the calendar window. */
  readonly sessionsUntil: (expiry: string) => number | null;
  readonly log?: (line: string) => void;
}

type ZodShape = Record<string, z.ZodType>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A permissive Zod shape from the child's JSON schema: the child validates its own arguments; the shape only tells the model what exists. */
function shapeFromJsonSchema(schema: unknown): ZodShape {
  const shape: ZodShape = {};
  if (!isRecord(schema) || !isRecord(schema["properties"])) return shape;
  const required = Array.isArray(schema["required"]) ? (schema["required"] as readonly unknown[]) : [];
  for (const [name, property] of Object.entries(schema["properties"])) {
    const type = isRecord(property) ? property["type"] : undefined;
    const description = isRecord(property) && typeof property["description"] === "string" ? property["description"] : "";
    let base: z.ZodType;
    if (type === "string") base = z.string();
    else if (type === "number" || type === "integer") base = z.number();
    else if (type === "boolean") base = z.boolean();
    else if (type === "array") base = z.array(z.unknown());
    else if (type === "object") base = z.record(z.string(), z.unknown());
    else base = z.unknown();
    const described = description.length > 0 ? base.describe(description) : base;
    shape[name] = required.includes(name) ? described : described.optional();
  }
  return shape;
}

function textOf(content: readonly unknown[]): string {
  return content.map(block => (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : JSON.stringify(block))).join("\n");
}

const SYSTEM_PROMPT = `You are the analyst of Glass Box Trading, a paper-trading agent whose deterministic risk core decides everything. You PROPOSE candidates; you never place orders, and nothing you write can widen a risk limit.

Output contract (strict, machine-validated, no prose outside the JSON):
{"candidates":[{"candidateId":"<unique string>","declaredStructureType":"vertical_credit|vertical_debit|iron_condor|long_option","sleeve":"income|convex","quantity":<positive integer lots>,"remainingTradingSessions":<integer sessions until expiry, from the table you are given>,"rationale":"<one or two sentences; MUST mention the underlying symbol and the declaredStructureType literally>","entryLimit":{"kind":"credit|debit","priceCents":<net premium per share in cents, non-negative integer>},"legs":[{"contractId":"<OCC symbol from the observed list>","underlying":"<symbol>","expiry":"YYYY-MM-DD","strikeCents":<integer>,"right":"call|put","side":"buy|sell","ratio":1}]}]}
An empty batch is {"candidates":[]} and is always acceptable.
Rules: use ONLY contracts from the observed list (others are vetoed for missing quotes); every structure must have a fixed maximum loss (verticals need equal quantities on both legs; a credit vertical sells the nearer strike and buys the farther one); the entryLimit kind must match the quotes (a net credit for a credit vertical); keep candidateIds unique; reply with the JSON object only.`;

function candidateBrief(objective: ClaudeAnalystOptions["objective"]): string {
  if (objective === "certificate") {
    return "Objective for this supervised DEV live test: propose exactly ONE 1-lot vertical_credit on SPY using near-the-money strikes with the tightest spreads and the largest quote sizes, width 1 to 3 dollars, expiry as near as the session bounds allow. Fillability matters more than premium: prefer a structure whose net credit is at least 10 cents so a limit slightly inside the mid fills. Nothing else.";
  }
  return "Objective: propose zero to two candidates that fit the sleeve budgets and liquidity; prefer abstaining over marginal structures.";
}

function marketTable(input: AnalystInput, sessionsUntil: (expiry: string) => number | null, maxRows: number): string {
  const byExpiry = new Map<string, string[]>();
  const sorted = [...input.market.contracts].sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.strikeCents - b.strikeCents));
  for (const contract of sorted) {
    if (contract.expiry === "1970-01-01") continue;
    const quote = input.market.quotesByContract[contract.contractId];
    if (quote === undefined) continue;
    const rows = byExpiry.get(contract.expiry) ?? [];
    rows.push(`${contract.contractId} ${contract.underlying} ${contract.right} strike=${String(contract.strikeCents)}c bid=${String(quote.bidCents)}c x${String(quote.bidSize)} ask=${String(quote.askCents)}c x${String(quote.askSize)}`);
    byExpiry.set(contract.expiry, rows);
  }
  const lines: string[] = [];
  let total = 0;
  for (const [expiry, rows] of byExpiry) {
    lines.push(`# expiry ${expiry} remainingTradingSessions=${String(sessionsUntil(expiry) ?? "unknown")}`);
    for (const row of rows) {
      if (total < maxRows) lines.push(row);
      total += 1;
    }
  }
  if (total > maxRows) lines.push(`... (${String(total - maxRows)} more contracts omitted)`);
  return lines.join("\n");
}

export function createClaudeAnalyst(options: ClaudeAnalystOptions): (input: AnalystInput) => Promise<string> {
  const log = options.log ?? (() => undefined);
  const config = options.decisionConfig;
  let toolsPromise: Promise<readonly SdkMcpToolDefinition<ZodShape>[]> | null = null;

  async function proxiedTools(): Promise<readonly SdkMcpToolDefinition<ZodShape>[]> {
    const definitions = await options.child.listToolDefinitions();
    return definitions.map(definition => tool(definition.name, definition.description.length === 0 ? definition.name : definition.description, shapeFromJsonSchema(definition.inputSchema), async (args: Record<string, unknown>) => {
      const result = await options.child.callTool(definition.name, args);
      return { content: [{ type: "text" as const, text: textOf(result.content) }], isError: result.isError };
    }, { annotations: { readOnlyHint: true } }));
  }

  function childEnvironment(): Record<string, string> {
    const out: Record<string, string> = { CLAUDE_CODE_OAUTH_TOKEN: options.oauthToken, CLAUDE_AGENT_SDK_CLIENT_APP: "glass-box-trading/0.1.0", DISABLE_TELEMETRY: "1", DISABLE_AUTOUPDATER: "1" };
    for (const name of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "SystemDrive", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "COMSPEC", "ComSpec", "PATHEXT", "PROGRAMDATA", "ProgramData", "USERNAME", "HOME"]) {
      const value = options.processEnv[name];
      if (value !== undefined) out[name] = value;
    }
    return out;
  }

  return async (input: AnalystInput): Promise<string> => {
    toolsPromise ??= proxiedTools();
    const tools = await toolsPromise;
    const server = createSdkMcpServer({ name: "alpaca", version: "2.3.0", tools: [...tools] });
    const spotLine = Object.entries(input.market.spotCentsByUnderlying).map(([symbol, cents]) => `${symbol}=${String(cents)}c`).join(", ");
    const prompt = [
      `Trading day ${input.tradingDay}, cycle ${String(input.cycleIndex)}. Universe: ${input.underlyings.join(", ")}. Spot (cents): ${spotLine}.`,
      `Policy bounds the core will enforce: structures ${config.structureWhitelist.join("|")}; remainingTradingSessions in [${String(config.expiryMinSessions)}, ${String(config.expiryMaxSessions)}]; max quantity ${String(config.maxCandidateQuantity)}; max strike distance ${String(config.maxStrikeDistanceBps)} bps of spot; income budget ${String(config.incomeBudgetCents)}c, convex budget ${String(config.convexBudgetCents)}c; per-position cap ${String(config.maxLossPerPositionBps)} bps of the sleeve.`,
      `Qualification brief (S-CYC-12): ${JSON.stringify(input.qualification)}${input.qualification.active ? " — while this brief is active the core admits at most ONE live qualification lifecycle of exactly ONE lot (quantity 1) with reservedMaxLoss at or below maxLossCents; any other quantity is vetoed after the gates, so prefer one liquid, fillable one-lot structure over size." : ""}`,
      candidateBrief(options.objective),
      "Observed contracts with live quotes (cents; sizes in contracts). remainingTradingSessions per expiry is given in the header of each expiry group:",
      marketTable(input, options.sessionsUntil, 400),
      "You may call the alpaca tools for additional read-only context (chains, snapshots, calendar). Then answer with the JSON object only.",
    ].join("\n\n");
    const abort = new AbortController();
    const timer = setTimeout(() => { abort.abort(); }, options.timeoutMs);
    let finalText = "";
    let failure: string | null = null;
    try {
      for await (const message of query({
        prompt,
        options: {
          model: options.model,
          systemPrompt: SYSTEM_PROMPT,
          tools: [],
          mcpServers: { alpaca: server },
          allowedTools: ["mcp__alpaca__*"],
          permissionMode: "dontAsk",
          maxTurns: options.maxTurns,
          cwd: options.workingDirectory,
          settingSources: [],
          env: childEnvironment(),
          abortController: abort,
        },
      })) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") log(`analyst tool ${block.name}`);
          }
        }
        if (message.type === "result") {
          if (message.subtype === "success") finalText = message.result;
          else failure = message.subtype;
          log(`analyst result ${message.subtype} turns=${String(message.num_turns)} cost=${String(message.total_cost_usd)}`);
        }
      }
    } finally {
      clearTimeout(timer);
    }
    if (failure !== null) throw new Error(`analyst session ended without a result: ${failure}`);
    // The JSON object must be the whole answer. Prefixes, fences and suffixes stay present so the core's
    // structural parser rejects them; the shell never repairs an analyst protocol violation.
    return finalText;
  };
}
