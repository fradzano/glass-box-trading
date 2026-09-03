// The SUBMISSION-SPEC §5 timing table as frames. Total 299 s: under the
// five-minute limit with one second of margin, not "at most" it.
export const FPS = 30;

export interface SceneSlot {
  readonly id: "coldOpen" | "dashboardOpen" | "decisionCycle" | "gateVector" | "orderToOutcome" | "architecture" | "pnlAndLimits" | "sourceAndTests" | "close";
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export const SCENES: readonly SceneSlot[] = [
  { id: "coldOpen", startSeconds: 0, endSeconds: 30 },
  { id: "dashboardOpen", startSeconds: 30, endSeconds: 60 },
  { id: "decisionCycle", startSeconds: 60, endSeconds: 100 },
  { id: "gateVector", startSeconds: 100, endSeconds: 135 },
  { id: "orderToOutcome", startSeconds: 135, endSeconds: 165 },
  { id: "architecture", startSeconds: 165, endSeconds: 220 },
  { id: "pnlAndLimits", startSeconds: 220, endSeconds: 265 },
  { id: "sourceAndTests", startSeconds: 265, endSeconds: 295 },
  { id: "close", startSeconds: 295, endSeconds: 299 },
];

export function frames(seconds: number): number {
  return Math.round(seconds * FPS);
}

export const TOTAL_FRAMES = frames(SCENES[SCENES.length - 1]?.endSeconds ?? 0);
