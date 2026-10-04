#!/usr/bin/env node
// Screenshot harness. Usage:
//   node tools/shot.mjs vista forest player [--out shots/run1] [--w 1280] [--h 720] [--frames 90] [--query "a=1&b=2"]
// Serves the game folder on an ephemeral port, opens each preset in headless
// Chromium (WebGL via SwiftShader), waits for window.__shotReady, writes PNGs,
// and prints console errors + per-shot timing so regressions are visible.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = path.resolve(root, opt('out', 'shots/latest'));
const W = +opt('w', 1280), H = +opt('h', 720), frames = +opt('frames', 90), extra = opt('query', '');
const timeout = +opt('timeout', 240000);
const presets = args.length ? args : ['vista'];
fs.mkdirSync(out, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let failed = 0;
for (const name of presets) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  const url = `http://127.0.0.1:${port}/index.html?shot=${name}&frames=${frames}${extra ? '&' + extra : ''}`;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout, polling: 250 });
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    const fps = await page.evaluate(() => window.__ctx?.engine ? (1 / (window.__ctx.engine.clock.getDelta() || 1)).toFixed(1) : '?');
    console.log(`OK   ${name} -> ${path.relative(root, file)} (${((Date.now() - t0) / 1000).toFixed(1)}s, ~${fps}fps swiftshader)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    try { await page.screenshot({ path: path.join(out, `${name}.FAILED.png`) }); } catch {}
  }
  const uniq = [...new Set(errors)];
  for (const e of uniq.slice(0, 25)) console.log('     ' + e.slice(0, 400));
  if (uniq.length > 25) console.log(`     ... ${uniq.length - 25} more console messages`);
  await page.close();
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
