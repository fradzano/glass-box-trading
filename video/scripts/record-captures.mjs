// Screen-capture recorder for the five capture slots (video/README.md).
// Recorded 2026-09-04 against the pinned presentation route and the branch's
// GitHub blob view: headless Chrome through playwright-core (channel
// "chrome"), viewport 1920x1080, page zoom 1.4 (1.6 on GitHub), scripted
// eased scrolls on an absolute-time schedule so each scene's content lands
// inside its timeline slot and holds a static tail; the .webm is transcoded
// with ffmpeg to h264 (see the end of the file). Not part of `npm run render`:
// run it from a scratch directory that has `playwright-core` installed
// (`npm init -y && npm install playwright-core`; playwright-core needs an
// ffmpeg at its own path to record — a copy of any ffmpeg 6+ works) with
// `node record-captures.mjs <sceneId>` and move the mp4 to public/captures/.
// Known weak spot: GitHub's blob view virtualises rows, so a jump to a line
// anchor under body zoom can render blank; the source-and-tests capture shows
// the spec file from its top for that reason.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const ROUTE = 'https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/';
const OUT = path.resolve('recordings');
fs.mkdirSync(OUT, { recursive: true });

const scene = process.argv[2];
let T0 = 0;
const el = () => (Date.now() - T0) / 1000;

async function at(page, seconds) {
  const ms = seconds * 1000 - (Date.now() - T0);
  if (ms > 0) await page.waitForTimeout(ms);
}

async function setZoom(page, z) {
  await page.evaluate((zz) => { document.body.style.zoom = String(zz); }, z);
  await page.waitForTimeout(300);
}

async function yOf(page, sel) {
  return await page.evaluate((s) => {
    const e = document.querySelector(s);
    return e ? Math.round(e.getBoundingClientRect().top + window.scrollY) : null;
  }, sel);
}

async function yOfText(page, scope, needle) {
  return await page.evaluate(([s, n]) => {
    const root = document.querySelector(s);
    if (!root) return null;
    const els = [...root.querySelectorAll('*')].filter((e) => (e.textContent || '').includes(n));
    const sized = els.map((e) => ({ e, h: e.getBoundingClientRect().height })).filter((x) => x.h >= 18);
    sized.sort((a, b) => a.h - b.h);
    const hit = (sized[0] || {}).e || els[els.length - 1];
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return Math.round(r.top + window.scrollY + r.height / 2);
  }, [scope, needle]);
}

async function glide(page, y, ms) {
  await page.evaluate(([target, dur]) => new Promise((res) => {
    const start = window.scrollY;
    const delta = target - start;
    const t0 = performance.now();
    function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      window.scrollTo(0, start + delta * e);
      if (p < 1) requestAnimationFrame(step); else res();
    }
    requestAnimationFrame(step);
  }), [y, ms]);
}

async function jump(page, y) {
  await page.evaluate((t) => window.scrollTo(0, t), y);
  await page.waitForTimeout(200);
}

const scenes = {
  // slot 30 s -> record 34 s
  async dashboardOpen(page) {
    await page.waitForTimeout(1000);
    await page.goto(ROUTE, { waitUntil: 'networkidle', timeout: 120000 });
    await setZoom(page, 1.4);
    const r = await yOf(page, '#result');
    const g = await yOf(page, '#golden-path');
    await at(page, 9);
    await glide(page, r, 2500);
    await at(page, 17);
    await glide(page, r + 700, 2500);
    await at(page, 22);
    await glide(page, g, 3000);
    await at(page, 28.5);
    await glide(page, g + 600, 2500);
    await at(page, 34);
  },

  // slot 40 s -> record 43 s
  async decisionCycle(page) {
    await page.goto(ROUTE, { waitUntil: 'networkidle', timeout: 120000 });
    await setZoom(page, 1.4);
    const base = (await yOf(page, '#cycle-7')) - 40;
    await jump(page, base);
    await at(page, 13);
    await glide(page, base + 430, 3000);
    await at(page, 22);
    await glide(page, base + 860, 3000);
    await at(page, 31);
    await glide(page, base + 1290, 3000);
    await at(page, 43);
  },

  // slot 35 s -> record 38 s
  async gateVector(page) {
    await page.goto(ROUTE, { waitUntil: 'networkidle', timeout: 120000 });
    await setZoom(page, 1.4);
    const g70 = (await yOf(page, '#gates-7-0')) - 150;
    const g71 = (await yOf(page, '#gates-7-1')) - 150;
    const c2 = (await yOf(page, '#cycle-2')) - 40;
    const liq = await yOfText(page, '#cycle-2', 'LIQUIDITY');
    await jump(page, g70);
    await at(page, 11);
    await glide(page, g71, 3000);
    await at(page, 18);
    await glide(page, c2, 3000);
    await at(page, 24);
    await glide(page, Math.max(0, (liq ?? c2 + 500) - 540), 3000);
    await at(page, 38);
  },

  // slot 30 s -> record 34 s
  async orderToOutcome(page) {
    await page.goto(ROUTE, { waitUntil: 'networkidle', timeout: 120000 });
    await setZoom(page, 1.4);
    const lc = (await yOf(page, '#lifecycles')) - 40;
    const feat = await yOfText(page, '#lifecycles', '28f7a3b9');
    const rec = (await yOf(page, '#reconciliation')) - 40;
    const featTop = Math.max(0, (feat ?? lc + 500) - 500);
    await jump(page, lc);
    await at(page, 8);
    await glide(page, featTop, 2500);
    await at(page, 17);
    await glide(page, featTop + 560, 2500);
    await at(page, 22);
    await glide(page, rec, 3000);
    await at(page, 28);
    await glide(page, rec + 560, 2500);
    await at(page, 34);
  },

  // slot 30 s -> record 34 s
  async sourceAndTests(page) {
    await page.goto('https://github.com/fradzano/glass-box-trading/blob/p7/dev-live-certificate/src/core/decision.ts', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(3500);
    await setZoom(page, 1.6);
    await at(page, 8);
    await glide(page, 420, 2000);
    await at(page, 12);
    // The blob view virtualises far-down rows and renders blank under page
    // zoom, so this stays in the rendered top window of the file, where the
    // header comment names the S-CYC evidence-debt paths this spec executes.
    await page.goto('https://github.com/fradzano/glass-box-trading/blob/p7/dev-live-certificate/tests/cyc-runner.spec.ts', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(4000);
    await setZoom(page, 1.6);
    await at(page, 22);
    await glide(page, 380, 2000);
    await at(page, 27);
    await page.goto(ROUTE, { waitUntil: 'networkidle', timeout: 120000 });
    await setZoom(page, 1.4);
    await jump(page, (await yOf(page, '#reconciliation')) - 40);
    await at(page, 34);
  },
};

if (!scenes[scene]) { console.error('unknown scene', scene); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: path.join(OUT, scene), size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();
T0 = Date.now();
await scenes[scene](page);
console.log('scene seconds:', el().toFixed(1));
const vpath = await page.video().path();
await ctx.close();
await browser.close();
console.log('video:', vpath);
