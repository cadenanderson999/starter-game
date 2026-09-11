'use strict';
// Hollowmere — offline town-builder / night-raid defense, pixel-art edition.
// One file: data tables, pixel sprite generator, simulation, camera renderer, DOM UI, save/load.

// ---------------------------------------------------------------- constants
const COLS = 64, ROWS = 48;                       // world size in tiles
const PX = 16, SCALE = 3, TS = PX * SCALE;        // sprite pixels per tile, zoom, screen px per tile
const DAY_LEN = 90, NIGHT_LEN = 50, CYCLE = DAY_LEN + NIGHT_LEN;
const SAVE_KEY = 'hollowmere-save-v2';

const DEFS = {
  hall:     { name: 'Town Hall',    icon: '🏛️', w: 2, h: 2, hp: 600, cost: {}, cap: 4, mini: '#e8c040',
              desc: 'The heart of Hollowmere. Lose it and the town falls. Upgrade it to unlock more buildings.' },
  house:    { name: 'House',        icon: '🏠', w: 1, h: 1, hp: 120, cost: { wood: 20 }, cap: 3, key: '1', mini: '#d08a5a',
              desc: 'Room for 3 villagers. Villagers sleep here at night.' },
  farm:     { name: 'Farm',         icon: '🌾', w: 2, h: 2, hp: 100, cost: { wood: 30 }, prod: 'food', rate: 0.6, key: '2', mini: '#b8c860',
              desc: 'A villager grows food here. Villagers eat food, and soldiers are trained with it.' },
  mill:     { name: 'Lumber Mill',  icon: '🪵', w: 1, h: 1, hp: 120, cost: { wood: 25, gold: 10 }, prod: 'wood', rate: 0.5, key: '3', mini: '#9c7a4f',
              desc: 'A villager chops wood here. Wood builds and repairs everything.' },
  mine:     { name: 'Gold Mine',    icon: '⛏️', w: 1, h: 1, hp: 150, cost: { wood: 40 }, prod: 'gold', rate: 0.35, key: '4', mini: '#a0a0b0',
              desc: 'A villager digs gold here. Gold pays for towers, barracks and upgrades.' },
  wall:     { name: 'Wall',         icon: '🧱', w: 1, h: 1, hp: 300, cost: { wood: 8 }, key: '5', mini: '#8c8c96',
              desc: 'Cheap and tough. Mobs must chew through any wall in their way.' },
  tower:    { name: 'Archer Tower', icon: '🏹', w: 1, h: 1, hp: 200, cost: { wood: 30, gold: 30 }, range: 5, dmg: 10, rof: 0.7, key: '6', mini: '#6a7fd8',
              desc: 'Shoots any mob within 5 tiles. Your best friend at night.' },
  barracks: { name: 'Barracks',     icon: '⚔️', w: 2, h: 2, hp: 250, cost: { wood: 60, gold: 60 }, th: 2, soldiers: 3, key: '7', mini: '#c06060',
              desc: 'Trains up to 3 soldiers (10 food each) who guard the town and hunt mobs.' },
  tavern:   { name: 'Tavern',       icon: '🍺', w: 1, h: 1, hp: 150, cost: { wood: 30, gold: 40 }, th: 2, fun: true, key: '8', mini: '#c080c0',
              desc: 'Villagers come here to have fun. Happy villagers work up to twice as fast.' },
  tree:     { name: 'Pine Tree',    icon: '🌲', w: 1, h: 1, hp: 40, cost: {}, tree: true, mini: '#2f6b34',
              desc: 'Blocks building and walking. Chop it down (Demolish) for 6 wood. Mobs trample through forests slowly.' },
};
const BUILD_ORDER = ['house', 'farm', 'mill', 'mine', 'wall', 'tower', 'barracks', 'tavern'];
const TH_LEVELS = [
  { cost: {},                       hp: 600,  cap: 4 },
  { cost: { wood: 150, gold: 150 }, hp: 1000, cap: 6 },
  { cost: { wood: 400, gold: 400 }, hp: 1500, cap: 8 },
];
const MOBS = {
  goblin: { name: 'Goblin', hp: 30,  spd: 2.4, dmg: 4,  rof: 0.8, gold: 3,  hunts: true, r: 0.45 },
  orc:    { name: 'Orc',    hp: 90,  spd: 1.5, dmg: 10, rof: 1.0, gold: 8,  r: 0.5 },
  troll:  { name: 'Troll',  hp: 250, spd: 1.1, dmg: 25, rof: 1.5, gold: 20, r: 0.65 },
  shaman: { name: 'Shaman', hp: 40,  spd: 1.6, dmg: 12, rof: 2.0, gold: 10, ranged: 4, r: 0.45 },
  bomber: { name: 'Bomber', hp: 25,  spd: 3.0, dmg: 80, rof: 1.0, gold: 5,  bomb: true, r: 0.45 },
  king:   { name: 'Troll King', hp: 900, spd: 1.0, dmg: 45, rof: 1.6, gold: 120, boss: true, r: 0.9 },
};
const DASH_CD = 3, DASH_DIST = 3;
const DIFFS = { easy: 0.7, normal: 1, hard: 1.4 };
const UPGRADES = {
  gun:   { name: '🔫 Better rifle', desc: '+4 shot damage, faster fire', base: 80, max: 4 },
  vest:  { name: '🛡️ Leather vest', desc: '+40 max HP', base: 80, max: 4 },
  boots: { name: '👟 Swift boots', desc: '+0.6 walk speed', base: 60, max: 3 },
};
const upCost = k => Math.round(UPGRADES[k].base * Math.pow(1.6, S.up[k]));
const count = t => S.buildings.filter(b => b.type === t).length;
const QUESTS = [
  { id: 'house1',  text: 'Build a House',                    reward: { wood: 20 },  check: () => count('house') >= 1 },
  { id: 'farm1',   text: 'Build a Farm',                     reward: { wood: 20 },  check: () => count('farm') >= 1 },
  { id: 'tower1',  text: 'Build an Archer Tower',            reward: { gold: 30 },  check: () => count('tower') >= 1 },
  { id: 'night1',  text: 'Survive the first night',          reward: { gold: 40 },  check: () => S.day >= 2 },
  { id: 'trees10', text: 'Chop 10 trees',                    reward: { wood: 30 },  check: () => (S.chopped || 0) >= 10 },
  { id: 'pop6',    text: 'Grow to 6 villagers',              reward: { food: 30 },  check: () => S.villagers.length >= 6 },
  { id: 'walls20', text: 'Raise 20 wall segments',           reward: { wood: 40 },  check: () => count('wall') >= 20 },
  { id: 'kills25', text: 'Slay 25 mobs',                     reward: { gold: 50 },  check: () => S.kills >= 25 },
  { id: 'th2',     text: 'Upgrade the Town Hall to level 2', reward: { gold: 60 },  check: () => S.thLevel >= 2 },
  { id: 'barracks',text: 'Build a Barracks',                 reward: { food: 30 },  check: () => count('barracks') >= 1 },
  { id: 'tavern',  text: 'Open a Tavern',                    reward: { gold: 40 },  check: () => count('tavern') >= 1 },
  { id: 'night5',  text: 'Defeat the Troll King (night 5)',  reward: { gold: 150 }, check: () => S.day >= 6 },
  { id: 'kills100',text: 'Slay 100 mobs',                    reward: { gold: 100 }, check: () => S.kills >= 100 },
  { id: 'pop15',   text: 'Grow to 15 villagers',             reward: { gold: 80 },  check: () => S.villagers.length >= 15 },
  { id: 'th3',     text: 'Upgrade the Town Hall to level 3', reward: { gold: 200 }, check: () => S.thLevel >= 3 },
  { id: 'night10', text: 'Survive 10 nights',                reward: { gold: 300 }, check: () => S.day >= 11 },
  { id: 'night20', text: 'Survive 20 nights — a legend',     reward: { gold: 999 }, check: () => S.day >= 21 },
];
function checkQuests() {
  for (const q of QUESTS) {
    if (S.done.includes(q.id) || !q.check()) continue;
    S.done.push(q.id); for (const k in q.reward) S.res[k] += q.reward[k];
    const msg = `✅ Quest done: ${q.text} — ${costStr(q.reward) || `🍞${q.reward.food}`}`;
    log(msg); S.banner = { text: msg, life: 3.5 }; blip(900, 0.15); setTimeout(() => blip(1200, 0.2), 120);
  }
}
const NAMES = ['Ada', 'Bo', 'Cyrus', 'Dara', 'Eli', 'Fenn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lulu', 'Milo', 'Nia',
  'Otto', 'Pip', 'Quin', 'Rae', 'Sol', 'Tess', 'Uma', 'Vic', 'Wren', 'Xio', 'Yara', 'Zed', 'Ash', 'Bryn', 'Cole', 'Dove'];
const CRY_CD = 20, CRY_RANGE = 3, CRY_DMG = 35;
const HERO_SPEED = 4.2, SHOT_CD = 0.32, SHOT_SPEED = 18, SHOT_RANGE = 8;

// ---------------------------------------------------------------- helpers
const $ = s => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const center = b => ({ x: b.gx + b.w / 2, y: b.gy + b.h / 2 });
const door = b => ({ x: b.gx + b.w / 2, y: Math.min(ROWS - 0.3, b.gy + b.h + 0.3) });
function rectDist(p, b) {
  const cx = clamp(p.x, b.gx, b.gx + b.w), cy = clamp(p.y, b.gy, b.gy + b.h);
  return Math.hypot(p.x - cx, p.y - cy);
}
function moveToward(e, tx, ty, spd, dt) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy), step = spd * dt;
  if (d <= step) { e.x = tx; e.y = ty; return true; }
  e.x += dx / d * step; e.y += dy / d * step; if (Math.abs(dx) > 0.05) e.face = dx < 0 ? -1 : 1; return false;
}
function canAfford(cost) { return Object.keys(cost).every(k => S.res[k] >= cost[k]); }
function pay(cost) { for (const k in cost) S.res[k] -= cost[k]; }
function costStr(cost) {
  const parts = [];
  if (cost.wood) parts.push(`🪵${cost.wood}`);
  if (cost.gold) parts.push(`🪙${cost.gold}`);
  if (cost.food) parts.push(`🍞${cost.food}`);
  return parts.join(' ') || 'free';
}
const tileAt = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? null : grid[Math.floor(y)][Math.floor(x)];

// ---------------------------------------------------------------- state
let S = null, grid = null, bmap = null;
let speed = 1, paused = false, buildSel = null, demolish = false, selected = null;
let hover = { x: -1, y: -1 }, mouseW = { x: 0, y: 0 }, uiTimer = 0, saveTimer = 0, lastFrame = 0;
const keys = {}; let firing = false, painting = false; const touchVec = { x: 0, y: 0 };
const cam = { x: COLS / 2, y: ROWS / 2 }; let shakeT = 0, shakeMag = 0;
function shake(t, mag) { shakeT = Math.max(shakeT, t); shakeMag = Math.max(shakeMag, mag); }

