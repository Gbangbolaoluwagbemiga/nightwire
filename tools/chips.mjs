// Builds the war-machine brain chips as TapeOut NAND/LATCH netlists and writes src/chips.js.
// Inputs (7): bossQ (2 bits: boss HP quarter 0..3), baseQ (2 bits), shieldUp, rage (2 bits, capped at 3).
// Outputs (2): action, 0 BARRAGE, 1 FOCUS FIRE, 2 EMP, 3 FIELD REPAIR.  Run: node tools/chips.mjs
import fs from 'fs';
import { builder, load } from '../src/tap02.js';

const IN = { bq0: 0, bq1: 1, sq0: 2, sq1: 3, shield: 4, r0: 5, r1: 6 };
function brain(design) {
  const B = builder(7);
  const i = Object.fromEntries(Object.entries(IN).map(([k, v]) => [k, B.input(v)]));
  return B.finish(design(B, i));
}

export const DESIGNS = {
  // IRONCLAW: relentless. Every third shot is focus fire.
  ironclaw: brain((B, i) => {
    const c0 = B.latch(), c1 = B.latch();
    const isTwo = B.and(c1.q, B.not(c0.q));
    c0.set(B.and(B.not(c0.q), B.not(isTwo)));
    c1.set(B.and(c0.q, B.not(c1.q)));
    return [isTwo, B.ZERO];
  }),
  // STORMWING: hunter. EMPs a raised shield, then follows up with focus fire; focus fire when the base is weak.
  stormwing: brain((B, i) => {
    const e = B.latch();
    const emp = B.and(i.shield, B.not(e.q));
    const focus = B.or(e.q, B.not(i.sq1));
    e.set(emp);
    return [B.and(B.not(emp), focus), emp];
  }),
  // DREADNOUGHT: fortress. Repairs once when below half health; focus fire once rage reaches 2.
  dreadnought: brain((B, i) => {
    const r = B.latch();
    const rep = B.and(B.not(i.bq1), B.not(r.q));
    r.set(B.or(r.q, rep));
    return [B.or(rep, i.r1), rep];
  }),
  // HIVE CARRIER: swarm. Alternates barrage and focus; EMPs shields when enraged; one emergency repair.
  hive: brain((B, i) => {
    const t = B.latch(), u = B.latch();
    const crit = B.and(B.not(i.bq0), B.not(i.bq1));
    const rep = B.and(crit, B.not(u.q));
    const emp = B.and(B.and(i.shield, B.or(i.r0, i.r1)), t.q);
    t.set(B.not(t.q));
    u.set(B.or(u.q, rep));
    const o1 = B.or(rep, emp);
    const o0 = B.or(rep, B.and(B.not(o1), t.q));
    return [o0, o1];
  }),
  // BEHEMOTH: siege tank. Focus fire every other shot; once rage is 2+ it EMPs any raised shield.
  behemoth: brain((B, i) => {
    const t = B.latch();
    const emp = B.and(i.r1, i.shield);
    t.set(B.not(t.q));
    return [B.and(B.not(emp), t.q), emp];
  }),
  // SPECTRE: stealth bomber. One cloaked repair below 75% health; EMPs raised shields; otherwise barrage.
  spectre: brain((B, i) => {
    const u = B.latch();
    const below75 = B.not(B.and(i.bq0, i.bq1)); // bq != 3
    const rep = B.and(below75, B.not(u.q));
    u.set(B.or(u.q, rep));
    const emp = B.and(B.not(rep), i.shield);
    return [rep, B.or(rep, emp)];
  }),
  // TITAN: spider walker. Barrage, barrage, focus (a 3-step gait); always focus fire when critical.
  titan: brain((B, i) => {
    const c0 = B.latch(), c1 = B.latch();
    const isTwo = B.and(c1.q, B.not(c0.q));
    c0.set(B.and(B.not(c0.q), B.not(isTwo)));
    c1.set(B.and(c0.q, B.not(c1.q)));
    const crit = B.and(B.not(i.bq0), B.not(i.bq1));
    return [B.or(isTwo, crit), B.ZERO];
  }),
  // WARDEN: orbital platform. Charges its lance every other beat (focus fire); critical, it repairs on the off-beats.
  warden: brain((B, i) => {
    const q = B.latch();
    q.set(B.not(q.q));
    const crit = B.and(B.not(i.bq0), B.not(i.bq1));
    const rep = B.and(B.not(q.q), crit);
    return [B.or(q.q, rep), rep];
  }),
  // OMEGA (world boss): a four-beat cycle. Barrage, focus, EMP if a shield is up, then focus once enraged.
  omega: brain((B, i) => {
    const c0 = B.latch(), c1 = B.latch();
    c0.set(B.not(c0.q));
    c1.set(B.xor(c1.q, c0.q));
    const isOne = B.and(c0.q, B.not(c1.q)), isTwo = B.and(B.not(c0.q), c1.q), isThree = B.and(c0.q, c1.q);
    const emp = B.and(isTwo, i.shield);
    const focus = B.or(isOne, B.and(isThree, B.or(i.r0, i.r1)));
    return [focus, emp];
  }),
};

