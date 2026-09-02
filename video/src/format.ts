// Integer-cent formatting, no float arithmetic on money: the same rules the
// dashboard renderer applies, so a figure on screen matches the page.
export function formatUsd(cents: number | null): string {
  if (cents === null) return "n/a";
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

/** Basis points as a percentage with two decimals (`-1` bps → `-0.01%`). */
export function formatBps(bps: number | null): string {
  if (bps === null) return "n/a";
  const sign = bps < 0 ? "-" : bps > 0 ? "+" : "";
  const absolute = Math.abs(bps);
  return `${sign}${String(Math.floor(absolute / 100))}.${String(absolute % 100).padStart(2, "0")}%`;
}

/** `2026-09-03T20:05:11.000Z` → `2026-09-03 20:05 UTC`. */
export function formatInstant(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function formatPriceCents(cents: number | null): string {
  return cents === null ? "n/a" : `${String(cents)} ¢`;
}
