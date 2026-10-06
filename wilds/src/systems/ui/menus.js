// Full-screen menus: inventory (tabs, item cards, details), pause/settings, title screen.
import { makeCanvas, drawHeart, tabIcon, esc, glyph } from './draw.js';

const DEFAULT_CATS = [
  { id: 'weapons', name: 'Weapons' }, { id: 'bows', name: 'Bows' }, { id: 'shields', name: 'Shields' },
  { id: 'materials', name: 'Materials' }, { id: 'food', name: 'Food' }, { id: 'key', name: 'Key Items' },
];

function heartsRow(q, px = 22) {
  const wrap = document.createElement('div'); wrap.className = 'hh';
  if (q >= 999) { wrap.innerHTML = '<span style="font:italic 14px var(--wb-serif);color:var(--wb-gold-hi)">Full recovery</span>'; return wrap; }
  let left = q, n = 0;
  while (left > 0 && n < 40) { const f = Math.min(4, left) / 4; const { c, g } = makeCanvas(px, px, 2); drawHeart(g, px, f); wrap.appendChild(c); left -= 4; n++; }
  return wrap;
}
const fmtTime = s => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ==================================================================== inventory
export function createInventory(ctx, screen) {
  screen.innerHTML = `<div class="wb-backdrop"></div>
    <div class="wb-head"><h1><small>Traveller’s Pack</small>Inventory</h1><div class="aside"><span class="shards"></span></div></div>
    <div class="wb-rule" style="top:104px"></div>
    <div class="wb-tabs"></div>
    <div class="wb-inv-body"><div class="wb-hero"></div><div class="wb-grid-wrap"><div class="wb-grid"></div></div><div class="wb-detail"></div></div>
    <div class="wb-foot"><span><i class="wb-key">Q</i><i class="wb-key">E</i>Switch tab</span><span><i class="wb-key">Enter</i>Use</span><span><i class="wb-key">Tab</i>Close</span></div>`;
  const $ = s => screen.querySelector(s);
  const tabsEl = $('.wb-tabs'), grid = $('.wb-grid'), detail = $('.wb-detail'), hero = $('.wb-hero'), shardsEl = $('.shards');
  let cats = DEFAULT_CATS, cur = 'materials', sel = null, list = [], open = false, offInv = null;
  const seen = new Set();

  const gp = () => ctx.systems.gameplay;
  const icon = e => { try { return gp()?.getIcon?.(e.dish || e.weapon || e.id) || ''; } catch { return ''; } };
  const getList = cat => { try { return gp()?.inventory?.list?.(cat) || []; } catch { return []; } };

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const c of cats) {
      const n = getList(c.id).length;
      const t = document.createElement('div'); t.className = 'wb-tab' + (c.id === cur ? ' on' : ''); t.dataset.t = c.id;
      t.appendChild(tabIcon(c.id));
      t.insertAdjacentHTML('beforeend', `${esc(c.name)}<span class="n">${n || ''}</span>`);
      tabsEl.appendChild(t);
    }
  }
  function renderHero() {
    const pl = ctx.systems.player, W = ctx.systems.combat?.getInventoryWeapons?.();
    hero.innerHTML = '<div class="cap">Wayfarer</div>';
    hero.appendChild(heartsRow(pl?.health ?? 12, 24));
    const T = gp()?.temperature;
    const stats = [
      ['Shards', gp()?.shards ?? 0], ['Arrows', W?.arrows ?? '—'], ['Blastcaps', W?.blastcaps ?? '—'],
      ['Stamina', pl ? Math.round(pl.stamina / pl.maxStamina * 100) + '%' : '—'], ['Body warmth', T ? Math.round(T.value) + '°' : '—'],
    ];
    for (const [k, v] of stats) hero.insertAdjacentHTML('beforeend', `<div class="stat">${k}<b>${esc(v)}</b></div>`);
    const eq = W?.equipped || {};
    const eqEl = document.createElement('div'); eqEl.className = 'eq'; eqEl.style.marginTop = '8px';
    for (const [k, n] of [['weapon', 'Weapon'], ['shield', 'Shield'], ['bow', 'Bow']]) {
      const w = eq[k];
      eqEl.insertAdjacentHTML('beforeend', `<div>${w ? `<img src="${icon({ weapon: w })}">` : ''}<span>${n}</span></div>`);
    }
    hero.insertAdjacentHTML('beforeend', '<div class="cap" style="margin-top:6px">Equipped</div>');
    hero.appendChild(eqEl);
    const buffs = gp()?.buffs, effects = gp()?.effects || {};
    if (buffs && buffs.size) {
      const b = document.createElement('div'); b.className = 'wb-buffs'; b.style.marginTop = '18px';
      for (const [e, v] of buffs) b.insertAdjacentHTML('beforeend', `<div class="wb-buff"><i style="background:${effects[e]?.color || '#fff'}"></i>${esc(effects[e]?.name || e)} ${v.level ? 'Lv' + v.level : ''}<span>${fmtTime(v.time)}</span></div>`);
      hero.insertAdjacentHTML('beforeend', '<div class="cap" style="margin-top:16px">Effects</div>');
      hero.appendChild(b);
    }
    shardsEl.innerHTML = '';
    const { c, g } = makeCanvas(18, 18, 2);
    g.beginPath(); g.moveTo(9, 1); g.lineTo(15, 8); g.lineTo(9, 17); g.lineTo(3, 8); g.closePath();
    const gr = g.createLinearGradient(3, 1, 15, 17); gr.addColorStop(0, '#e6fbff'); gr.addColorStop(1, '#5fb8d8'); g.fillStyle = gr; g.fill();
    g.strokeStyle = '#f4dfae'; g.lineWidth = 1; g.stroke();
    shardsEl.appendChild(c); shardsEl.insertAdjacentHTML('beforeend', ` ${gp()?.shards ?? 0}`);
    shardsEl.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font:400 17px var(--wb-serif);color:var(--wb-gold-hi)';
  }
  function renderGrid() {
    list = getList(cur);
    if (!sel || !list.find(e => e.key === sel)) sel = list[0]?.key ?? null;
    grid.innerHTML = '';
    if (!list.length) { grid.innerHTML = `<div class="wb-empty">Nothing carried here yet.<br>The wilds will provide.</div>`; return; }
    for (const e of list) {
      const card = document.createElement('div');
      card.className = 'wb-card' + (e.key === sel ? ' sel' : '') + (!seen.has(e.key) && open && seen.size ? ' new' : '');
      card.dataset.k = e.key;
      let extra = '';
      if (e.weapon && e.weapon.maxDur) {
        const p = Math.ceil((e.weapon.dur / e.weapon.maxDur) * 6 - 1e-6);
        extra += `<div class="dur ${p <= 1 ? 'low' : ''}">${Array.from({ length: 6 }, (_, i) => `<i class="${i < p ? '' : 'off'}"></i>`).join('')}</div>`;
      }
      if (e.equipped) extra += '<div class="eqd"><b>✓</b></div>';
      card.innerHTML = `<img src="${icon(e)}" alt="">${e.count > 1 ? `<div class="q">×${e.count}</div>` : ''}${extra}`;
      grid.appendChild(card);
    }
  }
  function renderDetail() {
    const e = list.find(x => x.key === sel);
    detail.innerHTML = '';
    if (!e) { detail.innerHTML = '<div class="wb-empty" style="margin:auto">—</div>'; return; }
    const catName = (cats.find(c => c.id === cur) || {}).name || '';
    detail.insertAdjacentHTML('beforeend', `<div class="art"><img src="${icon(e)}" alt=""></div><div class="cap">${esc(catName)}</div><h2>${esc(e.name)}</h2>`);
    const meta = document.createElement('div'); meta.className = 'meta';
    const d = e.dish, it = e.item, w = e.weapon, effects = gp()?.effects || {};
    const hp = d ? d.hp : it?.edible || it?.hp ? it.hp : 0;
    if (hp) meta.appendChild(heartsRow(hp));
    const eff = d?.effect || it?.effect;
    if (eff && effects[eff] && eff !== 'hearty') {
      const E = effects[eff];
      const extra = d ? (eff === 'vigor' ? ` · ${d.stamina || ''}%` : `${d.level ? ' Lv' + d.level : ''}${d.duration ? ' · ' + fmtTime(d.duration) : ''}`) : '';
      meta.insertAdjacentHTML('beforeend', `<span class="chip"><i style="background:${E.color}"></i>${esc(E.name)}${extra}</span>`);
    }
    if (w) {
      meta.insertAdjacentHTML('beforeend', `<span class="chip"><i style="background:#f4dfae"></i>${w.type === 'shield' || cur === 'shields' ? 'Guard' : 'Power'} ${esc(w.dmg ?? '?')}</span>`);
      if (w.type) meta.insertAdjacentHTML('beforeend', `<span class="chip">${esc(String(w.type).replace(/_/g, ' '))}</span>`);
    }
    if (e.count > 1) meta.insertAdjacentHTML('beforeend', `<span class="chip">Carrying ${e.count}</span>`);
    if (e.value) meta.insertAdjacentHTML('beforeend', `<span class="chip">Worth ${e.value} shards</span>`);
    detail.appendChild(meta);
    if (w && w.maxDur) {
      detail.insertAdjacentHTML('beforeend', `<div class="cap" style="margin-top:14px">Durability · ${Math.ceil(w.dur)} / ${w.maxDur}</div><div class="bar"><b style="width:${Math.round(100 * w.dur / w.maxDur)}%"></b></div>`);
    }
    let desc = e.desc || it?.desc || d?.desc || '';
    if (w && !it) desc = WEAPON_LORE[cur] || desc;
    detail.insertAdjacentHTML('beforeend', `<div class="desc">${esc(desc)}</div>`);
    const act = document.createElement('div'); act.className = 'wb-actions';
    if (d || it?.edible) act.innerHTML = '<div class="wb-btn" data-a="eat"><i class="wb-key">Enter</i>Eat</div>';
    else if (w) act.innerHTML = `<div class="wb-btn" data-a="equip"><i class="wb-key">Enter</i>${e.equipped ? 'Equipped' : 'Equip'}</div>`;
    detail.appendChild(act);
  }
  function render() { renderTabs(); renderHero(); renderGrid(); renderDetail(); }
  function act() {
    const e = list.find(x => x.key === sel); if (!e) return;
    if (e.dish || e.item?.edible) { gp()?.eat?.(e.key, cur); }
    else if (e.weapon) { ctx.systems.combat?.equip?.(e.key); ctx.events.emit('equipWeapon', { uid: e.key }); }
    render();
  }
  function move(dx, dy) {
    if (!list.length) return;
    const i = Math.max(0, list.findIndex(x => x.key === sel));
    const cols = Math.max(1, Math.round(grid.clientWidth / 104) || 6);
    const j = Math.max(0, Math.min(list.length - 1, i + dx + dy * cols));
    sel = list[j].key; renderGrid(); renderDetail();
    grid.querySelector('.sel')?.scrollIntoView?.({ block: 'nearest' });
  }
  function tab(d) { const i = cats.findIndex(c => c.id === cur); cur = cats[(i + d + cats.length) % cats.length].id; sel = null; render(); }

  screen.addEventListener('click', e => {
    const t = e.target.closest('[data-t]'), c = e.target.closest('[data-k]'), a = e.target.closest('[data-a]');
    if (t) { cur = t.dataset.t; sel = null; render(); }
    else if (c) { if (sel === c.dataset.k) act(); else { sel = c.dataset.k; renderGrid(); renderDetail(); } }
    else if (a) act();
  });

  return {
    open(opts = {}) {
      cats = gp()?.categories || DEFAULT_CATS;
      if (opts.tab) cur = opts.tab;
      if (opts.select) sel = opts.select;
      open = true;
      render();
      for (const e of list) seen.add(e.key);
      offInv = gp()?.inventory?.onChange?.(() => { if (open) render(); }) || null;
    },
    close() { open = false; for (const c of cats) for (const e of getList(c.id)) seen.add(e.key); offInv?.(); offInv = null; },
    key(e) {
      const k = e.code;
      if (k === 'KeyQ' || k === 'BracketLeft' || k === 'PageUp') tab(-1);
      else if (k === 'KeyE' || k === 'BracketRight' || k === 'PageDown') tab(1);
      else if (k === 'ArrowLeft' || k === 'KeyA') move(-1, 0);
      else if (k === 'ArrowRight' || k === 'KeyD') move(1, 0);
      else if (k === 'ArrowUp' || k === 'KeyW') move(0, -1);
      else if (k === 'ArrowDown' || k === 'KeyS') move(0, 1);
      else if (k === 'Enter' || k === 'Space') act();
      else return false;
      return true;
    },
  };
}
const WEAPON_LORE = {
  weapons: 'A weapon taken from the wilds. Every blow wears it down; when the pips run dry it will shatter.',
  bows: 'A hunting bow. Draw slowly for a truer flight — arrows are carried in the quiver.',
  shields: 'Raise it to turn aside blows, or time a push to send an attack back at its owner.',
};

