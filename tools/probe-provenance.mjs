// Read-only: does an account satisfy the S-CYC-09 provenance proof?
//
// `node tools/probe-provenance.mjs [dev|competition]`
//
// The proof is what decides whether an account may be armed under the
// competition profile, and it is strict on purpose: paper role, the expected
// account id, creation at or after COMPETITION_START, opening cash AND equity
// at exactly INITIAL_CAPITAL, zero positions, zero non-terminal orders, an
// order and fill history that are complete and empty from creation, and an
// activity ledger carrying nothing but opening funding journals.
//
// Until now the only way to learn the verdict was to arm and watch the cycle
// refuse -- which happens on the anchor day, after the certificate and the
// whole activation gate, and which leaves a sticky PROVENANCE_BROKEN mark
// behind. This asks the same question through the same pure function, days
// earlier, and writes nothing at all: no order, no journal entry, no state
// file. It is safe to run at any time and as often as you like.
//
// It exists because reusing an existing account was proposed, and a reset
// paper account either satisfies the proof or does not -- that is an
// empirical question about the broker, not one to reason about.
import { createAlpacaBroker } from "../dist/shell/alpaca-broker.js";
import { loadEnvironment, loadPolicy, roleCredentials } from "../dist/shell/runtime-config.js";
import { MARKET_DATA_ORIGIN } from "../dist/shell/agent-runtime.js";
import { validateCompetitionProvenance } from "../dist/core/lifecycle.js";
import { utcIsoToEpochMs } from "../dist/core/execution.js";

const requested = process.argv[2] ?? null;

const env = loadEnvironment(process.cwd(), process.env);
const policy = loadPolicy(process.cwd());
const profile = requested ?? env["ALPACA_PROFILE"] ?? "dev";
if (profile !== "dev" && profile !== "competition") {
  process.stderr.write(`profile must be 'dev' or 'competition', not '${profile}'\n`);
  process.exit(2);
}

const credentials = roleCredentials(env, profile);
if (credentials.keyId.length === 0 || credentials.secretKey.length === 0) {
  process.stderr.write(`no credentials for the ${profile} role in .env (ALPACA_${profile === "dev" ? "DEV" : "COMP"}_KEY_ID / _SECRET_KEY)\n`);
  process.exit(2);
}

const tradingOrigin = String(policy["ALPACA_TRADING_ORIGIN"]);
const dataOrigin = MARKET_DATA_ORIGIN;
const expectedAccountId = env[profile === "dev" ? "ALPACA_DEV_ACCOUNT_ID" : "ALPACA_COMP_ACCOUNT_ID"] ?? "";

const broker = createAlpacaBroker({
  credentials: { keyId: credentials.keyId, secretKey: credentials.secretKey },
  tradingOrigin,
  dataOrigin,
  clock: () => Date.now(),
  requestTimeoutMs: 30_000,
});

let bundle;
try {
  bundle = await broker.provenanceBundle();
} catch (error) {
  process.stderr.write(`the provenance read failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write("A 401 or 403 here means the credentials are wrong for this profile; nothing was written.\n");
  process.exit(1);
}

const competitionStartIso = String(policy["COMPETITION_START"]);
const expectations = {
  expectedAccountId: expectedAccountId.length > 0 ? expectedAccountId : String(bundle.accountId ?? ""),
  competitionStartMs: utcIsoToEpochMs(competitionStartIso),
  initialCapitalCents: Number(policy["INITIAL_CAPITAL_CENTS"]),
};

const money = cents => `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

process.stdout.write(`profile            ${profile}\n`);
process.stdout.write(`account id         ${String(bundle.accountId ?? "(none)")}${expectedAccountId.length > 0 && bundle.accountId !== expectedAccountId ? "   <-- differs from EXPECTED_ACCOUNT_ID in .env" : ""}\n`);
process.stdout.write(`account role       ${String(bundle.accountRole ?? "(none)")}\n`);
process.stdout.write(`created at         ${String(bundle.createdAt ?? "(none)")}\n`);
process.stdout.write(`COMPETITION_START  ${competitionStartIso}\n`);
process.stdout.write(`opening cash       ${money(bundle.openingCashCents)}   (must be exactly ${money(expectations.initialCapitalCents)})\n`);
process.stdout.write(`opening equity     ${money(bundle.openingEquityCents)}   (must be exactly ${money(expectations.initialCapitalCents)})\n`);
process.stdout.write(`positions          ${String(bundle.positionCount)}\n`);
process.stdout.write(`non-terminal orders${String(bundle.nonTerminalOrderCount).padStart(2)}\n`);
process.stdout.write(`order history      ${String(bundle.orderHistory?.items ?? "?")} item(s), complete=${String(bundle.orderHistory?.complete ?? "?")}\n`);
process.stdout.write(`fill history       ${String(bundle.fillHistory?.items ?? "?")} item(s), complete=${String(bundle.fillHistory?.complete ?? "?")}\n`);
process.stdout.write(`activity ledger    ${String(bundle.activityLedger?.activities?.length ?? "?")} entr(y|ies), complete=${String(bundle.activityLedger?.complete ?? "?")}\n`);
process.stdout.write("\n");

const verdict = validateCompetitionProvenance(bundle, expectations);
if (verdict.ok) {
  process.stdout.write("PROVENANCE OK: this account would be accepted for arming under the competition profile.\n");
  process.stdout.write("Nothing was written. The verdict is about this instant; any order placed afterwards ends it.\n");
  process.exit(0);
}

process.stdout.write("PROVENANCE REFUSED. Violations:\n");
for (const violation of verdict.violations) process.stdout.write(`  - ${violation}\n`);
if (verdict.reuseEvidence) {
  process.stdout.write("\nAt least one violation is REUSE EVIDENCE: on a real arming this would latch the\n");
  process.stdout.write("irreversible PROVENANCE_BROKEN halt, not merely refuse. Nothing was written here.\n");
} else {
  process.stdout.write("\nNo reuse evidence: these violations block arming without latching the irreversible halt.\n");
}
process.exit(1);
