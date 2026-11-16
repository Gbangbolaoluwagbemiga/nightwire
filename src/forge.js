// Boss Forge: a player designs a war machine's brain with simple rules, and this compiles it into a real
// TapeOut NAND/LATCH netlist (TAP-02), the same kind of circuit the built-in bosses think with.
// Used by the browser and by the API server, so a published design always compiles to the same chip.
import { builder, load } from './tap02.js';

export const RHYTHM_ACTIONS = ['BARRAGE', 'FOCUS FIRE', 'EMP']; // per beat; repair only as a one-time reflex
export const HULLS = ['IRONCLAW mech', 'STORMWING gunship', 'DREADNOUGHT airship', 'HIVE carrier', 'BEHEMOTH tank', 'SPECTRE wing', 'TITAN walker', 'WARDEN platform'];
export const COLORS = ['#E0703F', '#9B8CFF', '#45B4E8', '#FF4FD8', '#C9A227', '#7CF2E2', '#FF8F3D', '#F2F2FF', '#3DDC97', '#FF2E4D'];
export const DEFAULT_DESIGN = { name: 'MY MACHINE', hull: 0, color: 0, rhythm: [0, 1, 0, 1], repairBelow: 0, emp: 0, focusWeakBase: false, focusEnraged: false };

/** Clean and validate a design (from a form or the network). Throws on nonsense. */
export function normalize(d) {
  const int = (v, lo, hi) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error('bad design'); return n; };
  const name = String(d.name || '').toUpperCase().replace(/[^A-Z0-9 \-]/g, '').trim().slice(0, 14) || 'UNNAMED';
  if (!Array.isArray(d.rhythm) || d.rhythm.length !== 4) throw new Error('bad rhythm');
  return {
    name, hull: int(d.hull, 0, 7), color: int(d.color, 0, COLORS.length - 1), rhythm: d.rhythm.map((a) => int(a, 0, 2)),
    repairBelow: [0, 25, 50, 75].includes(Number(d.repairBelow)) ? Number(d.repairBelow) : 0, // once, below this % health
    emp: int(d.emp || 0, 0, 2), // 0 never, 1 any raised shield, 2 raised shields once enraged
    focusWeakBase: !!d.focusWeakBase, focusEnraged: !!d.focusEnraged,
  };
}

/** Compile to a netlist. Inputs as every brain: bossQ(2) baseQ(2) shield rage(2); outputs 2 bits = action. */
export function compile(design) {
  const d = normalize(design);
  const B = builder(7);
  const i = { bq0: B.input(0), bq1: B.input(1), sq0: B.input(2), sq1: B.input(3), shield: B.input(4), r0: B.input(5), r1: B.input(6) };
  const c0 = B.latch(), c1 = B.latch(); // the 4-beat rhythm counter
  c0.set(B.not(c0.q));
  c1.set(B.xor(c1.q, c0.q));
  const beat = [B.and(B.not(c1.q), B.not(c0.q)), B.and(B.not(c1.q), c0.q), B.and(c1.q, B.not(c0.q)), B.and(c1.q, c0.q)];
  const anyBeat = (want) => d.rhythm.reduce((acc, a, k) => (a === want ? (acc === null ? beat[k] : B.or(acc, beat[k])) : acc), null) ?? B.ZERO;
  const o0r = anyBeat(1), o1r = anyBeat(2); // FOCUS = 01, EMP = 10
  let rep = B.ZERO;
  if (d.repairBelow) {
    const u = B.latch();
    const low = d.repairBelow === 75 ? B.not(B.and(i.bq0, i.bq1)) : d.repairBelow === 50 ? B.not(i.bq1) : B.and(B.not(i.bq0), B.not(i.bq1));
    rep = B.and(low, B.not(u.q));
    u.set(B.or(u.q, rep));
  }
  let emp = B.ZERO;
  if (d.emp === 1) emp = i.shield;
  if (d.emp === 2) emp = B.and(i.shield, B.or(i.r0, i.r1));
  let F = B.ZERO;
  if (d.focusWeakBase) F = B.not(i.sq1);
  if (d.focusEnraged) F = d.focusWeakBase ? B.or(F, i.r1) : i.r1;
  const nrep = B.not(rep), nemp = B.not(emp);
  const o0 = B.or(rep, B.and(B.and(nrep, nemp), B.or(F, o0r)));
  const o1 = B.or(rep, B.or(B.and(nrep, emp), B.and(B.and(B.and(nrep, nemp), B.not(F)), o1r)));
  const out = B.finish([o0, o1]);
  const c = load(out.netlist, 7, 2);
  return { ...out, design: d, gates: c.gates, nand: c.nand, latch: c.latch, circuit: c };
}

/** The same rules in plain JS, for tests. state {c, u}; x {bq, sq, shield, rage} → {a, s} */
export function spec(design) {
  const d = normalize(design);
  return (s, x) => {
    const c = s.c || 0;
    const low = d.repairBelow === 75 ? x.bq !== 3 : d.repairBelow === 50 ? x.bq <= 1 : d.repairBelow === 25 ? x.bq === 0 : false;
    const rep = d.repairBelow ? low && !s.u : false;
    const emp = d.emp === 1 ? x.shield : d.emp === 2 ? x.shield && x.rage >= 1 : false;
    const F = (d.focusWeakBase && x.sq <= 1) || (d.focusEnraged && x.rage >= 2);
    const a = rep ? 3 : emp ? 2 : F ? 1 : d.rhythm[c];
    return { a, s: { c: (c + 1) % 4, u: s.u || rep ? 1 : 0 } };
  };
}

/** A design's id and its fixed battlefield: everyone fights a published machine on the same seed. */
export function designKey(d) {
  const n = normalize(d);
  return [n.name, n.hull, n.color, n.rhythm.join(''), n.repairBelow, n.emp, +n.focusWeakBase, +n.focusEnraged].join('|');
}
