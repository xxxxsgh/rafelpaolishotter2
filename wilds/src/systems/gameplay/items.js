// Item catalogue + the cooking / effects engine. Pure data + functions (no three.js).
//
// Units: health is measured in quarter-hearts (player.maxHealth 12 = 3 hearts).
// Categories (inventory tabs): weapons, bows, shields (owned by combat, mirrored here),
//   materials (every raw ingredient, mineral and monster part), food (cooked dishes), key.
// Tags drive recipes: mushroom herb flower fruit fish meat egg grain dairy sweet spice monster mineral.

export const CATEGORIES = [
  { id: 'weapons', name: 'Weapons' },
  { id: 'bows', name: 'Bows' },
  { id: 'shields', name: 'Shields' },
  { id: 'materials', name: 'Materials' },
  { id: 'food', name: 'Food' },
  { id: 'key', name: 'Key Items' },
];

export const EFFECTS = {
  warmth: { name: 'Cold Resistance', prefix: 'Ember', draught: 'Ember Draught', color: '#ff8a3c', icon: 'flame', timed: true },
  chill:  { name: 'Heat Resistance', prefix: 'Frost', draught: 'Frost Draught', color: '#7fd4ff', icon: 'snow', timed: true },
  might:  { name: 'Attack Up', prefix: 'Brawny', draught: 'Brawn Draught', color: '#ff5a4a', icon: 'blade', timed: true },
  guard:  { name: 'Defense Up', prefix: 'Stalwart', draught: 'Bulwark Draught', color: '#9fb4c8', icon: 'ward', timed: true },
  swift:  { name: 'Speed Up', prefix: 'Fleet', draught: 'Gale Draught', color: '#7ff0b0', icon: 'wing', timed: true },
  vigor:  { name: 'Stamina Restore', prefix: 'Bright', draught: 'Brightwater Draught', color: '#e8f060', icon: 'wheel', timed: false },
  hearty: { name: 'Full Recovery', prefix: 'Bountiful', draught: 'Heartsease Draught', color: '#ffd24a', icon: 'heart', timed: false },
};

