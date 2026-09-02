// Alpaca wire documents recorded from the paper accounts, shared by the suites
// that need the same byte-for-byte shape. Shapes, never secrets: an account
// number is the account's own public identifier and no key material appears
// here.
//
// Recorded 2026-09-02 from the DEV account by a read-only probe:
//   GET /v2/account/activities?page_size=2&direction=asc -> 200
// A settled Alpaca paper account is NOT activity-free. It carries the journal
// entry that funded it, and `activity_types=FILL` came back empty on the same
// account. The S-CYC-09 proof therefore has to classify the ledger rather than
// require it to be empty.
export const RECORDED_OPENING_FUNDING_JOURNAL = {
  id: "20260824000000000::f40ccf26-0cef-428c-baab-c0fb403eec56",
  activity_type: "JNLC",
  date: "2026-08-24",
  created_at: "2026-08-24T20:13:41.157947Z",
  net_amount: "100000",
  description: "",
  status: "executed",
  currency: "USD",
};

// Recorded 2026-09-02 from the brand-new COMPETITION account, minutes after the
// broker created it, by read-only probes through the real adapter and by raw
// GETs:
//   GET /v2/account                              -> 200 (below, public fields only)
//   GET /v2/account/activities                   -> 200 []
//   GET /v2/account/activities?date=2026-09-02   -> 200 []
//   GET /v2/account/activities/JNLC              -> 200 []
// with orders and positions empty as well. The funding journal the dev account
// carries is posted LATER by the broker, not at account creation: here the cash
// and equity already stand at exactly $100,000 while the ledger is still empty.
// That is why the S-CYC-09 proof accepts an empty complete ledger on an
// otherwise perfect snapshot. The account's internal UUID `id` is deliberately
// not recorded; the account number is the public identifier.
export const RECORDED_VIRGIN_COMPETITION_ACCOUNT = {
  account_number: "PA376WIK2ATL",
  created_at: "2026-09-02T09:54:41.384033Z",
  cash: "100000",
  equity: "100000",
  status: "ACTIVE",
};

/** The same account's activity ledger as recorded: empty under every filter, and complete. */
export const RECORDED_VIRGIN_COMPETITION_ACTIVITIES: readonly Record<string, unknown>[] = [];