let chosenDiff = 'normal';
function newState() {
  const hx = Math.floor(COLS / 2) - 1, hy = Math.floor(ROWS / 2) - 1;
  S = {
    v: 2, nextId: 1, res: { gold: 50, wood: 80, food: 40 }, day: 1, t: 0, thLevel: 1,
    buildings: [], villagers: [], mobs: [], soldiers: [], projs: [], fx: [], log: [],
    waveQueue: [], arrivalTimer: 0, kills: 0, over: false, banner: null, foodWarned: false, diff: 'normal', up: { gun: 0, vest: 0, boots: 0 }, drops: [], parts: [], done: [], chopped: 0, questT: 0,
    hero: { x: hx + 1, y: hy + 3, hp: 150, maxhp: 150, cd: 0, dead: 0, cry: 0, cryFx: 0, face: 1, anim: 0, moving: false },
  };
  S.diff = chosenDiff; rebuildGrid();
  addBuilding('hall', hx, hy);
  // forest: sparse near town, dense at the edges
  const c = { x: hx + 1, y: hy + 1 };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
    if (d < 9) continue;
    const p = d < 15 ? 0.08 : d < 22 ? 0.2 : 0.34;
    if (Math.random() < p && canPlace('tree', x, y)) addBuilding('tree', x, y);
  }
  addVillager(); addVillager();
  cam.x = c.x; cam.y = c.y;
  log('Welcome to Hollowmere. Build houses and a farm before nightfall!');
  paintGround();
}
function rebuildGrid() {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  bmap = new Map();
  for (const b of S.buildings) {
    bmap.set(b.id, b);
    for (let y = b.gy; y < b.gy + b.h; y++) for (let x = b.gx; x < b.gx + b.w; x++) grid[y][x] = b;
  }
}
const bld = id => (id == null ? null : bmap.get(id) || null);
const mob = id => (id == null ? null : S.mobs.find(m => m.id === id) || null);
const capacity = () => S.buildings.reduce((n, b) => n + (b.type === 'hall' ? TH_LEVELS[S.thLevel - 1].cap : DEFS[b.type].cap || 0), 0);
const isNight = () => S.t >= DAY_LEN;
const heroLevel = () => 1 + Math.floor(S.kills / 10);
const heroDmg = () => 12 + 2 * (heroLevel() - 1) + 4 * S.up.gun;
const heroMaxHp = () => 150 + 10 * (heroLevel() - 1) + 40 * S.up.vest;
const heroSpeed = () => HERO_SPEED + 0.6 * S.up.boots;
const shotCd = () => SHOT_CD - 0.03 * S.up.gun;
function log(msg) { S.log.unshift(msg); if (S.log.length > 40) S.log.pop(); }
function fx(x, y, text, color, life = 0.9) { S.fx.push({ x, y, text, color, life, max: life }); if (S.fx.length > 80) S.fx.shift(); }
function toast(msg) { S.banner = { text: msg, life: 1.5 }; }

// ---------------------------------------------------------------- buildings
function canPlace(type, gx, gy) {
  const d = DEFS[type];
  if (gx < 0 || gy < 0 || gx + d.w > COLS || gy + d.h > ROWS) return false;
  for (let y = gy; y < gy + d.h; y++) for (let x = gx; x < gx + d.w; x++) if (grid[y][x]) return false;
  if (!d.tree) {   // keep the player from building on top of the Mayor
    const h = S.hero; if (h.dead <= 0 && h.x >= gx - 0.3 && h.x <= gx + d.w + 0.3 && h.y >= gy - 0.3 && h.y <= gy + d.h + 0.3) return false;
  }
  return true;
}
function addBuilding(type, gx, gy) {
  const d = DEFS[type];
  const b = { id: S.nextId++, type, gx, gy, w: d.w, h: d.h, hp: d.hp, maxhp: d.hp, cd: 0, trainCd: 0, v: Math.floor(rnd(0, 3)) };
  if (type === 'hall') b.maxhp = b.hp = TH_LEVELS[S.thLevel - 1].hp;
  S.buildings.push(b); rebuildGrid(); return b;
}
function tryBuild(type, gx, gy) {
  const d = DEFS[type];
  if ((d.th || 1) > S.thLevel) return toast(`Needs Town Hall level ${d.th}`);
  if (!canAfford(d.cost)) return toast('Not enough resources');
  if (!canPlace(type, gx, gy)) return;
  pay(d.cost); const b = addBuilding(type, gx, gy); paintDirt(b);
  blip(440, 0.05);
}
function removeBuilding(b, reason) {
  S.buildings = S.buildings.filter(x => x !== b);
  for (const v of S.villagers) { if (v.job === b.id) { v.job = null; if (v.state === 'working' || v.state === 'toWork') v.state = 'idle'; } if (v.home === b.id) v.home = null; }
  rebuildGrid();
  if (selected && selected.kind === 'building' && selected.id === b.id) selected = null;
  if (reason === 'destroyed' && !DEFS[b.type].tree) {
    log(`${DEFS[b.type].icon} ${DEFS[b.type].name} was destroyed!`);
    fx(b.gx + b.w / 2, b.gy + b.h / 2, '💥', '#fff', 1.2); burst(b.gx + b.w / 2, b.gy + b.h / 2, 14, '#c0a080'); shake(0.3, 5); boom();
    if (b.type === 'hall') gameOver();
  }
}
function damageBuilding(b, dmg) { b.hp -= dmg; if (b.hp <= 0) removeBuilding(b, 'destroyed'); }
function demolishBuilding(b) {
  if (b.type === 'hall') return toast('You cannot demolish the Town Hall');
  if (b.type === 'tree') { S.res.wood += 6; S.chopped = (S.chopped || 0) + 1; fx(b.gx + 0.5, b.gy + 0.3, '+🪵6', '#e8c060'); burst(b.gx + 0.5, b.gy + 0.5, 8, '#3a8a3a'); removeBuilding(b, 'chopped'); blip(300, 0.05); return; }
  const c = DEFS[b.type].cost; for (const k in c) S.res[k] += Math.floor(c[k] / 2);
  removeBuilding(b, 'demolished'); log(`Demolished a ${DEFS[b.type].name}.`);
}
function repairCost() { return Math.ceil(S.buildings.reduce((n, b) => n + (DEFS[b.type].tree ? 0 : b.maxhp - b.hp), 0) / 10); }
function repairAll() {
  const c = repairCost(); if (!c) return;
  if (S.res.wood < c) return toast(`Repairs need 🪵${c}`);
  S.res.wood -= c; for (const b of S.buildings) if (!DEFS[b.type].tree) b.hp = b.maxhp; log(`Repaired the town for 🪵${c}.`); blip(520, 0.08);
}
function upgradeHall() {
  const next = TH_LEVELS[S.thLevel]; if (!next) return toast('Town Hall is at max level');
  if (!canAfford(next.cost)) return toast('Not enough resources for the upgrade');
  pay(next.cost); S.thLevel++;
  const hall = S.buildings.find(b => b.type === 'hall'); hall.maxhp = next.hp; hall.hp = next.hp;
  log(`🏛️ Town Hall upgraded to level ${S.thLevel}!` + (S.thLevel === 2 ? ' Barracks and Tavern unlocked.' : ''));
  blip(660, 0.12);
}

// ---------------------------------------------------------------- villagers
function addVillager() {
  const hall = S.buildings.find(b => b.type === 'hall'); const p = door(hall);
  const v = { id: S.nextId++, name: NAMES[Math.floor(Math.random() * NAMES.length)], x: p.x + rnd(-0.5, 0.5), y: p.y,
    state: 'idle', job: null, home: null, hunger: rnd(10, 40), energy: rnd(70, 100), fun: rnd(40, 80), wt: 0, tx: null, ty: null, face: 1, anim: rnd(0, 1) };
  S.villagers.push(v); return v;
}
const happiness = v => ((100 - v.hunger) + v.energy + v.fun) / 3;
const productivity = v => 0.5 + happiness(v) / 200;
function nearestBuilding(p, pred) {
  let best = null, bd = 1e9;
  for (const b of S.buildings) if (pred(b)) { const d = rectDist(p, b); if (d < bd) { bd = d; best = b; } }
  return best;
}
function findJob(v) {
  const taken = new Set(S.villagers.filter(o => o !== v && o.job != null).map(o => o.job));
  return nearestBuilding(v, b => DEFS[b.type].prod && !taken.has(b.id));
}
function goHome(v) {
  const h = nearestBuilding(v, b => b.type === 'house' || b.type === 'hall');
  v.home = h ? h.id : null; v.state = 'toHome';
}
function updateVillager(v, dt) {
  const night = isNight();
  v.hunger = clamp(v.hunger + 0.7 * dt, 0, 100);
  v.fun = clamp(v.fun - 0.25 * dt, 0, 100);
  if (v.state !== 'sleeping') v.energy = clamp(v.energy - 0.45 * dt, 0, 100);
  if (v.hunger >= 60 && S.res.food >= 5) { S.res.food -= 5; v.hunger = clamp(v.hunger - 70, 0, 100); }
  if (night && v.state !== 'sleeping' && v.state !== 'toHome') goHome(v);
  const tavern = () => nearestBuilding(v, b => b.type === 'tavern');
  const ox = v.x, oy = v.y;
  switch (v.state) {
    case 'idle': {
      if (v.energy < 15) { goHome(v); break; }
      if (v.fun < 25 && tavern()) { v.state = 'toFun'; break; }
      if (v.job == null || !bld(v.job)) { const j = findJob(v); v.job = j ? j.id : null; }
      if (v.job != null) { v.state = 'toWork'; break; }
      v.wt -= dt;
      if (v.tx == null || v.wt <= 0) {
        const hall = S.buildings.find(b => b.type === 'hall'); const p = door(hall);
        v.tx = clamp(p.x + rnd(-3, 3), 0.3, COLS - 0.3); v.ty = clamp(p.y + rnd(-1, 3), 0.3, ROWS - 0.3); v.wt = rnd(2, 5);
      }
      if (moveToward(v, v.tx, v.ty, 1.2, dt)) v.tx = null;
      break;
    }
    case 'toWork': { const b = bld(v.job); if (!b) { v.state = 'idle'; break; } const p = door(b); if (moveToward(v, p.x, p.y, 1.6, dt)) v.state = 'working'; break; }
    case 'working': {
      const b = bld(v.job); if (!b) { v.state = 'idle'; break; }
      S.res[DEFS[b.type].prod] += DEFS[b.type].rate * productivity(v) * dt;
      if (v.energy < 15) goHome(v); else if (v.fun < 20 && tavern()) v.state = 'toFun';
      break;
    }
    case 'toHome': {
      const h = bld(v.home); if (!h) { goHome(v); if (!bld(v.home)) v.state = 'sleeping'; break; }
      const p = door(h); if (moveToward(v, p.x, p.y, 1.8, dt)) v.state = 'sleeping';
      break;
    }
    case 'sleeping': { v.energy = clamp(v.energy + 3 * dt, 0, 100); if (!night && v.energy >= 90) { v.state = 'idle'; v.tx = null; } break; }
    case 'toFun': { const tv = tavern(); if (!tv) { v.state = 'idle'; break; } const p = door(tv); if (moveToward(v, p.x, p.y, 1.6, dt)) v.state = 'fun'; break; }
    case 'fun': { v.fun = clamp(v.fun + 6 * dt, 0, 100); if (v.fun >= 95 || !tavern()) v.state = 'idle'; break; }
  }
  v.moving = ox !== v.x || oy !== v.y; if (v.moving) v.anim += dt * 8;
}

