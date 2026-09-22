// Deliberate unit-13 proof of the fourth alert path. This command never prints
// or accepts an endpoint; it reads HEALTHCHECK_ACTIVATION_URL from the normal
// deployment environment and emits only a credential-free result.
import path from "node:path";
import { createActivationPager } from "./actions/host.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const mode = process.argv[2];
if (mode !== "fail" && mode !== "clear") {
  process.stderr.write("usage: node ops/activation/page-test.ts fail|clear\n");
  process.exitCode = 2;
} else {
  const pager = createActivationPager({
    repoRoot: REPO_ROOT,
    activationRoot: REPO_ROOT,
    devStateDir: "",
    devDiagnosticSink: "",
    canonicalTradingOrigin: "https://paper-api.alpaca.markets",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, 10_000);
  try {
    const result = mode === "fail"
      ? await pager.fail("ACTIVATION_ALERT_PATH_PROOF", controller.signal)
      : await pager.success(controller.signal);
    if (result.ok) {
      process.stdout.write(`activation alert ${mode === "fail" ? "sent" : "cleared"}\n`);
      process.exitCode = 0;
    } else {
      process.stderr.write(`activation alert ${mode} failed: ${result.reason}\n`);
      process.exitCode = 1;
    }
  } finally {
    clearTimeout(timer);
  }
}
