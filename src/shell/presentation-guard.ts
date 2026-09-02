// P9 / R33 (B1) — the stylesheet is inlined verbatim into the published
// page (src/shell/dashboard-build.ts, renderDashboard, renderDecisionView).
// While it sat outside the S-ARM-01 runtime digest, the gate's executed
// counter-example was: appending
// `.gate--veto,.stamp--veto,.discrepancies,.result--no_trade{display:none}`
// to assets/dashboard.css hides every gate veto, no-trade result and
// reconciliation discrepancy on the published page while the digest stays
// byte-identical and every test stays green. docs/SUBMISSION-SPEC.md names
// "hides unfavorable decisions" as the anti-criterion; docs/SPEC.md S-J-07
// requires "content may not lie".
//
// This module is the countermeasure: a pure, static audit over a
// stylesheet's declarations that refuses any construct capable of hiding,
// truncating, or visually suppressing content, or of loading anything
// off-page. It lives in src/shell/, not src/core/, so it is not subject to
// the architecture gate's ambient-I/O ban — but it performs no I/O itself:
// no filesystem, no clock, no environment, no network. Given the same text
// it always returns the same reasons.
//
// This is a syntactic gate, not a CSS renderer: it walks `{ ... }` blocks
// (including nested blocks inside `@media`/`@supports`) and inspects each
// `property: value` declaration by its tokens, so a keyword or a zero length
// is found inside a `var()` fallback and inside `min()`/`clamp()`/`calc()`
// arguments as well; custom-property definitions are audited by value, so
// `var()` indirection cannot smuggle a refused value past the guard;
// `!important` is stripped before the comparison; a backslash anywhere is
// refused because a CSS escape can spell a refused keyword; a `<` anywhere is
// refused because CSS has no legitimate use for it and it is exactly what a
// stylesheet needs to break out of the `<style>` block it is inlined into
// (`</style><script>...`) — `>` stays allowed, it is the child combinator
// (P9/R34 B2).
//
// Declared residual (DECISIONS.md 2026-09-02, R33 B1): the audit reads text,
// not a rendered page. It does not catch text painted in the ground colour
// (`color:#fff` on `background:#fff`), near-zero sizes (`font-size:1px`,
// `width:1px`), off-canvas placement through large positive margins or
// paddings, a zero computed from a `calc()` subtraction on a width, or
// glyph-less font stacks. Those remain the reviewer's eyes on the golden
// render and the byte-identity test of the rendered page.

/** Properties refused outright, regardless of value. */
const FORBIDDEN_PROPERTIES: ReadonlySet<string> = new Set([
  "visibility",
  "opacity",
  "clip",
  "clip-path",
  "content",
  "transform",
  "filter",
  "mask",
  "mask-image",
  "text-indent",
  "scale",
  "translate",
  "rotate",
  "zoom",
  "backdrop-filter",
  "mix-blend-mode",
  "content-visibility",
]);

/** Keywords that, inside a custom-property value, could feed a hiding declaration through `var()` indirection. */
const HIDING_KEYWORDS: ReadonlySet<string> = new Set(["none", "hidden", "clip", "contents", "absolute", "fixed", "transparent"]);

/** Tracking tighter than this collapses glyphs onto each other; the shipped headings use -0.01em to -0.05em. */
const TIGHTEST_TRACKING_EM = 0.1;
const TIGHTEST_TRACKING_PX = 2;

const OVERFLOW_PROPERTIES: ReadonlySet<string> = new Set([
  "overflow",
  "overflow-x",
  "overflow-y",
  "overflow-block",
  "overflow-inline",
]);

const ZERO_LENGTH_PROPERTIES: ReadonlySet<string> = new Set([
  "font-size",
  "line-height",
  "height",
  "max-height",
  "width",
  "max-width",
]);

const NEGATIVE_LENGTH_PROPERTIES: ReadonlySet<string> = new Set([
  "margin",
  "left",
  "right",
  "top",
  "bottom",
  "inset",
]);

const TRACKING_PROPERTIES: ReadonlySet<string> = new Set(["letter-spacing", "word-spacing"]);

/** `color`, `background`, `background-color`, `border-color`, `-webkit-text-fill-color`, ... — every property that paints text or its ground. */
function isColorProperty(property: string): boolean {
  return property === "background" || property === "color" || property.endsWith("-color") || property.endsWith("color");
}

