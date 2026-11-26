// Nightwire rules engine. Pure and deterministic, no DOM: the same seed and the same actions always give
// the same game. The live game, the AI rival, friend duels and the score verifier all run on this file.
// Integers only, so the Solidity verifier (contracts/src/NightwireEngine.sol) gets identical results:
// HP, damage, shield and base are in tenths; charge is in half-points; fight times are in milliseconds.

export const N = 8;
export const CORE = 5; // airstrike beacon
export const MOVES_PER_DAY = 14;
export const MAX_STRIKES = 9;
export const BASE_MAX = 1000; // tenths
export const TIER_PCT = [100, 125, 160];
export const NIGHT_START = 2000; // ms
// round(a / b) for a >= 0, b > 0 (halves round up, like Math.round)
export const rdiv = (a, b) => Math.floor((2 * a + b) / (2 * b));
import { CHIPS } from './chips.js';
import { compile as compileForge, COLORS as FORGE_COLORS, designKey } from './forge.js';
import { load as loadChip, beat as chipBeat } from './tap02.js';

// Each war machine's combat brain is a TapeOut NAND/LATCH chip (src/chips.js, taped out on X Layer).
// Before every attack the boss steps its chip once; the 2 output bits pick the action.
export const ACTIONS = ['BARRAGE', 'FOCUS FIRE', 'EMP', 'FIELD REPAIR'];
const BRAIN_KEYS = ['ironclaw', 'stormwing', 'dreadnought', 'hive', 'behemoth', 'spectre', 'titan', 'warden', 'omega', 'juggernaut'];
const BRAINS = BRAIN_KEYS.map((k) => loadChip(CHIPS[k].netlist, CHIPS[k].nIn, CHIPS[k].nOut));
export const brainOf = (type) => ({ key: BRAIN_KEYS[type], chip: CHIPS[BRAIN_KEYS[type]], circuit: BRAINS[type] });
// chip inputs: boss HP quarter (2 bits), base HP quarter (2), shield up (1), rage (2, capped at 3)
export function brainInputs(hp, max, base, baseMax, shield, rage) {
  const bq = Math.min(3, Math.floor((hp * 4) / max)), sq = Math.min(3, Math.floor((base * 4) / baseMax)), r = Math.min(3, rage);
  return [bq & 1, bq >> 1, sq & 1, sq >> 1, shield > 0 ? 1 : 0, r & 1, r >> 1];
}
// tier thresholds: shots for guns, points for shield/repair
export const tierOf = (i, v) => (i < 3 ? (v >= 10 ? 2 : v >= 5 ? 1 : 0) : i === 3 ? (v >= 40 ? 2 : v >= 20 ? 1 : 0) : (v >= 16 ? 2 : v >= 8 ? 1 : 0));
// each war machine's signature weapon: it unleashes this once your arsenal is spent and it is still standing
export const SIGNATURE = ['RAIL CANNON', 'ROCKET PODS', 'BOMB BAY', 'KAMIKAZE DRONES', 'SIEGE SHELLS', 'CARPET BOMBING', 'PLASMA MORTAR', 'ORBITAL LANCE', 'DOOMSDAY ARRAY', 'MAIN GUN'];
export const ONSLAUGHT_HITS = 5;
// Twenty war machines, one per stage; after stage 20 they come back as MK 2, MK 3...
// type = which TapeOut brain chip it thinks with (src/chips.js); art = its hull. sea = fights from the water.
// sig = its signature weapon, style = how that weapon flies.
export const BOSSES = [
  { name: 'IRONCLAW', role: 'assault mech', color: '#E0703F', type: 0, sig: 'RAIL CANNON', style: 0 },
  { name: 'STORMWING', role: 'attack gunship', color: '#9B8CFF', type: 1, fly: true, sig: 'ROCKET PODS', style: 1 },
  { name: 'RIPTIDE', role: 'missile gunboat', color: '#2EC4B6', type: 0, art: 'gunboat', sea: true, sig: 'SEA SKIMMERS', style: 1 },
  { name: 'DREADNOUGHT', role: 'armoured airship', color: '#45B4E8', type: 2, fly: true, sig: 'BOMB BAY', style: 2 },
  { name: 'SCORPION', role: 'desert crawler', color: '#E8B04B', type: 6, art: 'scorpion', sig: 'STINGER LANCE', style: 0 },
  { name: 'HIVE CARRIER', role: 'drone carrier', color: '#FF4FD8', type: 3, fly: true, sig: 'KAMIKAZE DRONES', style: 3 },
  { name: 'NAUTILUS', role: 'attack submarine', color: '#3FA9F5', type: 5, art: 'sub', sea: true, sig: 'TORPEDO SPREAD', style: 'torpedo' },
  { name: 'BEHEMOTH', role: 'siege tank', color: '#C9A227', type: 4, sig: 'SIEGE SHELLS', style: 2 },
  { name: 'JUGGERNAUT', role: 'armoured tanker', color: '#9FB4C2', type: 9, armored: true, sig: 'MAIN GUN', style: 2 },
  { name: 'TEMPEST', role: 'storm engine', color: '#7FD1FF', type: 7, art: 'tempest', fly: true, sig: 'CHAIN LIGHTNING', style: 'bolt' },
  { name: 'SPECTRE', role: 'stealth bomber', color: '#7CF2E2', type: 5, fly: true, sig: 'CARPET BOMBING', style: 2 },
  { name: 'LEVIATHAN', role: 'armoured battleship', color: '#8FA3B8', type: 4, art: 'battleship', sea: true, armored: true, sig: 'BROADSIDE', style: 2 },
  { name: 'TITAN', role: 'spider walker', color: '#FF8F3D', type: 6, sig: 'PLASMA MORTAR', style: 1 },
  { name: 'MANTA', role: 'sea-skimming ray', color: '#B66DFF', type: 1, art: 'manta', sea: true, fly: true, sig: 'ION WAKE', style: 'bolt' },
  { name: 'WARDEN', role: 'orbital platform', color: '#F2F2FF', type: 7, fly: true, sig: 'ORBITAL LANCE', style: 0 },
  { name: 'COLOSSUS', role: 'shield titan', color: '#5BE37D', type: 0, art: 'colossus', sig: 'HAMMER FALL', style: 2 },
  { name: 'TRIDENT', role: 'supercarrier', color: '#4D7CFF', type: 3, art: 'carrier', sea: true, sig: 'JET SORTIE', style: 3 },
  { name: 'PHOENIX', role: 'firebird', color: '#FF5A1F', type: 1, art: 'phoenix', fly: true, sig: 'FIRESTORM', style: 'fire' },
  { name: 'KRAKEN', role: 'abyssal mech', color: '#00D1A0', type: 2, art: 'kraken', sea: true, sig: 'TENTACLE SLAM', style: 'torpedo' },
  { name: 'ECLIPSE', role: 'mothership', color: '#FFD23F', type: 9, art: 'eclipse', fly: true, armored: true, sig: 'SUNBREAKER', style: 0 },
];
// Armoured machines (JUGGERNAUT, LEVIATHAN, ECLIPSE) carry plating: a third of their health again, worn down before the hull takes a scratch.
// How hard each weapon bites into armour (%): bullets ping off, shells and rockets crack it open.
export const ARMOR_PCT = 35;
export const ARMOR_BITE = { 0: 40, 1: 150, 2: 100, bomb: 150, bz: 250 };