// plain-JS statement of the same rules, to test the chips against
export const SPEC = {
  ironclaw: (s, x) => { const c = s.c || 0; return { a: c === 2 ? 1 : 0, s: { c: (c + 1) % 3 } }; },
  stormwing: (s, x) => { const emp = x.shield && !s.e; const a = emp ? 2 : (s.e || x.sq <= 1) ? 1 : 0; return { a, s: { e: emp ? 1 : 0 } }; },
  dreadnought: (s, x) => { const rep = x.bq <= 1 && !s.r; return { a: rep ? 3 : x.rage >= 2 ? 1 : 0, s: { r: s.r || rep ? 1 : 0 } }; },
  hive: (s, x) => { const t = s.t || 0; const rep = x.bq === 0 && !s.u; const emp = x.shield && x.rage >= 1 && t; return { a: rep ? 3 : emp ? 2 : t ? 1 : 0, s: { t: 1 - t, u: s.u || rep ? 1 : 0 } }; },
  behemoth: (s, x) => { const t = s.t || 0; const emp = x.rage >= 2 && x.shield; return { a: emp ? 2 : t ? 1 : 0, s: { t: 1 - t } }; },
  spectre: (s, x) => { const rep = x.bq !== 3 && !s.u; const emp = !rep && x.shield; return { a: rep ? 3 : emp ? 2 : 0, s: { u: s.u || rep ? 1 : 0 } }; },
  titan: (s, x) => { const c = s.c || 0; return { a: c === 2 || x.bq === 0 ? 1 : 0, s: { c: (c + 1) % 3 } }; },
  omega: (s, x) => { const c = s.c || 0; return { a: c === 1 ? 1 : c === 2 ? (x.shield ? 2 : 0) : c === 3 ? (x.rage >= 1 ? 1 : 0) : 0, s: { c: (c + 1) % 4 } }; },
  warden: (s, x) => { const q = s.q || 0; return { a: q ? 1 : x.bq === 0 ? 3 : 0, s: { q: 1 - q } }; },
};

if (process.argv[1] && process.argv[1].endsWith('chips.mjs')) {
  const out = {};
  for (const [k, d] of Object.entries(DESIGNS)) {
    const c = load(d.netlist, d.nIn, d.nOut);
    out[k] = { ...d, gates: c.gates, nand: c.nand, latch: c.latch };
    console.log(k.padEnd(12), `${c.nand} NAND + ${c.latch} LATCH`, `${(d.netlist.length - 2) / 2} bytes`);
  }
  fs.writeFileSync(new URL('../src/chips.js', import.meta.url), `// Generated by tools/chips.mjs: war-machine brain chips (TapeOut TAP-02 netlists). Do not edit by hand.
// onchain: filled in once each chip is taped out on X Layer (processor address + circuit id).
export const CHIPS = ${JSON.stringify(out, null, 2)};
export const ONCHAIN = { chainId: 196, processor: null, first: null };
`);
  const order = ['ironclaw', 'stormwing', 'dreadnought', 'hive', 'behemoth', 'spectre', 'titan', 'warden', 'omega'];
  fs.writeFileSync(new URL('../contracts/chips.json', import.meta.url), JSON.stringify({ netlists: order.map((k) => out[k].netlist), names: order, nand: order.map((k) => out[k].nand), latch: order.map((k) => out[k].latch) }, null, 2));
}
