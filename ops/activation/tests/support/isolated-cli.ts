// Process-level CLI entry for tests that exercise the real ledger/store but must
// not touch Scheduled Tasks or external alert endpoints. The production entry
// uses the concrete unit-13 bindings; this entry passes the explicit null ports.
import { main } from "../../cli.ts";

process.exitCode = await main({ actions: null, pager: null });
