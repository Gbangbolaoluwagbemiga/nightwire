// Chip Inspector: draws a war machine's brain (a TapeOut NAND/LATCH circuit) with live signal values.
// Tap an input to flip it; Step runs one beat (LATCHes keep their new state), exactly like step() on X Layer.
import { signals, beat } from './tap02.js';
import * as E from './engine.js';

const IN_NAMES = ['BOSS HP·0', 'BOSS HP·1', 'BASE·0', 'BASE·1', 'SHIELD', 'RAGE·0', 'RAGE·1'];
const ON = '#3DDC97', OFF = 'rgba(160,175,195,0.28)';

export function makeInspector(root, opts) {
  const cv = root.querySelector('canvas'), g = cv.getContext('2d');
  let type = 0, state = [], inputs = [0, 0, 0, 0, 0, 0, 0], layout = null, k = 1;
  const W = 350, H = 300, X0 = 62, X1 = W - 58;

  function build() {
    const c = E.brainOf(type).circuit, nIn = c.nIn, base = 2 + nIn;
    const level = new Array(c.S).fill(0), row = [];
    for (let i = 0; i < c.op.length; i++) level[base + i] = c.op[i] === 0 ? Math.max(level[c.a[i]], level[c.b[i]]) + 1 : 1;
    const maxL = Math.max(...level) || 1;
    const pos = new Array(c.S);
    for (let i = 0; i < nIn; i++) pos[2 + i] = { x: X0, y: 40 + (i * (H - 70)) / (nIn - 1) };
    pos[0] = { x: X0 - 30, y: H - 12 }; pos[1] = { x: X0 - 30, y: H - 12 };
    const count = {};
    for (let i = 0; i < c.op.length; i++) { const L = level[base + i]; row[base + i] = count[L] = (count[L] || 0) + 1; }
    for (let i = 0; i < c.op.length; i++) {
      const sIdx = base + i, L = level[sIdx], n = count[L];
      pos[sIdx] = { x: X0 + 30 + ((X1 - X0 - 60) * (L - 1)) / Math.max(1, maxL - 1), y: 30 + ((H - 50) * (row[sIdx] - 0.5)) / n };
    }
    layout = { c, pos, base };
  }

  function draw() {
    const { c, pos, base } = layout;
    const s = signals(c, state, inputs);
    const out = Array.from(s.subarray(c.S - c.nOut));
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineWidth = 1.2;
    for (let i = 0; i < c.op.length; i++) { // wires
      const p = pos[base + i];
      const srcs = c.op[i] === 0 ? [c.a[i], c.b[i]] : [];
      for (const a of srcs) {
        const q = pos[a]; if (!q) continue;
        g.strokeStyle = s[a] ? ON : OFF;
        g.beginPath(); g.moveTo(q.x, q.y); g.bezierCurveTo((q.x + p.x) / 2, q.y, (q.x + p.x) / 2, p.y, p.x, p.y); g.stroke();
      }
      if (c.op[i] === 1) { // LATCH feedback, dashed
        const q = pos[c.a[i]];
        g.setLineDash([3, 3]); g.strokeStyle = s[c.a[i]] ? '#FFD23F' : OFF;
        g.beginPath(); g.moveTo(q.x, q.y); g.bezierCurveTo(q.x + 20, q.y - 60, p.x - 20, p.y - 60, p.x, p.y); g.stroke(); g.setLineDash([]);
      }
    }
    for (let i = 0; i < c.op.length; i++) { // gates
      const p = pos[base + i], v = s[base + i], latch = c.op[i] === 1;
      g.fillStyle = v ? (latch ? '#FFD23F' : ON) : '#1a2230';
      g.strokeStyle = latch ? '#FFD23F' : 'rgba(200,215,235,0.5)';
      if (latch) { g.fillRect(p.x - 6, p.y - 6, 12, 12); g.strokeRect(p.x - 6, p.y - 6, 12, 12); }
      else { g.beginPath(); g.arc(p.x, p.y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); }
    }
    g.font = '700 9px "JetBrains Mono", monospace';
    g.textBaseline = 'middle';
    for (let i = 0; i < c.nIn; i++) { // inputs (tap to flip)
      const p = pos[2 + i];
      g.fillStyle = inputs[i] ? ON : '#2a3444';
      g.fillRect(p.x - 9, p.y - 9, 18, 18);
      g.fillStyle = inputs[i] ? '#06110c' : '#c9d4e3';
      g.textAlign = 'center'; g.fillText(inputs[i], p.x, p.y + 0.5);
      g.fillStyle = 'rgba(232,238,247,0.7)'; g.textAlign = 'right'; g.fillText(IN_NAMES[i], p.x - 13, p.y);
    }
    const action = out[0] + 2 * out[1];
    g.textAlign = 'right';
    g.fillStyle = 'rgba(232,238,247,0.7)';
    g.fillText(`OUT ${out[1]}${out[0]}`, W - 6, H / 2 - 14);
    g.font = '800 12px "JetBrains Mono", monospace';
    g.fillStyle = ['#ff8a8a', '#ff4a4a', '#3FC8FF', '#3DDC97'][action];
    g.fillText(E.ACTIONS[action], W - 6, H / 2 + 2);
    opts.onInfo({ type, c, state: state.slice(), action });
  }

  function hit(e) {
    const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    for (let i = 0; i < 7; i++) { const p = layout.pos[2 + i]; if (Math.abs(x - p.x) < 16 && Math.abs(y - p.y) < 14) { inputs[i] ^= 1; opts.onTap(); draw(); return; } }
  }
  cv.addEventListener('pointerdown', hit);

  return {
    open(t, liveState, liveInputs) {
      type = t;
      build();
      state = liveState ? liveState.slice() : new Array(layout.c.nState).fill(0);
      if (liveInputs) inputs = liveInputs.slice();
      const r = cv.getBoundingClientRect();
      k = (r.width / W) * Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * k); cv.height = Math.round(H * k);
      draw();
    },
    step() { state = beat(layout.c, state, inputs).state; draw(); },
    reset() { state = new Array(layout.c.nState).fill(0); draw(); },
  };
}