/** Media/container at-rules whose block holds nested selector blocks, not declarations directly. */
const CONTAINER_AT_RULES = [/^@media\b/iu, /^@supports\b/iu, /^@keyframes\b/iu, /^@-webkit-keyframes\b/iu, /^@layer\b/iu];

interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly selector: string;
}

/** Strips `/* ... *&#47;` comments (non-greedy, may span lines). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, " ");
}

/** Finds the index of the `}` matching the `{` at `openIndex`, walking nested braces. Returns `text.length` if unterminated. */
function matchingBrace(text: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** Splits a declaration block's body on `;` and each chunk on the first `:`. CSS values never contain a raw `{`, `}`, or top-level `;`. */
function parseDeclarations(body: string, selector: string, out: Declaration[]): void {
  for (const chunk of body.split(";")) {
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (property.length === 0 || value.length === 0) continue;
    out.push({ property, value, selector: selector.trim() });
  }
}

/** Walks top-level `{ ... }` blocks in `text`, recursing into container at-rules and collecting declarations from ordinary rule/at-rule blocks. */
function walkBlocks(text: string, out: Declaration[]): void {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const header = text.slice(i, open).trim();
    const close = matchingBrace(text, open);
    const body = text.slice(open + 1, close);
    if (CONTAINER_AT_RULES.some(pattern => pattern.test(header))) {
      walkBlocks(body, out);
    } else {
      parseDeclarations(body, header, out);
    }
    i = close + 1;
  }
}

function collectDeclarations(text: string): readonly Declaration[] {
  const out: Declaration[] = [];
  walkBlocks(text, out);
  return out;
}

/** True when `value` is a bare zero length: `0`, `0px`, `0.0rem`, `0%`, etc. (unitless `0` and any-unit zero both count). */
function isZeroLength(value: string): boolean {
  return /^0(?:\.0+)?[a-z%]*$/u.test(value.trim().toLowerCase());
}

