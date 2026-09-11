'use strict';
// Hollowmere — a tiny offline town-builder / tower-defense.
// Everything lives in this one file: data, simulation, rendering, UI, save.

// ---------------------------------------------------------------- constants
const COLS = 28, ROWS = 20, T = 32;              // grid + tile size (px)
const DAY_LEN = 75, NIGHT_LEN = 45;              // seconds
const CYCLE = DAY_LEN + NIGHT_LEN;
const SAVE_KEY = 'hollowmere-save-v1';

const DEFS = {
  hall:     { name: 'Town Hall',    icon: '🏛️', w: 2, h: 2, hp: 600, cost: {}, cap: 4, color: '#c9a36a',
              desc: 'The heart of Hollowmere. Lose it and the town falls. Upgrade it to unlock more buildings.' },
  house:    { name: 'House',        icon: '🏠', w: 1, h: 1, hp: 120, cost: { wood: 20 }, cap: 3, key: '1', color: '#d08a5a',
              desc: 'Room for 3 villagers. Villagers sleep here at night.' },
  farm:     { name: 'Farm',         icon: '🌾', w: 2, h: 2, hp: 100, cost: { wood: 30 }, prod: 'food', rate: 0.6, key: '2', color: '#a8b85a',
              desc: 'A villager grows food here. Villagers eat food, and soldiers are trained with it.' },
  mill:     { name: 'Lumber Mill',  icon: '🪵', w: 1, h: 1, hp: 120, cost: { wood: 25, gold: 10 }, prod: 'wood', rate: 0.5, key: '3', color: '#9c7a4f',
              desc: 'A villager chops wood here. Wood builds and repairs everything.' },
  mine:     { name: 'Gold Mine',    icon: '⛏️', w: 1, h: 1, hp: 150, cost: { wood: 40 }, prod: 'gold', rate: 0.35, key: '4', color: '#8f8f9a',
              desc: 'A villager digs gold here. Gold pays for towers, barracks and upgrades.' },
  wall:     { name: 'Wall',         icon: '🧱', w: 1, h: 1, hp: 300, cost: { wood: 8 }, key: '5', color: '#7d7d86',
              desc: 'Cheap and tough. Mobs must chew through any wall in their way.' },
  tower:    { name: 'Archer Tower', icon: '🏹', w: 1, h: 1, hp: 200, cost: { wood: 30, gold: 30 }, range: 5, dmg: 10, rof: 0.7, key: '6', color: '#6a7fa8',
              desc: 'Shoots any mob within 5 tiles. Your best friend at night.' },
  barracks: { name: 'Barracks',     icon: '⚔️', w: 2, h: 2, hp: 250, cost: { wood: 60, gold: 60 }, th: 2, soldiers: 3, key: '7', color: '#a86a6a',
              desc: 'Trains up to 3 soldiers (10 food each) who guard the town and hunt mobs.' },
  tavern:   { name: 'Tavern',       icon: '🍺', w: 1, h: 1, hp: 150, cost: { wood: 30, gold: 40 }, th: 2, fun: true, key: '8', color: '#b07ab0',
              desc: 'Villagers come here to have fun. Happy villagers work up to twice as fast.' },
};
const BUILD_ORDER = ['house', 'farm', 'mill', 'mine', 'wall', 'tower', 'barracks', 'tavern'];
const TH_LEVELS = [
  { cost: {},                      hp: 600,  cap: 4 },
  { cost: { wood: 150, gold: 150 }, hp: 1000, cap: 6 },
  { cost: { wood: 400, gold: 400 }, hp: 1500, cap: 8 },
];
const MOBS = {
  goblin: { name: 'Goblin', icon: '👺', hp: 30,  spd: 2.2, dmg: 4,  rof: 0.8, gold: 3,  r: 0.30 },
  orc:    { name: 'Orc',    icon: '👹', hp: 90,  spd: 1.4, dmg: 10, rof: 1.0, gold: 8,  r: 0.38 },
  troll:  { name: 'Troll',  icon: '🧌', hp: 250, spd: 1.0, dmg: 25, rof: 1.5, gold: 20, r: 0.45 },
};
const NAMES = ['Ada', 'Bo', 'Cyrus', 'Dara', 'Eli', 'Fenn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lulu', 'Milo', 'Nia',
  'Otto', 'Pip', 'Quin', 'Rae', 'Sol', 'Tess', 'Uma', 'Vic', 'Wren', 'Xio', 'Yara', 'Zed', 'Ash', 'Bryn', 'Cole', 'Dove'];

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
  e.x += dx / d * step; e.y += dy / d * step; return false;
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