// ---------------------------------------------------------------- mobs
function waveFor(n) {
  const list = [];
  for (let i = 0; i < 4 + 2 * n; i++) list.push('goblin');
  if (n >= 2) for (let i = 0; i < Math.floor(n * 1.2) - 1; i++) list.push('orc');
  if (n >= 4) for (let i = 0; i < Math.floor((n - 2) / 2); i++) list.push('troll');
  if (n >= 3) for (let i = 0; i < Math.floor((n - 1) / 2); i++) list.push('shaman');
  if (n >= 3) for (let i = 0; i < Math.floor(n / 2); i++) list.push('bomber');
  list.sort(() => Math.random() - 0.5);
  if (n % 5 === 0) list.push('king');
  const spread = Math.min(18, 5 + list.length);
  return list.map((type, i) => ({ type, delay: i * (spread / list.length) + rnd(0, 1.5) }));
}
function waveSummary(n) {
  const c = {}; for (const w of waveFor(n)) c[w.type] = (c[w.type] || 0) + 1;
  return Object.keys(MOBS).filter(k => c[k]).map(k => `${c[k]} ${MOBS[k].name}${c[k] > 1 ? 's' : ''}`).join(', ');
}
function startNight() {
  const n = S.day; S.waveQueue = waveFor(n);
  const boss = S.waveQueue.some(w => w.type === 'king');
  S.banner = { text: boss ? `👑 Night ${n} — the TROLL KING is coming!` : `🌙 Night ${n} — ${S.waveQueue.length} mobs approach!`, life: 4 };
  log(`Night ${n} falls. ${S.waveQueue.length} mobs are coming.` + (boss ? ' The Troll King leads them!' : '')); horn();
}
function spawnMob(type) {
  const d = MOBS[type], n = S.day, side = Math.floor(rnd(0, 4));
  let x, y;
  if (side === 0) { x = rnd(0.5, COLS - 0.5); y = 0.5; } else if (side === 1) { x = rnd(0.5, COLS - 0.5); y = ROWS - 0.5; }
  else if (side === 2) { x = 0.5; y = rnd(0.5, ROWS - 0.5); } else { x = COLS - 0.5; y = rnd(0.5, ROWS - 0.5); }
  const k = DIFFS[S.diff] || 1, hp = Math.round(d.hp * (1 + 0.1 * (n - 1)) * k);
  S.mobs.push({ id: S.nextId++, type, x, y, hp, maxhp: hp, dmg: d.dmg * (1 + 0.05 * (n - 1)) * k, spd: d.spd, rof: d.rof,
    cd: rnd(0, d.rof), target: null, blocker: null, attacker: null, retarget: 0, face: 1, anim: 0 });
}
function pickTarget(m) {
  let best = null, bd = 1e9;
  for (const b of S.buildings) {
    if (b.type === 'tree') continue;
    if (b.type === 'wall' && !MOBS[m.type].bomb) continue;
    let d = rectDist(m, b);
    if (MOBS[m.type].bomb && (b.type === 'wall' || b.type === 'tower')) d *= 0.4;
    if (m.type === 'goblin' && (DEFS[b.type].prod || b.type === 'house')) d *= 0.6;
    if ((m.type === 'troll' || m.type === 'king') && (b.type === 'tower' || b.type === 'hall' || b.type === 'barracks')) d *= 0.5;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function damageMob(m, dmg, byUnit) {
  m.hp -= dmg; if (byUnit) m.attacker = byUnit;
  fx(m.x, m.y - 0.5, `-${Math.round(dmg)}`, '#ffd166', 0.6);
  if (m.hp <= 0) {
    S.mobs = S.mobs.filter(x => x !== m);
    S.res.gold += MOBS[m.type].gold; S.kills++;
    fx(m.x, m.y, `+🪙${MOBS[m.type].gold}`, '#f2c14e', 1);
    burst(m.x, m.y, MOBS[m.type].boss ? 40 : 10, m.type === 'goblin' || m.type === 'bomber' ? '#5aa040' : m.type === 'shaman' ? '#a060c0' : '#7a8a7a');
    if (MOBS[m.type].boss) { log('👑 The Troll King has fallen! The forest goes quiet.'); S.banner = { text: '👑 Troll King slain!', life: 4 }; shake(0.6, 8); for (let i = 0; i < 4; i++) S.drops.push({ x: m.x + rnd(-1, 1), y: m.y + rnd(-1, 1), kind: ['gold', 'gold', 'heart', 'wood'][i], life: 40 }); }
    if (Math.random() < 0.25) { const kinds = ['wood', 'food', 'gold', 'heart']; S.drops.push({ x: m.x, y: m.y, kind: kinds[Math.floor(Math.random() * kinds.length)], life: 30 }); }
    if (S.kills % 10 === 0) { const h = S.hero; h.maxhp = heroMaxHp(); h.hp = Math.min(h.maxhp, h.hp + 30); log(`🤠 The Mayor reached level ${heroLevel()}! Shots do ${heroDmg()}.`); }
    if (selected && selected.kind === 'mob' && selected.id === m.id) selected = null;
    blip(160, 0.06);
  }
}
// axis-separated step that refuses to enter occupied tiles; returns the blocking building (if any)
function stepBlocked(e, ux, uy, passTarget) {
  const tries = [[ux, uy]]; if (Math.abs(ux) > 1e-4) tries.push([ux, 0]); if (Math.abs(uy) > 1e-4) tries.push([0, uy]);
  let firstBlock = null;
  for (const [mx, my] of tries) {
    const nx = clamp(e.x + mx, 0.2, COLS - 0.2), ny = clamp(e.y + my, 0.2, ROWS - 0.2);
    const b = tileAt(nx, ny);
    if (!b || b === passTarget) { e.x = nx; e.y = ny; if (Math.abs(ux) > 0.001) e.face = ux < 0 ? -1 : 1; return null; }
    if (!firstBlock) firstBlock = b;
  }
  return firstBlock;
}
function updateMob(m, dt) {
  m.cd -= dt; m.retarget -= dt;
  const ox = m.x, oy = m.y;
  const a = m.attacker;
  if (a && (a.hp <= 0 || (a === S.hero && a.dead > 0))) m.attacker = null;
  else if (a) {
    const da = dist(m, a);
    if (da < 1.1) { if (m.cd <= 0) { hitUnit(a, m.dmg); m.cd = m.rof; } return; }
    if (MOBS[m.type].hunts && da < 7) {          // goblins chase whoever shot them
      const step = m.spd * dt, d = da || 1;
      const bl = stepBlocked(m, (a.x - m.x) / d * step, (a.y - m.y) / d * step, null);
      if (bl && bl.type !== 'tree' && m.cd <= 0) { damageBuilding(bl, m.dmg); m.cd = m.rof; }
      else if (bl && bl.type === 'tree' && m.cd <= 0) { damageBuilding(bl, m.dmg * 2); m.cd = m.rof; }
      m.moving = ox !== m.x || oy !== m.y; if (m.moving) m.anim += dt * 8; return;
    }
    if (da > 3) m.attacker = null;
  }
  if (!m.target || !bld(m.target) || m.retarget <= 0) { const t = pickTarget(m); m.target = t ? t.id : null; m.retarget = 3; }
  const tgt = bld(m.target); if (!tgt) return;
  if (m.blocker && !bld(m.blocker)) m.blocker = null;
  const atk = bld(m.blocker) || (rectDist(m, tgt) < 0.7 ? tgt : null);
  const def = MOBS[m.type];
  if (def.ranged && rectDist(m, tgt) <= def.ranged && !(atk && atk.type === 'tree')) {   // shaman lobs fire from a distance
    if (m.cd <= 0) { const c = center(tgt); S.projs.push({ x: m.x, y: m.y - 0.4, tb: tgt.id, tx: c.x, ty: c.y, spd: 7, dmg: m.dmg }); m.cd = m.rof; }
    m.moving = false; return;
  }
  if (atk && def.bomb && atk.type !== 'tree') {                                           // bomber blows up on contact
    damageBuilding(atk, m.dmg); burst(m.x, m.y, 16, '#ffa030'); fx(m.x, m.y - 0.5, 'BOOM', '#ff8040', 0.8); boom(); shake(0.35, 7);
    for (const u of [S.hero, ...S.soldiers]) if (u.hp > 0 && dist(u, m) < 1.5) hitUnit(u, 20);
    S.mobs = S.mobs.filter(x => x !== m); return;
  }
  if (atk) {
    if (m.cd <= 0) { damageBuilding(atk, atk.type === 'tree' ? m.dmg * 2 : m.dmg); m.cd = m.rof; if (atk.type !== 'tree') { fx(m.x, m.y - 0.3, '💢', '#f66', 0.4); if (def.boss || m.type === 'troll') shake(0.25, def.boss ? 6 : 3); } }
    m.moving = false; return;
  }
  const c = center(tgt), dx = c.x - m.x, dy = c.y - m.y, d = Math.hypot(dx, dy) || 1, step = m.spd * dt;
  const bl = stepBlocked(m, dx / d * step, dy / d * step, tgt);
  if (bl) m.blocker = bl.id;
  m.moving = ox !== m.x || oy !== m.y; if (m.moving) m.anim += dt * 8;
}

// ---------------------------------------------------------------- towers, soldiers, hero
function nearestMob(p, range) {
  let best = null, bd = range;
  for (const m of S.mobs) { const d = dist(p, m); if (d < bd) { bd = d; best = m; } }
  return best;
}
function updateTower(b, dt) {
  b.cd -= dt; if (b.cd > 0) return;
  const c = center(b), m = nearestMob(c, DEFS.tower.range + 0.5);
  if (!m) return;
  const dmg = DEFS.tower.dmg * (S.thLevel >= 3 ? 1.5 : 1);
  S.projs.push({ x: c.x, y: c.y - 0.4, target: m.id, dmg, spd: 14 }); b.cd = DEFS.tower.rof;
}
function updateProj(p, dt) {
  if (p.target != null) {                                        // homing arrow
    const m = mob(p.target); if (!m) return false;
    if (moveToward(p, m.x, m.y, p.spd, dt)) { damageMob(m, p.dmg); burst(m.x, m.y - 0.3, 3, '#ffe070'); return false; }
    return true;
  }
  if (p.tb != null) {                                            // shaman fireball
    if (moveToward(p, p.tx, p.ty, p.spd, dt)) { const b = bld(p.tb); if (b) { damageBuilding(b, p.dmg); burst(p.x, p.y, 8, '#ff7030'); } return false; }
    return true;
  }
  p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;               // bullet
  if (p.life <= 0 || p.x < 0 || p.y < 0 || p.x > COLS || p.y > ROWS) return false;
  const m = S.mobs.find(x => dist(p, x) < MOBS[x.type].r); if (m) { damageMob(m, p.dmg, S.hero); burst(m.x, m.y - 0.3, 3, '#ffe070'); return false; }
  return true;
}
function updateBarracks(b, dt) {
  b.trainCd -= dt;
  const mine = S.soldiers.filter(s => s.home === b.id).length;
  if (mine < DEFS.barracks.soldiers && b.trainCd <= 0 && S.res.food >= 10) {
    S.res.food -= 10; const p = door(b);
    S.soldiers.push({ id: S.nextId++, x: p.x + rnd(-0.6, 0.6), y: p.y + rnd(0, 0.6), hp: 80, maxhp: 80, home: b.id, target: null, cd: 0, face: 1, anim: 0 });
    b.trainCd = 15; log('💂 A soldier finished training.');
  }
}
function hitUnit(u, dmg) {
  u.hp -= dmg; fx(u.x, u.y - 0.5, `-${Math.round(dmg)}`, '#ff8080', 0.5);
  if (u.hp <= 0) {
    if (u === S.hero) { u.dead = 15; u.hp = 0; log('🤠 The Mayor fell! Recovering at the Town Hall…'); }
    else { S.soldiers = S.soldiers.filter(s => s !== u); log('💂 A soldier has fallen.'); }
  }
}
function updateSoldier(s, dt) {
  s.cd -= dt; const ox = s.x, oy = s.y;
  let m = mob(s.target); if (!m) { m = nearestMob(s, 8); s.target = m ? m.id : null; }
  if (m) {
    if (dist(s, m) <= 0.9) { if (s.cd <= 0) { damageMob(m, 8, s); s.cd = 0.6; } }
    else moveToward(s, m.x, m.y, 2.4, dt);
  } else {
    const h = bld(s.home) || S.buildings.find(b => b.type === 'hall');
    if (h) { const p = door(h); if (dist(s, p) > 1.2) moveToward(s, p.x, p.y, 2, dt); }
    if (!isNight()) s.hp = clamp(s.hp + 3 * dt, 0, s.maxhp);
  }
  s.moving = ox !== s.x || oy !== s.y; if (s.moving) s.anim += dt * 8;
}
function burst(x, y, n, color) {
  for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), sp = rnd(1, 4); S.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: rnd(0.3, 0.7), color }); }
  if (S.parts.length > 300) S.parts.splice(0, S.parts.length - 300);
}
function buyUpgrade(k) {
  const u = UPGRADES[k]; if (S.up[k] >= u.max) return toast('Already maxed out');
  const c = upCost(k); if (S.res.gold < c) return toast(`Needs 🪙${c}`);
  S.res.gold -= c; S.up[k]++; S.hero.maxhp = heroMaxHp(); if (k === 'vest') S.hero.hp += 40;
  log(`${u.name} → level ${S.up[k]}.`); blip(700, 0.1);
}
function warCry() {
  const h = S.hero; if (h.dead > 0 || h.cry > 0) return;
  h.cry = CRY_CD; h.cryFx = 0.6; let n = 0;
  for (const m of S.mobs.slice()) if (dist(h, m) <= CRY_RANGE) { damageMob(m, CRY_DMG, h); n++; }
  fx(h.x, h.y - 0.9, 'WAR CRY!', '#fff', 1);
  if (n) log(`🤠 War cry hits ${n} mob${n === 1 ? '' : 's'}!`); blip(110, 0.35);
}
function fireAt(wx, wy) {
  const h = S.hero; if (h.dead > 0 || h.cd > 0 || S.over) return;
  const dx = wx - h.x, dy = wy - h.y, d = Math.hypot(dx, dy) || 1;
  h.face = dx < 0 ? -1 : 1; h.cd = shotCd(); h.flash = 0.06;
  S.projs.push({ x: h.x + dx / d * 0.4, y: h.y - 0.2 + dy / d * 0.4, vx: dx / d * SHOT_SPEED, vy: dy / d * SHOT_SPEED, life: SHOT_RANGE / SHOT_SPEED, dmg: heroDmg() });
  noise(0.07, 0.05, 2500);
}
function updateHero(dt) {
  const h = S.hero;
  if (h.dead > 0) {
    h.dead -= dt;
    if (h.dead <= 0) { const hall = S.buildings.find(b => b.type === 'hall'); const p = door(hall); h.x = p.x; h.y = p.y; h.hp = h.maxhp; log('🤠 The Mayor is back on their feet.'); }
    return;
  }
  h.cd -= dt; h.cry = Math.max(0, h.cry - dt); h.cryFx = Math.max(0, h.cryFx - dt); h.flash = Math.max(0, (h.flash || 0) - dt);
  let dx = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0);
  let dy = (keys.s || keys.ArrowDown ? 1 : 0) - (keys.w || keys.ArrowUp ? 1 : 0);
  if (!dx && !dy && (Math.abs(touchVec.x) > 0.2 || Math.abs(touchVec.y) > 0.2)) { dx = touchVec.x; dy = touchVec.y; }
  h.moving = !!(dx || dy);
  h.dash = Math.max(0, (h.dash || 0) - dt);
  if (h.moving) {
    const d = Math.hypot(dx, dy); const step = heroSpeed() * dt;
    stepBlocked(h, dx / d * step, dy / d * step, null); h.anim += dt * 9;
    if ((keys.Shift) && h.dash <= 0) { h.dash = DASH_CD; for (let i = 0; i < 12; i++) { burst(h.x, h.y + 0.3, 1, '#c8b890'); if (stepBlocked(h, dx / d * DASH_DIST / 12, dy / d * DASH_DIST / 12, null)) break; } blip(500, 0.08); }
  }
  if (firing) fireAt(mouseW.x, mouseW.y);
  if (!isNight() || !nearestMob(h, 6)) h.hp = clamp(h.hp + 2 * dt, 0, h.maxhp);
  for (const d of S.drops) if (dist(h, d) < 0.7) {
    d.life = 0;
    if (d.kind === 'wood') { S.res.wood += 10; fx(h.x, h.y - 0.8, '+🪵10', '#e8c060'); }
    else if (d.kind === 'food') { S.res.food += 10; fx(h.x, h.y - 0.8, '+🍞10', '#f0d060'); }
    else if (d.kind === 'gold') { S.res.gold += 10; fx(h.x, h.y - 0.8, '+🪙10', '#f2c14e'); }
    else { h.hp = Math.min(h.maxhp, h.hp + 30); fx(h.x, h.y - 0.8, '+30 HP', '#ff6080'); }
    blip(1200, 0.05);
  }
}

