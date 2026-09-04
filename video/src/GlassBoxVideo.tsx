// The composition: one Sequence per SUBMISSION-SPEC §5 slot, in order. Every
// scene receives the whole dataset and picks what it shows through the pure
// selectors in dataset.ts; nothing here types a figure or a URL.
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { VideoProps } from "./Root";
import { cuesFor } from "./narration";
import { Architecture } from "./scenes/Architecture";
import { Close } from "./scenes/Close";
import { ColdOpen } from "./scenes/ColdOpen";
import { DashboardOpen } from "./scenes/DashboardOpen";
import { DecisionCycle } from "./scenes/DecisionCycle";
import { GateVector } from "./scenes/GateVector";
import { OrderToOutcome } from "./scenes/OrderToOutcome";
import { PnlAndLimits } from "./scenes/PnlAndLimits";
import { SourceAndTests } from "./scenes/SourceAndTests";
import { CaptionStrip, DevWatermark } from "./scenes/shared";
import { SCENES, frames } from "./timeline";
import type { SceneSlot } from "./timeline";
import { color, font } from "./theme";

const SCENE_COMPONENTS: Record<SceneSlot["id"], React.FC<{ readonly dataset: NonNullable<VideoProps["dataset"]> }>> = {
  coldOpen: ColdOpen,
  dashboardOpen: DashboardOpen,
  decisionCycle: DecisionCycle,
  gateVector: GateVector,
  orderToOutcome: OrderToOutcome,
  architecture: Architecture,
  pnlAndLimits: PnlAndLimits,
  sourceAndTests: SourceAndTests,
  close: Close,
};

/** The one scene drawn on ink rather than paper; its caption bar inverts to match. */
const DARK_SCENES: ReadonlySet<SceneSlot["id"]> = new Set<SceneSlot["id"]>(["close"]);

export const GlassBoxVideo: React.FC<VideoProps> = ({ dataset, narration }) => {
  if (dataset === null) {
    return <AbsoluteFill style={{ background: color.paper, color: color.mute, fontFamily: font.sans, fontSize: 40, alignItems: "center", justifyContent: "center" }}>loading dataset…</AbsoluteFill>;
  }
  return (
    <AbsoluteFill style={{ background: color.paper }}>
      {SCENES.map(slot => {
        const Scene = SCENE_COMPONENTS[slot.id];
        return (
          <Sequence key={slot.id} name={slot.id} from={frames(slot.startSeconds)} durationInFrames={frames(slot.endSeconds) - frames(slot.startSeconds)}>
            <Scene dataset={dataset} />
            {/* meta.narration is the declaration that the TTS file exists; nothing probes the disk. */}
            {dataset.meta.narration?.[slot.id] === true ? <Audio src={staticFile(`narration/${slot.id}.mp3`)} /> : null}
            <CaptionStrip cues={cuesFor(narration, slot.id)} invert={DARK_SCENES.has(slot.id)} />
          </Sequence>
        );
      })}
      {dataset.meta.frozen ? null : <DevWatermark note={dataset.meta.datasetNote} />}
    </AbsoluteFill>
  );
};
