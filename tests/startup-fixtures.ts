// A coherent, fully valid §0 configuration record for the S-CYC-11 tests.
// Every coupling holds at the baseline so a single overridden field isolates
// exactly one violation. Values are cents/ms integers as the closed field set
// demands; the calendar sits inside the frozen event window.
import { TEST_ONLY_ACCOUNT_ID } from "./journal-fixtures.js";

export type RawStartupConfig = Record<string, unknown>;

export function validStartupConfig(stateDir: string, sinkPath: string, overrides: RawStartupConfig = {}): RawStartupConfig {
  const base: RawStartupConfig = {
    EXPECTED_ACCOUNT_ID: TEST_ONLY_ACCOUNT_ID,
    ALPACA_PROFILE: "dev",
    ALPACA_TRADING_ORIGIN: "https://paper-api.alpaca.markets",
    STATE_DIR: stateDir,
    BOOTSTRAP_DIAGNOSTIC_SINK: sinkPath,
    INCOME_BUDGET_CENTS: 1_200_000,
    CONVEX_BUDGET_CENTS: 800_000,
    INITIAL_CAPITAL_CENTS: 10_000_000,
    MAX_LOSS_PER_POSITION_BPS: 2_000,
    MAX_UNDERLYING_EXPOSURE_CENTS: 500_000,
    MAX_REL_SPREAD_BPS: 500,
    MIN_QUOTE_SIZE: 1,
    QUOTE_MAX_AGE_MS: 60_000,
    SNAPSHOT_STALENESS_BOUND_MS: 600_000,
    KILL_EQUITY_THRESHOLD_CENTS: 9_000_000,
    DEAD_MAN_BOUND_MS: 3_000_000,
    ALERT_DELIVERY_BUDGET_MS: 600_000,
    CYCLE_INTERVAL_MS: 900_000,
    UNDERLYING_UNIVERSE: ["SPY", "QQQ"],
    STRUCTURE_WHITELIST: ["long_option"],
    EXPIRY_MIN_SESSIONS: 2,
    EXPIRY_MAX_SESSIONS: 10,
    MAX_STRIKE_DISTANCE_BPS: 1_000,
    MAX_CANDIDATE_QTY: 5,
    LIMIT_TOLERANCE_CENTS: 5,
    CLOSE_ESCALATION_STEP_CENTS: 2,
    RESIDUE_MAX_SESSIONS: 1,
    ANALYST_TIMEOUT_MS: 240_000,
    CYCLE_WALLTIME_BUDGET_MS: 300_000,
    LOCK_TAKEOVER_BOUND_MS: 400_000,
    ANALYST_MCP_CAPABILITY_MANIFEST: "config/analyst-mcp-readonly.json",
    ANALYST_MCP_RUNTIME_LOCK: "config/analyst-runtime-lock.json",
    ANALYST_ALPACA_PROFILE: "dev",
    QUALIFYING_ACTIVITY_CHECKPOINT: "2026-09-01T20:00:00Z",
    QUALIFICATION_WINDOW_END: "2026-09-02T20:00:00Z",
    QUALIFICATION_MAX_LOSS_CENTS: 50_000,
  };
  // An `undefined` override removes the field: the caller expresses "symbol absent" without a delete.
  const merged: RawStartupConfig = {};
  for (const [field, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== undefined) merged[field] = value;
  }
  return merged;
}