// ---------------------------------------------------------------- upgrades
// After every war machine you destroy, HQ offers three upgrades and you keep one (each goes up to level 3).
// The offer is drawn from its own seeded stream, so the server and the chain see the same three cards.
export const UPGRADES = [
  { key: 'heavy', name: 'HEAVY ROUNDS', icon: '💥', desc: '+20% damage from every weapon, airstrike and bazooka' },
  { key: 'ap', name: 'AP SHELLS', icon: '🔩', desc: '+50% bite into armour plating' },
  { key: 'bunker', name: 'BUNKER', icon: '🧱', desc: 'War machine attacks hit your base 12% softer' },
  { key: 'orders', name: 'EXTRA ORDERS', icon: '📜', desc: '+2 moves every day' },
  { key: 'medic', name: 'REPAIR CREWS', icon: '🔧', desc: '+50% repairs from FIELD HQ (wrench) matches' },
  { key: 'dome', name: 'DOME CAPACITORS', icon: '🛡', desc: '+50% shield from shield matches' },
  { key: 'wing', name: 'AIR WING', icon: '✈', desc: '+1 airstrike now and +1 every night' },
  { key: 'cannon', name: 'FIELD CANNON', icon: '🚀', desc: '+1 bazooka rocket now and +1 every night' },
  { key: 'scope', name: 'CRIT SCOPES', icon: '🎯', desc: '+7% critical hit chance (crits do double)' },
];
export const UP_MAX = 3;
export const U = { HEAVY: 0, AP: 1, BUNKER: 2, ORDERS: 3, MEDIC: 4, DOME: 5, WING: 6, CANNON: 7, SCOPE: 8 };
export const movesPerDay = (st) => MOVES_PER_DAY + 2 * st.up[U.ORDERS];
export const critLine = (st) => 429496730 + st.up[U.SCOPE] * 300647711; // 10% + 7% a level, of 2^32
// draw up to three distinct upgrades that are not maxed out
export function makeOffer(st) {
  const avail = [];
  for (let i = 0; i < UPGRADES.length; i++) if (st.up[i] < UP_MAX) avail.push(i);
  const R = rng(0);
  R.s = st.urs;
  const offer = [];
  while (offer.length < 3 && avail.length) offer.push(avail.splice(Math.floor((R.next() * avail.length) / 4294967296), 1)[0]);
  st.urs = R.s;
  st.offer = offer.length ? offer : null;
  return st.offer;
}
// keep card k of the offer
export function pickUpgrade(st, k) {
  if (!st.offer || !(k >= 0 && k < st.offer.length)) return false;
  const id = st.offer[k];
  st.up[id]++;
  st.offer = null;
  if (id === U.ORDERS) st.moves += 2; // the extra orders arrive today
  if (id === U.WING && st.strikes < MAX_STRIKES) st.strikes++; // the first sortie is on the deck right away
  if (id === U.CANNON && st.bazooka < MAX_BAZOOKA) st.bazooka++; // and the first rocket
  return id;
}