// ---------------------------------------------------------------- state
let S = null, grid = null, bmap = null;
let speed = 1, paused = false, buildSel = null, demolish = false, selected = null;
let hover = { x: -1, y: -1 }, uiTimer = 0, saveTimer = 0, lastFrame = 0;

function newState() {
  const hx = Math.floor(COLS / 2) - 1, hy = Math.floor(ROWS / 2) - 1;
  const st = {
    v: 1, nextId: 1, res: { gold: 50, wood: 80, food: 40 }, day: 1, t: 0, thLevel: 1,
    buildings: [], villagers: [], mobs: [], soldiers: [], projs: [], fx: [], log: [],
    waveQueue: [], arrivalTimer: 0, kills: 0, over: false, banner: null,
    hero: { x: hx + 1, y: hy + 2.6, tx: null, ty: null, hp: 150, maxhp: 150, target: null, cd: 0, dead: 0 },
  };
  S = st; rebuildGrid();
  addBuilding('hall', hx, hy);
  addVillager(); addVillager();
  log('Welcome to Hollowmere. Build houses and a farm before nightfall!');
  return st;
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
function log(msg) { S.log.unshift(msg); if (S.log.length > 40) S.log.pop(); }
function fx(x, y, text, color, life = 0.9) { S.fx.push({ x, y, text, color, life, max: life }); if (S.fx.length > 80) S.fx.shift(); }

// ---------------------------------------------------------------- buildings
function canPlace(type, gx, gy) {
  const d = DEFS[type];
  if (gx < 0 || gy < 0 || gx + d.w > COLS || gy + d.h > ROWS) return false;
  for (let y = gy; y < gy + d.h; y++) for (let x = gx; x < gx + d.w; x++) if (grid[y][x]) return false;
  return true;
}
function addBuilding(type, gx, gy) {
  const d = DEFS[type];
  const b = { id: S.nextId++, type, gx, gy, w: d.w, h: d.h, hp: d.hp, maxhp: d.hp, worker: null, cd: 0, trainCd: 0 };
  if (type === 'hall') b.maxhp = b.hp = TH_LEVELS[S.thLevel - 1].hp;
  S.buildings.push(b); rebuildGrid(); return b;
}
function tryBuild(type, gx, gy) {
  const d = DEFS[type];
  if ((d.th || 1) > S.thLevel) return toast(`Needs Town Hall level ${d.th}`);
  if (!canAfford(d.cost)) return toast('Not enough resources');
  if (!canPlace(type, gx, gy)) return;
  pay(d.cost); addBuilding(type, gx, gy);
  blip(440, 0.05);
}
function removeBuilding(b, reason) {
  S.buildings = S.buildings.filter(x => x !== b);
  for (const v of S.villagers) { if (v.job === b.id) { v.job = null; if (v.state === 'working' || v.state === 'toWork') v.state = 'idle'; } if (v.home === b.id) v.home = null; }
  rebuildGrid();
  if (selected && selected.kind === 'building' && selected.id === b.id) selected = null;
  if (reason === 'destroyed') {
    log(`${DEFS[b.type].icon} ${DEFS[b.type].name} was destroyed!`);
    fx(b.gx + b.w / 2, b.gy + b.h / 2, '💥', '#fff', 1.2);
    if (b.type === 'hall') gameOver();
  }
}
function damageBuilding(b, dmg) {
  b.hp -= dmg; if (b.hp <= 0) removeBuilding(b, 'destroyed');
}
function demolishBuilding(b) {
  if (b.type === 'hall') return toast('You cannot demolish the Town Hall');
  const c = DEFS[b.type].cost; for (const k in c) S.res[k] += Math.floor(c[k] / 2);
  removeBuilding(b, 'demolished'); log(`Demolished a ${DEFS[b.type].name}.`);
}
function repairCost() { return Math.ceil(S.buildings.reduce((n, b) => n + (b.maxhp - b.hp), 0) / 10); }
function repairAll() {
  const c = repairCost(); if (!c) return;
  if (S.res.wood < c) return toast(`Repairs need 🪵${c}`);
  S.res.wood -= c; for (const b of S.buildings) b.hp = b.maxhp; log(`Repaired the town for 🪵${c}.`); blip(520, 0.08);
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
    state: 'idle', job: null, home: null, hunger: rnd(10, 40), energy: rnd(70, 100), fun: rnd(40, 80), wt: 0, tx: null, ty: null };
  S.villagers.push(v); return v;
}
const happiness = v => ((100 - v.hunger) + v.energy + v.fun) / 3;
const productivity = v => 0.5 + happiness(v) / 200;   // 0.5 .. 1.0
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
  switch (v.state) {
    case 'idle': {
      if (v.energy < 15) { goHome(v); break; }
      if (v.fun < 25 && tavern()) { v.state = 'toFun'; break; }
      if (v.job == null || !bld(v.job)) { const j = findJob(v); v.job = j ? j.id : null; }
      if (v.job != null) { v.state = 'toWork'; break; }
      v.wt -= dt;                                   // wander near the hall
      if (v.tx == null || v.wt <= 0) {
        const hall = S.buildings.find(b => b.type === 'hall'); const p = door(hall);
        v.tx = clamp(p.x + rnd(-3, 3), 0.3, COLS - 0.3); v.ty = clamp(p.y + rnd(-1, 3), 0.3, ROWS - 0.3); v.wt = rnd(2, 5);
      }
      if (moveToward(v, v.tx, v.ty, 1.2, dt)) v.tx = null;
      break;
    }
    case 'toWork': {
      const b = bld(v.job); if (!b) { v.state = 'idle'; break; }
      const p = door(b); if (moveToward(v, p.x, p.y, 1.6, dt)) v.state = 'working';
      break;
    }
    case 'working': {
      const b = bld(v.job); if (!b) { v.state = 'idle'; break; }
      S.res[DEFS[b.type].prod] += DEFS[b.type].rate * productivity(v) * dt;
      if (v.energy < 15) goHome(v);
      else if (v.fun < 20 && tavern()) v.state = 'toFun';
      break;
    }
    case 'toHome': {
      const h = bld(v.home); if (!h) { goHome(v); if (!bld(v.home)) { v.state = 'sleeping'; } break; }
      const p = door(h); if (moveToward(v, p.x, p.y, 1.8, dt)) v.state = 'sleeping';
      break;
    }
    case 'sleeping': {
      v.energy = clamp(v.energy + 3 * dt, 0, 100);
      if (!night && v.energy >= 90) { v.state = 'idle'; v.tx = null; }
      break;
    }
    case 'toFun': {
      const tv = tavern(); if (!tv) { v.state = 'idle'; break; }
      const p = door(tv); if (moveToward(v, p.x, p.y, 1.6, dt)) v.state = 'fun';
      break;
    }
    case 'fun': {
      v.fun = clamp(v.fun + 6 * dt, 0, 100);
      if (v.fun >= 95 || !tavern()) v.state = 'idle';
      break;
    }
  }
}

