// Voice-over and captions (SUB-04). Two artefacts are produced outside this
// package and dropped into public/narration/: one script.json holding the
// spoken text and its caption cues per scene, and one <sceneId>.mp3 per scene
// from the TTS step. Both are optional at every stage — a missing script means
// no captions, a scene not listed in meta.narration means no audio — so the
// composition renders identically before either exists.
//
// The loader is the only impure part; the shape check and the cue lookup are
// pure functions over plain data, testable without Remotion or a network.
import { staticFile } from "remotion";
import type { SceneSlot } from "./timeline";

export interface NarrationCue {
  /** Seconds from the START OF THE SCENE, not of the video. */
  readonly at: number;
  readonly text: string;
}

export interface NarrationScene {
  /** The full spoken text of the scene; the TTS step reads this, the video does not display it. */
  readonly text: string;
  readonly cues: readonly NarrationCue[];
}

export interface NarrationScript {
  readonly scenes: Readonly<Record<string, NarrationScene>>;
}

/** What a missing, unreadable or malformed script.json resolves to: every scene silent and uncaptioned. */
export const EMPTY_NARRATION: NarrationScript = { scenes: {} };

function normalizeCue(value: unknown): NarrationCue | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const at = record["at"];
  const text = record["text"];
  if (typeof at !== "number" || !Number.isFinite(at) || at < 0) return null;
  if (typeof text !== "string" || text.trim() === "") return null;
  return { at, text };
}

/**
 * Accepts whatever the writer's file happens to contain and keeps only the
 * well-formed parts, sorted by cue time. A broken script degrades to fewer
 * captions; it never fails the render.
 */
export function normalizeScript(value: unknown): NarrationScript {
  if (value === null || typeof value !== "object") return EMPTY_NARRATION;
  const scenesValue = (value as Record<string, unknown>)["scenes"];
  if (scenesValue === null || typeof scenesValue !== "object") return EMPTY_NARRATION;
  const scenes: Record<string, NarrationScene> = {};
  for (const [sceneId, sceneValue] of Object.entries(scenesValue as Record<string, unknown>)) {
    if (sceneValue === null || typeof sceneValue !== "object") continue;
    const record = sceneValue as Record<string, unknown>;
    const text = typeof record["text"] === "string" ? record["text"] : "";
    const rawCues = Array.isArray(record["cues"]) ? (record["cues"] as readonly unknown[]) : [];
    const cues = rawCues.map(normalizeCue).filter((cue): cue is NarrationCue => cue !== null).sort((left, right) => left.at - right.at);
    scenes[sceneId] = { text, cues };
  }
  return { scenes };
}

export function cuesFor(script: NarrationScript | null, sceneId: SceneSlot["id"]): readonly NarrationCue[] {
  return script?.scenes[sceneId]?.cues ?? [];
}

/** The cue whose `at` is the latest one at or before `seconds`; null before the first cue. */
export function activeCue(cues: readonly NarrationCue[], seconds: number): NarrationCue | null {
  let found: NarrationCue | null = null;
  for (const cue of cues) {
    if (cue.at > seconds) break;
    found = cue;
  }
  return found;
}

/** Loads public/narration/script.json; a missing or unreadable file is not an error. */
export async function loadNarrationScript(): Promise<NarrationScript> {
  try {
    const response = await fetch(staticFile("narration/script.json"));
    if (!response.ok) return EMPTY_NARRATION;
    return normalizeScript(await response.json());
  } catch {
    return EMPTY_NARRATION;
  }
}