// ---------------------------------------------------------------- seeded randomness (mulberry32, state is one int)
export function rng(seed) {
  const R = {
    s: seed >>> 0,
    next() {
      let t = (R.s = (R.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0; // uint32
    },
  };
  return R;
}
const r5 = (R) => Math.floor((R.next() * 5) / 4294967296); // exact: the product is below 2^35
export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const randomSeed = () => (Math.random() * 4294967296) >>> 0;
// Daily Op: one board per UTC day, same formula as NightwireLadder.dailySeed
export const dayNumber = (ms = Date.now()) => Math.floor(ms / 86400000);
export const dailySeed = (day) => (Number((BigInt(day) * 2654435761n + 0x5eedn) & 0xffffffffn)) >>> 0;

export const plain = (c) => ({ c, sp: null });
const NOFX = new Proxy({}, { get: () => () => {} });

// Hard (VS AI): veteran rules from stage 3 for both sides: tougher, angrier war machines
export const VETERAN = { from: 3, hpPct: 160, dmgPct: 140, extraAttacks: 2 };
const veteran = (st) => st.hard && st.stageNo >= VETERAN.from;

// Boss Forge: a player-designed war machine fought at every stage (its brain compiled from the design)
export function forgeRules(design) {
  const c = compileForge(design);
  return { design: c.design, circuit: c.circuit, netlist: c.netlist };
}
export const forgeSeed = (design) => seedFrom(`forge:${designKey(design)}`);

export function makeBoss(stageNo, hard = false, forge = null) {
  const d = forge ? { name: forge.design.name, role: 'forged war machine', color: FORGE_COLORS[forge.design.color], type: forge.design.hull } : BOSSES[(stageNo - 1) % BOSSES.length];
  const mk = Math.floor((stageNo - 1) / BOSSES.length);
  let hp = 1300; // tenths; x1.45 per stage
  for (let i = 1; i < stageNo; i++) hp = rdiv(hp * 145, 100);
  if (hard && stageNo >= VETERAN.from) hp = rdiv(hp * VETERAN.hpPct, 100);
  const armor = !forge && d.armored ? rdiv(hp * ARMOR_PCT, 100) : 0;
  return { ...d, name: mk ? `${d.name} MK ${mk + 1}` : d.name, hp, max: hp, lag: hp, armor, armorMax: armor, age: 0, brain: new Array((forge ? forge.circuit : BRAINS[d.type]).nState).fill(0), flash: 0, dying: -1, charge: 0, look: Math.PI / 2, rage: 0, present: false, recoil: 0 };
}

// ---------------------------------------------------------------- World Boss raid
// One colossal war machine a week. Everyone fights the same board; nobody can kill it alone, so every run's
// total damage counts toward one shared health pool.
export const RAID = { hp: 1_000_000_000, stage: 1, type: 8 };
export const weekNumber = (day) => Math.floor(day / 7);
export const raidSeed = (week) => (Number((BigInt(week) * 2246822519n + 0x0bade5n) & 0xffffffffn)) >>> 0;
export function makeRaidBoss() {
  return { name: 'OMEGA', role: 'world boss', color: '#FF2E4D', type: RAID.type, hp: RAID.hp, max: RAID.hp, lag: RAID.hp, armor: 0, armorMax: 0, age: 0, brain: new Array(BRAINS[RAID.type].nState).fill(0), flash: 0, dying: -1, charge: 0, look: Math.PI / 2, rage: 0, present: false, recoil: 0 };
}

export function newRun(seed, mk = plain, opts = {}) {
  const R = rng(seed), CR = rng(seed ^ 0x5bd1e995);
  const st = {
    seed, stageNo: 1, bossesDown: 0, score: 0, moves: MOVES_PER_DAY, base: BASE_MAX, baseMax: BASE_MAX, shield: 0, shieldMax: 1,
    charge: [0, 0, 0, 0, 0], ammo: [0, 0, 0], wtier: [0, 0, 0], strikes: 0, bazooka: 0, boss: makeBoss(1), cascade: 0, over: false, damage: 0,
    up: new Array(UPGRADES.length).fill(0), offer: null, urs: (seed ^ 0x2545f491) >>> 0, raid: !!opts.raid, hard: false, forge: null, // every rule flag set explicitly: the live game reuses one state object
  };
  if (opts.raid) { st.stageNo = RAID.stage; st.boss = makeRaidBoss(); }
  if (opts.hard && !opts.raid) st.hard = true;
  if (opts.forge && !opts.raid) { st.forge = forgeRules(opts.forge); st.boss = makeBoss(1, st.hard, st.forge); }
  return { st, R, CR, G: freshBoard(R, mk) };
}

// ---------------------------------------------------------------- board
export function freshBoard(R, mk = plain) {
  for (;;) {
    const G = Array.from({ length: N }, () => new Array(N).fill(null));
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      let col;
      do { col = r5(R); } while ((c >= 2 && G[r][c - 1].c === col && G[r][c - 2].c === col) || (r >= 2 && G[r - 1][c].c === col && G[r - 2][c].c === col));
      G[r][c] = mk(col, r, c, -1);
    }
    if (findMove(G)) return G;
  }
}
export function findRuns(G) {
  const runs = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N;) {
      const g = G[r][c];
      if (!g || g.c === CORE) { c++; continue; }
      let e = c + 1;
      while (e < N && G[r][e] && G[r][e].c === g.c) e++;
      if (e - c >= 3) runs.push({ dir: 'h', color: g.c, cells: Array.from({ length: e - c }, (_, j) => [r, c + j]) });
      c = e;
    }
  }
  for (let c = 0; c < N; c++) {
    for (let r = 0; r < N;) {
      const g = G[r][c];
      if (!g || g.c === CORE) { r++; continue; }
      let e = r + 1;
      while (e < N && G[e][c] && G[e][c].c === g.c) e++;
      if (e - r >= 3) runs.push({ dir: 'v', color: g.c, cells: Array.from({ length: e - r }, (_, j) => [r + j, c]) });
      r = e;
    }
  }
  return runs;
}
export function swapGrid(G, a, b) { const t = G[a[0]][a[1]]; G[a[0]][a[1]] = G[b[0]][b[1]]; G[b[0]][b[1]] = t; }
function makesMatchAt(G, r, c) {
  const g = G[r][c];
  if (!g || g.c === CORE) return false;
  const same = (y, x) => y >= 0 && y < N && x >= 0 && x < N && G[y][x] && G[y][x].c === g.c;
  let h = 1, v = 1;
  for (let x = c - 1; same(r, x); x--) h++;
  for (let x = c + 1; same(r, x); x++) h++;
  for (let y = r - 1; same(y, c); y--) v++;
  for (let y = r + 1; same(y, c); y++) v++;
  return h >= 3 || v >= 3;
}
const isJet = (g) => g.sp === 'row' || g.sp === 'col';
function validAt(G, r, c, r2, c2) {
  if (G[r][c].c === CORE || G[r2][c2].c === CORE) return true;
  if (isJet(G[r][c]) && isJet(G[r2][c2])) return true; // JET CROSS
  swapGrid(G, [r, c], [r2, c2]);
  const ok = makesMatchAt(G, r, c) || makesMatchAt(G, r2, c2);
  swapGrid(G, [r, c], [r2, c2]);
  return ok;
}
export function findMove(G) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const r2 = r + dr, c2 = c + dc;
    if (r2 < N && c2 < N && validAt(G, r, c, r2, c2)) return [[r, c], [r2, c2]];
  }
  return null;
}
export function listMoves(G) {
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
    const r2 = r + dr, c2 = c + dc;
    if (r2 < N && c2 < N && validAt(G, r, c, r2, c2)) out.push([[r, c], [r2, c2]]);
  }
  return out;
}
export function shuffle(G, R) {
  for (let tries = 0; tries < 60; tries++) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (G[r][c].c !== CORE && !G[r][c].sp) G[r][c].c = r5(R);
    if (!findRuns(G).length && findMove(G)) return;
  }
}
export const adjacent = (a, b) => a[0] >= 0 && a[0] < N && a[1] >= 0 && a[1] < N && b[0] >= 0 && b[0] < N && b[1] >= 0 && b[1] < N && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;

