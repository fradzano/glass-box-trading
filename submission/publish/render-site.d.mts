// Type surface of render-site.mjs for the test suite (tests/publish-dashboard.spec.ts).
// The implementation is plain ESM JavaScript so it can run against dist/ without a build step.

export interface RenderSiteOptions {
  readonly repoRoot: string;
  readonly distDir?: string;
  readonly journalPath: string;
  readonly outDir: string;
  readonly accountId: string;
  readonly profile?: "competition" | "dev";
  readonly presentationCutoff?: string | null;
  readonly deadlineCutoff?: string | null;
  readonly repositoryUrl?: string;
  readonly journalRevisionUrl?: string | null;
  readonly nowMs?: number;
}

export interface DeployedFile {
  readonly site: string;
  readonly deploy: string;
  readonly url: string;
}

export interface ManifestRoute {
  readonly kind: "latest" | "presentation" | "deadline";
  readonly cutoffAt: string;
  readonly sitePath: string;
  readonly deployPath: string;
  readonly url: string;
  readonly expectedMeta: Readonly<Record<string, string>>;
}

export interface PublishManifest {
  readonly renderedAt: string;
  readonly journalPath: string;
  readonly journalRevision: string;
  readonly entryCount: number;
  readonly lastSeq: number | null;
  readonly accountId: string;
  readonly profile: "competition" | "dev";
  readonly latestCutoffAt: string;
  readonly discrepancies: readonly string[];
  readonly siteDir: string;
  readonly deployDir: string;
  readonly build: { readonly written: readonly string[]; readonly carriedForward: readonly string[]; readonly preservedImmutable: readonly string[] };
  readonly files: readonly DeployedFile[];
  readonly routes: readonly ManifestRoute[];
  readonly jsonRoutes: readonly string[];
}

export function hostSafeSegment(segment: string): string;
export function hostSafeRelativePath(relativePath: string): string;
export function hostSafeHref(href: string): string;
export function rewritePinHrefs(html: string): string;
export function routeUrlPath(deployRelativePath: string): string;
export function deriveDeployTree(siteDir: string, deployDir: string, nonce: string): DeployedFile[];
export function liveStateDirMarker(journalPath: string): string | null;
export function completeJournalText(raw: string): string;
export function renderSite(options: RenderSiteOptions): Promise<PublishManifest>;
