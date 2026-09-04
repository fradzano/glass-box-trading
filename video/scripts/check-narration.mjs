// Every narration mp3 must fit its scene slot with a margin (timeline.ts):
//   node scripts/check-narration.mjs   -> exit 1 if a file is longer than slot - 1 s
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const slots = { coldOpen: 30, dashboardOpen: 30, decisionCycle: 40, gateVector: 35, orderToOutcome: 30, architecture: 55, pnlAndLimits: 45, sourceAndTests: 30, close: 4 };
let failures = 0;
for (const [id, slot] of Object.entries(slots)) {
  const file = path.join(here, "..", "public", "narration", `${id}.mp3`);
  if (!existsSync(file)) { process.stdout.write(`${id}: no file\n`); continue; }
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const seconds = Number.parseFloat(probe.stdout.trim());
  const fits = seconds <= slot - 1;
  if (!fits) failures += 1;
  process.stdout.write(`${id}: ${seconds.toFixed(2)} s of ${String(slot)} s ${fits ? "ok" : "TOO LONG"}\n`);
}
process.exit(failures > 0 ? 1 : 0);