// After G has been swapped at a<->b: what does that swap do? null = not a legal move.
export function judgeSwap(G, a, b) {
  const ga = G[b[0]][b[1]], gb = G[a[0]][a[1]];
  if (ga.c === CORE || gb.c === CORE) { // airstrike beacon: a bomber hits every item of that kind
    const clear = new Set();
    if (ga.c === CORE && gb.c === CORE) for (let k = 0; k < N * N; k++) clear.add(k);
    else {
      const core = ga.c === CORE ? b : a, other = ga.c === CORE ? gb : ga;
      clear.add(core[0] * N + core[1]);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (G[r][c].c === other.c) clear.add(r * N + c);
      // SQUADRON: beacon + fighter jet. Every item of that kind turns into a jet and they all strafe at once
      if (other.sp === 'row' || other.sp === 'col') return { core: true, squad: other.c, clear, creates: new Map() };
    }
    return { core: true, clear, creates: new Map() };
  }
  // JET CROSS: two fighter jets swapped into each other, match or not. Both jets fly the row AND the column
  if (isJet(ga) && isJet(gb)) {
    const clear = new Set();
    for (const [r, c] of [a, b]) for (let i = 0; i < N; i++) { clear.add(r * N + i); clear.add(i * N + c); }
    return { core: false, cross: true, clear, creates: new Map() };
  }
  const runs = findRuns(G);
  if (!runs.length) return null;
  return { core: false, ...resolveRuns(G, runs, [a, b]) };
}

// SQUADRON: every plain item of that kind becomes a fighter jet (rows and columns alternating like a
// checkerboard), and the squadron earns an airstrike for the night. Call after useMove, before applyClear.
export function armSquadron(st, G, j, fx = NOFX) {
  if (j.squad === undefined) return;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const g = G[r][c]; if (g.c === j.squad && !g.sp) g.sp = (r + c) % 2 ? 'col' : 'row'; }
  addStrike(st, fx, 'A SQUADRON', null);
}

export function resolveRuns(G, runs, swapped) {
  const clear = new Set();
  const mem = new Map();
  for (const run of runs) for (const [r, c] of run.cells) {
    const key = r * N + c;
    clear.add(key);
    const m = mem.get(key) || { h: false, v: false };
    m[run.dir] = true;
    mem.set(key, m);
  }
  const creates = new Map();
  const isSwapped = (r, c) => swapped && swapped.some(([sr, sc]) => sr === r && sc === c);
  for (const run of runs) {
    const inter = run.cells.find(([r, c]) => { const m = mem.get(r * N + c); return m.h && m.v; });
    let sp = null, at = null;
    if (inter) { sp = 'bomb'; at = inter; }
    else if (run.cells.length >= 5) sp = 'core';
    else if (run.cells.length === 4) sp = run.dir === 'h' ? 'row' : 'col';
    if (!sp) continue;
    if (!at) {
      const cand = run.cells.filter(([r, c]) => !G[r][c].sp);
      at = cand.find(([r, c]) => isSwapped(r, c)) || cand[Math.floor(cand.length / 2)];
    }
    if (!at) continue;
    const key = at[0] * N + at[1];
    if (!creates.has(key)) creates.set(key, { sp, color: run.color });
  }
  for (const key of creates.keys()) clear.delete(key);
  return { clear, creates };
}

