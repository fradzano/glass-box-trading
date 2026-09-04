// Voice-over for the submission video: one mp3 per scene from
// public/narration/script.json through the ElevenLabs text-to-speech API,
// written to public/narration/<sceneId>.mp3, then meta.json's `narration`
// flags set for the scenes that got a file. The key comes from video/.env
// (gitignored) as ELEVENLABS_API_KEY; voice and model are overridable with
// ELEVENLABS_VOICE_ID and ELEVENLABS_MODEL_ID. After the run, check every
// file's duration against its slot (video/src/timeline.ts) with ffprobe:
//   node scripts/tts-elevenlabs.mjs            (all scenes)
//   node scripts/tts-elevenlabs.mjs pnlAndLimits (one scene)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..");
const envPath = path.join(pkg, ".env");
const env = Object.fromEntries(
  (existsSync(envPath) ? readFileSync(envPath, "utf8") : "")
    .split(/\r?\n/).filter(line => line.includes("=") && !line.trim().startsWith("#"))
    .map(line => { const i = line.indexOf("="); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const apiKey = process.env.ELEVENLABS_API_KEY ?? env.ELEVENLABS_API_KEY;
if (!apiKey) { process.stderr.write("ELEVENLABS_API_KEY missing (video/.env or environment)\n"); process.exit(2); }
// Default voice: "Daniel" (a calm British narrator from the ElevenLabs premade set); override with ELEVENLABS_VOICE_ID.
const voiceId = process.env.ELEVENLABS_VOICE_ID ?? env.ELEVENLABS_VOICE_ID ?? "onwK4e9ZLuTAKqWW03F9";
const modelId = process.env.ELEVENLABS_MODEL_ID ?? env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

const scriptPath = path.join(pkg, "public", "narration", "script.json");
const script = JSON.parse(readFileSync(scriptPath, "utf8"));
const only = process.argv[2];
const scenes = Object.entries(script.scenes).filter(([id]) => only === undefined || id === only);

let ok = 0;
for (const [id, scene] of scenes) {
  const text = scene.text.trim();
  if (text.includes("[OWNER")) { process.stderr.write(`${id}: still holds an owner slot, skipped\n`); continue; }
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } }),
  });
  if (!response.ok) { process.stderr.write(`${id}: HTTP ${String(response.status)} ${await response.text()}\n`); process.exit(1); }
  const audio = Buffer.from(await response.arrayBuffer());
  writeFileSync(path.join(pkg, "public", "narration", `${id}.mp3`), audio);
  process.stdout.write(`${id}: ${String(audio.length)} bytes (${String(text.split(/\s+/).length)} words)\n`);
  ok += 1;
}

// Flag the scenes that now have a file in meta.json (the composition plays only flagged scenes).
const metaPath = path.join(pkg, "public", "dataset", "meta.json");
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const narration = { ...(meta.narration ?? {}) };
for (const id of Object.keys(script.scenes)) narration[id] = existsSync(path.join(pkg, "public", "narration", `${id}.mp3`));
writeFileSync(metaPath, `${JSON.stringify({ ...meta, narration }, null, 2)}\n`);
process.stdout.write(`${String(ok)} scene(s) synthesized; meta.narration updated\n`);
