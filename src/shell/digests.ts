// Digest material for S-ARM-01 (P7): the shell enumerates and hashes the
// bytes that run (source, schemas, dependency locks, the MCP manifest and
// runtime lock, the verified launch artifacts); the pure core canonicalizes
// and combines them into `runtimeDigest`, and derives `policyDigest` from the
// classified configuration. Content is LF-normalized before hashing so a
// checkout's line endings cannot change the identity of the code.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { policyDigest, runtimeDigest } from "../core/certificate.js";
import type { DigestResult, RuntimeDigestInput } from "../core/certificate.js";

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256File(file: string): string {
  return sha256Hex(readFileSync(file));
}

function sha256TextNormalized(file: string): string {
  return sha256Hex(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

function walk(root: string, directory: string, predicate: (relative: string) => boolean, out: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".tmp" || entry.name === "artifacts") continue;
      walk(root, absolute, predicate, out);
    } else if (predicate(relative)) {
      out.push(relative);
    }
  }
}

/**
 * Executable code, built Node artifacts, schemas, locks, and the presentation
 * assets inlined into every published page. The digest binds both reviewed
 * source and every built JavaScript byte Node executes; `assets/` is bound
 * because the stylesheet is what the judges see (R33/R34, DECISIONS.md
 * 2026-09-02): a change there after the certificate voids it exactly like a
 * code change.
 */
export function enumerateRuntimeFiles(repoRoot: string): readonly { readonly path: string; readonly sha256: string }[] {
  const files: string[] = [];
  walk(repoRoot, repoRoot, relative =>
    (relative.startsWith("src/") && relative.endsWith(".ts"))
    || (relative.startsWith("dist/") && relative.endsWith(".js"))
    || relative.startsWith("assets/")
    || (relative.startsWith("config/") && relative.endsWith(".json"))
    || (relative.startsWith("tools/") && (relative.endsWith(".mjs") || relative.endsWith(".py")))
    || relative === "package.json" || relative === "package-lock.json" || relative === "tsconfig.json" || relative === "tsconfig.build.json",
  files);
  return files.sort().map(relative => ({ path: relative, sha256: sha256TextNormalized(path.join(repoRoot, relative)) }));
}

export function computeRuntimeDigest(repoRoot: string, analystRuntime: RuntimeDigestInput["analystRuntime"]): DigestResult {
  return runtimeDigest({ files: enumerateRuntimeFiles(repoRoot), analystRuntime });
}

export function computePolicyDigest(raw: Readonly<Record<string, unknown>>, canonicalTradingOrigin: string): DigestResult {
  return policyDigest(raw, { canonicalTradingOrigin });
}

export function fileExists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
