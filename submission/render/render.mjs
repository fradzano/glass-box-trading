// Reproducible render pipeline for the three submission artifacts:
//   SUB-03  submission/glass-box-trading-one-pager.pdf
//   SUB-05  submission/glass-box-trading.pdf
//   SUB-06  submission/cover.png
//
// Run:  node submission/render/render.mjs
//
// This script only writes under submission/ (never touches src/, dist/,
// config/, tools/, package.json, .env). Node packages (marp-cli, marked)
// live in the scratch workspace below, NOT in the repo's own
// node_modules/package.json, per the hard rule against touching the repo
// root build.
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const submissionDir = path.join(repoRoot, "submission");
const outDir = path.join(here, "out");
mkdirSync(outDir, { recursive: true });

// Scratch npm workspace holding @marp-team/marp-cli and marked (installed
// there per the hard rule: no npm install in the repo tree).
const scratchDir =
  "C:\\Users\\felix\\AppData\\Local\\Temp\\claude\\C--Users-felix-source-repos-glass-box-trading\\f953090d-c924-4047-a242-743c037d6daa\\scratchpad\\render-work";
const markedEsm = path.join(scratchDir, "node_modules", "marked", "lib", "marked.esm.js");
const marpBin = path.join(scratchDir, "node_modules", ".bin", "marp.cmd");
const chromeExe = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const { marked } = await import(pathToFileURL(markedEsm).href);
marked.setOptions({ breaks: false });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    console.error(`--- FAILED: ${cmd} ${args.join(" ")}`);
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`command failed: ${cmd}`);
  }
  return r;
}

function injectFile(source, target) {
  const r = run("node", [path.join(here, "inject.mjs"), source, target]);
  process.stdout.write(r.stdout);
  return target;
}

// ---------------------------------------------------------------------------
// 1. Inject placeholders (source files are untouched; another agent edits
//    their wording concurrently, so this step is re-run fresh every time).
// ---------------------------------------------------------------------------
const onePagerSrc = path.join(submissionDir, "ONE-PAGER.md");
const deckSrc = path.join(submissionDir, "slides", "deck.md");

const onePagerInjected = injectFile(onePagerSrc, path.join(outDir, "ONE-PAGER.injected.md"));
const deckInjected = injectFile(deckSrc, path.join(outDir, "deck.injected.md"));

// The densest slide (failure drills + known API limitation) overflows the
// default Marp 16:9 theme's font size. Per the render brief: shrink font,
// never cut words. This only touches the injected copy under out/, never
// submission/slides/deck.md — that file is owned by wording edits elsewhere
// and is re-read fresh on every run.
{
  const raw = readFileSync(deckInjected, "utf8");
  const shrinkStyle = `style: |
  section { font-size: 25px; padding: 46px 64px; }
  section h1 { font-size: 42px; margin-bottom: 6px; }
  section h2 { font-size: 32px; margin-bottom: 10px; }
  section ul { margin-top: 4px; margin-bottom: 6px; }
  section li { margin-bottom: 5px; line-height: 1.28; }
  section p { margin: 4px 0; }
`;
  const withStyle = raw.replace(/^(---\n)([\s\S]*?)(\n---\n)/, (whole, open, front, close) => {
    if (/^style:/m.test(front)) return whole; // already has a style key
    return `${open}${front}\n${shrinkStyle}${close}`;
  });
  writeFileSync(deckInjected, withStyle, "utf8");
}

// ---------------------------------------------------------------------------
// 2. One-pager: markdown -> print HTML -> Chrome headless print-to-pdf.
//    A4, ~11pt serif body, tight margins, strong rule under the title,
//    no page header/footer.
// ---------------------------------------------------------------------------
const onePagerMdRaw = readFileSync(onePagerInjected, "utf8");
// Strip the leading HTML comment (build note, not content).
const onePagerMd = onePagerMdRaw.replace(/^<!--[\s\S]*?-->\s*/, "");
const onePagerBodyHtml = marked.parse(onePagerMd);

const ONE_PAGER_FONT_PT = 11; // ~11pt serif body per spec; content currently
// fills well under one A4 page at this size (see render report for margin).

const onePagerHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Glass Box Trading — One-Pager</title>
<style>
  @page { size: A4; margin: 12mm 16mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: ${ONE_PAGER_FONT_PT}pt;
    line-height: 1.32;
    color: #16181c;
  }
  h1 {
    font-size: 1.9em;
    margin: 0 0 2px 0;
    letter-spacing: -0.01em;
  }
  h1 + p {
    margin: 0 0 8px 0;
    padding-bottom: 8px;
    border-bottom: 3px solid #16181c;
    font-weight: 700;
    font-size: 1.05em;
  }
  h1 + p strong { font-weight: 700; }
  h2 {
    font-size: 1.05em;
    margin: 10px 0 3px 0;
    border-bottom: 1px solid #999;
    padding-bottom: 1px;
  }
  p { margin: 0 0 5px 0; text-align: left; }
  ul { margin: 2px 0 6px 0; padding-left: 1.1em; }
  li { margin-bottom: 2px; }
  strong { font-weight: 700; }
  code { font-family: Consolas, monospace; font-size: 0.92em; background: #f0f0f0; padding: 0 2px; }
</style>
</head>
<body>
${onePagerBodyHtml}
</body>
</html>
`;
const onePagerHtmlPath = path.join(outDir, "one-pager.html");
writeFileSync(onePagerHtmlPath, onePagerHtml, "utf8");

const onePagerPdfPath = path.join(submissionDir, "glass-box-trading-one-pager.pdf");
run(chromeExe, [
  "--headless=new",
  "--disable-gpu",
  "--no-pdf-header-footer",
  "--run-all-compositor-stages-before-draw",
  "--virtual-time-budget=8000",
  `--print-to-pdf=${onePagerPdfPath}`,
  pathToFileURL(onePagerHtmlPath).href,
]);

// ---------------------------------------------------------------------------
// 3. Deck: marp-cli markdown -> PDF (max 10 slides).
// ---------------------------------------------------------------------------
const deckPdfPath = path.join(submissionDir, "glass-box-trading.pdf");
run(marpBin, [
  deckInjected,
  "--pdf",
  "--allow-local-files",
  "-o",
  deckPdfPath,
], { shell: true });

// ---------------------------------------------------------------------------
// 4. Cover: hand-authored HTML (submission/render/cover.html) -> 1920x1080 PNG
//    via Chrome headless screenshot. No injection (no numbers on the cover).
// ---------------------------------------------------------------------------
const coverHtmlPath = path.join(here, "cover.html");
const coverPngPath = path.join(submissionDir, "cover.png");
run(chromeExe, [
  "--headless=new",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--hide-scrollbars",
  "--window-size=1920,1080",
  `--screenshot=${coverPngPath}`,
  pathToFileURL(coverHtmlPath).href,
]);

// ---------------------------------------------------------------------------
// 5. Verification
// ---------------------------------------------------------------------------
// Counts /Type /Page objects (excluding /Type /Pages). Handles both plain
// PDFs (Chrome print-to-pdf) and PDFs that wrap objects in compressed
// object streams (PDF 1.5+ /ObjStm, used by marp-cli's Chromium PDF export)
// by inflating each ObjStm and scanning the decompressed object bodies too.
function countPdfPages(pdfPath) {
  const buf = readFileSync(pdfPath);
  const text = buf.toString("latin1");

  let decoded = "";
  const objRe = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = objRe.exec(text)) !== null) {
    const dict = m[2];
    if (!dict.includes("/ObjStm")) continue;
    const streamStart = objRe.lastIndex;
    const endIdx = text.indexOf("endstream", streamStart);
    if (endIdx === -1) continue;
    const rawSlice = buf.subarray(streamStart, endIdx);
    try {
      decoded += zlib.inflateSync(rawSlice).toString("latin1") + "\n";
    } catch {
      // not FlateDecode or not decodable; ignore, plain-text scan below still applies
    }
  }

  const combined = text + "\n" + decoded;
  const matches = combined.match(/\/Type\s*\/Page(?!s)\b/g) || [];
  return matches.length;
}

function pngDimensions(pngPath) {
  const buf = readFileSync(pngPath);
  // PNG signature (8 bytes) + IHDR chunk: length(4) type(4) width(4) height(4)
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function fileSizeKb(p) {
  return (statSync(p).size / 1024).toFixed(1) + " KB";
}

function grepNoTokens(files) {
  const offenders = [];
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    if (content.includes("{{")) offenders.push(f);
  }
  return offenders;
}

console.log("\n=== VERIFICATION ===");

const onePagerPages = countPdfPages(onePagerPdfPath);
console.log(`one-pager page count: ${onePagerPages} (expect 1) -> ${onePagerPages === 1 ? "PASS" : "FAIL"}`);

const deckPages = countPdfPages(deckPdfPath);
console.log(`deck page count: ${deckPages} (expect <= 10) -> ${deckPages <= 10 ? "PASS" : "FAIL"}`);

const { width, height } = pngDimensions(coverPngPath);
console.log(`cover dimensions: ${width}x${height} (expect 1920x1080) -> ${width === 1920 && height === 1080 ? "PASS" : "FAIL"}`);

console.log(`one-pager PDF size: ${fileSizeKb(onePagerPdfPath)}`);
console.log(`deck PDF size: ${fileSizeKb(deckPdfPath)}`);
console.log(`cover PNG size: ${fileSizeKb(coverPngPath)}`);

const offenders = grepNoTokens([onePagerInjected, deckInjected, onePagerHtmlPath]);
console.log(`unresolved {{ tokens in injected output: ${offenders.length === 0 ? "NONE -> PASS" : "FOUND -> FAIL: " + offenders.join(", ")}`);

console.log(`\none-pager body font size used: ${ONE_PAGER_FONT_PT}pt (Georgia serif, A4, 12mm/16mm margins)`);
console.log("=== DONE ===");