/** True when `value` contains a unary-minus length: a `-` at the start, or preceded by whitespace/`(`/`,`, directly followed by a digit or `.digit`. */
function hasNegativeLength(value: string): boolean {
  return /(?:^|[\s(,])-\.?\d/u.test(value);
}

/**
 * Splits a value into bare tokens across function calls, commas, slashes and
 * operators, so a keyword or a zero length hides in no fallback
 * (`var(--x, none)`) and in no `min()`/`clamp()` argument.
 */
function valueTokens(value: string): readonly string[] {
  return value.toLowerCase().split(/[\s,/()*+]+/u).filter(token => token.length > 0);
}

function hasToken(value: string, keywords: ReadonlySet<string>): boolean {
  return valueTokens(value).some(token => keywords.has(token));
}

function hasZeroLengthToken(value: string): boolean {
  return valueTokens(value).some(token => isZeroLength(token));
}

/** Negative tracking beyond the typographic range (`-0.1em`, `-2px`) collapses text; `-0.05em` is a heading's tight tracking. */
function isCollapsingTracking(value: string): boolean {
  const match = /^-(\d*\.?\d+)([a-z%]*)$/u.exec(value.trim().toLowerCase());
  if (match === null) return hasNegativeLength(value);
  const magnitude = Number.parseFloat(match[1] ?? "0");
  const unit = match[2] ?? "";
  if (unit === "em" || unit === "rem" || unit === "ch" || unit === "ex") return magnitude >= TIGHTEST_TRACKING_EM;
  if (unit === "px") return magnitude >= TIGHTEST_TRACKING_PX;
  return true;
}

/**
 * True when `value` contains the `transparent` keyword, a zero-alpha colour
 * (`rgba()`/`hsla()` comma syntax, `rgb()`/`hsl()` slash syntax, 8-digit or
 * 4-digit hex), or a `color-mix()` (which can reach zero alpha by mixing).
 * Scans the whole value, so a shorthand such as `background: transparent
 * none` is caught too.
 */
function isFullyTransparent(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (/\btransparent\b/u.test(v)) return true;
  if (/\bcolor-mix\s*\(/u.test(v)) return true;
  for (const match of v.matchAll(/\b(?:rgba?|hsla?)\(([^)]*)\)/gu)) {
    const inner = match[1] ?? "";
    const alphaText = /[,/]\s*([\d.]+%?)\s*$/u.exec(inner)?.[1];
    if (alphaText === undefined) continue;
    const alpha = alphaText.endsWith("%") ? Number.parseFloat(alphaText) / 100 : Number.parseFloat(alphaText);
    if (Number.isFinite(alpha) && alpha === 0) return true;
  }
  for (const match of v.matchAll(/#([0-9a-f]{8})\b/gu)) if ((match[1] ?? "").slice(6, 8) === "00") return true;
  for (const match of v.matchAll(/#([0-9a-f]{4})\b/gu)) if ((match[1] ?? "")[3] === "0") return true;
  return false;
}

/** True when a custom-property value carries anything a guarded declaration could pick up through `var()`. */
function customPropertyCarriesHiding(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (isFullyTransparent(v)) return true;
  if (isZeroLength(v) || hasNegativeLength(v)) return true;
  return hasToken(v, HIDING_KEYWORDS);
}

const DISPLAY_HIDING = new Set(["none", "contents"]);
const OVERFLOW_HIDING = new Set(["hidden", "clip"]);
const POSITION_HIDING = new Set(["absolute", "fixed"]);

function where(selector: string): string {
  return selector.length === 0 ? "" : ` (selector ${selector})`;
}

function auditDeclaration(decl: Declaration): readonly string[] {
  const { property, selector } = decl;
  // `!important` changes priority, never meaning: audit the bare value.
  const value = decl.value.replace(/!\s*important\s*$/iu, "").trim();
  const v = value.toLowerCase();
  const reasons: string[] = [];
  const flag = (): void => { reasons.push(`${property}: ${decl.value}${where(selector)}`); };

  if (property.startsWith("--")) {
    if (customPropertyCarriesHiding(value)) flag();
    return reasons;
  }
  const negativeGuarded = NEGATIVE_LENGTH_PROPERTIES.has(property) || property.startsWith("margin-") || property.startsWith("inset-");
  if (FORBIDDEN_PROPERTIES.has(property)) flag();
  // Token checks reach into var() fallbacks and min()/clamp()/calc() arguments; `!important` was stripped above.
  if (property === "display" && hasToken(v, DISPLAY_HIDING)) flag();
  if (OVERFLOW_PROPERTIES.has(property) && hasToken(v, OVERFLOW_HIDING)) flag();
  if (property === "position" && hasToken(v, POSITION_HIDING)) flag();
  if (ZERO_LENGTH_PROPERTIES.has(property) && (hasZeroLengthToken(value) || hasNegativeLength(value))) flag();
  if (negativeGuarded && (hasNegativeLength(value) || /\s-\s/u.test(value))) flag();
  if (TRACKING_PROPERTIES.has(property) && isCollapsingTracking(value)) flag();
  if (isColorProperty(property) && isFullyTransparent(value)) flag();
  if (/\battr\s*\(/u.test(v)) flag();

  return reasons;
}

/**
 * Audits presentation stylesheet text for constructs able to hide, truncate,
 * or visually suppress rendered content, or to load an external resource.
 * Pure: no I/O, no clock, no environment. Returns the list of refusal
 * reasons; an empty array means the stylesheet is acceptable.
 */
export function auditPresentationStylesheet(text: string): readonly string[] {
  const stripped = stripComments(text);
  const reasons: string[] = [];

  if (/@import\b/iu.test(stripped)) reasons.push("@import (stylesheet must stay self-contained; no external resource load)");
  if (/url\s*\(/iu.test(stripped)) reasons.push("url( (stylesheet must stay self-contained; no external resource load)");
  // A CSS escape (`\6e one` is `none` to the browser) would let a declaration slip past every textual rule below.
  if (stripped.includes("\\")) reasons.push("backslash escape (a CSS escape could spell a refused keyword; the audit reads text, not the parsed identifier)");
  // CSS has no legitimate use for `<`; `>` stays allowed (the child combinator). A `<` lets the
  // stylesheet text break out of the inlined `<style>` block (`</style><script>...`) once it is
  // spliced into a page's HTML — this is a style-block breakout, not a CSS construct.
  if (stripped.includes("<")) reasons.push("< (style-block breakout: the inlined text could close </style> and inject markup; CSS has no legitimate use for `<`)");

  for (const decl of collectDeclarations(stripped)) reasons.push(...auditDeclaration(decl));

  return reasons;
}
