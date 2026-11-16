// Nightwire rules engine. Pure and deterministic, no DOM: the same seed and the same actions always give
// the same game. The live game, the AI rival, friend duels and the score verifier all run on this file.

export const N = 8;
export const CORE = 5; // airstrike beacon
export const MOVES_PER_DAY = 14;
export const MAX_STRIKES = 5;
export const BASE_MAX = 100;
export const TIER_MUL = [1, 1.25, 1.6];
export const NIGHT_START = 2.0;
// tier thresholds: shots for guns, points for shield/repair
export const tierOf = (i, v) => (i < 3 ? (v >= 10 ? 2 : v >= 5 ? 1 : 0) : i === 3 ? (v >= 40 ? 2 : v >= 20 ? 1 : 0) : (v >= 16 ? 2 : v >= 8 ? 1 : 0));
export const BOSSES = [
  { name: 'IRONCLAW', role: 'assault mech', color: '#E0703F', type: 0 },
  { name: 'STORMWING', role: 'attack gunship', color: '#9B8CFF', type: 1 },
  { name: 'DREADNOUGHT', role: 'armoured airship', color: '#45B4E8', type: 2 },
  { name: 'HIVE CARRIER', role: 'drone carrier', color: '#FF4FD8', type: 3 },
];

// ---------------------------------------------------------------- seeded randomness (mulberry32, state is one int)
export function rng(seed) {
  const R = {
    s: seed >>> 0,
    next() {
      let t = (R.s = (R.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
  return R;
}
const r5 = (R) => Math.floor(R.next() * 5);
export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const randomSeed = () => (Math.random() * 4294967296) >>> 0;

export const plain = (c) => ({ c, sp: null });
const NOFX = new Proxy({}, { get: () => () => {} });

export function makeBoss(stageNo) {
  const d = BOSSES[(stageNo - 1) % BOSSES.length];
  const mk = Math.floor((stageNo - 1) / BOSSES.length);
  const hp = Math.round(130 * 1.42 ** (stageNo - 1));
  return { ...d, name: mk ? `${d.name} MK ${mk + 1}` : d.name, hp, max: hp, lag: hp, flash: 0, dying: -1, charge: 0, look: Math.PI / 2, rage: 0, present: false, recoil: 0 };
}

export function newRun(seed, mk = plain) {
  const R = rng(seed), CR = rng(seed ^ 0x5bd1e995);
  const st = {
    seed, stageNo: 1, bossesDown: 0, score: 0, moves: MOVES_PER_DAY, base: BASE_MAX, baseMax: BASE_MAX, shield: 0, shieldMax: 1,
    charge: [0, 0, 0, 0, 0], ammo: [0, 0, 0], wtier: [0, 0, 0], strikes: 0, boss: makeBoss(1), cascade: 0, over: false,
  };
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
function validAt(G, r, c, r2, c2) {
  if (G[r][c].c === CORE || G[r2][c2].c === CORE) return true;
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
    }
    return { core: true, clear, creates: new Map() };
  }
  const runs = findRuns(G);
  if (!runs.length) return null;
  return { core: false, ...resolveRuns(G, runs, [a, b]) };
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
  const mul = 1 + 0.5 * (st.cascade - 1);
  let n = 0;
  for (const key of clear) {
    const g = G[Math.floor(key / N)][key % N];
    if (!g) continue;
    g.gone = true;
    n++;
    if (g.c < CORE) st.charge[g.c] += mul;
    fx.pop(g, mul);
  }
  for (const [key, cr] of creates) {
    const g = G[Math.floor(key / N)][key % N];
    if (!g) continue;
    if (cr.sp === 'core') { g.c = CORE; g.sp = null; } else g.sp = cr.sp;
    fx.create(g, cr.sp);
    if (cr.sp === 'core') addStrike(st, fx, 'A match of 5', g);
  }
  if (n) st.score += Math.round(n * 10 * st.cascade);
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
  if (b && b.present && st.moves > 0 && (MOVES_PER_DAY - st.moves) % 4 === 0) {
    const dmg = 3 + 2 * st.stageNo + b.rage;
    st.base = Math.max(0, st.base - dmg);
    return dmg;
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
  if (st.over || st.moves <= 0 || !adjacent(a, b)) return null;
  swapGrid(G, a, b);
  const j = judgeSwap(G, a, b);
  if (!j) { swapGrid(G, a, b); return null; }
  const shot = useMove(st);
  st.cascade = 1;
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
  return { status: finishTurn(st, G, R, fx), shot, chain, cleared, core: j.core };
}

// ---------------------------------------------------------------- night
// Turn the day's munitions into weapons and lay out the fight's timeline.
export function planNight(st) {
  const mul = 1 + 0.12 * (st.stageNo - 1);
  for (let i = 0; i < 3; i++) {
    st.ammo[i] = Math.floor(st.charge[i] / 3);
    st.charge[i] -= st.ammo[i] * 3;
    st.wtier[i] = tierOf(i, st.ammo[i]);
  }
  const shieldTier = tierOf(3, Math.round(st.charge[3] * 2));
  st.shield = Math.round(st.charge[3] * 2 * TIER_MUL[shieldTier]);
  st.shieldMax = Math.max(1, st.shield);
  st.charge[3] = 0;
  const repTier = tierOf(4, st.charge[4]);
  const heal = Math.min(st.baseMax - st.base, Math.round(st.charge[4] * TIER_MUL[repTier]));
  st.charge[4] = 0;
  const shots = [];
  const left = st.ammo.slice();
  while (left.some((n) => n > 0)) for (let w = 0; w < 3; w++) if (left[w] > 0) { left[w]--; shots.push(w); }
  const spacing = shots.length ? Math.max(0.16, Math.min(0.42, 7 / shots.length)) : 0;
  const events = shots.map((w, j) => ({ t: NIGHT_START + j * spacing, kind: w, dmg: [5, 8, 2.6][w] * mul * TIER_MUL[st.wtier[w]] }));
  const dur = Math.max(4.5, shots.length * spacing + 0.5);
  const rage = st.boss.rage;
  const attacks = 4 + st.stageNo + rage;
  const bossDmg = (6 + 3 * (st.stageNo - 1)) * (1 + 0.25 * rage);
  for (let j = 0; j < attacks; j++) events.push({ t: NIGHT_START + 0.6 + (j * dur) / attacks, kind: 'boss', dmg: bossDmg });
  events.sort((x, y) => x.t - y.t);
  events.forEach((e, i) => { e.id = i; });
  return { events, heal, mul, wtier: st.wtier.slice(), ammo: st.ammo.slice(), base: st.base, shield: st.shield, hp: st.boss.hp, score: st.score, strikes: st.strikes };
}

// Hit timings per weapon (seconds after firing) and how a shot's damage splits across its projectiles.
export function volley(w, tier, dmg) {
  if (w === 0) { const n = [4, 6, 9][tier]; return Array.from({ length: n }, (_, j) => ({ delay: j * 0.035, d: 0.16, dmg: (dmg / n) * 1.6 })); }
  if (w === 1) { const n = tier === 2 ? 3 : 1; return Array.from({ length: n }, (_, j) => ({ delay: j * 0.1, d: tier === 0 ? 0.7 : 0.5, dmg: (dmg / n) * (n > 1 ? 1.3 : 1) })); }
  const n = [2, 3, 4][tier];
  return Array.from({ length: n }, (_, j) => ({ delay: j * 0.08, d: 0.75, dmg: (dmg * 3) / n }));
}
export const BOMB = (j) => ({ delay: 0.15 + j * 0.09, d: 0.38 });
export const BOSS_AIM = 0.38, BOSS_FLIGHT = 0.7;

// Resolve the whole fight from the plan and the airstrike call times. crState = crit RNG state at nightfall.
export function simNight(plan, strikes, crState) {
  const CR = rng(0);
  CR.s = crState;
  const items = [];
  let q = 0;
  const push = (t, o) => { o.t = t; o.q = q++; items.push(o); };
  if (plan.heal > 0) push(1.2, { type: 'heal', v: plan.heal });
  for (const ev of plan.events) {
    if (ev.kind === 'boss') {
      push(ev.t, { type: 'bfire', id: ev.id });
      push(ev.t + BOSS_AIM, { type: 'blaunch', id: ev.id });
      push(ev.t + BOSS_AIM + BOSS_FLIGHT, { type: 'bhit', id: ev.id, dmg: ev.dmg });
      continue;
    }
    const tier = plan.wtier[ev.kind];
    push(ev.t, { type: 'fire', w: ev.kind, tier, id: ev.id });
    volley(ev.kind, tier, ev.dmg).forEach((v, j) => push(ev.t + v.delay + v.d, { type: 'hit', src: ev.kind, dmg: v.dmg, id: ev.id, j }));
  }
  strikes.forEach((ts, sid) => {
    push(ts, { type: 'strike', sid });
    for (let j = 0; j < 3; j++) push(ts + BOMB(j).delay + BOMB(j).d, { type: 'hit', src: 'bomb', dmg: 16 * plan.mul, sid, j });
  });
  items.sort((x, y) => x.t - y.t || x.q - y.q);

  let hp = plan.hp, base = plan.base, shield = plan.shield, score = plan.score, left = plan.strikes, dead = false, over = false, killT = -1;
  const live = new Set();
  const out = [];
  for (const it of items) {
    if (over) break;
    if (it.type === 'heal') { base += it.v; out.push({ ...it, base }); }
    else if (it.type === 'strike') {
      if (dead || left <= 0) continue;
      left--;
      live.add(it.sid);
      out.push({ ...it, strikes: left });
    } else if (it.type === 'hit') {
      if (dead || (it.sid !== undefined && !live.has(it.sid))) continue;
      const crit = CR.next() < 0.1;
      const d = Math.round(it.dmg * (crit ? 2 : 1) * 10) / 10;
      hp = Math.max(0, hp - d);
      score += Math.round(d * 2);
      out.push({ ...it, d, crit, hp, score });
      if (hp <= 0) { dead = true; killT = it.t; out.push({ t: it.t, type: 'kill' }); }
    } else if (it.type === 'bhit') {
      if (dead) continue;
      const absorbed = Math.min(shield, it.dmg);
      shield -= absorbed;
      const rest = it.dmg - absorbed;
      base = Math.max(0, base - rest);
      out.push({ ...it, absorbed, rest, shield, base });
      if (base <= 0) { over = true; out.push({ t: it.t, type: 'over' }); }
    } else if (!dead) out.push(it); // fire, bfire, blaunch
  }
  return {
    entries: out, outcome: over ? 'over' : dead ? 'kill' : 'hold', killT,
    lastT: out.length ? out[out.length - 1].t : NIGHT_START, hp, base, shield, score, strikes: left, crEnd: CR.s,
  };
}

export function finishNight(run, script) {
  const st = run.st;
  st.boss.hp = script.hp;
  st.base = script.base;
  st.shield = script.shield;
  st.score = script.score;
  st.strikes = script.strikes;
  st.ammo = [0, 0, 0];
  run.CR.s = script.crEnd;
  if (script.outcome === 'over') st.over = true;
  return script.outcome;
}
export function bossDefeated(st) { const bonus = 500 * st.stageNo; st.score += bonus; st.bossesDown++; return bonus; }
export function nextStage(st) { st.stageNo++; st.base = Math.min(st.baseMax, st.base + 30); st.boss = makeBoss(st.stageNo); }
export function bossHolds(st) { st.boss.present = true; st.boss.rage++; }
export function startDay(run) {
  run.st.moves = MOVES_PER_DAY;
  run.st.shield = 0;
  if (!findMove(run.G)) { shuffle(run.G, run.R); return true; }
  return false;
}

// Whole night in one go (AI, ghosts, verifier). Returns the script.
export function runNight(run, strikes) {
  const plan = planNight(run.st);
  const script = simNight(plan, strikes, run.CR.s);
  const out = finishNight(run, script);
  if (out === 'kill') { bossDefeated(run.st); nextStage(run.st); startDay(run); }
  else if (out === 'hold') { bossHolds(run.st); startDay(run); }
  return script;
}

// ---------------------------------------------------------------- replay log + verifier
// A move is "r1c1r2c2" (e.g. "3435"); a night is "N" followed by airstrike call times ("N2.41|3.07").
export const encodeMove = (a, b) => `${a[0]}${a[1]}${b[0]}${b[1]}`;
export const encodeNight = (strikes) => `N${strikes.map((t) => t.toFixed(2)).join('|')}`;
export function parseAction(s) {
  if (s[0] === 'N') return { night: true, strikes: s.length > 1 ? s.slice(1).split('|').map(Number) : [] };
  return { night: false, a: [+s[0], +s[1]], b: [+s[2], +s[3]] };
}
export function replay(seed, actions) {
  const run = newRun(seed);
  for (let i = 0; i < actions.length; i++) {
    if (run.st.over) return { ok: false, reason: `action ${i} after the base fell`, st: run.st };
    const act = parseAction(actions[i]);
    if (act.night) {
      if (run.st.moves > 0) return { ok: false, reason: `night ${i} before the moves ran out`, st: run.st };
      runNight(run, act.strikes);
    } else if (!playMove(run, act.a, act.b)) return { ok: false, reason: `illegal move ${actions[i]} at ${i}`, st: run.st };
  }
  return { ok: true, st: run.st };
}
