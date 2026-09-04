// 4:25–4:55 — the public repository at the pure core and the test that
// executes one named evidence-debt path (§3 step 5), then the evidence that
// stays after judging.
import type { Dataset } from "../dataset";
import { color, font } from "../theme";
import { Capture, Chain, Frame, Lead } from "./shared";

export const SourceAndTests: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const { meta } = dataset;
  return (
    <Frame dataset={dataset} eyebrow="Golden path · 5 and 6 of 6" title="Public source and immutable evidence">
      <Lead>The repository is public under MIT, with the pure core, its tests, the decisions and the build rules. One named evidence-debt path runs as a test: journal-only failure with open exposure ends in a deterministic risk-reducing emergency close and an explicit audit-gap reconciliation.</Lead>
      <Capture
        file={meta.captures.sourceAndTests}
        label="open the repository at the core file and the named test; return to the pinned reconciliation route"
        standIn={
          <Chain rows={[
            ["Repository", meta.repositoryUrl],
            ["Pure core", meta.corePath],
            ["Evidence-debt test", meta.evidenceTestPath],
            ["Pinned evidence", meta.presentationRouteUrl],
          ]} />
        }
      />
      <p style={{ fontFamily: font.sans, fontSize: 26, color: color.mute, margin: 0 }}>After judging, the pinned route stays addressable by journal revision and cutoff; the live route may advance, the pinned one does not. <span style={{ fontFamily: font.mono }}>{dataset.projection.journalRevision}</span></p>
    </Frame>
  );
};