// ---------------------------------------------------------------- mobs
function waveFor(n) {
  const list = [];
  for (let i = 0; i < 4 + 2 * n; i++) list.push('goblin');
  if (n >= 2) for (let i = 0; i < Math.floor(n * 1.2) - 1; i++) list.push('orc');
  if (n >= 4) for (let i = 0; i < Math.floor((n - 2) / 2); i++) list.push('troll');
  list.sort(() => Math.random() - 0.5);
  const spread = Math.min(25, 6 + list.length);
  return list.map((type, i) => ({ type, delay: i * (spread / list.length) + rnd(0, 1.5) }));
}
function waveSummary(n) {
  const c = {}; for (const w of waveFor(n)) c[w.type] = (c[w.type] || 0) + 1;
  return Object.keys(MOBS).filter(k => c[k]).map(k => `${c[k]}${MOBS[k].icon}`).join(' ');
}
function startNight() {
  const n = S.day;
  S.waveQueue = waveFor(n);
  S.banner = { text: `🌙 Night ${n} — ${S.waveQueue.length} mobs approach!`, life: 4 };
  log(`Night ${n} falls. ${S.waveQueue.length} mobs are coming.`);
  blip(220, 0.3);
}
function spawnMob(type) {
  const d = MOBS[type], n = S.day, side = Math.floor(rnd(0, 4));
  let x, y;
  if (side === 0) { x = rnd(0.5, COLS - 0.5); y = 0.3; } else if (side === 1) { x = rnd(0.5, COLS - 0.5); y = ROWS - 0.3; }
  else if (side === 2) { x = 0.3; y = rnd(0.5, ROWS - 0.5); } else { x = COLS - 0.3; y = rnd(0.5, ROWS - 0.5); }
  const hp = Math.round(d.hp * (1 + 0.1 * (n - 1)));
  S.mobs.push({ id: S.nextId++, type, x, y, hp, maxhp: hp, dmg: d.dmg * (1 + 0.05 * (n - 1)), spd: d.spd, rof: d.rof,
    r: d.r, cd: rnd(0, d.rof), target: null, blocker: null, attacker: null, retarget: 0 });
}
function pickTarget(m) {
  let best = null, bd = 1e9;
  for (const b of S.buildings) {
    if (b.type === 'wall') continue;
    let d = rectDist(m, b);
    if (m.type === 'goblin' && (DEFS[b.type].prod || b.type === 'house')) d *= 0.6;
    if (m.type === 'troll' && (b.type === 'tower' || b.type === 'hall' || b.type === 'barracks')) d *= 0.5;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function damageMob(m, dmg, byUnit) {
  m.hp -= dmg; if (byUnit) m.attacker = byUnit;
  fx(m.x, m.y - 0.4, `-${Math.round(dmg)}`, '#ffd166', 0.6);
  if (m.hp <= 0) {
    S.mobs = S.mobs.filter(x => x !== m);
    S.res.gold += MOBS[m.type].gold; S.kills++;
    fx(m.x, m.y, `+🪙${MOBS[m.type].gold}`, '#f2c14e', 1);
    if (selected && selected.kind === 'mob' && selected.id === m.id) selected = null;
    blip(160, 0.06);
  }
}
function updateMob(m, dt) {
  m.cd -= dt; m.retarget -= dt;
  // fight back against a unit that is hitting us
  const a = m.attacker;
  if (a && a.hp > 0 && dist(m, a) < 1.1) {
    if (m.cd <= 0) { hitUnit(a, m.dmg); m.cd = m.rof; }
    return;
  }
  if (a && (a.hp <= 0 || dist(m, a) > 2.5)) m.attacker = null;
  if (!m.target || !bld(m.target) || m.retarget <= 0) { const t = pickTarget(m); m.target = t ? t.id : null; m.retarget = 3; }
  const tgt = bld(m.target); if (!tgt) return;
  if (m.blocker && !bld(m.blocker)) m.blocker = null;
  const atk = bld(m.blocker) || (rectDist(m, tgt) < 0.7 ? tgt : null);
  if (atk) {
    if (m.cd <= 0) { damageBuilding(atk, m.dmg); m.cd = m.rof; fx(m.x, m.y - 0.3, '💢', '#f66', 0.4); }
    return;
  }
  const c = center(tgt), dx = c.x - m.x, dy = c.y - m.y, d = Math.hypot(dx, dy), step = m.spd * dt;
  const ux = dx / d * step, uy = dy / d * step;
  const tileB = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? null : grid[Math.floor(y)][Math.floor(x)];
  const tries = [[ux, uy]]; if (Math.abs(ux) > 1e-4) tries.push([ux, 0]); if (Math.abs(uy) > 1e-4) tries.push([0, uy]);
  let firstBlock = null;
  for (const [mx, my] of tries) {
    const nx = clamp(m.x + mx, 0.2, COLS - 0.2), ny = clamp(m.y + my, 0.2, ROWS - 0.2);
    const b = tileB(nx, ny);
    if (!b || b === tgt) { m.x = nx; m.y = ny; return; }
    if (!firstBlock) firstBlock = b;
  }
  m.blocker = firstBlock.id;
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
  S.projs.push({ x: c.x, y: c.y - 0.3, target: m.id, dmg, spd: 14 }); b.cd = DEFS.tower.rof;
}
function updateProj(p, dt) {
  const m = mob(p.target); if (!m) return false;
  if (moveToward(p, m.x, m.y, p.spd, dt)) { damageMob(m, p.dmg); return false; }
  return true;
}
function updateBarracks(b, dt) {
  b.trainCd -= dt;
  const mine = S.soldiers.filter(s => s.home === b.id).length;
  if (mine < DEFS.barracks.soldiers && b.trainCd <= 0 && S.res.food >= 10) {
    S.res.food -= 10; const p = door(b);
    S.soldiers.push({ id: S.nextId++, x: p.x + rnd(-0.6, 0.6), y: p.y + rnd(0, 0.6), hp: 80, maxhp: 80, home: b.id, target: null, cd: 0 });
    b.trainCd = 15; log('💂 A soldier finished training.');
  }
}
function hitUnit(u, dmg) {
  u.hp -= dmg; fx(u.x, u.y - 0.4, `-${Math.round(dmg)}`, '#ff8080', 0.5);
  if (u.hp <= 0) {
    if (u === S.hero) { u.dead = 15; u.hp = 0; log('🤠 The Mayor fell! Recovering at the Town Hall…'); }
    else { S.soldiers = S.soldiers.filter(s => s !== u); log('💂 A soldier has fallen.'); }
  }
}
function fightNearby(u, dt, range, dmg, rof, chase) {
  u.cd -= dt;
  let m = mob(u.target); if (!m) { m = nearestMob(u, chase); u.target = m ? m.id : null; }
  if (!m) return false;
  if (dist(u, m) <= range) { if (u.cd <= 0) { damageMob(m, dmg, u); u.cd = rof; } }
  else moveToward(u, m.x, m.y, u === S.hero ? 3.5 : 2.4, dt);
  return true;
}
function updateSoldier(s, dt) {
  if (fightNearby(s, dt, 0.9, 8, 0.6, 8)) return;
  const h = bld(s.home) || S.buildings.find(b => b.type === 'hall'); if (!h) return;
  const p = door(h); if (dist(s, p) > 1.2) moveToward(s, p.x, p.y, 2, dt);
  if (!isNight()) s.hp = clamp(s.hp + 3 * dt, 0, s.maxhp);
}
function updateHero(dt) {
  const h = S.hero;
  if (h.dead > 0) {
    h.dead -= dt;
    if (h.dead <= 0) { const hall = S.buildings.find(b => b.type === 'hall'); const p = door(hall); h.x = p.x; h.y = p.y; h.hp = h.maxhp; h.tx = null; log('🤠 The Mayor is back on their feet.'); }
    return;
  }
  h.cd -= dt;
  if (h.tx != null) {                                    // player-ordered move
    if (moveToward(h, h.tx, h.ty, 3.5, dt)) h.tx = null;
    const m = mob(h.target); if (m && dist(h, m) <= 1.2 && h.cd <= 0) { damageMob(m, 14, h); h.cd = 0.5; }
    return;
  }
  if (!fightNearby(h, dt, 1.2, 14, 0.5, 4) && !isNight()) h.hp = clamp(h.hp + 2 * dt, 0, h.maxhp);
}

// ---------------------------------------------------------------- main update
function update(dt) {
  if (S.over) return;
  const wasNight = isNight();
  S.t += dt;
  if (!wasNight && isNight()) startNight();
  if (S.t >= CYCLE) {
    S.t -= CYCLE; S.day++;
    if (S.mobs.length) log(`☀️ Dawn. ${S.mobs.length} mobs fled the sunlight.`); else log(`☀️ Day ${S.day}. The town held the night!`);
    S.mobs = []; S.projs = [];
    S.banner = { text: `☀️ Day ${S.day}`, life: 3 };
    const cap = capacity();
    if (S.villagers.length > cap) { const n = S.villagers.length - cap; S.villagers.length = cap; log(`${n} villager(s) left — not enough housing.`); }
  }
  if (isNight()) for (const w of S.waveQueue) { w.delay -= dt; if (w.delay <= 0) spawnMob(w.type); }
  S.waveQueue = S.waveQueue.filter(w => w.delay > 0);

  if (!isNight() && S.villagers.length < capacity()) {
    S.arrivalTimer += dt;
    if (S.arrivalTimer >= 12) { S.arrivalTimer = 0; const v = addVillager(); log(`🧑‍🌾 ${v.name} moved into Hollowmere.`); }
  }
  for (const v of S.villagers) updateVillager(v, dt);
  for (const b of S.buildings.slice()) { if (b.type === 'tower') updateTower(b, dt); else if (b.type === 'barracks') updateBarracks(b, dt); }
  for (const m of S.mobs.slice()) updateMob(m, dt);
  S.projs = S.projs.filter(p => updateProj(p, dt));
  for (const s of S.soldiers.slice()) updateSoldier(s, dt);
  updateHero(dt);
  for (const f of S.fx) { f.life -= dt; f.y -= 0.6 * dt; } S.fx = S.fx.filter(f => f.life > 0);
  if (S.banner) { S.banner.life -= dt; if (S.banner.life <= 0) S.banner = null; }
}
function gameOver() {
  S.over = true; save();
  $('#go-stats').innerHTML = `The town survived <b>${S.day - 1}</b> night${S.day - 1 === 1 ? '' : 's'} and slew <b>${S.kills}</b> mobs.<br>Score: <b>${score()}</b>`;
  $('#gameover').hidden = false;
}
const score = () => S.kills * 10 + (S.day - 1) * 100 + S.buildings.length * 5;

// ---------------------------------------------------------------- save / load
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
    const st = JSON.parse(raw); if (!st || st.v !== 1 || st.over) return false;
    S = st; for (const m of S.mobs) m.attacker = null; rebuildGrid(); return true;
  } catch (e) { return false; }
}
function hasSave() { try { const r = localStorage.getItem(SAVE_KEY); if (!r) return false; const s = JSON.parse(r); return s && !s.over; } catch (e) { return false; } }

