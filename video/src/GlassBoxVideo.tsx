// The composition: one Sequence per SUBMISSION-SPEC §5 slot, in order. Every
// scene receives the whole dataset and picks what it shows through the pure
// selectors in dataset.ts; nothing here types a figure or a URL.
import { AbsoluteFill, Sequence } from "remotion";
import type { VideoProps } from "./Root";
import { Architecture } from "./scenes/Architecture";
import { Close } from "./scenes/Close";
import { ColdOpen } from "./scenes/ColdOpen";
import { DashboardOpen } from "./scenes/DashboardOpen";
import { DecisionCycle } from "./scenes/DecisionCycle";
import { GateVector } from "./scenes/GateVector";
import { OrderToOutcome } from "./scenes/OrderToOutcome";
import { PnlAndLimits } from "./scenes/PnlAndLimits";
import { SourceAndTests } from "./scenes/SourceAndTests";
import { DevWatermark } from "./scenes/shared";
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

export const GlassBoxVideo: React.FC<VideoProps> = ({ dataset }) => {
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
          </Sequence>
        );
      })}
      {dataset.meta.frozen ? null : <DevWatermark note={dataset.meta.datasetNote} />}
    </AbsoluteFill>
  );
};