// a match of 5 also loads a bazooka: heavy rockets that open the night's fight
export const MAX_BAZOOKA = 9, BZ_FLIGHT = 600;
export const bzTime = (j) => NIGHT_START + 200 + j * 550;
function addStrike(st, fx, reason, g) {
  if (st.strikes >= MAX_STRIKES) return;
  st.strikes++;
  fx.strike(reason, g);
}

// Clear cells (setting off any specials caught in the blast), arm weapons, create new specials. Returns cells cleared.
export function applyClear(st, G, clear, creates, fx = NOFX) {
  const queue = [...clear];
  const fired = new Set();
  while (queue.length) {
    const key = queue.pop();
    const r = Math.floor(key / N), c = key % N, g = G[r][c];
    if (!g || !g.sp || fired.has(key)) continue;
    fired.add(key);
    const add = (y, x) => {
      if (y < 0 || y >= N || x < 0 || x >= N) return;
      const kk = y * N + x;
      if (creates.has(kk) || clear.has(kk)) return;
      clear.add(kk);
      queue.push(kk);
    };
    if (g.sp === 'row' || g.sp === 'col') { // fighter jet strafing run
      const h = g.sp === 'row';
      for (let i = 0; i < N; i++) (h ? add(r, i) : add(i, c));
      fx.strafe(h, r, c);
    } else if (g.sp === 'bomb') { // grenade
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(r + dy, c + dx);
      fx.grenade(r, c);
    }
  }
  const mulH = st.cascade + 1; // chain multiplier 1 + 0.5 (cascade - 1), in half-points
  let n = 0;
  for (const key of clear) {
    const g = G[Math.floor(key / N)][key % N];
    if (!g) continue;
    g.gone = true;
    n++;
    if (g.c < CORE) st.charge[g.c] += mulH;
    fx.pop(g, mulH / 2);
  }
  for (const [key, cr] of creates) {
    const g = G[Math.floor(key / N)][key % N];
    if (!g) continue;
    if (cr.sp === 'core') { g.c = CORE; g.sp = null; } else g.sp = cr.sp;
    fx.create(g, cr.sp);
    if (cr.sp === 'core') { addStrike(st, fx, 'A match of 5', g); if (st.bazooka < MAX_BAZOOKA) { st.bazooka++; fx.bazooka(g); } }
  }
  if (n) st.score += n * 10 * st.cascade;
  return n;
}

export function dropAndRefill(G, R, mk = plain) {
  for (let c = 0; c < N; c++) {
    let write = N - 1;
    for (let r = N - 1; r >= 0; r--) {
      const g = G[r][c];
      if (g && !g.gone) { G[r][c] = null; G[write][c] = g; write--; }
      else if (g) G[r][c] = null;
    }
    let spawn = 0;
    for (let r = write; r >= 0; r--) { spawn++; G[r][c] = mk(r5(R), r, c, spawn); }
  }
}

// Spend a move. A boss that holds the sky fires every 4 moves; returns that shot's damage (already applied).
export function useMove(st) {
  st.moves--;
  const b = st.boss;
  if (b && b.present && st.moves > 0 && (movesPerDay(st) - st.moves) % 4 === 0) {
    const dmg = (3 + 2 * st.stageNo + b.rage) * 10;
    const absorbed = Math.min(st.shield, dmg); // the shield stays up until it is knocked down
    st.shield -= absorbed;
    st.base = Math.max(1, st.base - (dmg - absorbed)); // daytime assaults can't finish the base: it only falls in a night battle
    return { dmg, absorbed, rest: dmg - absorbed };
  }
  return 0;
}

// After a move's chain has fully settled. Returns 'over' | 'night' | 'idle'.
export function finishTurn(st, G, R, fx = NOFX) {
  if (st.cascade >= 3) { fx.chain(st.cascade); addStrike(st, fx, `A ${st.cascade}x chain`, null); }
  st.cascade = 0;
  if (st.base <= 0) { st.over = true; return 'over'; }
  if (st.moves <= 0) return 'night';
  if (!findMove(G)) { shuffle(G, R); fx.shuffle(); }
  return 'idle';
}

// Play one whole move instantly (AI, ghosts, verifier). null = illegal move.
export function playMove(run, a, b, fx = NOFX, mk = plain) {
  const { st, G, R } = run;
  if (st.over || st.offer || st.moves <= 0 || !adjacent(a, b)) return null;
  swapGrid(G, a, b);
  const j = judgeSwap(G, a, b);
  if (!j) { swapGrid(G, a, b); return null; }
  const shot = useMove(st);
  st.cascade = 1;
  armSquadron(st, G, j, fx);
  let cleared = applyClear(st, G, j.clear, j.creates, fx);
  for (;;) {
    dropAndRefill(G, R, mk);
    const runs = findRuns(G);
    if (!runs.length) break;
    st.cascade++;
    const rr = resolveRuns(G, runs, null);
    cleared += applyClear(st, G, rr.clear, rr.creates, fx);
  }
  const chain = st.cascade;
  return { status: finishTurn(st, G, R, fx), shot, chain, cleared, core: j.core, squad: j.squad !== undefined, cross: !!j.cross };
}

