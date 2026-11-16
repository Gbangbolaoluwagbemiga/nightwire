// TAP-02 circuit evaluator: decode a TapeOut NAND/LATCH netlist and run one beat, bit for bit as the
// processor contracts' eval/step do (github.com/TapeOutProtocol/TAPs, TAP-02 §2–§5). REF is not used
// by Nightwire chips and is rejected.

export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export const bytesToHex = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;

// Decode and check well-formedness (§3, without REF). Returns a compiled circuit.
export function load(netlist, nIn, nOut) {
  const d = typeof netlist === 'string' ? hexToBytes(netlist) : netlist;
  const op = [], a = [], b = [];
  let p = 0, next = 2 + nIn;
  const u24 = () => { if (p + 3 > d.length) throw new Error('truncated record'); const v = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2]; p += 3; return v; };
  while (p < d.length) {
    const o = d[p++];
    if (o === 0) { const x = u24(), y = u24(); if (x >= next || y >= next) throw new Error('NAND: future signal'); op.push(0); a.push(x); b.push(y); }
    else if (o === 1) { op.push(1); a.push(u24()); b.push(0); }
    else if (o === 2) throw new Error('REF not supported');
    else throw new Error('bad opcode');
    next++;
  }
  const S = next;
  if (nOut < 1 || nIn > 65536 || nOut > 65536) throw new Error('bad pins');
  if (2 + nIn + nOut > S) throw new Error('too few signals for outputs');
  let nState = 0, nand = 0;
  const stateIdx = op.map((o, i) => { if (o === 1) { if (a[i] >= S) throw new Error('LATCH d out of range'); return nState++; } nand++; return -1; });
  return { nIn, nOut, nState, gates: op.length, nand, latch: nState, op, a, b, stateIdx, S };
}

// One beat (§4). state and inputs are bit arrays; returns { state, outputs } as bit arrays.
export function beat(c, state, inputs) {
  const s = new Uint8Array(c.S);
  s[1] = 1;
  for (let i = 0; i < c.nIn; i++) s[2 + i] = inputs[i] ? 1 : 0;
  const base = 2 + c.nIn;
  for (let i = 0; i < c.op.length; i++) s[base + i] = c.op[i] === 0 ? 1 - (s[c.a[i]] & s[c.b[i]]) : state[c.stateIdx[i]] ? 1 : 0;
  const ns = new Array(c.nState);
  for (let i = 0; i < c.op.length; i++) if (c.op[i] === 1) ns[c.stateIdx[i]] = s[c.a[i]];
  return { state: ns, outputs: Array.from(s.subarray(c.S - c.nOut)) };
}

// LSB-first bit packing (§5); reading is lenient like the contracts.
export function pack(bits) {
  const out = new Uint8Array((bits.length + 7) >> 3);
  bits.forEach((v, i) => { if (v) out[i >> 3] |= 1 << (i & 7); });
  return out;
}
export function unpack(bytes, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (i >> 3) < bytes.length ? (bytes[i >> 3] >> (i & 7)) & 1 : 0;
  return out;
}

// Same as the contracts' step(id, state, inputs) with packed byte strings.
export function step(c, stateBytes, inputBytes) {
  const r = beat(c, unpack(stateBytes, c.nState), unpack(inputBytes, c.nIn));
  return { state: pack(r.state), outputs: pack(r.outputs) };
}

// ---------------------------------------------------------------- netlist builder (for designing chips)
export function builder(nIn) {
  const recs = [];
  let next = 2 + nIn;
  const latches = [];
  const B = {
    ZERO: 0, ONE: 1,
    input: (i) => 2 + i,
    nand(x, y) { recs.push([0, x, y]); return next++; },
    not(x) { return B.nand(x, x); },
    and(x, y) { return B.not(B.nand(x, y)); },
    or(x, y) { return B.nand(B.not(x), B.not(y)); },
    xor(x, y) { const m = B.nand(x, y); return B.nand(B.nand(x, m), B.nand(y, m)); },
    mux(sel, x0, x1) { return B.nand(B.nand(x0, B.not(sel)), B.nand(x1, sel)); }, // sel ? x1 : x0
    latch() { const rec = [1, 0]; recs.push(rec); latches.push(rec); const q = next++; return { q, set(d) { rec[1] = d; } }; },
    // outputs must be the last nOut signals: buffer them through two inverters
    finish(outs) {
      const inv = outs.map((o) => B.not(o));
      inv.forEach((o) => B.not(o));
      const bytes = [];
      for (const r of recs) {
        bytes.push(r[0]);
        for (const v of r.slice(1)) bytes.push((v >> 16) & 255, (v >> 8) & 255, v & 255);
      }
      return { netlist: bytesToHex(bytes), nIn, nOut: outs.length };
    },
  };
  return B;
}
