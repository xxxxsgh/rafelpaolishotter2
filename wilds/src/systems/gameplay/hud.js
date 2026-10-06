// Gameplay overlays (DOM): interaction prompt, pickup toasts, quest banners, temperature +
// food-effect chips, the campfire cooking panel, the dish reveal card and a fallback
// inventory screen (used only when the ui system doesn't provide its own).
// Visual language: translucent ink panels, hairline warm borders, small-caps headings.
import { ITEMS, EFFECTS, CATEGORIES, fmtTime, fmtHearts } from './items.js';
import { getIcon } from './icons.js';

const CSS = `
.gp-root{position:absolute;inset:0;pointer-events:none;font-family:"Trebuchet MS","Segoe UI",system-ui,sans-serif;color:#f6efdc;}
.gp-root *{box-sizing:border-box;}
.gp-panel{background:linear-gradient(180deg,rgba(22,30,38,.72),rgba(14,20,26,.78));border:1px solid rgba(255,236,200,.22);border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(6px);}
.gp-cap{font-family:"Palatino Linotype",Palatino,Georgia,serif;letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#e8d7ae;}
.gp-prompt{position:absolute;right:7%;bottom:22%;display:flex;align-items:center;gap:10px;padding:8px 16px 8px 8px;border-radius:999px;opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;}
.gp-prompt.on{opacity:1;transform:none;}
.gp-key{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font:700 13px/1 Georgia,serif;color:#1d1a16;background:radial-gradient(circle at 35% 30%,#fff8e6,#e6c98a);box-shadow:0 0 0 2px rgba(255,240,210,.35),0 2px 8px rgba(0,0,0,.4);}
.gp-prompt b{font-weight:600;font-size:15px;letter-spacing:.02em}
.gp-prompt span{font-size:13px;color:#cfe0e6}
.gp-toasts{position:absolute;left:28px;top:40%;display:flex;flex-direction:column;gap:6px;}
.gp-toast{display:flex;align-items:center;gap:10px;padding:5px 14px 5px 6px;border-radius:10px;animation:gpIn .35s ease-out both;}
.gp-toast img{width:34px;height:34px}
.gp-toast .n{font-size:14px}
.gp-toast .c{font-size:12px;color:#ffcf7a;margin-left:2px}
.gp-toast.out{animation:gpOut .5s ease-in forwards}
@keyframes gpIn{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes gpOut{to{opacity:0;transform:translateX(-10px)}}
.gp-banner{position:absolute;left:50%;top:13%;transform:translateX(-50%);text-align:center;opacity:0;transition:opacity .6s;}
.gp-banner.on{opacity:1}
.gp-banner .t{font-family:"Palatino Linotype",Palatino,Georgia,serif;font-size:26px;letter-spacing:.08em;text-shadow:0 2px 12px rgba(0,0,0,.6);}
.gp-banner .s{margin-top:6px;font-size:14px;color:#dfe9ec;text-shadow:0 1px 6px rgba(0,0,0,.7);}
.gp-banner .rule{width:280px;height:1px;margin:8px auto 0;background:linear-gradient(90deg,transparent,rgba(255,214,150,.8),transparent);}
.gp-banner.main .t{color:#ffe0a0}
.gp-status{position:absolute;left:28px;bottom:26px;display:flex;gap:8px;align-items:flex-end;}
.gp-therm{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;position:relative;transition:opacity .4s;}
.gp-therm svg{position:absolute;inset:0}
.gp-therm .v{font:600 11px/1 Georgia,serif}
.gp-chip{display:flex;align-items:center;gap:6px;padding:4px 10px 4px 5px;border-radius:999px;font-size:12px;}
.gp-chip i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:700;font-size:10px;color:#1b1a18}
.gp-modal{position:absolute;inset:0;display:none;pointer-events:auto;background:radial-gradient(ellipse at center,rgba(10,14,20,.05),rgba(10,14,20,.55));}
.gp-modal.on{display:block}
.gp-cook{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);width:min(760px,92vw);padding:16px 20px 18px;}
.gp-cook h2,.gp-inv h2{margin:0 0 2px;font:400 22px/1.2 "Palatino Linotype",Palatino,Georgia,serif;letter-spacing:.06em}
.gp-pot{display:flex;gap:10px;justify-content:center;margin:12px 0}
.gp-slot{width:62px;height:62px;border-radius:12px;border:1px dashed rgba(255,236,200,.28);display:grid;place-items:center;background:rgba(255,255,255,.03);position:relative;cursor:pointer;transition:transform .12s,border-color .12s}
.gp-slot img{width:54px;height:54px}
.gp-slot.full{border-style:solid;border-color:rgba(255,214,150,.6);background:radial-gradient(circle,rgba(255,190,110,.18),rgba(255,255,255,.02))}
.gp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;max-height:220px;overflow:auto;padding:4px}
.gp-cell{position:relative;height:64px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);display:grid;place-items:center;cursor:pointer;transition:background .12s,transform .12s}
.gp-cell:hover{background:rgba(255,220,160,.12);transform:translateY(-2px)}
.gp-cell.sel{border-color:#ffd58a;box-shadow:0 0 0 1px #ffd58a inset,0 0 18px rgba(255,200,120,.25)}
.gp-cell img{width:52px;height:52px}
.gp-cell .q{position:absolute;right:5px;bottom:3px;font:600 11px/1 Georgia,serif;color:#fff3d6;text-shadow:0 1px 2px #000}
.gp-cell.dim{opacity:.35}
.gp-row{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px}
.gp-btn{pointer-events:auto;cursor:pointer;border:1px solid rgba(255,214,150,.55);background:linear-gradient(180deg,rgba(255,200,120,.25),rgba(255,160,80,.12));color:#fff4dc;border-radius:999px;padding:8px 22px;font:600 13px/1 "Trebuchet MS",sans-serif;letter-spacing:.12em;text-transform:uppercase}
.gp-btn.ghost{border-color:rgba(255,255,255,.2);background:transparent;color:#cfdbe0}
.gp-btn:disabled{opacity:.4;cursor:default}
.gp-hint{font-size:12px;color:#a9bcc4}
.gp-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.96);width:380px;padding:26px 26px 22px;text-align:center;opacity:0;transition:opacity .35s,transform .35s;}
.gp-card.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
.gp-card .glow{width:150px;height:150px;margin:-6px auto 4px;border-radius:50%;background:radial-gradient(circle,rgba(255,214,140,.45),rgba(255,214,140,0) 68%);display:grid;place-items:center}
.gp-card .glow img{width:118px;height:118px}
.gp-card .nm{font:400 23px/1.2 "Palatino Linotype",Palatino,Georgia,serif;letter-spacing:.04em}
.gp-card .ds{font-size:13px;color:#cdd9de;margin-top:8px;line-height:1.5}
.gp-hearts{display:flex;gap:3px;justify-content:center;margin-top:10px;flex-wrap:wrap}
.gp-eff{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:4px 12px;border-radius:999px;background:rgba(255,255,255,.06);font-size:12px}
.gp-inv{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1060px,94vw);height:min(600px,86vh);display:grid;grid-template-columns:1fr 330px;gap:0;overflow:hidden}
.gp-inv .left{padding:20px 22px;display:flex;flex-direction:column;min-height:0}
.gp-tabs{display:flex;gap:4px;margin:12px 0 14px;border-bottom:1px solid rgba(255,236,200,.14)}
.gp-tab{pointer-events:auto;cursor:pointer;padding:8px 14px 10px;font:600 12px/1 "Trebuchet MS",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#a9bcc4;border-bottom:2px solid transparent;margin-bottom:-1px}
.gp-tab.on{color:#ffe0a0;border-color:#ffcf7a}
.gp-inv .gp-grid{grid-template-columns:repeat(auto-fill,minmax(78px,1fr));max-height:none;flex:1;align-content:start}
.gp-inv .gp-cell{height:78px}
.gp-inv .gp-cell img{width:62px;height:62px}
.gp-inv .right{padding:22px;background:linear-gradient(180deg,rgba(255,236,200,.05),rgba(255,236,200,.02));border-left:1px solid rgba(255,236,200,.12);display:flex;flex-direction:column}
.gp-inv .big{height:180px;display:grid;place-items:center;background:radial-gradient(circle,rgba(255,214,140,.22),rgba(255,214,140,0) 65%)}
.gp-inv .big img{width:150px;height:150px}
.gp-inv .nm{font:400 22px/1.2 "Palatino Linotype",Palatino,Georgia,serif;margin-top:4px}
.gp-inv .ds{font-size:13px;line-height:1.55;color:#cdd9de;margin-top:10px;flex:1}
.gp-shards{display:flex;align-items:center;gap:8px;font:600 15px/1 Georgia,serif;color:#fff1cc}
.gp-dur{height:4px;border-radius:2px;background:rgba(255,255,255,.12);position:absolute;left:8px;right:8px;bottom:6px;overflow:hidden}
.gp-dur b{display:block;height:100%;background:linear-gradient(90deg,#7fe0a0,#e8f070)}
.gp-tray{position:absolute;left:50%;bottom:7%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;padding:10px 18px 10px 16px;opacity:0;transition:opacity .4s}
.gp-tray.on{opacity:1}
.gp-tray .slots{display:flex;gap:6px}
.gp-tray .gp-slot{width:50px;height:50px;cursor:default}
.gp-tray .gp-slot img{width:44px;height:44px}
.gp-dots span{display:inline-block;width:5px;height:5px;border-radius:50%;background:#ffd58a;margin-left:4px;animation:gpDot 1.2s infinite}
.gp-dots span:nth-child(2){animation-delay:.2s}.gp-dots span:nth-child(3){animation-delay:.4s}
@keyframes gpDot{0%,100%{opacity:.25}50%{opacity:1}}
`;