// ---------------------------------------------------------------- night
// Turn the day's munitions into weapons and lay out the fight's timeline.
export function planNight(st) {
  const mulP = rdiv((100 + 12 * (st.stageNo - 1)) * (100 + 20 * st.up[U.HEAVY]), 100); // percent
  for (let i = 0; i < 3; i++) {
    st.ammo[i] = Math.floor(st.charge[i] / 6); // 3 points (6 half-points) per shot
    st.charge[i] -= st.ammo[i] * 6;
    st.wtier[i] = tierOf(i, st.ammo[i]);
  }
  const shieldPts = st.charge[3]; // 2 shield per point = 1 per half-point
  st.shield = Math.min(BASE_MAX, st.shield + rdiv(rdiv(shieldPts * TIER_PCT[tierOf(3, shieldPts)], 100) * (100 + 50 * st.up[U.DOME]), 100) * 10); // stacks on what is left
  st.charge[3] = 0;
  const repTier = tierOf(4, Math.floor(st.charge[4] / 2));
  const repair = rdiv(rdiv(st.charge[4] * TIER_PCT[repTier], 200) * (100 + 50 * st.up[U.MEDIC]), 100) * 10; // the medics' pool: they patch up hits as they land
  st.shieldMax = Math.max(1, st.shield);
  st.charge[4] = 0;
  const bz = Math.min(MAX_BAZOOKA, st.bazooka + st.up[U.CANNON]), bzDmg = rdiv(600 * mulP, 100);
  st.bazooka = 0;
  st.strikes = Math.min(MAX_STRIKES, st.strikes + st.up[U.WING]);
  const shots = [];
  const left = st.ammo.slice();
  while (left.some((n) => n > 0)) for (let w = 0; w < 3; w++) if (left[w] > 0) { left[w]--; shots.push(w); }
  const spacing = shots.length ? Math.max(160, Math.min(420, Math.floor(7000 / shots.length))) : 0;
  const events = shots.map((w, j) => ({ t: NIGHT_START + j * spacing, kind: w, dmg: rdiv([50, 80, 26][w] * mulP * TIER_PCT[st.wtier[w]], 10000) }));
  const rage = st.boss.rage;
  const attacks = 4 + st.stageNo + rage + (veteran(st) ? VETERAN.extraAttacks : 0);
  let bossDmg = rdiv((6 + 3 * (st.stageNo - 1)) * 10 * (4 + rage), 4);
  if (veteran(st)) bossDmg = rdiv(bossDmg * VETERAN.dmgPct, 100);
  bossDmg = rdiv(bossDmg * (100 - 12 * st.up[U.BUNKER]), 100);
  const dur = Math.max(4500, shots.length * spacing + 500); // the war machine fights back while the arsenal fires
  for (let j = 0; j < attacks; j++) events.push({ t: NIGHT_START + 600 + Math.floor((j * dur) / attacks), kind: 'boss', dmg: bossDmg });
  events.sort((x, y) => x.t - y.t);
  events.forEach((e, i) => { e.id = i; });
  return {
    events, repair, bz, bzDmg, mulP, wtier: st.wtier.slice(), ammo: st.ammo.slice(), base: st.base, baseMax: st.baseMax, shield: st.shield, hp: st.boss.hp, armor: st.boss.armor || 0, score: st.score, strikes: st.strikes,
    max: st.boss.max, rage, type: st.boss.type, brain: st.boss.brain.slice(), bossDmg, circuit: st.forge ? st.forge.circuit : null,
    critLine: critLine(st), apPct: 100 + 50 * st.up[U.AP],
  };
}

// Hit timings per weapon (seconds after firing) and how a shot's damage splits across its projectiles.
export function volley(w, tier, dmg) { // delay and flight in ms
  if (w === 0) { const n = [4, 6, 9][tier]; return Array.from({ length: n }, (_, j) => ({ delay: j * 35, d: 160, dmg: rdiv(dmg * 16, n * 10) })); }
  if (w === 1) { const n = tier === 2 ? 3 : 1; return Array.from({ length: n }, (_, j) => ({ delay: j * 100, d: tier === 0 ? 700 : 500, dmg: n > 1 ? rdiv(dmg * 13, n * 10) : dmg })); }
  const n = [2, 3, 4][tier];
  return Array.from({ length: n }, (_, j) => ({ delay: j * 80, d: 750, dmg: rdiv(dmg * 3, n) }));
}
// Rules: a volley lands as ONE hit (all its damage, when its first projectile arrives); crits are per volley.
export function volleyHit(w, tier, dmg) {
  const v = volley(w, tier, dmg);
  return { at: v[0].delay + v[0].d, dmg: v.reduce((sum, x) => sum + x.dmg, 0) };
}
export const BOMB = (j) => ({ delay: 150 + j * 90, d: 380 });
export const STRIKE_LAND = 530; // ms after the call: the first bomb lands
export const BOSS_AIM = 380, BOSS_FLIGHT = 700;
export const MEDIC_PCT = 60; // medics patch up to 60% of each hit that gets through, while their pool lasts