// ---------------------------------------------------------------- events, day cycle
const EVENTS = [
  { when: () => S.res.gold >= 30, run: () => { S.res.gold -= 30; S.res.wood += 60; return '🧳 A travelling merchant swapped 60 wood for 30 gold.'; } },
  { when: () => S.villagers.length > 0, run: () => { for (const v of S.villagers) v.fun = 100; return '🎉 A festival! Everyone is in high spirits.'; } },
  { when: () => S.buildings.some(b => b.type === 'farm'), run: () => { S.res.food += 30; return '🌦️ Good rains — a bumper harvest brought 30 food.'; } },
  { when: () => S.villagers.length < capacity(), run: () => { const v = addVillager(); return `🚶 A wanderer, ${v.name}, asked to stay. Welcome!`; } },
  { when: () => S.res.wood >= 20, run: () => { S.res.wood -= 20; return '🐀 Rats got into the wood store. Lost 20 wood.'; } },
];
function dailyEvent() {
  if (S.day < 2 || Math.random() > 0.5) return;
  const ok = EVENTS.filter(e => e.when()); if (!ok.length) return;
  const msg = ok[Math.floor(Math.random() * ok.length)].run(); log(msg); S.banner = { text: msg, life: 4 };
}
function update(dt) {
  if (S.over) return;
  const wasNight = isNight();
  S.t += dt;
  if (!wasNight && isNight()) startNight();
  if (S.t >= CYCLE) {
    S.t -= CYCLE; S.day++;
    if (S.mobs.length) log(`☀️ Dawn. ${S.mobs.length} mobs fled the sunlight.`); else log(`☀️ Day ${S.day}. The town held the night!`);
    if (S.mobs.length === 0) { const bonus = 10 + 5 * (S.day - 1); S.res.gold += bonus; log(`🏆 Raid repelled! Bounty of 🪙${bonus}.`); }
    S.mobs = []; S.projs = S.projs.filter(p => p.target == null);
    S.banner = { text: `☀️ Day ${S.day}`, life: 3 };
    dailyEvent();
    const cap = capacity();
    if (S.villagers.length > cap) { const n = S.villagers.length - cap; S.villagers.length = cap; log(`${n} villager(s) left — not enough housing.`); }
  }
  if (isNight()) for (const w of S.waveQueue) { w.delay -= dt; if (w.delay <= 0) spawnMob(w.type); }
  S.waveQueue = S.waveQueue.filter(w => w.delay > 0);
  if (!isNight() && S.villagers.length < capacity()) {
    S.arrivalTimer += dt;
    if (S.arrivalTimer >= 12) { S.arrivalTimer = 0; const v = addVillager(); log(`🧑‍🌾 ${v.name} moved into Hollowmere.`); }
  }
  if (S.day === 1 && !isNight()) {
    const has = t => S.buildings.some(b => b.type === t);
    const tips = [[6, 'Tip: press 1 and click to build a House so villagers move in', () => !has('house')], [26, 'Tip: build a Farm (2) so nobody goes hungry', () => !has('farm')], [48, 'Tip: build an Archer Tower (6) and some Walls (5) before dark', () => !has('tower')], [70, 'Tip: WASD walks the Mayor, left-click shoots, right-click inspects', () => true]];
    for (const [at, text, need] of tips) if (S.t >= at && S.t - dt < at && need()) S.banner = { text, life: 4 };
  }
  S.questT += dt; if (S.questT > 1) { S.questT = 0; checkQuests(); }
  if (S.res.food < 1 && !S.foodWarned) { S.foodWarned = true; log('⚠️ The granary is empty! Hungry villagers work slowly. Build more farms.'); S.banner = { text: '⚠️ Out of food — build more farms!', life: 3 }; }
  else if (S.res.food > 15) S.foodWarned = false;
  for (const v of S.villagers) updateVillager(v, dt);
  for (const b of S.buildings.slice()) { if (b.type === 'tower') updateTower(b, dt); else if (b.type === 'barracks') updateBarracks(b, dt); }
  for (const m of S.mobs.slice()) updateMob(m, dt);
  S.projs = S.projs.filter(p => updateProj(p, dt));
  for (const s of S.soldiers.slice()) updateSoldier(s, dt);
  updateHero(dt);
  for (const f of S.fx) { f.life -= dt; f.y -= 0.6 * dt; } S.fx = S.fx.filter(f => f.life > 0);
  for (const p of S.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 6 * dt; } S.parts = S.parts.filter(p => p.life > 0);
  for (const d of S.drops) d.life -= dt; S.drops = S.drops.filter(d => d.life > 0);
  if (S.banner) { S.banner.life -= dt; if (S.banner.life <= 0) S.banner = null; }
}
function gameOver() {
  S.over = true; save();
  let best = 0; try { best = +localStorage.getItem('hollowmere-best') || 0; if (score() > best) { best = score(); localStorage.setItem('hollowmere-best', best); } } catch (e) { /* ignore */ }
  $('#go-best').textContent = best ? `Best score: ${best}` : '';
  $('#go-stats').innerHTML = `The town survived <b>${S.day - 1}</b> night${S.day - 1 === 1 ? '' : 's'} and slew <b>${S.kills}</b> mobs.<br>Score: <b>${score()}</b>`;
  $('#gameover').hidden = false;
}
const score = () => S.kills * 10 + (S.day - 1) * 100 + S.buildings.filter(b => !DEFS[b.type].tree).length * 5;

// ---------------------------------------------------------------- save / load
function save() { try { const st = { ...S, fx: [], parts: [], mobs: S.mobs.map(m => ({ ...m, attacker: null })) }; localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) { /* storage unavailable */ } }
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    const st = JSON.parse(raw); if (!st || st.v !== 2 || st.over) return false;
    S = st; S.done = S.done || []; S.chopped = S.chopped || 0; S.questT = 0; S.up = S.up || { gun: 0, vest: 0, boots: 0 }; S.drops = S.drops || []; S.parts = []; S.diff = S.diff || 'normal'; rebuildGrid(); cam.x = S.hero.x; cam.y = S.hero.y; paintGround(); return true;
  } catch (e) { return false; }
}
function hasSave() { try { const r = localStorage.getItem(SAVE_KEY); if (!r) return false; const s = JSON.parse(r); return s && s.v === 2 && !s.over; } catch (e) { return false; } }

// ---------------------------------------------------------------- audio
let actx = null, muted = false;
try { muted = !!localStorage.getItem('hollowmere-muted'); } catch (e) { /* ignore */ }
function noise(len, vol, freq) {
  if (muted) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = actx.createBufferSource(); src.buffer = buf;
    const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = actx.createGain(); g.gain.value = vol; src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
  } catch (e) { /* no audio */ }
}
const boom = () => noise(0.5, 0.12, 400);
const horn = () => { blip(196, 0.5); setTimeout(() => blip(147, 0.8), 350); };
function blip(freq, len) {
  if (muted) return;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = freq; g.gain.value = 0.04;
    o.connect(g); g.connect(actx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + len); o.stop(actx.currentTime + len);
  } catch (e) { /* no audio */ }
}

