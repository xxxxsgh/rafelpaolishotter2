// Quest / objective log. One main quest (wake a spire -> the four Sanctums -> light the
// Summit Beacon) plus small side objectives. Progress is event driven; every change emits
// 'questUpdate' {quest, step} and finished quests emit 'questComplete' {quest, reward}.
// objectives() returns markers for a map / compass: [{id, label, x, z, kind}].

export function createQuests(ctx, deps) {
  const { events } = ctx;
  const { inv, landmarks, hud } = deps;
  const Q = [
    { id: 'main', main: true, title: 'The Windborne Path', desc: 'An ember sleeps on the summit, waiting for a traveller strong enough to wake it.',
      steps: [
        { id: 'spire', text: 'Climb a Windstone Spire and wake its crystal', goal: 1 },
        { id: 'sanctums', text: 'Complete the trials of the four Sanctums', goal: 4 },
        { id: 'beacon', text: 'Carry the Summit Ember to the beacon atop the Summit', goal: 1 },
      ], reward: 500 },
    { id: 'meal', title: 'A Warm Meal', desc: 'Every journey goes better on a full stomach.', steps: [{ id: 'cook', text: 'Cook a dish in a campfire pot', goal: 1 }], reward: 20 },
    { id: 'forager', title: 'Forager’s Basket', desc: 'The wilds are a pantry for those who look closely.', steps: [{ id: 'gather', text: 'Gather wild ingredients', goal: 15 }], reward: 40 },
    { id: 'spires', title: 'Eyes of the Wind', desc: 'Four spires keep watch over the island.', steps: [{ id: 'all', text: 'Wake every Windstone Spire', goal: 4 }], reward: 120 },
    { id: 'prospector', title: 'Prospector', desc: 'Glittering seams run through the rocks.', steps: [{ id: 'ore', text: 'Break open ore deposits', goal: 5 }], reward: 60 },
  ];
  for (const q of Q) { q.stepIndex = 0; q.done = false; for (const s of q.steps) s.n = 0; }
  const byId = id => Q.find(q => q.id === id);

  function advance(qid, sid, n = 1, absolute = false, silent = false) {
    const q = byId(qid); if (!q || q.done) return;
    const s = q.steps[q.stepIndex];
    if (!s || s.id !== sid) {
      // allow progress on later steps to be remembered (e.g. sanctums solved before the spire)
      const later = q.steps.find(x => x.id === sid); if (later) later.n = absolute ? n : Math.min(later.goal, later.n + n);
      return;
    }
    const before = s.n;
    s.n = absolute ? Math.min(s.goal, n) : Math.min(s.goal, s.n + n);
    if (s.n === before && !absolute) return;
    events.emit('questUpdate', { quest: q.id, title: q.title, step: s.id, text: s.text, n: s.n, goal: s.goal });
    if (s.n >= s.goal) nextStep(q, silent);
    else if (!silent && s.goal > 1 && s.n !== before) hud?.banner?.(q.title, `${s.text} · ${s.n}/${s.goal}`, q.main ? 'main' : 'side', true);
  }
  function nextStep(q, silent) {
    q.stepIndex++;
    // carry over progress already made on the new step
    while (q.stepIndex < q.steps.length && q.steps[q.stepIndex].n >= q.steps[q.stepIndex].goal) q.stepIndex++;
    if (q.stepIndex >= q.steps.length) {
      q.done = true;
      if (!silent) {
        inv.addShards(q.reward);
        hud?.banner?.(q.title, `Complete · +${q.reward} shards`, q.main ? 'main' : 'side');
      }
      events.emit('questComplete', { quest: q.id, title: q.title, reward: q.reward });
    } else {
      const s = q.steps[q.stepIndex];
      if (!silent) hud?.banner?.(q.main ? 'New Objective' : q.title, s.text, q.main ? 'main' : 'side');
      onStepStart(q, s, silent);
    }
  }
  function onStepStart(q, s, silent) {
    if (q.id === 'main' && s.id === 'beacon' && !inv.has('summit-ember')) {
      inv.add('summit-ember', 1);
      if (!silent) events.emit('itemPickup', { id: 'summit-ember', name: 'Summit Ember', kind: 'key', count: 1 });
    }
  }

  events.on('spireActivated', () => {
    advance('main', 'spire');
    const n = landmarks.spires.filter(s => s.active).length;
    advance('spires', 'all', n, true);
  });
  events.on('shrineSolved', () => {
    const list = ctx.systems.physics?.sanctums;
    const solved = Array.isArray(list) ? list.filter(s => s.solved).length : inv.count('sanctum-sigil');
    advance('main', 'sanctums', Math.max(solved, inv.count('sanctum-sigil')), true);
  });
  events.on('cook', e => { if (!e?.dish?.dubious) advance('meal', 'cook'); });
  events.on('itemPickup', e => { if (e?.source === 'forage') advance('forager', 'gather', e.count || 1); });
  events.on('oreBroken', () => advance('prospector', 'ore'));
  events.on('beaconLit', () => advance('main', 'beacon'));

  return {
    list: Q,
    get(id) { return byId(id); },
    advance,
    current() {
      const q = byId('main');
      if (q.done) return { quest: q, step: null };
      return { quest: q, step: q.steps[q.stepIndex] };
    },
    // markers for map / compass (UI reads these)
    objectives() {
      const out = [];
      const m = byId('main');
      const s = m.steps[m.stepIndex];
      if (!m.done && s) {
        if (s.id === 'spire') for (const sp of landmarks.spires) if (!sp.active) out.push({ id: sp.id, label: sp.name, x: sp.x, z: sp.z, kind: 'spire' });
        if (s.id === 'sanctums') for (const sn of ctx.systems.physics?.sanctums || []) if (!sn.solved) out.push({ id: 'sanctum-' + sn.id, label: sn.name, x: sn.x, z: sn.z, kind: 'sanctum' });
        if (s.id === 'beacon') out.push({ id: 'beacon', label: 'Summit Beacon', x: landmarks.beacon.x, z: landmarks.beacon.z, kind: 'beacon' });
      }
      return out;
    },
    serialize() { return Q.map(q => ({ id: q.id, stepIndex: q.stepIndex, done: q.done, n: q.steps.map(s => s.n) })); },
    restore(arr) {
      for (const o of arr || []) {
        const q = byId(o.id); if (!q) continue;
        q.stepIndex = o.stepIndex; q.done = o.done;
        (o.n || []).forEach((v, i) => { if (q.steps[i]) q.steps[i].n = v; });
      }
    },
  };
}