// ---------------------------------------------------------------- audio (tiny synth, optional)
let actx = null;
function blip(freq, len) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = freq; g.gain.value = 0.04;
    o.connect(g); g.connect(actx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + len); o.stop(actx.currentTime + len);
  } catch (e) { /* no audio */ }
}

// ---------------------------------------------------------------- rendering
const canvas = $('#c'), ctx = canvas.getContext('2d');
const ground = document.createElement('canvas'); ground.width = COLS * T; ground.height = ROWS * T;
(function paintGround() {
  const g = ground.getContext('2d');
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const v = Math.floor(rnd(-8, 8));
    g.fillStyle = `rgb(${96 + v},${150 + v},${72 + v})`; g.fillRect(x * T, y * T, T, T);
    if (Math.random() < 0.25) { g.fillStyle = 'rgba(40,90,40,.5)'; const px = x * T + rnd(4, T - 6), py = y * T + rnd(4, T - 6); g.fillRect(px, py, 2, 4); g.fillRect(px + 3, py - 2, 2, 5); }
  }
})();
function emoji(txt, x, y, size) { ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y); }
function hpBar(x, y, w, frac, color) {
  ctx.fillStyle = '#0008'; ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 4);
}
function darkness() {
  const t = S.t;
  if (t < DAY_LEN - 8) return 0;
  if (t < DAY_LEN) return (t - (DAY_LEN - 8)) / 8 * 0.55;
  if (t > CYCLE - 6) return (CYCLE - t) / 6 * 0.55;
  return 0.55;
}
function draw() {
  ctx.drawImage(ground, 0, 0);
  // build grid + ghost
  if (buildSel || demolish) {
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= COLS; x++) { ctx.moveTo(x * T, 0); ctx.lineTo(x * T, ROWS * T); }
    for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y * T); ctx.lineTo(COLS * T, y * T); }
    ctx.stroke();
  }
  // buildings
  for (const b of S.buildings) {
    const d = DEFS[b.type], x = b.gx * T, y = b.gy * T, w = b.w * T, h = b.h * T;
    ctx.fillStyle = '#0003'; ctx.fillRect(x + 3, y + 4, w, h);
    ctx.fillStyle = d.color; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = '#0006'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (b.type === 'wall') { ctx.strokeStyle = '#0003'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + T / 2); ctx.lineTo(x + T, y + T / 2); ctx.moveTo(x + T / 2, y); ctx.lineTo(x + T / 2, y + T / 2); ctx.moveTo(x + T / 4, y + T / 2); ctx.lineTo(x + T / 4, y + T); ctx.moveTo(x + 3 * T / 4, y + T / 2); ctx.lineTo(x + 3 * T / 4, y + T); ctx.stroke(); }
    else emoji(d.icon, x + w / 2, y + h / 2 + 1, b.w === 2 ? 34 : 20);
    if (b.type === 'hall') { ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('Lv' + S.thLevel, x + 4, y + 4); }
    if (b.type === 'tower' && S.mobs.length) { ctx.strokeStyle = 'rgba(120,160,255,.18)'; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, DEFS.tower.range * T, 0, Math.PI * 2); ctx.stroke(); }
    if (b.hp < b.maxhp) hpBar(x + w / 2, y + h - 6, w - 8, b.hp / b.maxhp, b.hp / b.maxhp > 0.4 ? '#6fcf7a' : '#ef6b6b');
    if (selected && selected.kind === 'building' && selected.id === b.id) { ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2); }
  }
  // ghost
  if (hover.x >= 0 && (buildSel || demolish)) {
    if (buildSel) {
      const d = DEFS[buildSel], ok = canPlace(buildSel, hover.x, hover.y) && canAfford(d.cost) && (d.th || 1) <= S.thLevel;
      ctx.fillStyle = ok ? 'rgba(110,220,120,.45)' : 'rgba(240,90,90,.45)';
      ctx.fillRect(hover.x * T, hover.y * T, d.w * T, d.h * T);
      if (buildSel === 'tower') { ctx.strokeStyle = 'rgba(120,160,255,.35)'; ctx.beginPath(); ctx.arc(hover.x * T + T / 2, hover.y * T + T / 2, DEFS.tower.range * T, 0, Math.PI * 2); ctx.stroke(); }
    } else { const b = grid[hover.y] && grid[hover.y][hover.x]; if (b) { ctx.fillStyle = 'rgba(240,90,90,.45)'; ctx.fillRect(b.gx * T, b.gy * T, b.w * T, b.h * T); } }
  }
  // villagers
  for (const v of S.villagers) {
    if (v.state === 'sleeping') continue;
    const x = v.x * T, y = v.y * T;
    ctx.fillStyle = '#0004'; ctx.beginPath(); ctx.ellipse(x, y + 8, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    emoji('🧑‍🌾', x, y, 18);
    if (v.state === 'working') emoji('💪', x + 9, y - 9, 9);
    else if (v.state === 'fun') emoji('🎶', x + 9, y - 9, 9);
    else if (v.hunger > 80) emoji('🍽️', x + 9, y - 9, 9);
    else if (v.state === 'toHome' && !isNight()) emoji('😴', x + 9, y - 9, 9);
    if (selected && selected.kind === 'villager' && selected.id === v.id) ring(x, y, 12);
  }
  // soldiers + hero
  for (const s of S.soldiers) { emoji('💂', s.x * T, s.y * T, 18); if (s.hp < s.maxhp) hpBar(s.x * T, s.y * T + 11, 20, s.hp / s.maxhp, '#6fcf7a'); }
  const h = S.hero;
  if (h.dead <= 0) { emoji('🤠', h.x * T, h.y * T, 22); hpBar(h.x * T, h.y * T + 13, 24, h.hp / h.maxhp, '#f2c14e'); if (h.tx != null) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(h.tx * T, h.ty * T, 5, 0, Math.PI * 2); ctx.stroke(); } if (selected && selected.kind === 'hero') ring(h.x * T, h.y * T, 14); }
  // mobs
  for (const m of S.mobs) {
    const x = m.x * T, y = m.y * T, sz = m.type === 'troll' ? 30 : m.type === 'orc' ? 24 : 18;
    ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(x, y + sz * 0.45, sz * 0.4, sz * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    emoji(MOBS[m.type].icon, x, y, sz);
    hpBar(x, y + sz * 0.55, sz, m.hp / m.maxhp, '#ef6b6b');
    if (selected && selected.kind === 'mob' && selected.id === m.id) ring(x, y, sz * 0.7);
  }
  // projectiles
  ctx.strokeStyle = '#f5e6b3'; ctx.lineWidth = 2; ctx.beginPath();
  for (const p of S.projs) { const m = mob(p.target); if (!m) continue; const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy) || 1; ctx.moveTo(p.x * T, p.y * T); ctx.lineTo(p.x * T - dx / d * 8, p.y * T - dy / d * 8); }
  ctx.stroke();
  // night
  const dk = darkness();
  if (dk > 0) {
    ctx.fillStyle = `rgba(12,16,50,${dk})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of S.buildings) if (b.type === 'hall' || b.type === 'tower' || b.type === 'tavern') {
      const c = center(b), r = b.type === 'hall' ? 4 * T : 2.5 * T;
      const g = ctx.createRadialGradient(c.x * T, c.y * T, 4, c.x * T, c.y * T, r);
      g.addColorStop(0, `rgba(255,190,90,${0.35 * dk})`); g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = g; ctx.fillRect(c.x * T - r, c.y * T - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // floating text
  for (const f of S.fx) { ctx.globalAlpha = clamp(f.life / f.max, 0, 1); ctx.fillStyle = f.color; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(f.text, f.x * T, f.y * T); }
  ctx.globalAlpha = 1;
  // banner
  if (S.banner) {
    ctx.globalAlpha = clamp(S.banner.life, 0, 1); ctx.fillStyle = '#000a'; ctx.fillRect(0, canvas.height / 2 - 26, canvas.width, 52);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(S.banner.text, canvas.width / 2, canvas.height / 2); ctx.globalAlpha = 1;
  }
  if (paused) { ctx.fillStyle = '#0006'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⏸ Paused', canvas.width / 2, canvas.height / 2); }
}
function ring(x, y, r) { ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }

// ---------------------------------------------------------------- UI (DOM)
function toast(msg) { S.banner = { text: msg, life: 1.5 }; }
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
  $('#log').innerHTML = S.log.slice(0, 12).map(m => `<div>${m}</div>`).join('');
  $('#sel').innerHTML = selectionHTML();
}
function needBar(label, val) { return `<div class="need"><span>${label}</span><div class="b"><i class="${val < 30 ? 'low' : ''}" style="width:${val}%"></i></div></div>`; }
function selectionHTML() {
  if (!selected) return '<i>Nothing selected. Click a building, villager, or mob. Click the ground to move the Mayor.</i>';
  if (selected.kind === 'hero') { const h = S.hero; return `<div class="t">🤠 The Mayor</div><div class="m">HP ${Math.ceil(h.hp)}/${h.maxhp} · hits for 14</div><div class="m">Click the ground to walk, click a mob to attack. Heals during the day.</div>`; }
  if (selected.kind === 'building') {
    const b = bld(selected.id); if (!b) { selected = null; return selectionHTML(); }
    const d = DEFS[b.type]; let extra = '';
    if (d.prod) { const w = S.villagers.find(v => v.job === b.id); extra = w ? `Worked by ${w.name} (${w.state === 'working' ? 'working' : w.state})` : '<span style="color:var(--red)">No worker yet</span>'; extra += `<br>Makes ${d.rate}/s ${d.prod} at full happiness`; }
    if (b.type === 'barracks') extra = `Soldiers: ${S.soldiers.filter(s => s.home === b.id).length}/${d.soldiers}`;
    if (b.type === 'hall') extra = `Level ${S.thLevel} · houses ${TH_LEVELS[S.thLevel - 1].cap}`;
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
    return `<div class="t">${MOBS[m.type].icon} ${MOBS[m.type].name}</div><div class="m">HP ${Math.ceil(m.hp)}/${m.maxhp} · hits for ${Math.round(m.dmg)}</div><div class="m">The Mayor is moving to attack it.</div>`;
  }
  return '';
}

// ---------------------------------------------------------------- input
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * canvas.width / T, y: (e.clientY - r.top) / r.height * canvas.height / T };
}
canvas.addEventListener('mousemove', e => { const p = canvasPos(e); hover = { x: Math.floor(p.x), y: Math.floor(p.y) }; });
canvas.addEventListener('mouseleave', () => { hover = { x: -1, y: -1 }; });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); selectBuild(null); demolish = false; updateUI(); });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || S.over) return;
  const p = canvasPos(e), gx = Math.floor(p.x), gy = Math.floor(p.y);
  if (buildSel) { tryBuild(buildSel, gx, gy); if (!e.shiftKey && buildSel !== 'wall') selectBuild(null); updateUI(); return; }
  if (demolish) { const b = grid[gy] && grid[gy][gx]; if (b) demolishBuilding(b); updateUI(); return; }
  const m = nearestMob(p, 0.7);
  if (m) { selected = { kind: 'mob', id: m.id }; S.hero.target = m.id; S.hero.tx = null; updateUI(); return; }
  if (S.hero.dead <= 0 && dist(p, S.hero) < 0.6) { selected = { kind: 'hero' }; updateUI(); return; }
  let v = null, vd = 0.6; for (const o of S.villagers) if (o.state !== 'sleeping') { const d = dist(p, o); if (d < vd) { vd = d; v = o; } }
  if (v) { selected = { kind: 'villager', id: v.id }; updateUI(); return; }
  const b = grid[gy] && grid[gy][gx];
  if (b) { selected = { kind: 'building', id: b.id }; updateUI(); return; }
  if (S.hero.dead <= 0) { S.hero.tx = p.x; S.hero.ty = p.y; S.hero.target = null; selected = { kind: 'hero' }; updateUI(); }
});
document.addEventListener('keydown', e => {
  if (!S || S.over || e.target.tagName === 'INPUT') return;
  const k = e.key;
  if (k === 'Escape') { selectBuild(null); demolish = false; selected = null; }
  else if (k === ' ') { e.preventDefault(); setSpeed(paused ? speed : 0); }
  else if (k === 'x' || k === 'X') { demolish = !demolish; buildSel = null; }
  else if (k === 'r' || k === 'R') repairAll();
  else { const t = BUILD_ORDER.find(t => DEFS[t].key === k); if (t) selectBuild(buildSel === t ? null : t); }
  updateUI();
});
function setSpeed(s) {
  paused = s === 0; if (s > 0) speed = s;
  for (const b of document.querySelectorAll('#speed button')) b.classList.toggle('on', +b.dataset.speed === s);
}
for (const b of document.querySelectorAll('#speed button')) b.onclick = () => setSpeed(+b.dataset.speed);
$('#btn-upgrade').onclick = () => { upgradeHall(); updateUI(); };
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
  buildSel = null; demolish = false; selected = null; setSpeed(1); updateUI();
}
function frame(now) {
  const raw = Math.min(0.1, (now - lastFrame) / 1000 || 0); lastFrame = now;
  if (S) {
    if (!paused) { const dt = raw * speed; const steps = Math.ceil(dt / 0.05); for (let i = 0; i < steps; i++) update(dt / steps); }
    uiTimer += raw; if (uiTimer > 0.25) { uiTimer = 0; updateUI(); }
    saveTimer += raw; if (saveTimer > 5) { saveTimer = 0; if (!S.over) save(); }
    draw();
  }
  requestAnimationFrame(frame);
}
buildButtons();
$('#btn-continue').style.display = hasSave() ? '' : 'none';
requestAnimationFrame(frame);