// ---------------------------------------------------------------- pixel art
// Every sprite is drawn once at native 16px resolution and scaled up with crisp edges.
function mk(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); fn(g, w, h); return c; }
const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const P = (g, x, y, c) => R(g, x, y, 1, 1, c);
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); const r = clamp(((n >> 16) * f) | 0, 0, 255), gg = clamp((((n >> 8) & 255) * f) | 0, 0, 255), b = clamp(((n & 255) * f) | 0, 0, 255); return `rgb(${r},${gg},${b})`; }
function cone(g, cx, top, h, half, col) {   // pixel pine layer
  for (let i = 0; i < h; i++) { const w = Math.max(1, Math.round(half * (i + 1) / h)); R(g, cx - w, top + i, w * 2 + 1, 1, col); P(g, cx - w, top + i, shade(col, 0.7)); P(g, cx + w, top + i, shade(col, 0.7)); if (i % 2 === 0) P(g, cx - Math.max(0, w - 1), top + i, shade(col, 1.3)); }
}
function figure(g, o) {            // generic 16x16 humanoid; o = {skin, hair, shirt, pants, hat, helm, frame, item}
  const f = o.frame || 0;
  R(g, 5, 13, 6, 1, 'rgba(0,0,0,.25)');                      // shadow
  R(g, 6 + (f ? 1 : 0), 11, 2, 3, o.pants); R(g, 9 - (f ? 1 : 0), 11, 2, 3, o.pants);  // legs
  R(g, 5, 7, 6, 4, o.shirt); P(g, 5, 7, shade(o.shirt, 1.25)); // body
  R(g, 4, 8, 1, 2, o.skin); R(g, 11, 8, 1, 2, o.skin);          // arms
  R(g, 6, 3, 4, 4, o.skin); R(g, 6, 2, 4, 1, o.hair); P(g, 6, 3, o.hair);  // head + hair
  P(g, 7, 5, '#222'); P(g, 9, 5, '#222');                       // eyes
  if (o.hat) { R(g, 5, 1, 6, 1, o.hat); R(g, 4, 2, 8, 1, shade(o.hat, 0.8)); R(g, 6, 0, 4, 1, o.hat); }
  if (o.helm) { R(g, 6, 1, 4, 2, o.helm); P(g, 5, 2, o.helm); P(g, 10, 2, o.helm); }
  if (o.item === 'gun') { R(g, 10, 8, 5, 1, '#3a3a44'); P(g, 11, 9, '#7a5a3a'); }
  if (o.item === 'spear') { R(g, 12, 1, 1, 12, '#8a6a48'); P(g, 12, 0, '#d8d8e0'); }
  if (o.item === 'hoe') { R(g, 12, 6, 1, 8, '#8a6a48'); R(g, 11, 6, 3, 1, '#9a9aa4'); }
  if (o.item === 'club') { R(g, 12, 3, 2, 8, '#6a4a2a'); R(g, 11, 2, 4, 3, '#7a5a3a'); }
  if (o.item === 'dagger') { R(g, 12, 7, 1, 4, '#d8d8e0'); P(g, 12, 11, '#6a4a2a'); }
  if (o.item === 'staff') { R(g, 12, 2, 1, 11, '#8a6a48'); P(g, 12, 1, '#c060ff'); P(g, 11, 2, '#e0a0ff'); P(g, 13, 2, '#e0a0ff'); }
  if (o.item === 'bomb') { R(g, 11, 7, 3, 3, '#1a1a22'); P(g, 12, 6, '#ffa030'); P(g, 13, 5, '#ffe070'); }
}
const SPR = {};
function buildSprites() {
  const G = ['#5d9b3c', '#589637', '#62a141', '#5a9a3a'];
  SPR.grass = G.map((c, i) => mk(PX, PX, g => {
    R(g, 0, 0, PX, PX, c);
    for (let k = 0; k < 10; k++) P(g, Math.floor(rnd(0, PX)), Math.floor(rnd(0, PX)), shade(c, 0.86));
    for (let k = 0; k < 5; k++) { const x = Math.floor(rnd(0, PX)), y = Math.floor(rnd(1, PX)); P(g, x, y, shade(c, 1.15)); P(g, x, y - 1, shade(c, 1.25)); }
    if (i === 3) { P(g, 4, 5, '#f4f0d0'); P(g, 11, 10, '#f0d060'); P(g, 12, 3, '#e8e8f8'); }
  }));
  const D = ['#8a5a3a', '#875737', '#8d5d3d'];
  SPR.dirt = D.map(c => mk(PX, PX, g => {
    R(g, 0, 0, PX, PX, c);
    for (let k = 0; k < 12; k++) P(g, Math.floor(rnd(0, PX)), Math.floor(rnd(0, PX)), shade(c, 0.88));
    for (let k = 0; k < 6; k++) P(g, Math.floor(rnd(0, PX)), Math.floor(rnd(0, PX)), shade(c, 1.12));
    if (Math.random() < 0.5) { const x = Math.floor(rnd(2, 13)), y = Math.floor(rnd(2, 13)); R(g, x, y, 2, 1, '#a08a78'); P(g, x, y + 1, '#7a6a5a'); }
  }));
  SPR.tree = [0, 1, 2].map(v => mk(PX, 24, g => {
    const col = ['#2f6b34', '#35743a', '#2a6230'][v];
    R(g, 3, 22, 10, 2, 'rgba(0,0,0,.2)');
    R(g, 7, 18, 2, 6, '#5a3a22'); P(g, 7, 18, '#6a4a2a');
    cone(g, 8, 11, 8, 7, col); cone(g, 8, 6, 7, 5, col); cone(g, 8, 1, 6, 3, col);
  }));
  SPR.house = mk(PX, PX, g => {
    R(g, 3, 15, 10, 1, 'rgba(0,0,0,.25)');
    R(g, 2, 7, 12, 8, '#d9b98a'); R(g, 2, 7, 12, 1, '#c4a577'); R(g, 2, 7, 1, 8, '#c4a577');
    for (let i = 0; i < 6; i++) R(g, 1 + i, 1 + i, 14 - 2 * i, 1, i % 2 ? '#a83a2a' : '#b84535');
    R(g, 1, 6, 14, 1, '#7a2a1e');
    R(g, 7, 11, 3, 4, '#5a3a22'); P(g, 9, 13, '#e8c040');
    R(g, 3, 9, 2, 2, '#7fc9e8'); R(g, 11, 9, 2, 2, '#7fc9e8');
    R(g, 11, 1, 2, 3, '#6a6a72');
  });
  SPR.farm = mk(32, 32, g => {
    R(g, 0, 0, 32, 32, '#6b4326');
    for (let y = 2; y < 30; y += 4) { R(g, 2, y, 28, 2, '#7f5230'); for (let x = 3; x < 30; x += 4) { P(g, x, y - 1, '#5aa040'); P(g, x, y, '#4a8a30'); P(g, x + 1, y - 1, '#6ab050'); } }
    R(g, 0, 0, 32, 1, '#8a6a48'); R(g, 0, 31, 32, 1, '#8a6a48'); R(g, 0, 0, 1, 32, '#8a6a48'); R(g, 31, 0, 1, 32, '#8a6a48');
    for (let i = 0; i < 32; i += 4) { P(g, i, 0, '#a58a62'); P(g, i, 31, '#a58a62'); P(g, 0, i, '#a58a62'); P(g, 31, i, '#a58a62'); }
  });
  SPR.mill = mk(PX, PX, g => {
    R(g, 2, 15, 12, 1, 'rgba(0,0,0,.25)');
    R(g, 1, 6, 14, 9, '#8a6a48'); for (let y = 7; y < 15; y += 2) R(g, 1, y, 14, 1, '#7d5f40');
    R(g, 0, 4, 16, 3, '#5a3a22'); R(g, 0, 4, 16, 1, '#6c4a2e');
    R(g, 2, 11, 5, 3, '#a37a52'); R(g, 2, 11, 1, 3, '#d9b98a'); R(g, 3, 9, 4, 2, '#a37a52'); P(g, 3, 9, '#d9b98a');
    g.fillStyle = '#9a9aa4'; g.beginPath(); g.arc(11.5, 10.5, 3, 0, Math.PI * 2); g.fill(); P(g, 11, 10, '#5a5a64');
  });
  SPR.mine = mk(PX, PX, g => {
    R(g, 1, 3, 14, 13, '#6e6e78'); R(g, 2, 2, 12, 1, '#7e7e88'); P(g, 3, 5, '#8a8a94'); P(g, 12, 7, '#8a8a94'); P(g, 5, 13, '#5a5a64');
    R(g, 5, 8, 6, 8, '#1a1a22'); R(g, 4, 7, 8, 1, '#8a6a48'); R(g, 4, 7, 1, 9, '#8a6a48'); R(g, 11, 7, 1, 9, '#8a6a48');
    P(g, 3, 10, '#e8c040'); P(g, 13, 12, '#e8c040'); P(g, 12, 4, '#e8c040');
  });
  SPR.wall = mk(PX, PX, g => {
    R(g, 0, 0, PX, PX, '#8c8c96');
    for (let y = 0; y < PX; y += 4) { R(g, 0, y, PX, 1, '#5e5e68'); const off = (y / 4) % 2 ? 4 : 0; for (let x = off; x < PX; x += 8) R(g, x, y, 1, 4, '#5e5e68'); }
    P(g, 2, 2, '#a0a0aa'); P(g, 10, 6, '#a0a0aa'); P(g, 6, 10, '#a0a0aa'); P(g, 13, 13, '#7a7a84');
  });
  SPR.tower = mk(PX, 24, g => {
    R(g, 2, 23, 12, 1, 'rgba(0,0,0,.25)');
    R(g, 3, 8, 10, 16, '#8c8c96'); R(g, 3, 8, 1, 16, '#6e6e78'); R(g, 12, 8, 1, 16, '#a0a0aa');
    for (let y = 10; y < 24; y += 4) R(g, 4, y, 8, 1, '#6e6e78');
    R(g, 3, 6, 2, 2, '#8c8c96'); R(g, 7, 6, 2, 2, '#8c8c96'); R(g, 11, 6, 2, 2, '#8c8c96');
    R(g, 7, 15, 2, 3, '#1a1a22'); R(g, 5, 20, 1, 1, '#1a1a22'); R(g, 10, 20, 1, 1, '#1a1a22');
    R(g, 7, 2, 2, 2, '#e8b890'); R(g, 6, 4, 4, 2, '#3a6a3a'); R(g, 10, 1, 1, 5, '#8a6a48');
  });
  SPR.barracks = mk(32, 32, g => {
    R(g, 2, 30, 28, 2, 'rgba(0,0,0,.25)');
    R(g, 2, 10, 28, 20, '#7a6a6a'); for (let y = 12; y < 30; y += 4) R(g, 2, y, 28, 1, '#6a5a5a');
    R(g, 0, 6, 32, 5, '#4a3a3a'); R(g, 0, 6, 32, 1, '#5c4a4a'); R(g, 2, 4, 28, 2, '#4a3a3a');
    R(g, 13, 22, 6, 8, '#2a1e1e'); R(g, 5, 16, 3, 3, '#1a1a22'); R(g, 24, 16, 3, 3, '#1a1a22');
    R(g, 14, 12, 4, 8, '#c03030'); P(g, 15, 19, '#7a6a6a'); P(g, 15, 14, '#e8c040');
    for (let i = 0; i < 5; i++) { P(g, 22 + i, 2 + i, '#d8d8e0'); P(g, 26 - i, 2 + i, '#d8d8e0'); }
  });
  SPR.tavern = mk(PX, PX, g => {
    R(g, 2, 15, 12, 1, 'rgba(0,0,0,.25)');
    R(g, 1, 6, 14, 9, '#9a6a3a'); for (let y = 7; y < 15; y += 2) R(g, 1, y, 14, 1, '#8c5f33');
    R(g, 0, 3, 16, 4, '#6a3a2a'); R(g, 0, 3, 16, 1, '#7c4a38');
    R(g, 6, 10, 3, 5, '#3a2a1a'); R(g, 11, 9, 2, 3, '#f0d060');
    R(g, 10, 0, 5, 3, '#d9b98a'); R(g, 12, 1, 2, 1, '#e8c040'); P(g, 11, 1, '#f8f8f8'); P(g, 12, 3, '#5a3a22');
  });
  SPR.hall = mk(32, 32, g => {
    R(g, 2, 30, 28, 2, 'rgba(0,0,0,.25)');
    R(g, 2, 12, 28, 18, '#b8a888'); for (let y = 14; y < 30; y += 4) R(g, 2, y, 28, 1, '#a49478'); R(g, 2, 12, 1, 18, '#a49478');
    R(g, 0, 9, 32, 4, '#3a5a9a'); R(g, 3, 6, 26, 3, '#4468ac'); R(g, 6, 3, 20, 3, '#3a5a9a'); R(g, 9, 1, 14, 2, '#4468ac');
    R(g, 0, 12, 32, 1, '#2a4070');
    R(g, 13, 22, 6, 8, '#5a3a22'); P(g, 17, 26, '#e8c040');
    R(g, 5, 16, 3, 4, '#7fc9e8'); R(g, 24, 16, 3, 4, '#7fc9e8'); R(g, 5, 24, 3, 3, '#7fc9e8'); R(g, 24, 24, 3, 3, '#7fc9e8');
    R(g, 15, 0, 1, 3, '#444'); R(g, 16, 0, 4, 2, '#e8c040');
  });
  const two = (o) => [0, 1].map(f => mk(PX, PX, g => figure(g, { ...o, frame: f })));
  SPR.villager = two({ skin: '#e8b890', hair: '#5a3a22', shirt: '#4a8a4a', pants: '#3a3a5a', item: 'hoe' });
  SPR.soldier = two({ skin: '#e8b890', hair: '#6a6a72', shirt: '#8a8a9a', pants: '#3a3a44', helm: '#6a6a72', item: 'spear' });
  SPR.hero = two({ skin: '#e8b890', hair: '#3a2a1a', shirt: '#7a4a2a', pants: '#2a2a3a', hat: '#5a3a22', item: 'gun' });
  SPR.goblin = two({ skin: '#5aa040', hair: '#3a7a2a', shirt: '#6a4a2a', pants: '#4a3a2a', item: 'dagger' });
  SPR.orc = [0, 1].map(f => mk(PX, PX, g => { figure(g, { skin: '#6a8a4a', hair: '#2a2a2a', shirt: '#5a4a3a', pants: '#3a2a2a', frame: f, item: 'club' }); P(g, 6, 6, '#f8f8f8'); P(g, 9, 6, '#f8f8f8'); }));
  SPR.troll = [0, 1].map(f => mk(24, 24, g => {
    R(g, 6, 21, 12, 2, 'rgba(0,0,0,.3)');
    R(g, 8 + (f ? 2 : 0), 16, 3, 6, '#5a6a5a'); R(g, 13 - (f ? 2 : 0), 16, 3, 6, '#5a6a5a');
    R(g, 6, 8, 12, 8, '#7a8a7a'); R(g, 6, 8, 12, 1, shade('#7a8a7a', 1.2)); R(g, 4, 9, 2, 6, '#7a8a7a'); R(g, 18, 9, 2, 6, '#7a8a7a');
    R(g, 8, 2, 8, 6, '#8a9a8a'); R(g, 7, 1, 10, 2, '#3a4a3a'); P(g, 10, 5, '#c02020'); P(g, 13, 5, '#c02020'); P(g, 9, 7, '#f8f8f8'); P(g, 14, 7, '#f8f8f8');
    R(g, 19, 4, 3, 12, '#6a4a2a'); R(g, 18, 2, 5, 3, '#7a5a3a');
  }));
  SPR.shaman = two({ skin: '#5aa040', hair: '#e0e0e0', shirt: '#6a3a9a', pants: '#4a2a6a', item: 'staff' });
  SPR.bomber = two({ skin: '#5aa040', hair: '#3a7a2a', shirt: '#a03030', pants: '#4a3a2a', item: 'bomb' });
  SPR.decor = [
    mk(PX, PX, g => { R(g, 4, 9, 8, 5, '#3f7a34'); R(g, 5, 7, 6, 2, '#3f7a34'); R(g, 3, 10, 1, 3, '#356a2c'); P(g, 6, 8, '#5a9a4a'); P(g, 9, 10, '#5a9a4a'); R(g, 5, 14, 6, 1, 'rgba(0,0,0,.2)'); }),
    mk(PX, PX, g => { R(g, 5, 9, 6, 4, '#8a8a94'); R(g, 6, 8, 4, 1, '#a0a0aa'); P(g, 6, 9, '#b0b0ba'); R(g, 5, 13, 6, 1, '#5e5e68'); R(g, 4, 14, 8, 1, 'rgba(0,0,0,.2)'); }),
    mk(PX, PX, g => { P(g, 3, 4, '#f0d060'); P(g, 4, 3, '#f8f8f8'); P(g, 11, 7, '#f06090'); P(g, 12, 6, '#f8f8f8'); P(g, 7, 12, '#f8f8f8'); P(g, 6, 11, '#f0d060'); P(g, 3, 5, '#3a7a2a'); P(g, 11, 8, '#3a7a2a'); P(g, 7, 13, '#3a7a2a'); }),
    mk(PX, PX, g => { R(g, 5, 8, 6, 5, '#7a5a3a'); R(g, 5, 7, 6, 1, '#a37a52'); P(g, 7, 7, '#c49a6a'); R(g, 4, 13, 8, 1, 'rgba(0,0,0,.2)'); }),
  ];
  SPR.drop = {
    wood: mk(PX, PX, g => { R(g, 3, 7, 10, 4, '#a37a52'); R(g, 3, 7, 2, 4, '#d9b98a'); R(g, 3, 8, 10, 1, '#8a6a48'); }),
    food: mk(PX, PX, g => { R(g, 4, 6, 8, 5, '#d9a050'); R(g, 5, 5, 6, 1, '#e8b860'); P(g, 6, 7, '#f0d090'); P(g, 9, 8, '#f0d090'); }),
    gold: mk(PX, PX, g => { R(g, 5, 5, 6, 6, '#e8c040'); R(g, 6, 4, 4, 1, '#f8e080'); R(g, 6, 11, 4, 1, '#b08a20'); P(g, 7, 6, '#fff8c0'); }),
    heart: mk(PX, PX, g => { R(g, 4, 5, 3, 3, '#e04060'); R(g, 9, 5, 3, 3, '#e04060'); R(g, 4, 7, 8, 2, '#e04060'); R(g, 5, 9, 6, 1, '#e04060'); R(g, 6, 10, 4, 1, '#c02040'); R(g, 7, 11, 2, 1, '#c02040'); P(g, 5, 6, '#ff90a0'); }),
  };
  SPR.king = [0, 1].map(f => mk(32, 32, g => {
    R(g, 8, 29, 16, 2, 'rgba(0,0,0,.3)');
    R(g, 10 + (f ? 2 : 0), 22, 4, 8, '#4a5a4a'); R(g, 18 - (f ? 2 : 0), 22, 4, 8, '#4a5a4a');
    R(g, 7, 10, 18, 12, '#6a7a6a'); R(g, 7, 10, 18, 1, '#8a9a8a'); R(g, 4, 12, 3, 8, '#6a7a6a'); R(g, 25, 12, 3, 8, '#6a7a6a');
    R(g, 10, 3, 12, 8, '#7a8a7a'); P(g, 13, 7, '#ff3030'); P(g, 18, 7, '#ff3030'); P(g, 12, 10, '#f8f8f8'); P(g, 19, 10, '#f8f8f8'); R(g, 13, 8, 6, 1, '#4a5a4a');
    R(g, 10, 1, 12, 2, '#e8c040'); P(g, 10, 0, '#e8c040'); P(g, 13, 0, '#e8c040'); P(g, 16, 0, '#e8c040'); P(g, 19, 0, '#e8c040'); P(g, 21, 0, '#e8c040'); P(g, 15, 1, '#ff3060');
    R(g, 27, 4, 4, 18, '#5a3a1a'); R(g, 26, 2, 6, 4, '#7a5a3a'); P(g, 28, 3, '#9a7a5a');
  }));
  SPR.arrow = mk(4, 2, g => { R(g, 0, 0, 4, 1, '#d8c8a0'); P(g, 3, 0, '#e8e8f0'); });
  SPR.bullet = mk(4, 2, g => { R(g, 0, 0, 3, 2, '#ffe070'); P(g, 3, 0, '#fff8d0'); });
}

