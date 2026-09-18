// Configuration assembly for a real run (P7). The role-neutral policy is a
// tracked JSON document (`config/policy.json`, the O5 values); the identity
// fields come from the environment for the selected role; the deployment
// locations come from the environment too. Credentials never enter the raw
// configuration record — they are handed to the adapters separately and
// registered as secrets for journal redaction. Missing is indistinguishable
// from wrong: everything lands in the S-CYC-11 validator as-is.
import { readFileSync } from "node:fs";
import path from "node:path";

export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** The values a `.env` yields, and the ambiguity the plain reader would otherwise hide. */
export interface DotEnvEntries {
  /** Last assignment of a key wins, which is what the runtime reads. */
  readonly values: Readonly<Record<string, string>>;
  /** Keys assigned on more than one line, in first-seen order. */
  readonly duplicateKeys: readonly string[];
}

/**
 * A minimal `.env` reader: `KEY=value` lines, `#` comments, optional
 * single/double quotes. Reports what it had to resolve as well as the result,
 * so that a caller who must not guess does not have to.
 */
export function parseDotEnvEntries(text: string): DotEnvEntries {
  const out: Record<string, string> = {};
  const duplicates: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (Object.prototype.hasOwnProperty.call(out, key) && !duplicates.includes(key)) duplicates.push(key);
    out[key] = value;
  }
  return { values: out, duplicateKeys: duplicates };
}

/**
 * A minimal `.env` reader: `KEY=value` lines, `#` comments, optional
 * single/double quotes. Existing process variables win. Last-one-wins on a
 * duplicated key is deliberate and load-bearing: the activation's observer is
 * held to reading exactly what the runtime reads
 * (`ops/activation/tests/parse.spec.ts`), and it is that observer, not this
 * function, that reports the duplicate as a red.
 */
export function parseDotEnv(text: string): Readonly<Record<string, string>> {
  return parseDotEnvEntries(text).values;
}

/** What reading `.env` actually found. "Absent" and "unreadable" are different facts, and a guard may not confuse them. */
export type DotEnvRead =
  | { readonly kind: "parsed"; readonly entries: DotEnvEntries }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly code: string };

/**
 * The `.env` file alone, without process variables, with the failure kept.
 * A file that exists but cannot be read at this instant — an editor's
 * exclusive lock, a permission bit, a transient I/O error — must not be
 * indistinguishable from a host that has no `.env`.
 */
export function readDotEnvStrict(repoRoot: string): DotEnvRead {
  try {
    return { kind: "parsed", entries: parseDotEnvEntries(readFileSync(path.join(repoRoot, ".env"), "utf8")) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return code === "ENOENT" ? { kind: "absent" } : { kind: "unreadable", code };
  }
}

/** The `.env` file alone, without process variables; an absent or unreadable file reads as empty. */
export function readDotEnv(repoRoot: string): Readonly<Record<string, string>> {
  const read = readDotEnvStrict(repoRoot);
  return read.kind === "parsed" ? read.entries.values : {};
}

/** The one merge rule: the file underneath, defined process variables on top. */
export function mergeEnvironment(dotEnvValues: Readonly<Record<string, string>>, processEnv: EnvRecord): EnvRecord {
  return { ...dotEnvValues, ...Object.fromEntries(Object.entries(processEnv).filter(([, value]) => value !== undefined)) };
}

export function loadEnvironment(repoRoot: string, processEnv: EnvRecord): EnvRecord {
  return mergeEnvironment(readDotEnv(repoRoot), processEnv);
}

export function loadPolicy(repoRoot: string): Readonly<Record<string, unknown>> {
  const parsed = JSON.parse(readFileSync(path.join(repoRoot, "config", "policy.json"), "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("config/policy.json is not an object");
  return parsed as Readonly<Record<string, unknown>>;
}

export interface RoleCredentials {
  readonly keyId: string;
  readonly secretKey: string;
  readonly expectedAccountId: string;
}

/** The credential block of one role; an unknown or unset profile yields nothing usable and the validator refuses to arm. */
export function roleCredentials(env: EnvRecord, profile: string): RoleCredentials {
  const prefix = profile === "competition" ? "ALPACA_COMP_" : "ALPACA_DEV_";
  return {
    keyId: env[`${prefix}KEY_ID`] ?? "",
    secretKey: env[`${prefix}SECRET_KEY`] ?? "",
    expectedAccountId: env[`${prefix}ACCOUNT_ID`] ?? "",
  };
}

/** The raw §0 record the S-CYC-11 validator sees: policy + identity + deployment, nothing else. */
export function rawStartupConfig(policy: Readonly<Record<string, unknown>>, env: EnvRecord): Readonly<Record<string, unknown>> {
  const profile = env["ALPACA_PROFILE"];
  const credentials = roleCredentials(env, profile ?? "");
  const raw: Record<string, unknown> = { ...policy };
  if (profile !== undefined) raw["ALPACA_PROFILE"] = profile;
  if (credentials.expectedAccountId.length > 0) raw["EXPECTED_ACCOUNT_ID"] = credentials.expectedAccountId;
  if (env["STATE_DIR"] !== undefined) raw["STATE_DIR"] = env["STATE_DIR"];
  if (env["BOOTSTRAP_DIAGNOSTIC_SINK"] !== undefined) raw["BOOTSTRAP_DIAGNOSTIC_SINK"] = env["BOOTSTRAP_DIAGNOSTIC_SINK"];
  if (env["PRE_ARM_CERTIFICATE"] !== undefined) raw["PRE_ARM_CERTIFICATE"] = env["PRE_ARM_CERTIFICATE"];
  raw["ANALYST_MODEL"] = env["ANALYST_MODEL"] ?? "claude-sonnet-5";
  return raw;
}

/** Every value the journal must never carry: both roles' keys, the analyst token, the ping URL. */
export function secretValues(env: EnvRecord): readonly string[] {
  const names = ["ALPACA_DEV_KEY_ID", "ALPACA_DEV_SECRET_KEY", "ALPACA_COMP_KEY_ID", "ALPACA_COMP_SECRET_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "HEALTHCHECK_PING_URL"];
  return names.map(name => env[name] ?? "").filter(value => value.length > 0);
}

export interface AnalystEnvironmentPaths {
  readonly root: string;
  readonly site: string;
  readonly source: string;
  readonly runtime: string;
  readonly launcher: string;
}

/** Where the dedicated, pinned MCP environment lives; deployment-local like STATE_DIR, validated by the launcher, never by trust. */
export function analystEnvironmentPaths(env: EnvRecord): AnalystEnvironmentPaths | null {
  const root = env["ANALYST_MCP_ENVIRONMENT_ROOT"];
  const runtime = env["ANALYST_PYTHON_RUNTIME"];
  const launcher = env["ANALYST_PYTHON_LAUNCHER"];
  if (root === undefined || runtime === undefined || launcher === undefined) return null;
  return { root, site: path.join(root, "site"), source: path.join(root, "src"), runtime, launcher };
}