// shape -> icon + world model family; c = main colour, c2 = secondary
const I = (o) => o;
export const ITEMS = {
  // ---------------- mushrooms
  hearthcap:  I({ name: 'Hearthcap', tags: ['mushroom'], hp: 2, value: 3, shape: 'mushroom', c: '#b8452e', c2: '#f2e2c4', spots: true, desc: 'A plump red-capped mushroom that grows in the shade of old trees. Cooks into hearty meals.' }),
  emberbell:  I({ name: 'Emberbell', tags: ['mushroom'], hp: 1, effect: 'warmth', pot: 1, value: 5, shape: 'mushroom', c: '#ff8a2a', c2: '#ffe0a0', tall: true, desc: 'Warm to the touch, even at dawn. Dishes made with it keep the cold at bay.' }),
  frostgill:  I({ name: 'Frostgill', tags: ['mushroom'], hp: 1, effect: 'chill', pot: 1, value: 5, shape: 'mushroom', c: '#8fd0ee', c2: '#eef8ff', desc: 'Its gills are rimed with frost all year round. Cools the body when eaten.' }),
  swiftstool: I({ name: 'Swiftstool', tags: ['mushroom'], hp: 1, effect: 'swift', pot: 1, value: 5, shape: 'mushroom', c: '#3fb8a0', c2: '#e6f6ea', tall: true, desc: 'A slender teal mushroom that sprouts overnight. Said to quicken the feet.' }),
  stoutshelf: I({ name: 'Stoutshelf', tags: ['mushroom'], hp: 1, effect: 'guard', pot: 1, value: 6, shape: 'shelf', c: '#a8865a', c2: '#e8d8b0', desc: 'A tough bracket fungus that clings to stumps. Hardens the skin when cooked.' }),
  lanterncap: I({ name: 'Lanterncap', tags: ['mushroom'], hp: 1, effect: 'vigor', pot: 1, value: 6, shape: 'mushroom', c: '#d8f070', c2: '#f8ffd8', glow: true, desc: 'Glows softly in the dark forest. Restores stamina.' }),
  // ---------------- herbs & flowers
  dewleaf:    I({ name: 'Dewleaf', tags: ['herb'], hp: 1, value: 2, shape: 'herb', c: '#6cbf3a', c2: '#3f8a2a', desc: 'A common meadow herb that holds the morning dew. Mild and fragrant.' }),
  sunpetal:   I({ name: 'Sunpetal', tags: ['herb', 'flower'], hp: 0, effect: 'vigor', pot: 1, value: 4, shape: 'flower', c: '#ffd23a', c2: '#ff9a20', desc: 'A bright yellow bloom that turns to follow the sun. Restores stamina.' }),
  bravebloom: I({ name: 'Bravebloom', tags: ['herb', 'flower'], hp: 0, effect: 'might', pot: 1, value: 6, shape: 'flower', c: '#e8384a', c2: '#ffd0a0', desc: 'A crimson flower prized by travelling fighters. Strengthens the arm.' }),
  snowmint:   I({ name: 'Snowmint', tags: ['herb'], hp: 1, effect: 'chill', pot: 1, value: 4, shape: 'herb', c: '#b8ecd8', c2: '#5fb89a', desc: 'An icy mountain mint. Cooling and refreshing, perfect for hot climates.' }),
  windreed:   I({ name: 'Windreed Sprig', tags: ['herb'], hp: 0, effect: 'swift', pot: 1, value: 5, shape: 'reed', c: '#c8e078', c2: '#7ea83a', desc: 'Grows on breezy shores. It hums faintly in the wind.' }),
  heartroot:  I({ name: 'Heartroot', tags: ['herb'], hp: 4, effect: 'hearty', pot: 1, value: 20, shape: 'root', c: '#ff7a8a', c2: '#ffd8a0', desc: 'A rare root shaped like a heart, found on high slopes. Fully restores health.' }),
  // ---------------- fruit
  russetpome: I({ name: 'Russet Pome', tags: ['fruit'], hp: 2, value: 3, shape: 'fruit', c: '#d2402e', c2: '#f0b040', desc: 'A crisp red fruit that falls from meadow trees in late summer.' }),
  duskberry:  I({ name: 'Duskberry', tags: ['fruit'], hp: 1, value: 2, shape: 'berries', c: '#5a3a9a', c2: '#8a6ad0', desc: 'Small violet berries that ripen at twilight. Sweet and a little tart.' }),
  goldplum:   I({ name: 'Goldplum', tags: ['fruit'], hp: 2, effect: 'might', pot: 1, value: 6, shape: 'fruit', c: '#f0b830', c2: '#ffe890', desc: 'A heavy golden plum. Its juice is said to give strength.' }),
  firethorn:  I({ name: 'Firethorn Pepper', tags: ['fruit', 'spice'], hp: 1, effect: 'warmth', pot: 1, value: 4, shape: 'pepper', c: '#e8402a', c2: '#3f8a2a', desc: 'A fiery little pepper from the dry plains. Warms you from the inside.' }),
  frostmelon: I({ name: 'Frost Melon', tags: ['fruit'], hp: 2, effect: 'chill', pot: 1, value: 6, shape: 'melon', c: '#5aa860', c2: '#c8f0a8', desc: 'Grows in the red mesas yet stays cold inside. A traveller’s relief in the heat.' }),
  // ---------------- fish
  silverfin:  I({ name: 'Silverfin Trout', tags: ['fish'], hp: 4, value: 8, shape: 'fish', c: '#9ab8c8', c2: '#e8f0f0', desc: 'A lively river trout with a silver flash along its side.' }),
  ribboncarp: I({ name: 'Ribbon Carp', tags: ['fish'], hp: 2, effect: 'vigor', pot: 1, value: 10, shape: 'fish', c: '#f08a3a', c2: '#fff0d0', desc: 'Trails long ribbon fins through still lakes. Restores stamina.' }),
  mossback:   I({ name: 'Mossback Bass', tags: ['fish'], hp: 2, effect: 'guard', pot: 1, value: 10, shape: 'fish', c: '#5f7a3a', c2: '#d8d8a0', desc: 'A stout bass with a mossy green back. Toughens the body.' }),
  // ---------------- meat, eggs & pantry
  roast_haunch: I({ name: 'Raw Haunch', tags: ['meat'], hp: 4, value: 8, shape: 'meat', c: '#c85a4a', c2: '#f0e0c8', desc: 'A hefty cut of game meat. Best cooked over an open flame.' }),
  gamecut:    I({ name: 'Game Cut', tags: ['meat'], hp: 3, value: 6, shape: 'meat', c: '#d06a5a', c2: '#f4e4cc', desc: 'A lean cut of wild meat.' }),
  speckledegg: I({ name: 'Speckled Egg', tags: ['egg'], hp: 2, value: 3, shape: 'egg', c: '#f2e6cc', c2: '#9a7a5a', desc: 'Laid by meadow birds in grassy nests.' }),
  highwheat:  I({ name: 'Highland Wheat', tags: ['grain'], hp: 2, value: 4, shape: 'wheat', c: '#e8c060', c2: '#b88a30', desc: 'Golden grain from the plateau farms. The base of breads and pies.' }),
  hearthsalt: I({ name: 'Hearth Salt', tags: ['spice'], hp: 0, value: 2, shape: 'salt', c: '#f4eee6', c2: '#c8b8a8', desc: 'Coarse salt mined from rock seams. Brings out the flavour of any dish.' }),
  canesugar:  I({ name: 'Cane Sugar', tags: ['sweet'], hp: 0, value: 3, shape: 'sugar', c: '#fff8ee', c2: '#e8d8c0', desc: 'Sweet crystals for desserts.' }),
  churnbutter: I({ name: 'Churned Butter', tags: ['dairy'], hp: 1, value: 4, shape: 'butter', c: '#f8e070', c2: '#fff4c0', desc: 'Rich and creamy. Makes pastry golden.' }),
  freshmilk:  I({ name: 'Fresh Milk', tags: ['dairy'], hp: 1, value: 4, shape: 'milk', c: '#fbf8f0', c2: '#9ac0e0', desc: 'Still warm from the highland farms.' }),
  wildhoney:  I({ name: 'Wild Honey', tags: ['sweet'], hp: 3, effect: 'vigor', pot: 1, value: 10, shape: 'honey', c: '#f0a020', c2: '#ffd870', desc: 'Dripping comb taken from a hollow tree. Sweet and energising.' }),
  // ---------------- minerals (inedible, valuable)
  flint:      I({ name: 'Flint', tags: ['mineral'], value: 5, shape: 'flint', c: '#6f7480', c2: '#b8bec8', desc: 'Strikes sparks against steel. Merchants buy it by the sackful.' }),
  amberite:   I({ name: 'Amberite', tags: ['mineral'], value: 30, shape: 'gem', c: '#f0a030', c2: '#ffe0a0', desc: 'Warm golden stone with ancient bubbles trapped inside.' }),
  skyglass:   I({ name: 'Skyglass', tags: ['mineral'], value: 60, shape: 'gem', c: '#4ab0f0', c2: '#d0f0ff', desc: 'A crystal the colour of a summer sky. Hums when held to the wind.' }),
  emberstone: I({ name: 'Emberstone', tags: ['mineral'], value: 90, shape: 'gem', c: '#e83040', c2: '#ffb0a0', desc: 'A deep red gem that glows faintly with inner heat.' }),
  rimeopal:   I({ name: 'Rime Opal', tags: ['mineral'], value: 120, shape: 'gem', c: '#c8e8ff', c2: '#ffffff', desc: 'An opal cold as glacier ice, shimmering with every colour.' }),
  // ---------------- monster parts (combat drops)
  gnarl_horn:   I({ name: 'Gnarl Horn', tags: ['monster'], value: 8, shape: 'horn', c: '#eee0bd', c2: '#8a7a62', desc: 'A gnarled horn. Strengthens draughts when simmered with herbs.' }),
  gnarl_fang:   I({ name: 'Gnarl Fang', tags: ['monster'], value: 10, shape: 'fang', c: '#f6ecd2', c2: '#c8b890', desc: 'A sharp yellowed fang.' }),
  shell_plate:  I({ name: 'Shellback Plate', tags: ['monster'], value: 18, shape: 'shellplate', c: '#2a4f6e', c2: '#4fa3a6', desc: 'A plate from a shellback’s armoured back.' }),
  beetle_horn:  I({ name: 'Beetle Horn', tags: ['monster'], value: 14, shape: 'horn', c: '#1e2430', c2: '#5a6a80', desc: 'Black and glossy as lacquer.' }),
  warden_core:  I({ name: 'Warden Core', tags: ['monster'], value: 60, shape: 'core', c: '#ffb24a', c2: '#6f6a60', desc: 'The still-warm heart of a stone warden.' }),
  mossy_stone:  I({ name: 'Mossy Heartstone', tags: ['monster'], value: 25, shape: 'mossstone', c: '#9c9584', c2: '#6f9c3a', desc: 'A stone heart overgrown with moss.' }),
  wisp_essence: I({ name: 'Wisp Essence', tags: ['monster'], value: 30, shape: 'essence', c: '#fff1b0', c2: '#ffd060', desc: 'A drifting mote of light left behind by a wisp.' }),
  // ---------------- key items
  'sanctum-sigil': I({ name: 'Sigil of Passage', cat: 'key', value: 0, shape: 'sigil', c: '#ffb347', c2: '#5ad8ff', desc: 'Proof of a Sanctum’s trial. Four are needed to light the summit beacon.' }),
  'wind-sail':     I({ name: 'Wayfarer’s Sail', cat: 'key', value: 0, shape: 'sail', c: '#d8c8a0', c2: '#3a6a8a', desc: 'A folding cloth wing. Leap from a height and open it to ride the wind.' }),
  'spire-chart':   I({ name: 'Spire Chart', cat: 'key', value: 0, shape: 'chart', c: '#e8dcc0', c2: '#6a5a40', desc: 'A blank chart that fills in as you wake the Windstone Spires.' }),
  'summit-ember':  I({ name: 'Summit Ember', cat: 'key', value: 0, shape: 'essence', c: '#ffcf6a', c2: '#ff7a2a', desc: 'A coal that never cools. It wants to return to the beacon on the summit.' }),
};
for (const [id, it] of Object.entries(ITEMS)) {
  it.id = id;
  it.cat ||= 'materials';
  it.tags ||= [];
  it.edible = it.cat === 'materials' && !it.tags.includes('mineral') && !it.tags.includes('monster');
}

