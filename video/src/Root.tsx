import { Composition } from "remotion";
import { loadDataset } from "./dataset";
import type { Dataset } from "./dataset";
import { loadNarrationScript } from "./narration";
import type { NarrationScript } from "./narration";
import { GlassBoxVideo } from "./GlassBoxVideo";
import { FPS, TOTAL_FRAMES } from "./timeline";
import { HEIGHT, WIDTH } from "./theme";

// A type alias, not an interface: Remotion's Composition props must be assignable to Record<string, unknown>.
export type VideoProps = { readonly dataset: Dataset | null; readonly narration: NarrationScript | null };

export const RemotionRoot: React.FC = () => (
  <Composition
    id="GlassBoxTrading"
    component={GlassBoxVideo}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={TOTAL_FRAMES}
    defaultProps={{ dataset: null, narration: null } satisfies VideoProps}
    calculateMetadata={async () => {
      // The dataset is required and its loader throws on a bad one; the
      // narration script is optional and its loader resolves to an empty
      // script when public/narration/script.json is not there yet.
      const [dataset, narration] = await Promise.all([loadDataset(), loadNarrationScript()]);
      return { props: { dataset, narration }, durationInFrames: TOTAL_FRAMES };
    }}
  />
);
