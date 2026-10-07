#!/usr/bin/env node
// Offline audio renders for review without speakers.
//   node tools/audio-render.mjs [scenario...] [--out shots/audio-render]
// Renders each audio layer (music moods, combat, sanctum, ambience beds, SFX
// banks, a full gameplay mix) with an OfflineAudioContext in headless Chromium,
// using the game's own src/systems/audio code. Writes per scenario:
//   <name>.wav   16-bit stereo 44.1 kHz
//   <name>.png   waveform + log-frequency spectrogram with labelled event markers
// plus overview.png (contact sheet of all spectrograms) and report.json
// (peak / RMS dBFS per layer). Scenario list: src/systems/audio/render.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = path.resolve(root, opt('out', 'shots/audio-render'));
fs.mkdirSync(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__audio.html') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset="utf-8"><title>audio render</title><body></body>'); return; }
  const p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:${port}/__audio.html`);
const all = await page.evaluate(async () => Object.keys((await import('/src/systems/audio/render.js')).SCENARIOS));
const names = args.length ? args : all;

function wav(pcmB64, sr) {
  const pcm = Buffer.from(pcmB64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const report = [];
const pngs = [];
let failed = 0;
for (const name of names) {
  const t0 = Date.now();
  try {
    const r = await page.evaluate(async n => (await import('/src/systems/audio/render.js')).renderScenario(n), name);
    fs.writeFileSync(path.join(out, name + '.wav'), wav(r.pcm, r.sr));
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    pngs.push({ name, png: r.png });
    report.push({ name, desc: r.desc, seconds: r.dur, peakDb: r.peakDb, rmsDb: r.rmsDb });
    console.log(`OK   ${name.padEnd(20)} ${String(r.dur).padStart(3)}s  peak ${String(r.peakDb).padStart(6)} dBFS  rms ${String(r.rmsDb).padStart(6)} dBFS  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}
if (pngs.length > 1) {
  const sheet = await page.evaluate(async items => (await import('/src/systems/audio/render.js')).contactSheet(items), pngs);
  fs.writeFileSync(path.join(out, 'overview.png'), Buffer.from(sheet.split(',')[1], 'base64'));
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
for (const e of [...new Set(errors)].slice(0, 20)) console.log('     ' + e.slice(0, 300));
console.log(`-> ${path.relative(root, out)}/`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