// ==================================================================== pause / settings
export const SETTINGS_KEY = 'windborne.settings.v1';
export function loadSettings() {
  const def = { quality: 'high', sensitivity: 1, invertY: false, volume: 0.8, hud: 'full' };
  try { return { ...def, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; } catch { return def; }
}
export function createPause(ctx, screen, settings, hooks) {
  screen.innerHTML = `<div class="wb-backdrop"></div>
    <div class="wb-head"><h1><small>The journey rests</small>Paused</h1><div class="aside"><span class="clock"></span></div></div>
    <div class="wb-rule" style="top:104px"></div>
    <div class="wb-pause-panel"><div class="wb-menu"></div><div class="wb-pane"></div></div>
    <div class="wb-foot"><span><i class="wb-key">↑</i><i class="wb-key">↓</i>Choose</span><span><i class="wb-key">Enter</i>Select</span><span><i class="wb-key">Esc</i>Resume</span></div>`;
  const menu = screen.querySelector('.wb-menu'), pane = screen.querySelector('.wb-pane'), clock = screen.querySelector('.clock');
  const items = [
    ['resume', 'Resume'], ['settings', 'Settings'], ['controls', 'Controls'], ['save', 'Save Journey'], ['title', 'Return to Title'],
  ];
  let cur = 'resume', note = '';
  function renderMenu() {
    menu.innerHTML = items.map(([id, n]) => `<div class="it ${id === cur ? 'on' : ''}" data-m="${id}">${n}</div>`).join('');
  }
  function seg(key, opts) {
    return `<div class="seg" data-s="${key}">${opts.map(([v, n]) => `<b data-v="${v}" class="${String(settings[key]) === String(v) ? 'on' : ''}">${n}</b>`).join('')}</div>`;
  }
  function renderPane() {
    if (cur === 'settings') {
      pane.innerHTML = `<div class="cap">Settings</div>
        <div class="wb-opt">Graphics quality ${seg('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}</div>
        <div class="wb-opt">Camera sensitivity <span style="display:flex;align-items:center;gap:12px"><input type="range" min="0.2" max="3" step="0.05" value="${settings.sensitivity}" data-r="sensitivity"><span class="val">${(+settings.sensitivity).toFixed(2)}</span></span></div>
        <div class="wb-opt">Invert vertical look ${seg('invertY', [[false, 'Off'], [true, 'On']])}</div>
        <div class="wb-opt">Master volume <span style="display:flex;align-items:center;gap:12px"><input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-r="volume"><span class="val">${Math.round(settings.volume * 100)}</span></span></div>
        <div class="wb-opt">Interface ${seg('hud', [['full', 'Full'], ['minimal', 'Minimal']])}</div>`;
    } else if (cur === 'controls') {
      const rows = [['Move', 'W A S D'], ['Look', 'Mouse'], ['Jump · climb · glide', 'Space'], ['Sprint', 'Shift'], ['Crouch', 'C'], ['Attack', 'LMB'], ['Draw bow', 'RMB'],
        ['Shield', 'Q'], ['Lock on', 'F'], ['Interact', 'E'], ['Throw', 'R'], ['Inventory', 'Tab'], ['Map', 'M'], ['Quick save', 'F5']];
      pane.innerHTML = `<div class="cap">Controls</div><div class="wb-ctl">${rows.map(([a, k]) => `<span>${a}</span><span>${k.split(' ').map(x => `<i class="wb-key">${x}</i>`).join(' ')}</span>`).join('')}</div>`;
    } else if (cur === 'save') {
      pane.innerHTML = `<div class="cap">Save Journey</div><p>Your journey is also kept automatically whenever you rest at a fire, wake a spire or close the window.</p><div class="wb-btn" data-do="save">Save now</div><p class="note">${esc(note)}</p>`;
    } else if (cur === 'title') {
      pane.innerHTML = `<div class="cap">Return to Title</div><p>The isle will wait. Progress since your last save will be kept in the autosave.</p><div class="wb-btn" data-do="title">Return to title</div>`;
    } else {
      let q = null; try { q = ctx.systems.gameplay?.quests?.current?.(); } catch { q = null; }
      const sp = ctx.systems.gameplay?.spires || [];
      const sn = ctx.systems.physics?.sanctums || [];
      pane.innerHTML = `<div class="cap">Journal</div>
        ${q?.quest ? `<div class="wb-quest" style="max-width:none"><div class="qt" style="font-size:17px">${esc(q.quest.title)}</div><div class="qs" style="font-size:14px">${esc(q.step?.text || 'Complete')}</div></div>` : ''}
        <p style="margin-top:18px">${esc(q?.quest?.desc || '')}</p>
        <div class="wb-opt">Windstone Spires awakened <span class="val" style="width:auto">${sp.filter(s => s.active).length} / ${sp.length}</span></div>
        <div class="wb-opt">Sanctums solved <span class="val" style="width:auto">${sn.filter(s => s.solved).length} / ${sn.length}</span></div>
        <div class="wb-opt">Camps cleared <span class="val" style="width:auto">${(ctx.systems.combat?.camps || []).filter(c => c.cleared).length} / ${(ctx.systems.combat?.camps || []).length}</span></div>`;
    }
  }
  screen.addEventListener('click', e => {
    const m = e.target.closest('[data-m]'), s = e.target.closest('[data-v]'), d = e.target.closest('[data-do]');
    if (m) { if (cur === m.dataset.m && m.dataset.m === 'resume') return hooks.resume(); cur = m.dataset.m; note = ''; renderMenu(); renderPane(); }
    else if (s) { const key = s.parentElement.dataset.s; let v = s.dataset.v; if (v === 'true') v = true; else if (v === 'false') v = false; settings[key] = v; hooks.apply(); renderPane(); }
    else if (d) {
      if (d.dataset.do === 'save') { note = ctx.systems.gameplay?.save?.() ? 'Journey saved.' : 'Could not save right now.'; renderPane(); }
      if (d.dataset.do === 'title') hooks.toTitle();
    }
  });
  screen.addEventListener('input', e => {
    const r = e.target.closest('[data-r]'); if (!r) return;
    settings[r.dataset.r] = +r.value; hooks.apply();
    const v = r.parentElement.querySelector('.val'); if (v) v.textContent = r.dataset.r === 'volume' ? Math.round(r.value * 100) : (+r.value).toFixed(2);
  });
  return {
    open(opts = {}) { cur = opts.pane || 'resume'; note = ''; renderMenu(); renderPane(); const h = ctx.systems.sky?.getTime?.(); clock.textContent = h !== undefined ? `Day ${(ctx.systems.sky?.getDay?.() ?? 0) + 1} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor(h % 1 * 60)).padStart(2, '0')}` : ''; },
    close() {},
    key(e) {
      const i = items.findIndex(x => x[0] === cur);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { cur = items[(i + 1) % items.length][0]; }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') { cur = items[(i - 1 + items.length) % items.length][0]; }
      else if (e.code === 'Enter' || e.code === 'Space') {
        if (cur === 'resume') { hooks.resume(); return true; }
        if (cur === 'save') { note = ctx.systems.gameplay?.save?.() ? 'Journey saved.' : 'Could not save right now.'; }
        if (cur === 'title') { hooks.toTitle(); return true; }
      } else return false;
      renderMenu(); renderPane(); return true;
    },
  };
}

// ==================================================================== title screen
export function createTitle(ctx, root) {
  const el = document.createElement('div'); el.className = 'wb-title gone';
  el.innerHTML = `<div class="shade"></div><div class="mark"></div><div class="press">Press any key</div><div class="legal">An original adventure · procedurally painted</div>`;
  const mark = el.querySelector('.mark');
  // emblem: a stylised gust curling around a diamond
  const { c, g } = makeCanvas(120, 60, 2);
  g.strokeStyle = '#f4dfae'; g.lineWidth = 1.3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(8, 34); g.bezierCurveTo(30, 34, 40, 18, 56, 22); g.bezierCurveTo(68, 25, 66, 40, 56, 40); g.bezierCurveTo(48, 40, 47, 31, 54, 30); g.stroke();
  g.beginPath(); g.moveTo(112, 30); g.bezierCurveTo(92, 30, 84, 44, 70, 40); g.stroke();
  g.beginPath(); g.moveTo(60, 10); g.lineTo(66, 22); g.lineTo(60, 52); g.lineTo(54, 22); g.closePath(); g.fillStyle = 'rgba(244,223,174,.2)'; g.fill(); g.stroke();
  mark.appendChild(c);
  mark.insertAdjacentHTML('beforeend', '<h1>WINDBORNE</h1><div class="sub">a tale carried on the wind</div><div class="tr"></div>');
  root.appendChild(el);
  void glyph;
  let active = false, t = 0, onStart = null;
  const pos = new ctx.THREE.Vector3(), tgt = new ctx.THREE.Vector3();
  let centre = { x: 150, z: 250 };
  function path(tt) {
    const w = ctx.world;
    // drift along the southern side of the meadow, always gazing north toward the snowy spine
    const a = Math.PI * 0.5 + Math.sin(tt * 0.035) * 0.55;
    const R = 190;
    pos.set(centre.x + Math.cos(a) * R, 0, centre.z + Math.sin(a) * R);
    pos.y = Math.max(w.getHeight(pos.x, pos.z), 0) + 26 + Math.sin(tt * 0.11) * 5;
    const sx = -260 + Math.sin(tt * 0.05) * 380, sz = -1290;
    const dx = sx - pos.x, dz = sz - pos.z, L = Math.hypot(dx, dz) || 1;
    tgt.set(pos.x + dx / L * 700, 0, pos.z + dz / L * 700);
    tgt.y = pos.y + 20;
  }
  return {
    get active() { return active; },
    show(cb) {
      active = true; onStart = cb; t = ctx.params?.has?.('shot') ? 18 : 0;
      const p = ctx.systems.player?.position; if (p) centre = { x: p.x, z: p.z };
      path(t);
      ctx.cameraOverride = { pos: pos.clone(), target: tgt.clone() };
      el.classList.remove('gone');
    },
    start() {
      if (!active) return;
      active = false; el.classList.add('gone');
      ctx.cameraOverride = null;
      onStart?.();
    },
    update(dt) {
      if (!active) return;
      if (!ctx.shotMode) t += dt;   // stills keep a fixed frame so terrain LOD can settle
      path(t);
      if (ctx.cameraOverride) { ctx.cameraOverride.pos.copy(pos); ctx.cameraOverride.target.copy(tgt); }
      ctx.camera.position.copy(pos); ctx.camera.lookAt(tgt);
    },
  };
}