export const DISH_KINDS = {
  bowl: { shape: 'bowl' }, skewer: { shape: 'skewer' }, pie: { shape: 'pie' }, plate: { shape: 'plate' },
  bread: { shape: 'bread' }, bottle: { shape: 'bottle' }, mash: { shape: 'mash' }, omelette: { shape: 'omelette' },
  pudding: { shape: 'pudding' }, cup: { shape: 'cup' },
};

// Recipes: first match wins. `t` = tag counts of the ingredients (excluding effects).
const has = (t, k) => (t[k] || 0) > 0;
const only = (t, keys) => Object.keys(t).every(k => !t[k] || keys.includes(k));
const RECIPES = [
  { name: 'Wayfarer’s Meat Pie', kind: 'pie', c: '#d89a4a', c2: '#8a4a2a', test: t => has(t, 'meat') && has(t, 'grain') && has(t, 'dairy') },
  { name: 'Golden Orchard Tart', kind: 'pie', c: '#e8b04a', c2: '#d8402e', test: t => has(t, 'fruit') && has(t, 'grain') && has(t, 'sweet') },
  { name: 'Sweet Cream Pudding', kind: 'pudding', c: '#f8e8b0', c2: '#c87a2a', test: t => has(t, 'dairy') && has(t, 'sweet') && has(t, 'egg') },
  { name: 'Riverstone Chowder', kind: 'bowl', c: '#f0e2c0', c2: '#e89a6a', test: t => has(t, 'fish') && has(t, 'dairy') },
  { name: 'Highland Omelette', kind: 'omelette', c: '#f8d860', c2: '#6cbf3a', test: t => has(t, 'egg') && (has(t, 'herb') || has(t, 'mushroom') || has(t, 'meat')) },
  { name: 'Twin Harvest Grill', kind: 'plate', c: '#b85a3a', c2: '#e8b8a0', test: t => has(t, 'meat') && has(t, 'fish') },
  { name: 'Hearthside Stew', kind: 'bowl', c: '#9a5a2e', c2: '#d8803a', test: t => has(t, 'meat') && (has(t, 'mushroom') || has(t, 'herb') || has(t, 'fruit')) },
  { name: 'Lakeshore Hotpot', kind: 'bowl', c: '#d8a060', c2: '#f0e0c0', test: t => has(t, 'fish') && (has(t, 'mushroom') || has(t, 'herb') || has(t, 'fruit')) },
  { name: 'Honey-Glazed Roast', kind: 'plate', c: '#c86a2a', c2: '#f0a020', test: t => has(t, 'meat') && has(t, 'sweet') },
  { name: 'Smoked Haunch Skewer', kind: 'skewer', c: '#8a3a22', c2: '#d8803a', test: t => has(t, 'meat') },
  { name: 'Ember-Seared Fillet', kind: 'skewer', c: '#e8a070', c2: '#f8e8d0', test: t => has(t, 'fish') },
  { name: 'Sunrise Flatbread', kind: 'bread', c: '#e8c070', c2: '#a86a2a', test: t => has(t, 'grain') },
  { name: 'Woodland Skillet', kind: 'plate', c: '#a86a3a', c2: '#e8d0a0', test: t => has(t, 'mushroom') && only(t, ['mushroom', 'spice']) },
  { name: 'Orchard Compote', kind: 'bowl', c: '#d84a3a', c2: '#f0b040', test: t => has(t, 'fruit') && only(t, ['fruit', 'sweet', 'spice']) },
  { name: 'Steamed Meadow Greens', kind: 'plate', c: '#6cbf3a', c2: '#b8e070', test: t => has(t, 'herb') && only(t, ['herb', 'flower', 'spice']) },
  { name: 'Soft-Boiled Egg', kind: 'cup', c: '#f8f0e0', c2: '#f8c030', test: t => has(t, 'egg') && only(t, ['egg', 'spice']) },
  { name: 'Forager’s Medley', kind: 'bowl', c: '#7aa83a', c2: '#c8503a', test: t => has(t, 'mushroom') || has(t, 'herb') || has(t, 'fruit') },
  { name: 'Warm Honeyed Milk', kind: 'cup', c: '#f8f0e0', c2: '#f0a020', test: t => has(t, 'dairy') },
  { name: 'Candied Drops', kind: 'plate', c: '#f0a020', c2: '#fff0c0', test: t => has(t, 'sweet') },
  { name: 'Salted Broth', kind: 'bowl', c: '#e0c890', c2: '#f8f0d8', test: () => true },
];

