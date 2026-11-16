// The rival commander: an AI (easy / normal / hard) or a friend's recorded run replayed as a ghost.
// It plays the exact same battlefield (seed) as you, in real time, on the shared rules engine.
import * as E from './engine.js';

export const LEVELS = {
  easy: { label: 'EASY', pace: 2.4 },
  normal: { label: 'NORMAL', pace: 1.7 },
  hard: { label: 'HARD', pace: 1.3 },
  ghost: { label: 'FRIEND', pace: 1.6 },
};

function cloneRun(run) {
  const st = run.st;
  return {
    st: { ...st, charge: st.charge.slice(), ammo: st.ammo.slice(), wtier: st.wtier.slice(), boss: { ...st.boss } },
    G: run.G.map((row) => row.map((g) => ({ c: g.c, sp: g.sp }))),
    R: E.rng(E.randomSeed()), // the AI can't see future supplies
    CR: E.rng(run.CR.s),
  };
}

// How much a finished move helped, judged by what the base needs right now.
function value(before, after, smart) {
  const s0 = before.st, s1 = after.st;
  const d = s1.charge.map((v, i) => v - s0.charge[i]);
  let v = d[0] + d[1] * 1.15 + d[2] * 1.1 + (s1.strikes - s0.strikes) * 7 + (s1.score - s0.score) * 0.004;
  const hurt = 1 - s0.base / s0.baseMax;
  if (!smart) return v + d[3] * 0.8 + d[4] * 0.5;
  const threat = (4 + s0.stageNo + s0.boss.rage) * (6 + 3 * (s0.stageNo - 1)) * (1 + 0.25 * s0.boss.rage) * 10;
  v += d[3] * (0.4 + Math.min(1.4, threat / Math.max(20, s0.base) * 0.6));
  v += d[4] * (0.1 + hurt * 2.2);
  let sp = 0;
  for (const row of after.G) for (const g of row) if (g.sp || g.c === E.CORE) sp++;
  return v + sp * 1.6 + (s1.base <= 0 ? -999 : 0);
}