// Resolve the whole fight from the plan and the airstrike call times. crState = crit RNG state at nightfall.
export function simNight(plan, strikes, crState) {
  const CR = rng(0);
  CR.s = crState;
  const items = [];
  let q = 0;
  const push = (t, o) => { o.t = t; o.q = q++; items.push(o); };
  for (const ev of plan.events) {
    if (ev.kind === 'boss') {
      push(ev.t, { type: 'bfire', id: ev.id });
      push(ev.t + BOSS_AIM, { type: 'blaunch', id: ev.id });
      push(ev.t + BOSS_AIM + BOSS_FLIGHT, { type: 'bhit', id: ev.id, dmg: ev.dmg });
      continue;
    }
    const tier = plan.wtier[ev.kind];
    push(ev.t, { type: 'fire', w: ev.kind, tier, id: ev.id });
    const vh = volleyHit(ev.kind, tier, ev.dmg);
    push(ev.t + vh.at, { type: 'hit', src: ev.kind, dmg: vh.dmg, id: ev.id });
  }
  for (let j = 0; j < plan.bz; j++) {
    push(bzTime(j), { type: 'bzfire', j });
    push(bzTime(j) + BZ_FLIGHT, { type: 'hit', src: 'bz', dmg: plan.bzDmg, j });
  }
  // the onslaught: after its regular attacks, a war machine still standing unleashes its signature weapon
  let lastHit = NIGHT_START + 1200;
  for (const ev of plan.events) lastHit = Math.max(lastHit, ev.kind === 'boss' ? ev.t + BOSS_AIM + BOSS_FLIGHT : ev.t + volleyHit(ev.kind, plan.wtier[ev.kind], 0).at);
  for (let j = 0; j < plan.bz; j++) lastHit = Math.max(lastHit, bzTime(j) + BZ_FLIGHT);
  const slamAt = lastHit + 600; // after its regular attacks
  const slamDmg = rdiv(plan.bossDmg * 6, 10);
  for (let k = 0; k < ONSLAUGHT_HITS; k++) {
    push(slamAt + k * 160 - 450, { type: 'slamfire', k }); // visual only: launch
    push(slamAt + k * 160, { type: 'slam', dmg: slamDmg, k });
  }
  strikes.forEach((ts, sid) => {
    push(ts, { type: 'strike', sid });
    push(ts + STRIKE_LAND, { type: 'hit', src: 'bomb', dmg: 3 * rdiv(160 * plan.mulP, 100), sid });
  });
  items.sort((x, y) => x.t - y.t || x.q - y.q);

  let armor = plan.armor || 0, hp = plan.hp, base = plan.base, shield = plan.shield, score = plan.score, left = plan.strikes, dead = false, over = false, killT = -1;
  let brain = plan.brain.slice(), damage = 0, pool = plan.repair;
  const patchUp = (rest) => { const p = Math.min(pool, rdiv(rest * MEDIC_PCT, 100)); pool -= p; return p; };
  const circuit = plan.circuit || BRAINS[plan.type];
  const act = {};
  const live = new Set();
  const out = [];
  for (const it of items) {
    if (over) break;
    if (it.type === 'strike') {
      if (dead || left <= 0) continue;
      left--;
      live.add(it.sid);
      out.push({ ...it, strikes: left });
    } else if (it.type === 'hit') {
      if (dead || (it.sid !== undefined && !live.has(it.sid))) continue;
      const crit = CR.next() < plan.critLine; // 10%, more with crit scopes
      let d = it.dmg * (crit ? 2 : 1), ad = 0;
      if (armor > 0) { // armour first, scaled by how hard this weapon bites; a breaking hit spills into the hull
        const bite = rdiv(ARMOR_BITE[it.src] * plan.apPct, 100), eff = rdiv(d * bite, 100);
        if (eff <= armor) { armor -= eff; ad = eff; d = 0; } else { ad = armor; d = rdiv((eff - armor) * 100, bite); armor = 0; }
      }
      hp = Math.max(0, hp - d);
      damage += ad + d;
      score += rdiv(ad + d, 5); // 2 points per HP (armour counts)
      out.push({ ...it, d, ad, armor, crit, hp, score });
      if (hp <= 0) { dead = true; killT = it.t; out.push({ t: it.t, type: 'kill' }); }
    } else if (it.type === 'bfire') { // the boss steps its brain chip to choose this attack
      if (dead) continue;
      const r = chipBeat(circuit, brain, brainInputs(hp, plan.max, base, plan.baseMax, shield, plan.rage));
      brain = r.state;
      act[it.id] = r.outputs[0] + 2 * r.outputs[1];
      out.push({ ...it, action: act[it.id], brain: brain.slice() });
    } else if (it.type === 'bhit') {
      if (dead) continue;
      const action = act[it.id] || 0;
      if (action === 3) { // field repair instead of attacking
        hp = Math.min(plan.max, hp + rdiv(plan.max * 8, 100));
        out.push({ ...it, action, hp, absorbed: 0, rest: 0, shield, base });
        continue;
      }
      let absorbed, rest;
      if (action === 2) { absorbed = shield; shield = 0; rest = rdiv(it.dmg * 4, 10); } // EMP: shield knocked out
      else {
        const dmg = action === 1 ? rdiv(it.dmg * 18, 10) : it.dmg;
        absorbed = Math.min(shield, dmg);
        shield -= absorbed;
        rest = dmg - absorbed;
      }
      const patch = patchUp(rest);
      rest -= patch;
      base = Math.max(0, base - rest);
      out.push({ ...it, action, absorbed, rest, patch, pool, shield, base });
      if (base <= 0) { over = true; out.push({ t: it.t, type: 'over' }); }
    } else if (it.type === 'slam') {
      if (dead) continue;
      const absorbed = Math.min(shield, it.dmg);
      shield -= absorbed;
      const patch = patchUp(it.dmg - absorbed);
      const rest = it.dmg - absorbed - patch;
      base = Math.max(0, base - rest);
      out.push({ ...it, absorbed, rest, patch, pool, shield, base });
      if (base <= 0) { over = true; out.push({ t: it.t, type: 'over' }); }
    } else if (it.type === 'blaunch') { if (!dead) out.push({ ...it, action: act[it.id] || 0 }); }
    else if (!dead) out.push(it); // fire
  }
  // the medics' leftover pool repairs the base; whatever the base can't use reinforces the dome
  if (!over && pool > 0) {
    const heal = Math.min(plan.baseMax - base, pool);
    base += heal;
    shield = Math.min(BASE_MAX, shield + pool - heal);
    out.push({ t: out.length ? out[out.length - 1].t : NIGHT_START, type: 'heal', v: heal, dome: pool - heal, base, shield });
    pool = 0;
  }
  // destroyed before the whole arsenal fired: the unfired shots go back to the arsenal (6 half-points each)
  const refund = [0, 0, 0];
  let bzBack = 0;
  if (dead) {
    for (const ev of plan.events) if (ev.kind !== 'boss' && ev.t > killT) refund[ev.kind] += 6;
    for (let j = 0; j < plan.bz; j++) if (bzTime(j) > killT) bzBack++; // unfired rockets go back too
  }
  return {
    entries: out, outcome: over ? 'over' : dead ? 'kill' : 'hold', killT, refund, bzBack, damage,
    lastT: out.length ? out[out.length - 1].t : NIGHT_START, hp, armor, base, shield, score, strikes: left, crEnd: CR.s, brain,
  };
}