export const DUBIOUS = { name: 'Dubious Mash', kind: 'mash', c: '#7a6a8a', c2: '#5a7a4a' };

// seeded random for deterministic results (critical cooks)
let _seed = 1;
export function setCookSeed(s) { _seed = s >>> 0 || 1; }
function rand() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }

// ids: array of item ids (1..5). Returns a dish object (not yet in the inventory).
export function cook(ids) {
  const items = ids.map(id => ITEMS[id]).filter(Boolean);
  if (!items.length) return null;
  const tags = {}; let monster = 0, mineral = 0, spice = 0, hp = 0, value = 0;
  const eff = {}; let effCount = 0;
  for (const it of items) {
    value += it.value || 0;
    if (it.tags.includes('mineral') || it.cat === 'key') { mineral++; continue; }
    if (it.tags.includes('monster')) { monster++; continue; }
    hp += it.hp || 0;
    for (const t of it.tags) tags[t] = (tags[t] || 0) + 1;
    if (it.tags.includes('spice') || it.tags.includes('sweet')) spice++;
    if (it.effect) { eff[it.effect] = (eff[it.effect] || 0) + (it.pot || 1); effCount++; }
  }
  const nonMonster = items.length - monster - mineral;
  const plantsOnlyEffects = items.every(it => it.tags.includes('monster') || (it.effect && (it.tags.includes('herb') || it.tags.includes('flower') || it.tags.includes('mushroom'))));
  const effKeys = Object.keys(eff);
  const effect = effKeys.length === 1 ? effKeys[0] : null;
  const dish = { id: 'dish', uid: 'd' + Math.floor(rand() * 1e9).toString(36) + Date.now().toString(36).slice(-4), ingredients: ids.slice(), effect: null, level: 0, duration: 0, stamina: 0 };

  if (mineral > 0 || nonMonster === 0 || (monster > 0 && !(plantsOnlyEffects && effect))) {
    Object.assign(dish, { name: DUBIOUS.name, kind: DUBIOUS.kind, c: DUBIOUS.c, c2: DUBIOUS.c2, hp: 2, value: 2, dubious: true,
      desc: 'Something went wrong in the pot. It is technically edible.' });
    return dish;
  }
  let recipe;
  if (monster > 0) {
    const E = EFFECTS[effect];
    recipe = { name: E.draught, kind: 'bottle', c: E.color, c2: '#ffffff' };
  } else recipe = RECIPES.find(r => r.test(tags));
  dish.kind = recipe.kind; dish.c = recipe.c; dish.c2 = recipe.c2;
  let name = recipe.name;
  dish.hp = monster > 0 ? 0 : Math.max(1, hp * 2 + spice);
  if (effect) {
    const E = EFFECTS[effect];
    const pot = eff[effect];
    dish.effect = effect;
    dish.level = pot >= 5 ? 3 : pot >= 3 ? 2 : 1;
    if (E.timed) dish.duration = Math.min(1800, 30 * effCount + 20 * (items.length - effCount - monster) + 60 * monster + 30 * spice + 30);
    if (effect === 'vigor') dish.stamina = Math.min(100, 20 * pot + 10 * monster);
    if (effect === 'hearty') dish.hp = 999;
    if (monster === 0) name = `${E.prefix} ${name}`;
  }
  // a perfect simmer: occasional bonus
  if (rand() < 0.12) {
    dish.critical = true;
    if (dish.duration) dish.duration = Math.min(1800, dish.duration + 120);
    else if (dish.hp < 999) dish.hp += 4;
    if (dish.level && dish.level < 3 && !dish.duration) dish.level++;
  }
  dish.name = name;
  dish.value = Math.max(2, Math.round(value * 1.5));
  dish.desc = describeDish(dish);
  return dish;
}

export function describeDish(d) {
  if (d.dubious) return d.desc;
  const parts = [];
  if (d.hp >= 999) parts.push('Fully restores your hearts.');
  else if (d.hp > 0) parts.push(`Restores ${fmtHearts(d.hp)} heart${d.hp > 4 ? 's' : ''}.`);
  if (d.effect) {
    const E = EFFECTS[d.effect];
    if (d.effect === 'vigor') parts.push(`Restores stamina (${d.stamina}%).`);
    else if (d.effect !== 'hearty') parts.push(`${E.name} Lv${d.level} for ${fmtTime(d.duration)}.`);
  }
  if (d.critical) parts.push('Simmered to perfection.');
  return parts.join(' ');
}
export function fmtHearts(q) { const h = q / 4; return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, ''); }
export function fmtTime(s) { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