export function makeRival(seed, level, ghostActions = null, opts = {}) {
  const run = E.newRun(seed, E.plain, opts);
  const cfg = LEVELS[level];
  const R = {
    run, level, label: cfg.label, phase: 'day', timer: 1.4, night: null, flash: [], ev: [], log: [], dirty: true,
    actions: ghostActions ? ghostActions.slice() : null, finished: false,
    get st() { return run.st; },
  };

  function emit(type, extra = {}) { R.ev.push({ type, ...extra }); }

  // thinking is a generator that yields after each candidate, so the game can spread it over frames
  function* thinkMove() {
    const moves = E.listMoves(run.G);
    if (!moves.length) return null;
    if (level === 'easy') return moves[Math.floor(Math.random() * moves.length)];
    const smart = level === 'hard';
    const scored = [];
    for (const m of moves) {
      const sim = cloneRun(run);
      if (!E.playMove(sim, m[0], m[1])) continue;
      scored.push({ m, v: value(run, sim, smart) + Math.random() * 0.5 });
      yield;
    }
    if (!scored.length) return null;
    scored.sort((x, y) => y.v - x.v);
    if (!smart) return scored[0].m;
    // hard: re-judge the best few over several possible refills
    let best = scored[0].m, bv = -Infinity;
    for (const { m, v } of scored.slice(0, 5)) {
      let tot = v;
      for (let k = 0; k < 3; k++) { const sim = cloneRun(run); E.playMove(sim, m[0], m[1]); tot += value(run, sim, true); yield; }
      if (tot > bv) { bv = tot; best = m; }
    }
    return best;
  }

  function chooseMove() { // all at once (fast-forward)
    const it = thinkMove();
    for (;;) { const r = it.next(); if (r.done) return r.value; }
  }
  let thinking = null, planned;
  function think(budgetMs) { // a few milliseconds per frame until the move is chosen
    if (!thinking) { thinking = thinkMove(); planned = undefined; }
    const t0 = performance.now();
    while (planned === undefined && performance.now() - t0 < budgetMs) {
      const r = thinking.next();
      if (r.done) planned = r.value;
    }
    return planned !== undefined;
  }

  function chooseStrikes(plan) {
    const have = run.st.strikes;
    if (!have) return [];
    const at = (k) => Array.from({ length: k }, (_, j) => 2400 + j * 600);
    if (level === 'easy') return Math.random() < 0.35 ? [3100] : [];
    if (level === 'normal') return at(have);
    for (let k = 0; k <= have; k++) if (E.simNight(plan, at(k), run.CR.s).outcome === 'kill') return at(k);
    return at(have);
  }

  function doMove() {
    let a, b;
    if (R.actions) {
      const s = R.actions.shift();
      if (!s || s[0] === 'N') { R.phase = 'over'; R.finished = true; return; }
      const act = E.parseAction(s);
      a = act.a; b = act.b;
    } else {
      const m = planned !== undefined ? planned : chooseMove();
      thinking = null; planned = undefined;
      if (!m) { R.phase = 'over'; R.finished = true; return; }
      [a, b] = m;
    }
    const before = run.G.map((row) => row.map((g) => g));
    const res = E.playMove(run, a, b);
    if (!res) { R.phase = 'over'; R.finished = true; return; }
    R.log.push(E.encodeMove(a, b));
    R.flash = [];
    for (let r = 0; r < E.N; r++) for (let c = 0; c < E.N; c++) if (before[r][c].gone) R.flash.push([r, c, 0.35]);
    R.dirty = true;
    if (res.shot) emit('hit', { dmg: res.shot });
    if (res.chain >= 3) emit('chain', { n: res.chain });
    if (res.core) emit('bomber');
    if (res.status === 'over') { R.phase = 'over'; R.finished = true; emit('fell'); }
    else if (res.status === 'night') beginNight();
  }

  function beginNight() {
    const st = run.st;
    const plan = E.planNight(st);
    let strikes;
    if (R.actions) {
      const s = R.actions.shift();
      strikes = s && s[0] === 'N' ? E.parseAction(s).strikes : [];
    } else strikes = chooseStrikes(plan);
    const script = E.simNight(plan, strikes, run.CR.s);
    R.log.push(E.encodeNight(script.entries.filter((e) => e.type === 'strike').map((e) => e.t)));
    const end = script.outcome === 'kill' ? script.killT + 2200 : script.outcome === 'over' ? script.lastT + 600 : script.lastT + 900; // ms
    R.night = { script, t: 0, i: 0, end, hp: plan.hp, base: st.base };
    R.phase = 'night';
    R.dirty = true;
    if (strikes.length) emit('strike', { n: strikes.length });
  }

  function endNight() {
    const st = run.st, script = R.night.script;
    const name = st.boss.name;
    const out = E.finishNight(run, script);
    R.night = null;
    if (out === 'kill') { E.bossDefeated(st); E.nextStage(st); E.startDay(run); emit('kill', { name }); }
    else if (out === 'hold') { E.bossHolds(st); E.startDay(run); }
    else { R.phase = 'over'; R.finished = true; emit('fell'); return; }
    R.phase = 'day';
    R.timer = cfg.pace + 0.8;
    R.dirty = true;
  }

  // real-time pacing, so you can watch the rival fight
  R.update = (dt) => {
    for (const f of R.flash) f[2] -= dt;
    if (R.flash.length && R.flash.every((f) => f[2] <= 0)) R.flash = [];
    if (R.phase === 'day') {
      R.timer -= dt;
      const ready = R.actions || dt === 0 || think(3);
      if (R.timer <= 0 && ready) { R.timer = cfg.pace * (0.75 + Math.random() * 0.5); doMove(); }
    } else if (R.phase === 'night') {
      const n = R.night;
      n.t += dt * 1000;
      while (n.i < n.script.entries.length && n.script.entries[n.i].t <= n.t) {
        const e = n.script.entries[n.i++];
        if (e.hp !== undefined) n.hp = e.hp;
        if (e.base !== undefined) n.base = e.base;
      }
      if (n.t >= n.end) endNight();
    }
    if (!R.finished && run.st.stageNo > 60) { R.phase = 'over'; R.finished = true; }
  };

  // finish the rival's whole run at once (when your base has fallen), in small slices so the phone never stalls
  R.fastForward = (done) => {
    function slice() {
      const t0 = performance.now();
      while (!R.finished && performance.now() - t0 < 8) {
        if (R.phase === 'night') { R.night.t = R.night.end; R.update(0); }
        else { R.timer = 0; R.update(0); }
      }
      R.ev.length = 0;
      if (R.finished) done(); else setTimeout(slice, 0);
    }
    slice();
  };
  return R;
}
