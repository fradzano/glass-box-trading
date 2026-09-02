// Alpaca wire documents recorded from the DEV paper account, shared by the
// suites that need the same byte-for-byte shape. Shapes, never secrets: the
// account number is the account's own public identifier and no key material
// appears here.
//
// Recorded 2026-09-02 by a read-only probe:
//   GET /v2/account/activities?page_size=2&direction=asc -> 200
// A virgin Alpaca paper account is NOT activity-free. It already carries the
// journal entry that funded it, and `activity_types=FILL` came back empty on
// the same account. The S-CYC-09 proof therefore has to classify the ledger
// rather than require it to be empty.
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
