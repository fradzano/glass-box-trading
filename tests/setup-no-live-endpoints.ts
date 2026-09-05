// The test suite may not reach the operator's live alerting. Ever.
//
// Found by counting pings on the real endpoint: running
// `tests/p7-launch-hardening.spec.ts` took gbt-readiness from 4 pings to 5.
// The cause is a seam that looks harmless -- `buildRuntime({ repoRoot:
// process.cwd(), processEnv: { ...a few synthetic values } })`. `buildRuntime`
// resolves its environment as `.env` first and the given values on top, so
// every key the test does NOT name survives from the developer's real `.env`,
// `HEALTHCHECK_PING_URL` among them. The startup refusal the test is asserting
// then sends a genuine failure ping.
//
// The consequence is worse than noise. `npm run verify` is condition 1 of the
// activation gate and the thing to run after any change during a three-month
// unattended run: a suite that alarms the operator every time it passes teaches
// them to ignore the one signal that says the deployment cannot trade. An
// alerting system that cries wolf is not a degraded alerting system; it is an
// absent one.
//
// So the class is closed here rather than at each call site: any test that
// tries to reach healthchecks.io fails loudly instead of paging anyone. Tests
// that install their own fetch stub are unaffected -- they never reach this.
const LIVE_ENDPOINTS = /(^|\.)hc-ping\.com$|(^|\.)healthchecks\.io$/iu;

const inherited = globalThis.fetch;

function hostOf(input: Parameters<typeof fetch>[0]): string {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(target).host;
  } catch {
    return "";
  }
}

globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const host = hostOf(input);
  if (LIVE_ENDPOINTS.test(host)) {
    throw new Error(
      `a test reached the live alerting endpoint (${host}). Nothing in the suite may ping the operator's checks: ` +
      "it fires a real alarm and trains them to ignore the next one. The usual cause is a runtime built with " +
      "`repoRoot: process.cwd()`, which resolves the developer's .env underneath the values the test names -- " +
      "name HEALTHCHECK_PING_URL, HEALTHCHECK_LIVENESS_URL and HEALTHCHECK_WATCHDOG_URL as empty strings, or " +
      "point repoRoot at a fixture.",
    );
  }
  return inherited(input, init);
};