const SHARD_SVG = `<svg width="18" height="18" viewBox="0 0 20 20"><path d="M10 1 L16 8 L10 19 L4 8 Z" fill="#8fe0ff" stroke="#24364a" stroke-width="1.2"/><path d="M10 1 L12 8 L10 19 L8 8 Z" fill="#d8f6ff"/></svg>`;
function heartSVG(fill) {   // fill 0..1 (quarters)
  const id = 'h' + Math.random().toString(36).slice(2, 7);
  return `<svg width="20" height="18" viewBox="0 0 20 18"><defs><clipPath id="${id}"><rect x="0" y="0" width="${20 * fill}" height="18"/></clipPath></defs>
  <path d="M10 17 C2 11 0 7.5 0 5 A5 5 0 0 1 10 3 A5 5 0 0 1 20 5 C20 7.5 18 11 10 17Z" fill="rgba(0,0,0,.35)" stroke="rgba(255,236,210,.5)" stroke-width="1"/>
  <path clip-path="url(#${id})" d="M10 17 C2 11 0 7.5 0 5 A5 5 0 0 1 10 3 A5 5 0 0 1 20 5 C20 7.5 18 11 10 17Z" fill="#ff5f6d"/></svg>`;
}
export function heartsHTML(q) {
  if (q >= 999) return `<span class="gp-hint" style="color:#ffd58a">Full recovery</span>`;
  let s = ''; let left = q;
  while (left > 0 && s.length < 40000) { const f = Math.min(4, left); s += heartSVG(f / 4); left -= f; }
  return s;
}
const EFF_LETTER = { warmth: '♨', chill: '❄', might: '⚔', guard: '⛨', swift: '➤', vigor: '✦', hearty: '♥' };