// ---------------------------------------------------------------- ground (prerendered, world-sized)
const ground = document.createElement('canvas'); ground.width = COLS * PX; ground.height = ROWS * PX;
const gctx = ground.getContext('2d');
function paintGround() {
  const hall = S.buildings.find(b => b.type === 'hall'); const c = hall ? center(hall) : { x: COLS / 2, y: ROWS / 2 };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
    const dirt = d < 5.5 + Math.sin(x * 1.7) * 0.8 + Math.cos(y * 2.1) * 0.8;
    const v = (x * 7 + y * 13 + (x * y) % 5) % 4;
    gctx.drawImage(dirt ? SPR.dirt[v % 3] : SPR.grass[v], x * PX, y * PX);
    const hsh = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
    if (!dirt && hsh < 70 && !grid[y][x]) gctx.drawImage(SPR.decor[hsh % 4], x * PX, y * PX);
  }
  for (const b of S.buildings) if (!DEFS[b.type].tree) paintDirt(b);
}
function paintDirt(b) {
  const margin = b.type === 'wall' ? 0 : 1;   // walls stay on grass; other buildings wear a ragged dirt apron
  for (let y = b.gy - margin; y < b.gy + b.h + margin; y++) for (let x = b.gx - margin; x < b.gx + b.w + margin; x++) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
    const t = grid[y][x]; if (t && t.type === 'tree') continue;
    const inside = x >= b.gx && x < b.gx + b.w && y >= b.gy && y < b.gy + b.h;
    if (!inside && ((x * 7 + y * 11 + b.id) % 5) < 2) continue;
    gctx.drawImage(SPR.dirt[(x * 3 + y * 5) % 3], x * PX, y * PX);
  }
}

