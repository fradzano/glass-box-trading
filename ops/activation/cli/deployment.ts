// The deployment facts an attempt does not derive (unit 10).
//
// These are measurements, not constants: the host preconditions of spec §3 were read off
// this machine on 2026-09-12, and the long-run account's masked id belongs to an account
// that was created by hand. Inventing either of them in source would produce a gate that
// can never turn green — or, worse, one that turns green against the wrong account — so
// they live in a file that the host produced, and this module only parses it.
//
// Nothing in here is a credential: a masked account id, a coverage date and a handful of
// registry values. The file is readable, diffable and belongs to the deployment, which is
// the same reason the ledger is JSONL rather than a database.
import type { DeploymentFacts } from "./schedule.ts";

export type ParsedDeployment =
  | { readonly ok: true; readonly facts: DeploymentFacts }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValues(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return null;
    result[key] = item;
  }
  return result;
}

function refuse(reason: string): ParsedDeployment {
  return { ok: false, reason };
}

/**
 * The deployment file, by value. Every field is required and every refusal names the
 * field: a half-read deployment would put a plausible-looking wrong expectation in front
 * of the core, which compares it without ever asking where it came from.
 */
export function parseDeploymentFacts(text: string, repoRoot: string, activationRoot: string): ParsedDeployment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return refuse("the deployment file is not JSON");
  }
  if (!isRecord(parsed)) return refuse("the deployment file is not a JSON object");

  const account = parsed["longRunAccountMasked"];
  if (typeof account !== "string" || account.trim().length === 0) return refuse("longRunAccountMasked is missing");
  const coverage = parsed["coverageThroughDate"];
  if (typeof coverage !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(coverage)) return refuse("coverageThroughDate is missing or is not YYYY-MM-DD");
  const disk = parsed["minFreeDiskBytes"];
  if (typeof disk !== "number" || !Number.isSafeInteger(disk) || disk <= 0) return refuse("minFreeDiskBytes is missing or is not a positive whole number of bytes");
  const preconditions = textValues(parsed["expectedHostPreconditions"]);
  if (preconditions === null) return refuse("expectedHostPreconditions is missing or is not an object of text values");
  if (Object.keys(preconditions).length === 0) return refuse("expectedHostPreconditions is empty, so step 0 would compare against nothing");

  return { ok: true, facts: { repoRoot, activationRoot, longRunAccountMasked: account, coverageThroughDate: coverage, expectedHostPreconditions: preconditions, minFreeDiskBytes: disk } };
}