export function createHud(ctx) {
  if (!document.getElementById('gp-style')) { const st = document.createElement('style'); st.id = 'gp-style'; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement('div'); root.className = 'gp-root';
  (ctx.hud || document.body).appendChild(root);
  const el = (cls, html = '', parent = root) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; parent.appendChild(d); return d; };

  const prompt = el('gp-prompt gp-panel', '<div class="gp-key">E</div><b></b><span></span>');
  const toasts = el('gp-toasts');
  const banner = el('gp-banner', '<div class="t"></div><div class="rule"></div><div class="s"></div>');
  const status = el('gp-status');
  const therm = el('gp-therm gp-panel', '<svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="18" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/><circle class="arc" cx="23" cy="23" r="18" fill="none" stroke="#9fd0e0" stroke-width="4" stroke-linecap="round" stroke-dasharray="0 200" transform="rotate(135 23 23)"/></svg><div class="v"></div>', status);
  const chips = el('', '', status); chips.style.cssText = 'display:flex;gap:6px';
  const tray = el('gp-tray gp-panel', '<div><div class="gp-cap">Simmering</div><div style="font-size:13px;margin-top:3px" class="lbl">Cooking<span class="gp-dots"><span></span><span></span><span></span></span></div></div><div class="slots"></div>');
  const modal = el('gp-modal');
  const card = el('gp-card gp-panel', '');

  let promptKey = '';
  let bannerT = 0, bannerQ = [];
  const api = {
    root,
    prompt(p) {
      const ui = ctx.systems.ui;
      if (ui?.prompt) { const k = p ? p.key + p.verb + p.name : ''; if (k !== promptKey) { promptKey = k; ui.prompt(p ? `${p.verb} ${p.name || ''}`.trim() : null, p?.key || 'E'); } return; }
      if (!p) { prompt.classList.remove('on'); promptKey = ''; return; }
      const k = p.key + p.verb + p.name;
      if (k !== promptKey) { promptKey = k; prompt.children[0].textContent = p.key || 'E'; prompt.children[1].textContent = p.verb; prompt.children[2].textContent = p.name || ''; }
      prompt.classList.add('on');
    },
    toast(id, name, count = 1, iconSrc) {
      const t = el('gp-toast gp-panel', `<img src="${iconSrc || getIcon(id)}"><div class="n">${name}</div><div class="c">${count > 1 ? '×' + count : ''}</div>`, toasts);
      while (toasts.children.length > 5) toasts.firstChild.remove();
      setTimeout(() => t.classList.add('out'), 2600);
      setTimeout(() => t.remove(), 3200);
    },
    banner(title, sub, kind = 'side', small = false) {
      const ui = ctx.systems.ui;
      if (ui?.banner) { ui.banner(title, sub, kind === 'main' ? 'Main Quest' : ''); return; }
      bannerQ.push({ title, sub, kind, small });
      if (bannerQ.length > 4) bannerQ.shift();
    },
    _bannerTick(dt) {
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0.6) banner.classList.remove('on'); return; }
      const b = bannerQ.shift(); if (!b) return;
      banner.className = 'gp-banner ' + b.kind;
      banner.querySelector('.t').textContent = b.title;
      banner.querySelector('.t').style.fontSize = b.small ? '18px' : '';
      banner.querySelector('.s').textContent = b.sub || '';
      requestAnimationFrame(() => banner.classList.add('on'));
      bannerT = b.small ? 2.6 : 4.2;
    },
    status(temp, buffs, visible = true) {
      status.style.display = visible ? '' : 'none';
      if (!visible) return;
      therm.style.display = ctx.systems.ui?.prompt ? 'none' : '';   // the ui HUD shows temperature itself
      const v = temp.value;
      const k = Math.max(0, Math.min(1, (v + 20) / 70));
      const colr = temp.state === 'freezing' ? '#7fb8ff' : temp.state === 'cold' ? '#a8d8f0' : temp.state === 'hot' ? '#ffb060' : temp.state === 'scorching' ? '#ff6a40' : '#cfe8c8';
      const arc = therm.querySelector('.arc');
      arc.setAttribute('stroke', colr); arc.setAttribute('stroke-dasharray', `${(k * 84.8).toFixed(1)} 200`);
      therm.querySelector('.v').textContent = Math.round(v) + '°';
      therm.style.boxShadow = temp.state === 'mild' ? '' : `0 0 0 2px ${colr}55, 0 0 22px ${colr}66`;
      let html = '';
      for (const [e, b] of buffs) {
        const E = EFFECTS[e];
        html += `<div class="gp-chip gp-panel"><i style="background:${E.color}">${EFF_LETTER[e] || ''}${' '}</i>${'Lv' + b.level} <span style="color:#cfdbe0">${fmtTime(b.time)}</span></div>`;
      }
      if (chips._h !== html) { chips.innerHTML = html; chips._h = html; }
    },
    tray(ids, on = true, label) {
      tray.classList.toggle('on', on);
      if (!on) return;
      tray.querySelector('.slots').innerHTML = ids.map(id => `<div class="gp-slot full"><img src="${getIcon(id)}"></div>`).join('');
      if (label) tray.querySelector('.lbl').firstChild.textContent = label;
    },
    // ------------------------------------------------------------ dish reveal card
    dishCard(d, ms = 3600) {
      const E = d.effect ? EFFECTS[d.effect] : null;
      card.innerHTML = `<div class="gp-cap">${d.dubious ? 'Hmm…' : d.critical ? 'A perfect simmer!' : 'You cooked'}</div>
        <div class="glow"><img src="${getIcon(d)}"></div><div class="nm">${d.name}</div>
        <div class="gp-hearts">${d.hp ? heartsHTML(d.hp) : ''}</div>
        ${E && d.effect !== 'hearty' ? `<div class="gp-eff"><i style="width:18px;height:18px;border-radius:50%;background:${E.color};display:inline-grid;place-items:center;font-style:normal;color:#1b1a18;font-size:10px">${EFF_LETTER[d.effect]}</i>${E.name}${d.effect === 'vigor' ? ` · ${d.stamina}%` : ` Lv${d.level} · ${fmtTime(d.duration)}`}</div>` : ''}
        <div class="ds">${d.desc}</div>`;
      card.classList.add('on');
      clearTimeout(card._t);
      if (ms) card._t = setTimeout(() => card.classList.remove('on'), ms);
    },
    hideCard() { card.classList.remove('on'); },
    // ------------------------------------------------------------ cooking panel
    openCook({ items, onCook, onClose, preset = [] }) {
      modal.classList.add('on');
      const sel = preset.slice(0, 5);
      const box = el('gp-cook gp-panel', '', modal);
      const render = () => {
        const used = {}; for (const id of sel) used[id] = (used[id] || 0) + 1;
        box.innerHTML = `<div class="gp-cap">Campfire</div><h2>Cooking Pot</h2>
          <div class="gp-pot">${[0, 1, 2, 3, 4].map(i => `<div class="gp-slot ${sel[i] ? 'full' : ''}" data-i="${i}">${sel[i] ? `<img src="${getIcon(sel[i])}">` : ''}</div>`).join('')}</div>
          <div class="gp-grid">${items.length ? items.map(e => { const left = e.count - (used[e.id] || 0); return `<div class="gp-cell ${left <= 0 ? 'dim' : ''}" data-id="${e.id}" title="${e.item.name}"><img src="${getIcon(e.id)}"><div class="q">${left}</div></div>`; }).join('') : '<div class="gp-hint">Your pack holds nothing to cook. Forage mushrooms, herbs and fruit in the wilds.</div>'}</div>
          <div class="gp-row"><div class="gp-hint">${sel.length ? sel.map(id => ITEMS[id].name).join(' · ') : 'Choose up to five ingredients'}</div>
          <div style="display:flex;gap:8px"><button class="gp-btn ghost" data-a="close">Leave</button><button class="gp-btn" data-a="cook" ${sel.length ? '' : 'disabled'}>Cook</button></div></div>`;
      };
      render();
      const close = (cooked) => { modal.classList.remove('on'); box.remove(); removeEventListener('keydown', key, true); if (!cooked) onClose?.(); };
      box.addEventListener('click', e => {
        const c = e.target.closest('[data-id]'); const s = e.target.closest('[data-i]'); const a = e.target.closest('[data-a]');
        if (c) { const id = c.dataset.id; const it = items.find(x => x.id === id); const used = sel.filter(x => x === id).length; if (sel.length < 5 && it && used < it.count) sel.push(id); render(); }
        else if (s) { sel.splice(+s.dataset.i, 1); render(); }
        else if (a?.dataset.a === 'close') close(false);
        else if (a?.dataset.a === 'cook' && sel.length) { close(true); onCook(sel.slice()); }
      });
      const key = e => {
        if (e.code === 'Escape') { e.preventDefault(); close(false); }
        else if (e.code === 'Enter' && sel.length) { e.preventDefault(); close(true); onCook(sel.slice()); }
        else if (e.code === 'Backspace') { e.preventDefault(); sel.pop(); render(); }
      };
      addEventListener('keydown', key, true);
      if (document.pointerLockElement) document.exitPointerLock?.();
      return { close };
    },
    // ------------------------------------------------------------ fallback inventory screen
    openInventory({ inv, tab = 'materials', onUse, select }) {
      modal.classList.add('on');
      const box = el('gp-inv gp-panel', '', modal);
      let cur = tab, selKey = select || null;
      const render = () => {
        const list = inv.list(cur);
        if (!selKey || !list.find(e => e.key === selKey)) selKey = list[0]?.key || null;
        const s = list.find(e => e.key === selKey);
        const icon = e => e.dish ? getIcon(e.dish) : e.weapon ? getIcon(e.weapon) : getIcon(e.id);
        let detail = '<div class="gp-hint" style="margin:auto">Nothing here yet.</div>';
        if (s) {
          const it = s.item, d = s.dish, w = s.weapon;
          const hp = d ? d.hp : it?.edible ? it.hp : 0;
          const E = (d?.effect || it?.effect) ? EFFECTS[d?.effect || it.effect] : null;
          detail = `<div class="big"><img src="${icon(s)}"></div><div class="gp-cap">${CATEGORIES.find(c => c.id === cur).name}</div><div class="nm">${s.name}</div>
            <div class="gp-hearts" style="justify-content:flex-start">${hp ? heartsHTML(hp) : ''}</div>
            ${E ? `<div class="gp-eff"><i style="width:18px;height:18px;border-radius:50%;background:${E.color};display:inline-grid;place-items:center;font-style:normal;color:#1b1a18;font-size:10px">${EFF_LETTER[d?.effect || it.effect]}</i>${E.name}${d && d.level ? ' Lv' + d.level : ''}${d && d.duration ? ' · ' + fmtTime(d.duration) : ''}</div>` : ''}
            <div class="ds">${s.desc || ''}${w ? `<div style="margin-top:10px" class="gp-hint">${w.type || ''}</div>` : ''}</div>
            <div class="gp-row">${s.value ? `<div class="gp-hint">Worth ${s.value} shards</div>` : '<div></div>'}
            ${(d || it?.edible) ? '<button class="gp-btn" data-a="eat">Eat</button>' : w ? `<button class="gp-btn" data-a="equip">${s.equipped ? 'Equipped' : 'Equip'}</button>` : ''}</div>`;
        }
        box.innerHTML = `<div class="left"><div class="gp-cap">Traveller’s Pack</div><h2>Inventory</h2>
          <div class="gp-tabs">${CATEGORIES.map(c => `<div class="gp-tab ${c.id === cur ? 'on' : ''}" data-t="${c.id}">${c.name}</div>`).join('')}</div>
          <div class="gp-grid">${list.map(e => `<div class="gp-cell ${e.key === selKey ? 'sel' : ''}" data-k="${e.key}"><img src="${icon(e)}">${e.count > 1 ? `<div class="q">${e.count}</div>` : ''}${e.weapon && e.weapon.maxDur ? `<div class="gp-dur"><b style="width:${Math.round(100 * (e.weapon.dur ?? 0) / e.weapon.maxDur)}%"></b></div>` : ''}${e.equipped ? '<div style="position:absolute;left:6px;top:5px;width:8px;height:8px;border-radius:50%;background:#ffcf7a;box-shadow:0 0 6px #ffcf7a"></div>' : ''}</div>`).join('')}</div>
          <div class="gp-row"><div class="gp-hint">Tab / Esc to close</div><div class="gp-shards">${SHARD_SVG}${inv.shards}</div></div></div>
          <div class="right">${detail}</div>`;
      };
      render();
      const off = inv.onChange(() => render());
      const close = () => { modal.classList.remove('on'); box.remove(); off(); removeEventListener('keydown', key, true); api._invOpen = null; };
      box.addEventListener('click', e => {
        const t = e.target.closest('[data-t]'), c = e.target.closest('[data-k]'), a = e.target.closest('[data-a]');
        if (t) { cur = t.dataset.t; selKey = null; render(); }
        else if (c) { selKey = c.dataset.k; render(); }
        else if (a) { onUse?.(a.dataset.a, cur, selKey); render(); }
      });
      const key = e => { if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); close(); } };
      addEventListener('keydown', key, true);
      if (document.pointerLockElement) document.exitPointerLock?.();
      api._invOpen = { close };
      return api._invOpen;
    },
    get modalOpen() { return modal.classList.contains('on'); },
    update(dt) { api._bannerTick(dt); },
  };
  return api;
}
export { fmtHearts };