// ---------------------------------------------------------------- rendering
const canvas = $('#c'), ctx = canvas.getContext('2d');
const mini = $('#mini'), mctx = mini.getContext('2d');
const dark = document.createElement('canvas'); const dctx = dark.getContext('2d');
function resize() { const st = $('#stage'); canvas.width = st.clientWidth; canvas.height = st.clientHeight; dark.width = canvas.width; dark.height = canvas.height; }
window.addEventListener('resize', resize);
const W2S = (wx, wy) => [Math.round((wx - cam.x) * TS + canvas.width / 2), Math.round((wy - cam.y) * TS + canvas.height / 2)];
const S2W = (sx, sy) => ({ x: (sx - canvas.width / 2) / TS + cam.x, y: (sy - canvas.height / 2) / TS + cam.y });
function spr(img, wx, wy, w, h, flip) {   // draw sprite with its bottom-centre at world (wx, wy)
  const [sx, sy] = W2S(wx, wy); const dw = w * SCALE, dh = h * SCALE;
  if (flip) { ctx.save(); ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.drawImage(img, -dw / 2, sy - dh, dw, dh); ctx.restore(); }
  else ctx.drawImage(img, sx - dw / 2, sy - dh, dw, dh);
}
function hpBar(wx, wy, w, frac, color) {
  const [sx, sy] = W2S(wx, wy);
  ctx.fillStyle = '#0008'; ctx.fillRect(sx - w / 2, sy, w, 4);
  ctx.fillStyle = color; ctx.fillRect(sx - w / 2, sy, w * clamp(frac, 0, 1), 4);
}
function darkness() {
  const t = S.t;
  if (t < DAY_LEN - 8) return 0;
  if (t < DAY_LEN) return (t - (DAY_LEN - 8)) / 8 * 0.7;
  if (t > CYCLE - 6) return (CYCLE - t) / 6 * 0.7;
  return 0.7;
}
function light(x, y, r, strength) {
  const [sx, sy] = W2S(x, y); const g = dctx.createRadialGradient(sx, sy, r * 0.15, sx, sy, r);
  g.addColorStop(0, `rgba(0,0,0,${strength})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  dctx.fillStyle = g; dctx.fillRect(sx - r, sy - r, r * 2, r * 2);
}
function ringAt(wx, wy, r) { const [sx, sy] = W2S(wx, wy); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke(); }
function draw() {
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shakeT > 0) ctx.translate(Math.round(rnd(-shakeMag, shakeMag)), Math.round(rnd(-shakeMag, shakeMag)));
  const vw = canvas.width / TS, vh = canvas.height / TS;
  const x0 = Math.max(0, Math.floor(cam.x - vw / 2 - 1)), y0 = Math.max(0, Math.floor(cam.y - vh / 2 - 2));
  const x1 = Math.min(COLS, Math.ceil(cam.x + vw / 2 + 1)), y1 = Math.min(ROWS, Math.ceil(cam.y + vh / 2 + 1));
  ctx.fillStyle = '#1d3a1c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const [gx, gy] = W2S(x0, y0);
  ctx.drawImage(ground, x0 * PX, y0 * PX, (x1 - x0) * PX, (y1 - y0) * PX, gx, gy, (x1 - x0) * TS, (y1 - y0) * TS);
  // build grid + ghost
  if (buildSel || demolish) {
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = x0; x <= x1; x++) { const [sx] = W2S(x, 0); ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, canvas.height); }
    for (let y = y0; y <= y1; y++) { const [, sy] = W2S(0, y); ctx.moveTo(0, sy + 0.5); ctx.lineTo(canvas.width, sy + 0.5); }
    ctx.stroke();
    if (hover.x >= 0) {
      if (buildSel) {
        const d = DEFS[buildSel], ok = canPlace(buildSel, hover.x, hover.y) && canAfford(d.cost) && (d.th || 1) <= S.thLevel;
        const [sx, sy] = W2S(hover.x, hover.y);
        ctx.fillStyle = ok ? 'rgba(110,220,120,.35)' : 'rgba(240,90,90,.35)'; ctx.fillRect(sx, sy, d.w * TS, d.h * TS);
        ctx.globalAlpha = 0.7; const gi = SPR[buildSel]; ctx.drawImage(gi, sx + (d.w * TS - gi.width * SCALE) / 2, sy + d.h * TS - gi.height * SCALE, gi.width * SCALE, gi.height * SCALE); ctx.globalAlpha = 1;
        if (buildSel === 'tower') { ctx.strokeStyle = 'rgba(120,160,255,.4)'; ctx.beginPath(); ctx.arc(sx + TS / 2, sy + TS / 2, DEFS.tower.range * TS, 0, Math.PI * 2); ctx.stroke(); }
      } else { const b = tileAt(hover.x + 0.5, hover.y + 0.5); if (b) { const [sx, sy] = W2S(b.gx, b.gy); ctx.fillStyle = 'rgba(240,90,90,.4)'; ctx.fillRect(sx, sy, b.w * TS, b.h * TS); } }
    }
  }
  // tower ranges while mobs are about
  if (S.mobs.length) for (const b of S.buildings) if (b.type === 'tower' && b.gx >= x0 - 5 && b.gx <= x1 + 5 && b.gy >= y0 - 5 && b.gy <= y1 + 5) {
    const c = center(b); const [sx, sy] = W2S(c.x, c.y); ctx.strokeStyle = 'rgba(120,160,255,.15)'; ctx.beginPath(); ctx.arc(sx, sy, DEFS.tower.range * TS, 0, Math.PI * 2); ctx.stroke();
  }
  // drops on the ground
  for (const d of S.drops) { const bob = Math.sin(performance.now() / 200 + d.x) * 3; const [sx, sy] = W2S(d.x, d.y); if (d.life < 5 && Math.floor(d.life * 6) % 2) continue; ctx.drawImage(SPR.drop[d.kind], sx - 24, sy - 30 + bob, 48, 48); }
  // depth-sorted world objects
  const items = [];
  for (const b of S.buildings) if (b.gx + b.w > x0 && b.gx < x1 && b.gy + b.h > y0 - 1 && b.gy < y1) items.push({ y: b.gy + b.h, b });
  for (const v of S.villagers) if (v.state !== 'sleeping') items.push({ y: v.y, e: v, kind: 'villager' });
  for (const s of S.soldiers) items.push({ y: s.y, e: s, kind: 'soldier' });
  for (const m of S.mobs) items.push({ y: m.y, e: m, kind: m.type });
  if (S.hero.dead <= 0) items.push({ y: S.hero.y, e: S.hero, kind: 'hero' });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) {
    if (it.b) {
      const b = it.b, img = b.type === 'tree' ? SPR.tree[b.v] : SPR[b.type];
      spr(img, b.gx + b.w / 2, b.gy + b.h, img.width, img.height, false);
      if (b.type === 'hall') { const [sx, sy] = W2S(b.gx, b.gy); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('Lv' + S.thLevel, sx + 4, sy + 4); }
      if (b.hp < b.maxhp && b.type !== 'tree') hpBar(b.gx + b.w / 2, b.gy + b.h - 0.25, b.w * TS - 10, b.hp / b.maxhp, b.hp / b.maxhp > 0.4 ? '#6fcf7a' : '#ef6b6b');
      if (selected && selected.kind === 'building' && selected.id === b.id) { const [sx, sy] = W2S(b.gx, b.gy); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.strokeRect(sx - 1, sy - 1, b.w * TS + 2, b.h * TS + 2); }
    } else {
      const e = it.e; if (e.x < x0 - 1 || e.x > x1 + 1 || e.y < y0 - 1 || e.y > y1 + 1) continue;
      const frames = SPR[it.kind], img = frames[e.moving ? Math.floor(e.anim) % 2 : 0];
      spr(img, e.x, e.y + 0.45, img.width, img.height, e.face === -1);
      if (it.kind === 'villager') {
        const bubble = e.state === 'working' ? '💪' : e.state === 'fun' ? '🎶' : e.hunger > 80 ? '🍽️' : (e.state === 'toHome' && !isNight()) ? '😴' : null;
        if (bubble) { const [sx, sy] = W2S(e.x, e.y); ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(bubble, sx + 12, sy - 24); }
        if (selected && selected.kind === 'villager' && selected.id === e.id) ringAt(e.x, e.y, 20);
      } else if (it.kind === 'hero') {
        hpBar(e.x, e.y + 0.55, 28, e.hp / e.maxhp, '#f2c14e');
        if (e.flash > 0) { const [sx, sy] = W2S(e.x, e.y); const fxx = sx + e.face * 24, fyy = sy - 4; ctx.fillStyle = '#fff4a0'; ctx.fillRect(fxx - 4, fyy - 4, 8, 8); ctx.fillStyle = '#ffb040'; ctx.fillRect(fxx - 7, fyy - 1, 14, 2); ctx.fillRect(fxx - 1, fyy - 7, 2, 14); }
        if (e.cryFx > 0) { const [sx, sy] = W2S(e.x, e.y); ctx.strokeStyle = `rgba(255,230,120,${e.cryFx / 0.6})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sx, sy, CRY_RANGE * TS * (1 - e.cryFx / 0.6 * 0.6), 0, Math.PI * 2); ctx.stroke(); }
        if (selected && selected.kind === 'hero') ringAt(e.x, e.y, 22);
      } else if (it.kind === 'soldier') { if (e.hp < e.maxhp) hpBar(e.x, e.y + 0.55, 22, e.hp / e.maxhp, '#6fcf7a'); }
      else { hpBar(e.x, e.y + 0.55, it.kind === 'king' ? 60 : it.kind === 'troll' ? 34 : 22, e.hp / e.maxhp, it.kind === 'king' ? '#ffd040' : '#ef6b6b'); if (selected && selected.kind === 'mob' && selected.id === e.id) ringAt(e.x, e.y, 22); }
    }
  }
  // projectiles
  for (const p of S.projs) {
    const [sx, sy] = W2S(p.x, p.y); let ang;
    if (p.target != null) { const m = mob(p.target); if (!m) continue; ang = Math.atan2(m.y - p.y, m.x - p.x); } else if (p.tb == null) ang = Math.atan2(p.vy, p.vx);
    if (p.tb != null) { ctx.fillStyle = '#ff7030'; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffe070'; ctx.fillRect(sx - 2, sy - 2, 4, 4); continue; }
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang); ctx.drawImage(p.target != null ? SPR.arrow : SPR.bullet, -6, -3, 12, 6); ctx.restore();
  }
  // particles
  for (const p of S.parts) { const [sx, sy] = W2S(p.x, p.y); ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(sx - 2, sy - 2, 4, 4); }
  ctx.globalAlpha = 1;
  // night: darkness layer with light holes
  const dk = darkness();
  if (dk > 0) {
    dctx.globalCompositeOperation = 'source-over'; dctx.clearRect(0, 0, dark.width, dark.height);
    dctx.fillStyle = `rgba(8,12,40,${dk})`; dctx.fillRect(0, 0, dark.width, dark.height);
    dctx.globalCompositeOperation = 'destination-out';
    if (S.hero.dead <= 0) light(S.hero.x, S.hero.y, 5 * TS, 0.9);
    for (const b of S.buildings) if (b.type === 'hall' || b.type === 'tower' || b.type === 'tavern' || b.type === 'house') {
      const c = center(b); if (c.x < x0 - 6 || c.x > x1 + 6 || c.y < y0 - 6 || c.y > y1 + 6) continue;
      light(c.x, c.y, (b.type === 'hall' ? 6 : b.type === 'house' ? 2.5 : 4) * TS, b.type === 'house' ? 0.5 : 0.8);
    }
    ctx.drawImage(dark, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of S.buildings) if (b.type === 'hall' || b.type === 'tower' || b.type === 'tavern') {
      const c = center(b); const [sx, sy] = W2S(c.x, c.y); const r = 2.5 * TS;
      if (sx < -r || sx > canvas.width + r || sy < -r || sy > canvas.height + r) continue;
      const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, r); g.addColorStop(0, `rgba(255,170,60,${0.25 * dk})`); g.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // floating text
  ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of S.fx) { const [sx, sy] = W2S(f.x, f.y); ctx.globalAlpha = clamp(f.life / f.max, 0, 1); ctx.fillStyle = '#000'; ctx.fillText(f.text, sx + 1, sy + 1); ctx.fillStyle = f.color; ctx.fillText(f.text, sx, sy); }
  ctx.globalAlpha = 1;
  // crosshair
  if (!buildSel && !demolish && hover.x >= 0) { const [sx, sy] = W2S(mouseW.x, mouseW.y); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 9, sy); ctx.lineTo(sx - 4, sy); ctx.moveTo(sx + 4, sy); ctx.lineTo(sx + 9, sy); ctx.moveTo(sx, sy - 9); ctx.lineTo(sx, sy - 4); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx, sy + 9); ctx.stroke(); ctx.fillStyle = '#f33'; ctx.fillRect(sx - 1, sy - 1, 2, 2); }
  // banner
  if (S.banner) {
    ctx.globalAlpha = clamp(S.banner.life, 0, 1); ctx.fillStyle = '#000a'; ctx.fillRect(0, canvas.height / 2 - 26, canvas.width, 52);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(S.banner.text, canvas.width / 2, canvas.height / 2); ctx.globalAlpha = 1;
  }
  if (S.hero.dead > 0) { ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`🤠 Mayor down — back in ${Math.ceil(S.hero.dead)}s`, canvas.width / 2, 30); }
  if (paused) { ctx.fillStyle = '#0006'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.font = 'bold 32px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⏸ Paused', canvas.width / 2, canvas.height / 2); }
  drawMini(vw, vh);
}
function drawMini(vw, vh) {
  const k = mini.width / COLS;
  mctx.fillStyle = '#3f7a2c'; mctx.fillRect(0, 0, mini.width, mini.height);
  for (const b of S.buildings) { mctx.fillStyle = DEFS[b.type].mini; mctx.fillRect(b.gx * k, b.gy * k, b.w * k, b.h * k); }
  mctx.fillStyle = '#fff'; for (const v of S.villagers) mctx.fillRect(v.x * k - 1, v.y * k - 1, 2, 2);
  mctx.fillStyle = '#80c0ff'; for (const s of S.soldiers) mctx.fillRect(s.x * k - 1, s.y * k - 1, 2, 2);
  mctx.fillStyle = '#ff4040'; for (const m of S.mobs) mctx.fillRect(m.x * k - 1.5, m.y * k - 1.5, 3, 3);
  if (S.hero.dead <= 0) { mctx.fillStyle = '#ffe040'; mctx.fillRect(S.hero.x * k - 2, S.hero.y * k - 2, 4, 4); }
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.strokeRect((cam.x - vw / 2) * k, (cam.y - vh / 2) * k, vw * k, vh * k);
}