export function finishNight(run, script) {
  const st = run.st;
  st.boss.hp = script.hp;
  st.boss.armor = script.armor;
  st.base = script.base;
  st.shield = script.shield;
  st.score = script.score;
  st.strikes = script.strikes;
  st.boss.brain = script.brain;
  st.damage += script.damage;
  st.ammo = [0, 0, 0];
  if (script.outcome === 'kill') { for (let w = 0; w < 3; w++) st.charge[w] += script.refund[w]; st.bazooka += script.bzBack; }
  run.CR.s = script.crEnd;
  if (script.outcome === 'over') st.over = true;
  return script.outcome;
}
export function bossDefeated(st) { const bonus = 500 * st.stageNo; st.score += bonus; st.bossesDown++; return bonus; }
export function nextStage(st) { st.stageNo++; st.base = Math.min(st.baseMax, st.base + 300); st.boss = makeBoss(st.stageNo, st.hard, st.forge); }
export function bossHolds(st) { st.boss.present = true; st.boss.rage++; }
export function startDay(run) {
  run.st.moves = movesPerDay(run.st); // the shield is kept
  if (!findMove(run.G)) { shuffle(run.G, run.R); return true; }
  return false;
}

// Whole night in one go (AI, ghosts, verifier). Returns the script.
export function runNight(run, strikes) {
  const plan = planNight(run.st);
  const script = simNight(plan, strikes, run.CR.s);
  const out = finishNight(run, script);
  if (out === 'kill') { bossDefeated(run.st); nextStage(run.st); startDay(run); makeOffer(run.st); }
  else if (out === 'hold') { bossHolds(run.st); startDay(run); }
  return script;
}

// ---------------------------------------------------------------- replay log + verifier
// A move is "r1c1r2c2" (e.g. "3435"); a night is "N" followed by airstrike call times in ms ("N2410|3070").
export const encodeMove = (a, b) => `${a[0]}${a[1]}${b[0]}${b[1]}`;
export const encodeNight = (strikes) => `N${strikes.join('|')}`;
export const encodePick = (k) => `U${k}`;
export function parseAction(s) {
  if (s[0] === 'N') return { night: true, strikes: s.length > 1 ? s.slice(1).split('|').map(Number) : [] };
  if (s[0] === 'U') return { pick: +s.slice(1) };
  return { night: false, a: [+s[0], +s[1]], b: [+s[2], +s[3]] };
}
export function replay(seed, actions, opts = {}) {
  const run = newRun(seed, plain, opts);
  for (let i = 0; i < actions.length; i++) {
    if (run.st.over) return { ok: false, reason: `action ${i} after the base fell`, st: run.st };
    const act = parseAction(actions[i]);
    if (act.pick !== undefined) {
      if (pickUpgrade(run.st, act.pick) === false) return { ok: false, reason: `no upgrade ${act.pick} on offer at ${i}`, st: run.st };
    } else if (act.night) {
      if (run.st.moves > 0 || run.st.offer) return { ok: false, reason: `night ${i} before the moves ran out`, st: run.st };
      runNight(run, act.strikes);
    } else if (!playMove(run, act.a, act.b)) return { ok: false, reason: `illegal move ${actions[i]} at ${i}`, st: run.st };
  }
  return { ok: true, st: run.st };
}

// Compact binary form of a replay log, as the Solidity verifier reads it (see NightwireEngine.sol).
export function encodeBinary(actions) {
  const out = [];
  for (const s of actions) {
    const a = parseAction(s);
    if (a.pick !== undefined) out.push(0xc0 | a.pick);
    else if (a.night) {
      out.push(0x80 | a.strikes.length);
      for (const t of a.strikes) out.push((t >> 8) & 255, t & 255);
    } else {
      const ka = a.a[0] * 8 + a.a[1], kb = a.b[0] * 8 + a.b[1];
      const lo = Math.min(ka, kb), hi = Math.max(ka, kb);
      out.push(lo * 2 + (hi - lo === 1 ? 0 : 1));
    }
  }
  return `0x${out.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
