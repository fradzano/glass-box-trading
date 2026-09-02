import { Composition } from "remotion";
import { loadDataset } from "./dataset";
import type { Dataset } from "./dataset";
import { GlassBoxVideo } from "./GlassBoxVideo";
import { FPS, TOTAL_FRAMES } from "./timeline";
import { HEIGHT, WIDTH } from "./theme";

// A type alias, not an interface: Remotion's Composition props must be assignable to Record<string, unknown>.
export type VideoProps = { readonly dataset: Dataset | null };

export const RemotionRoot: React.FC = () => (
  <Composition
    id="GlassBoxTrading"
    component={GlassBoxVideo}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={TOTAL_FRAMES}
    defaultProps={{ dataset: null } satisfies VideoProps}
    calculateMetadata={async () => ({ props: { dataset: await loadDataset() }, durationInFrames: TOTAL_FRAMES })}
  />
);