// ---------------------------------------------------------------- UI (DOM)
function buildButtons() {
  const list = $('#build-list'); list.innerHTML = '';
  for (const type of BUILD_ORDER) {
    const d = DEFS[type], btn = document.createElement('button');
    btn.className = 'bb'; btn.dataset.type = type; btn.title = d.desc;
    btn.innerHTML = `<span class="n">${d.icon} ${d.name} <kbd>${d.key}</kbd></span><small class="c">${costStr(d.cost)}</small>`;
    btn.onclick = () => selectBuild(buildSel === type ? null : type);
    list.appendChild(btn);
  }
}
function selectBuild(type) { buildSel = type; demolish = false; if (type) selected = null; updateUI(); }
function updateUI() {
  const r = S.res;
  $('#r-gold').textContent = Math.floor(r.gold); $('#r-wood').textContent = Math.floor(r.wood); $('#r-food').textContent = Math.floor(r.food);
  $('#r-pop').textContent = `${S.villagers.length}/${capacity()}`;
  const hp = S.villagers.length ? S.villagers.reduce((n, v) => n + happiness(v), 0) / S.villagers.length : 0;
  $('#r-happy').textContent = `${Math.round(hp)}%`;
  $('#r-hp').textContent = `${Math.ceil(S.hero.hp)}/${S.hero.maxhp}`;
  $('#clock').textContent = isNight() ? `🌙 Night ${S.day}  ${Math.ceil(CYCLE - S.t)}s` : `☀️ Day ${S.day}  ${Math.ceil(DAY_LEN - S.t)}s`;
  $('#clock-fill').style.width = `${(S.t / CYCLE) * 100}%`;
  $('#next').textContent = isNight() ? `${S.mobs.length + S.waveQueue.length} mobs left` : `Tonight: ${waveSummary(S.day)}`;
  for (const btn of document.querySelectorAll('.bb')) {
    const type = btn.dataset.type, d = DEFS[type], locked = (d.th || 1) > S.thLevel;
    btn.disabled = locked; btn.classList.toggle('sel', buildSel === type);
    btn.querySelector('.c').innerHTML = locked ? `🔒 Town Hall lv${d.th}` : costStr(d.cost);
    btn.querySelector('.c').classList.toggle('no', !locked && !canAfford(d.cost));
  }
  const next = TH_LEVELS[S.thLevel];
  $('#btn-upgrade').disabled = !next; $('#upgrade-cost').textContent = next ? `lv${S.thLevel + 1}: ${costStr(next.cost)}` : 'max level';
  const rc = repairCost(); $('#btn-repair').disabled = !rc; $('#repair-cost').textContent = rc ? `🪵${rc}` : 'nothing damaged';
  $('#btn-demolish').classList.toggle('on', demolish);
  for (const k in UPGRADES) { const u = UPGRADES[k], btn = $('#up-' + k); const maxed = S.up[k] >= u.max; btn.disabled = maxed || S.res.gold < upCost(k); btn.querySelector('.n').textContent = `${u.name} ${'★'.repeat(S.up[k])}`; btn.querySelector('small').textContent = maxed ? 'max level' : `${u.desc} · 🪙${upCost(k)}`; }
  $('#log').innerHTML = S.log.slice(0, 12).map(m => `<div>${m}</div>`).join('');
  const open = QUESTS.filter(q => !S.done.includes(q.id)).slice(0, 3);
  $('#quests').innerHTML = (open.map(q => `<div>☐ ${q.text} <small>${costStr(q.reward) || `🍞${q.reward.food}`}</small></div>`).join('') || '<div>🏆 Every quest complete!</div>') + `<div class="m">${S.done.length}/${QUESTS.length} done</div>`;
  $('#sel').innerHTML = selectionHTML();
}
function needBar(label, val) { return `<div class="need"><span>${label}</span><div class="b"><i class="${val < 30 ? 'low' : ''}" style="width:${val}%"></i></div></div>`; }
function selectionHTML() {
  if (!selected) return '<i>Right-click a building, villager or mob to inspect it.</i>';
  if (selected.kind === 'hero') { const h = S.hero; return `<div class="t">🤠 The Mayor · level ${heroLevel()}</div><div class="m">HP ${Math.ceil(h.hp)}/${h.maxhp} · shots do ${heroDmg()} · next level in ${10 - S.kills % 10} kills</div><div class="m">War Cry <kbd>Q</kbd>: ${h.cry > 0 ? `ready in ${Math.ceil(h.cry)}s` : '<b style="color:var(--green)">ready</b>'} — ${CRY_DMG} damage to all mobs within ${CRY_RANGE} tiles</div><div class="m">Dash <kbd>Shift</kbd> while walking${h.dash > 0 ? ` (${Math.ceil(h.dash)}s)` : ''}</div>`; }
  if (selected.kind === 'building') {
    const b = bld(selected.id); if (!b) { selected = null; return selectionHTML(); }
    const d = DEFS[b.type]; let extra = '';
    if (d.prod) { const w = S.villagers.find(v => v.job === b.id); extra = w ? `Worked by ${w.name} (${w.state === 'working' ? 'working' : w.state})` : '<span style="color:var(--red)">No worker yet</span>'; extra += `<br>Makes ${d.rate}/s ${d.prod} at full happiness`; }
    if (b.type === 'barracks') extra = `Soldiers: ${S.soldiers.filter(s => s.home === b.id).length}/${d.soldiers}`;
    if (b.type === 'hall') extra = `Level ${S.thLevel} · houses ${TH_LEVELS[S.thLevel - 1].cap}<br><b>Townsfolk</b><br>` + (S.villagers.map(v => { const j = bld(v.job); return `${happiness(v) > 66 ? '😊' : happiness(v) > 33 ? '😐' : '😞'} ${v.name} · ${j ? DEFS[j.type].name : 'no job'}`; }).join('<br>') || 'nobody yet');
    if (b.type === 'house') extra = `Houses ${d.cap}`;
    return `<div class="t">${d.icon} ${d.name}</div><div class="m">HP ${Math.ceil(b.hp)}/${b.maxhp}</div><div class="m">${extra}</div><div class="m" style="margin-top:6px">${d.desc}</div>`;
  }
  if (selected.kind === 'villager') {
    const v = S.villagers.find(x => x.id === selected.id); if (!v) { selected = null; return selectionHTML(); }
    const job = bld(v.job);
    const st = { idle: 'wandering', toWork: 'heading to work', working: 'working', toHome: 'going home', sleeping: 'sleeping', toFun: 'off to the tavern', fun: 'having fun' }[v.state];
    return `<div class="t">🧑‍🌾 ${v.name}</div><div class="m">${st}${job ? ` · ${DEFS[job.type].name}` : ' · unemployed'}</div>` +
      needBar('🍞', 100 - v.hunger) + needBar('⚡', v.energy) + needBar('🎉', v.fun) +
      `<div class="m">Happiness ${Math.round(happiness(v))}% → works at ${Math.round(productivity(v) * 100)}%</div>`;
  }
  if (selected.kind === 'mob') {
    const m = mob(selected.id); if (!m) { selected = null; return selectionHTML(); }
    const tip = { goblin: 'Fast and weak. Goes for farms and houses, and chases whoever shoots it.', orc: 'Tough bruiser. Smashes whatever is closest.', troll: 'Huge. Heads straight for towers and the Town Hall.', shaman: 'Lobs fire at buildings from 4 tiles away. Kill it first.', bomber: 'Sprints at walls and towers and explodes. Shoot it before it arrives.' }[m.type];
    return `<div class="t">${MOBS[m.type].name}</div><div class="m">HP ${Math.ceil(m.hp)}/${m.maxhp} · hits for ${Math.round(m.dmg)}</div><div class="m" style="margin-top:6px">${tip}</div>`;
  }
  return '';
}

// ---------------------------------------------------------------- input
function pointerWorld(e) { const r = canvas.getBoundingClientRect(); return S2W(e.clientX - r.left, e.clientY - r.top); }
canvas.addEventListener('pointermove', e => {
  mouseW = pointerWorld(e); hover = { x: Math.floor(mouseW.x), y: Math.floor(mouseW.y) };
  if (painting && buildSel && canPlace(buildSel, hover.x, hover.y)) { tryBuild(buildSel, hover.x, hover.y); updateUI(); }
});
canvas.addEventListener('pointerleave', () => { hover = { x: -1, y: -1 }; firing = false; painting = false; });
window.addEventListener('pointerup', () => { painting = false; firing = false; });
canvas.addEventListener('pointerdown', e => {
  if (!S || S.over) return;
  e.preventDefault(); mouseW = pointerWorld(e); hover = { x: Math.floor(mouseW.x), y: Math.floor(mouseW.y) };
  if (e.button !== 0) return;                                 // right button handled in contextmenu
  if (buildSel) { tryBuild(buildSel, hover.x, hover.y); if (DEFS[buildSel].w === 1) painting = true; if (!e.shiftKey && buildSel !== 'wall') selectBuild(null); updateUI(); return; }
  if (demolish) { const b = tileAt(hover.x + 0.5, hover.y + 0.5); if (b) demolishBuilding(b); updateUI(); return; }
  firing = true; fireAt(mouseW.x, mouseW.y);
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault(); if (!S) return;
  if (buildSel || demolish) { selectBuild(null); demolish = false; updateUI(); return; }
  const p = pointerWorld(e);
  const m = nearestMob(p, 0.7); if (m) { selected = { kind: 'mob', id: m.id }; updateUI(); return; }
  if (S.hero.dead <= 0 && dist(p, S.hero) < 0.6) { selected = { kind: 'hero' }; updateUI(); return; }
  let v = null, vd = 0.6; for (const o of S.villagers) if (o.state !== 'sleeping') { const d = dist(p, o); if (d < vd) { vd = d; v = o; } }
  if (v) { selected = { kind: 'villager', id: v.id }; updateUI(); return; }
  const b = tileAt(p.x, p.y); selected = b ? { kind: 'building', id: b.id } : null; updateUI();
});
const MOVE_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const keyName = e => (e.key.length === 1 ? e.key.toLowerCase() : e.key);
document.addEventListener('keydown', e => {
  if (!S || e.target.tagName === 'INPUT') return;
  const k = e.key, kn = keyName(e); keys[kn] = true;
  if (MOVE_KEYS.includes(kn)) e.preventDefault();
  if (S.over) return;
  if (k === 'Escape') { selectBuild(null); demolish = false; selected = null; }
  else if (k === ' ') { e.preventDefault(); setSpeed(paused ? speed : 0); }
  else if (kn === 'x') { demolish = !demolish; buildSel = null; }
  else if (kn === 'r') repairAll();
  else if (kn === 'q') warCry();
  else if (kn === 'm') { muted = !muted; try { localStorage.setItem('hollowmere-muted', muted ? '1' : ''); } catch (er) { /* ignore */ } toast(muted ? '🔇 Sound off' : '🔊 Sound on'); }
  else { const t = BUILD_ORDER.find(t => DEFS[t].key === k); if (t) selectBuild(buildSel === t ? null : t); }
  updateUI();
});
document.addEventListener('keyup', e => { keys[keyName(e)] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; });
// on-screen controls for touch devices
(function touchSetup() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const box = $('#touch'); if (!box) return; box.hidden = !coarse; if (!coarse) return;
  const joy = $('#joy'), knob = $('#knob'); let jid = null;
  const setKnob = (x, y) => { knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`; };
  joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); });
  joy.addEventListener('pointermove', e => {
    if (e.pointerId !== jid) return; const r = joy.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; } touchVec.x = x; touchVec.y = y; setKnob(x, y);
  });
  const end = e => { if (e.pointerId !== jid) return; jid = null; touchVec.x = touchVec.y = 0; setKnob(0, 0); };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  $('#t-cry').addEventListener('pointerdown', e => { e.preventDefault(); warCry(); });
  $('#t-dash').addEventListener('pointerdown', e => { e.preventDefault(); keys.Shift = true; setTimeout(() => { keys.Shift = false; }, 150); });
})();
function setSpeed(s) {
  paused = s === 0; if (s > 0) speed = s;
  for (const b of document.querySelectorAll('#speed button')) b.classList.toggle('on', +b.dataset.speed === s);
}
for (const b of document.querySelectorAll('#speed button')) b.onclick = () => setSpeed(+b.dataset.speed);
$('#btn-upgrade').onclick = () => { upgradeHall(); updateUI(); };
for (const k in UPGRADES) $('#up-' + k).onclick = () => { buyUpgrade(k); updateUI(); };
for (const b of document.querySelectorAll('#diff button')) b.onclick = () => { chosenDiff = b.dataset.diff; for (const o of document.querySelectorAll('#diff button')) o.classList.toggle('on', o === b); };
$('#btn-repair').onclick = () => { repairAll(); updateUI(); };
$('#btn-demolish').onclick = () => { demolish = !demolish; buildSel = null; updateUI(); };
$('#btn-new').onclick = () => { if (confirm('Abandon this town and start over?')) { localStorage.removeItem(SAVE_KEY); startGame(true); } };
$('#btn-start').onclick = () => startGame(true);
$('#btn-continue').onclick = () => startGame(false);
$('#btn-again').onclick = () => { $('#gameover').hidden = true; startGame(true); };
window.addEventListener('beforeunload', () => { if (S && !S.over) save(); });

// ---------------------------------------------------------------- boot
function startGame(fresh) {
  if (fresh || !load()) newState();
  $('#overlay').style.display = 'none';
  buildSel = null; demolish = false; selected = null; setSpeed(1); resize(); updateUI();
}
function frame(now) {
  const raw = Math.min(0.1, (now - lastFrame) / 1000 || 0); lastFrame = now;
  if (S) {
    if (!paused) { const dt = raw * speed; const steps = Math.ceil(dt / 0.05); for (let i = 0; i < steps; i++) update(dt / steps); }
    const k = 1 - Math.exp(-6 * raw); const vw = canvas.width / TS, vh = canvas.height / TS;
    if (S.hero.dead <= 0) { cam.x += (S.hero.x - cam.x) * k; cam.y += (S.hero.y - cam.y) * k; }
    cam.x = clamp(cam.x, Math.min(vw / 2, COLS / 2), Math.max(COLS - vw / 2, COLS / 2)); cam.y = clamp(cam.y, Math.min(vh / 2, ROWS / 2), Math.max(ROWS - vh / 2, ROWS / 2));
    if (shakeT > 0) { shakeT -= raw; if (shakeT <= 0) shakeMag = 0; }
    uiTimer += raw; if (uiTimer > 0.25) { uiTimer = 0; updateUI(); }
    saveTimer += raw; if (saveTimer > 5) { saveTimer = 0; if (!S.over) save(); }
    draw();
  }
  requestAnimationFrame(frame);
}
buildSprites(); buildButtons(); resize();
$('#btn-continue').style.display = hasSave() ? '' : 'none';
requestAnimationFrame(frame);
