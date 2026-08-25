import { mkdir, writeFile } from "node:fs/promises";
import { decide } from "../core/decision.js";
import { P1_RECORDED_CANDIDATES, P1_RECORDED_SNAPSHOT, TEST_ONLY_P1_NOW, TEST_ONLY_P1_O5_CONFIG } from "../fixtures/p1-recorded-cycle.js";
import { renderDecisionView } from "./render-decision-view.js";

const result = decide(P1_RECORDED_SNAPSHOT, P1_RECORDED_CANDIDATES, TEST_ONLY_P1_O5_CONFIG, TEST_ONLY_P1_NOW);
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/p1-decision-view.html", renderDecisionView(result), "utf8");
process.stdout.write("Rendered artifacts/p1-decision-view.html from one pure decision result.\n");
