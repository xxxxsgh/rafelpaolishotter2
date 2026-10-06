// In-game HUD: hearts, quest tracker, compass ribbon, minimap + sky dial + temperature,
// equipment diamonds with durability pips, prompt/toast/banner (api), damage + chill vignettes.
import { drawHeart, makeCanvas, esc, fmtClock } from './draw.js';
import { createMinimap, createCompass } from './map.js';

const WEATHER_LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Mist', snow: 'Snow' };

export function createHud(ctx, md, root) {
  const layer = document.createElement('div'); layer.className = 'wb-layer wb-hudlayer';
  root.appendChild(layer);
  const el = (cls, html = '', parent = layer) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; };

  const vign = el('wb-vignette');
  const chill = el('wb-chill');
  // ------------------------------------------------ vitals
  const vitals = el('wb-vitals');
  const heartsEl = el('wb-hearts', '', vitals);
  el('wb-vrule', '', vitals);
  const questEl = el('wb-quest wb-shadow-text', '', vitals);
  const hearts = [];   // {c, g, fill}
  let lastHealth = -1, lastMax = -1;
  function syncHearts(health, max) {
    const n = Math.max(1, Math.ceil(max / 4));
    while (hearts.length < n) { const { c, g } = makeCanvas(30, 30, 2); heartsEl.appendChild(c); hearts.push({ c, g, fill: -1 }); }
    while (hearts.length > n) hearts.pop().c.remove();
    for (let i = 0; i < n; i++) {
      const f = Math.max(0, Math.min(1, (health - i * 4) / 4));
      const h = hearts[i];
      if (h.fill !== f) { drawHeart(h.g, 30, f); h.fill = f; }
    }
    const low = health > 0 && health <= 4;
    const last = hearts[Math.max(0, Math.ceil(health / 4) - 1)];
    for (const h of hearts) h.c.classList.toggle('pulse', low && h === last);
  }

  // ------------------------------------------------ compass + minimap + env
  const compassEl = el('wb-compass');
  const nav = el('wb-nav');
  const minimap = createMinimap(ctx, md, nav);
  const compass = createCompass(ctx, md, compassEl, minimap);
  const env = el('env wb-shadow-text', '<span class="tm"></span><i class="sep"></i><span class="wx"></span><i class="sep"></i><span class="tp"></span>', nav);
  const tmEl = env.querySelector('.tm'), wxEl = env.querySelector('.wx'), tpEl = env.querySelector('.tp');

  // ------------------------------------------------ gear
  const gear = el('wb-gear');
  const mkSlot = (cls, label, x, y) => {
    const s = el('wb-slot ' + cls + ' empty', `<div class="dia"></div><img alt=""><div class="pips"></div><div class="lbl">${label}</div><div class="cnt"></div>`, gear);
    s.style.left = x + 'px'; s.style.top = y + 'px';
    return { el: s, img: s.querySelector('img'), pips: s.querySelector('.pips'), cnt: s.querySelector('.cnt'), key: '' };
  };
  const slots = {
    shield: mkSlot('', 'Shield', 8, 44),
    weapon: mkSlot('main', 'Weapon', 76, 12),
    bow: mkSlot('', 'Bow', 164, 44),
  };
  const gearName = el('name', '', gear);
  let gearNameT = 0;
  function iconFor(w) {
    try { return ctx.systems.gameplay?.getIcon?.(w) || ''; } catch { return ''; }
  }
  function syncGear() {
    const W = ctx.systems.combat?.getInventoryWeapons?.();
    const eq = W?.equipped || {};
    for (const k of ['weapon', 'shield', 'bow']) {
      const w = eq[k], s = slots[k];
      const pip = w && w.maxDur ? Math.max(0, Math.ceil((w.dur / w.maxDur) * 5 - 1e-6)) : 0;
      const key = w ? `${w.uid || w.id}|${pip}` : '';
      if (k === 'bow') { const a = W?.arrows ?? ''; if (s.cnt._v !== a) { s.cnt.textContent = w ? (a === '' ? '' : '×' + a) : ''; s.cnt._v = a; } }
      if (key === s.key) continue;
      const changedItem = (s.key.split('|')[0] || '') !== (w ? String(w.uid || w.id) : '');
      s.key = key;
      s.el.classList.toggle('empty', !w);
      if (w) {
        if (changedItem) { s.img.src = iconFor(w); if (k === 'weapon') { gearName.textContent = w.name || ''; gearNameT = 2.5; } }
        let h = ''; for (let i = 0; i < 5; i++) h += `<i class="${i < pip ? '' : 'off'}"></i>`;
        s.pips.innerHTML = h;
        s.el.classList.toggle('low', pip <= 1);
      } else { s.pips.innerHTML = ''; s.el.classList.remove('low'); }
    }
  }

  // ------------------------------------------------ prompt / toasts / banner
  const prompt = el('wb-prompt', '<span class="wb-key">E</span><span class="t"></span>');
  const pKey = prompt.children[0], pText = prompt.children[1];
  const toasts = el('wb-toasts');
  const banner = el('wb-banner', '<div class="k"></div><div class="t"></div><div class="r"></div><div class="s"></div>');
  let bannerT = 0; const bannerQ = [];

  // ------------------------------------------------ events
  let vignT = 0;
  ctx.events.on('damage', e => {
    if (e && e.target && e.target !== 'player') return;
    vignT = Math.min(1, 0.45 + (e?.amount || 1) * 0.12);
    for (const h of hearts) { h.c.classList.remove('hit'); void h.c.offsetWidth; }
    const idx = Math.min(hearts.length - 1, Math.floor((e?.health ?? 0) / 4));
    hearts[idx]?.c.classList.add('hit');
  });
  ctx.events.on('weaponBroke', e => api.toast(`${e?.weapon?.name || 'Weapon'} shattered`));
  ctx.events.on('weaponLow', e => api.toast(`${e?.weapon?.name || 'Weapon'} is badly worn`));

  let questKey = '', acc = 0, slowAcc = 1;
  let regionCand = '', regionNow = null, regionT = 0; const regionsSeen = new Set();
  const api = {
    layer, minimap,
    prompt(text, key = 'E') {
      if (!text) { prompt.classList.remove('on'); return; }
      if (pText._t !== text) { pText.textContent = text; pText._t = text; }
      pKey.textContent = key; prompt.classList.add('on');
    },
    toast(text) {
      const t = el('wb-toast wb-shadow-text', esc(text), toasts);
      while (toasts.children.length > 4) toasts.firstChild.remove();
      if (ctx.shotMode) return;   // keep notices on screen for stills
      setTimeout(() => t.classList.add('out'), 2800);
      setTimeout(() => t.remove(), 3400);
    },
    banner(title, sub = '', kicker = '') { bannerQ.push({ title, sub, kicker }); if (bannerQ.length > 3) bannerQ.shift(); },
    update(dt) {
      const pl = ctx.systems.player, sky = ctx.systems.sky;
      acc += dt; slowAcc += dt;
      // vitals (cheap: only redraw on change)
      if (pl) {
        const hp = pl.health, mx = pl.maxHealth;
        if (hp !== lastHealth || mx !== lastMax) { syncHearts(hp, mx); lastHealth = hp; lastMax = mx; }
        const low = hp > 0 && hp <= 4;
        vign.classList.toggle('low', low && vignT <= 0.05);
      }
      if (vignT > 0) { vignT = Math.max(0, vignT - dt * 1.4); vign.style.opacity = vignT.toFixed(3); }
      else if (!vign.classList.contains('low')) vign.style.opacity = '0';
      const hour = sky?.getTime?.() ?? 12, day = sky?.getDaylight?.() ?? 1;
      minimap.update(dt, hour, day);
      compass.update(dt);
      if (slowAcc > 0.25) {
        slowAcc = 0;
        tmEl.textContent = fmtClock(hour);
        const wx = sky?.getWeather?.() || 'clear';
        wxEl.textContent = WEATHER_LABEL[wx] || wx;
        const T = ctx.systems.gameplay?.temperature;
        if (T) {
          tpEl.textContent = `${Math.round(T.value)}°`;
          tpEl.className = 'tp ' + (T.state === 'cold' || T.state === 'freezing' ? 'cold' : T.state === 'hot' || T.state === 'scorching' ? 'hot' : '');
          chill.style.opacity = T.state === 'freezing' ? '1' : T.state === 'cold' ? '.5' : '0';
        } else tpEl.textContent = '';
        syncGear();
        // quest tracker
        let q = null; try { q = ctx.systems.gameplay?.quests?.current?.(); } catch { q = null; }
        let dist = '';
        try {
          const o = ctx.systems.gameplay?.quests?.objectives?.() || [];
          const p = pl?.position;
          if (p && o.length) { let best = 1e9; for (const m of o) best = Math.min(best, Math.hypot(m.x - p.x, m.z - p.z)); dist = best < 1e8 ? `${best > 1000 ? (best / 1000).toFixed(1) + ' km' : Math.round(best) + ' m'} away` : ''; }
        } catch { dist = ''; }
        const key = q?.quest ? q.quest.title + '|' + (q.step?.text || '') + '|' + dist : '';
        if (key !== questKey) {
          questKey = key;
          questEl.innerHTML = q?.quest ? `<div class="qt">${esc(q.quest.title)}</div><div class="qs">${esc(q.step?.text || 'Complete')}</div>${dist ? `<div class="qd">${dist}</div>` : ''}` : '';
        }
        // remember where we have been (fog of war)
        if (pl?.position) {
          md.explore(pl.position.x, pl.position.z);
          // region discovery banner: announce a new region after lingering in it a moment
          const rn = md.regionName(pl.position.x, pl.position.z);
          if (rn !== regionCand) { regionCand = rn; regionT = 0; }
          else if (rn && rn !== regionNow) {
            regionT += 0.25;
            if (regionT > 3) {
              if (regionNow !== null && !regionsSeen.has(rn) && !ctx.shotMode && !ctx.paused) api.banner(rn, '', 'Entering');
              regionsSeen.add(rn); regionNow = rn;
            }
          }
        }
      }
      if (gearNameT > 0) { gearNameT -= dt; gearName.classList.toggle('on', gearNameT > 0); }
      // banner queue
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0.9) banner.classList.remove('on'); }
      else if (bannerQ.length) {
        const b = bannerQ.shift();
        banner.querySelector('.k').textContent = b.kicker || '';
        banner.querySelector('.t').textContent = b.title;
        banner.querySelector('.s').textContent = b.sub || '';
        banner.classList.add('on'); bannerT = 4.5;
      }
      void acc;
    },
  };
  return api;
}
