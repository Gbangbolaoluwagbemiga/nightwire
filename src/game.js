import { sfx, unlockAudio, toggleMute, isMuted } from './audio.js';
import * as E from './engine.js';
import { makeRival, LEVELS } from './rival.js';
import * as C from './chain.js';
import * as TS from './tapesend.js';
import { makeInspector } from './chipview.js';
import { ONCHAIN } from './chips.js';

// ================================================================ layout (logical units, portrait 390 x 860)
const W = 390, H = 860;
const { N, CORE, MOVES_PER_DAY, TIER_MUL, tierOf, BOSSES } = E;
const CELL = 45, BX = (W - N * CELL) / 2, BY = 404;
const SKY_TOP = 60, BASE_Y = 296;
const WBAR_Y = 336, WBAR_H = 54;

// munitions on the board -> the weapon they arm (3 upgrade tiers each)
const GEMS = [
  { item: 'Bullets', color: '#F5C542', dark: '#4A3000', tiers: ['M2 MG', 'GATLING', 'CIWS'] },
  { item: 'Shells', color: '#FF7A3D', dark: '#4E1803', tiers: ['MORTAR', 'HOWITZER', 'MLRS'] },
  { item: 'Missiles', color: '#B57BFF', dark: '#250D57', tiers: ['STINGER', 'JAVELIN', 'PATRIOT'] },
  { item: 'Armour', color: '#3FC8FF', dark: '#032F4C', tiers: ['SANDBAGS', 'ARMOUR', 'IRON DOME'] },
  { item: 'Wrenches', color: '#3DDC97', dark: '#03402A', tiers: ['MEDIC', 'ENGINEERS', 'FIELD HQ'] },
];
const TURRETS = [{ x: 64, y: BASE_Y - 14 }, { x: 195, y: BASE_Y - 18 }, { x: 326, y: BASE_Y - 14 }];
const cellX = (c) => BX + c * CELL + CELL / 2;
const cellY = (r) => BY + r * CELL + CELL / 2;
const wbarX = (i) => 8 + i * 75;

// ================================================================ DOM
const $ = (id) => document.getElementById(id);
const stage = $('stage'), cv = $('game'), ctx = cv.getContext('2d');
const bgDay = $('bgDay'), bgNight = $('bgNight');
const ui = {
  stage: $('dayTxt'), score: $('scoreTxt'), moves: $('movesTxt'), mute: $('muteBtn'), toast: $('toast'),
  banner: $('banner'), b1: $('b1'), b2: $('b2'), status: $('statusBox'), statusLbl: $('statusLbl'), statusTxt: $('statusTxt'),
  title: $('title'), over: $('over'), ranks: $('ranks'), best: $('bestTxt'), strikeBadge: $('strikeBadge'), strikeTxt: $('strikeTxt'),
  strikeBtn: $('strikeBtn'), strikeBtnN: $('strikeBtnN'),
};

// ================================================================ quality
let scale = 1, dpr = Math.min(2, window.devicePixelRatio || 1), k = 1, lowPower = false, MAXP = 380;

// ================================================================ state
const S = {
  phase: 'title', stageNo: 1, bossesDown: 0, score: 0, best: 0, moves: MOVES_PER_DAY,
  base: 100, baseMax: 100, shield: 0, shieldMax: 1, charge: [0, 0, 0, 0, 0], shown: [0, 0, 0, 0, 0], ammo: [0, 0, 0], wtier: [0, 0, 0],
  strikes: 0, boss: null, bp: { x: 195, y: 130, s: 0.4 }, events: [], proj: [], fx: [], texts: [], nt: 0, nightEnd: -1,
  bstate: 'idle', cascade: 0, popT: 0, sel: null, press: null, idleT: 0, hint: null, swap: null, tut: 0,
  time: 0, shake: 0, flash: 0, flashCol: '255,60,60', nb: 0, slow: 1, wpulse: [0, 0, 0, 0, 0], tierShown: [0, 0, 0, 0, 0],
};
try { S.best = Number(localStorage.getItem('nw-best')) || 0; } catch { /* storage blocked */ }
let G = [];

// ================================================================ pools
const P = Array.from({ length: 420 }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff', g: 0 }));
let pi = 0;
function spark(x, y, color, n, speed = 150, size = 2.6, life = 0.5, grav = 0) {
  for (let i = 0; i < n; i++) {
    const p = P[pi];
    pi = (pi + 1) % MAXP;
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    p.on = true; p.x = x; p.y = y; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.g = grav;
    p.size = size * (0.6 + Math.random() * 0.8); p.color = color;
    p.max = p.life = life * (0.6 + Math.random() * 0.6);
  }
}
function smoke(x, y, n = 1) {
  for (let i = 0; i < n; i++) {
    const p = P[pi];
    pi = (pi + 1) % MAXP;
    p.on = true; p.x = x + (Math.random() - 0.5) * 3; p.y = y + (Math.random() - 0.5) * 3; p.vx = (Math.random() - 0.5) * 14; p.vy = -8 - Math.random() * 10; p.g = 0;
    p.size = 3 + Math.random() * 3; p.color = '#9aa3ad'; p.max = p.life = 0.45 + Math.random() * 0.3;
  }
}
const ORBS = Array.from({ length: 140 }, () => ({ on: false }));
function orb(x, y, color, gi, val, delay) {
  const o = ORBS.find((q) => !q.on);
  if (!o) { S.shown[gi] += val; return; }
  const tx = wbarX(gi) + 18, ty = WBAR_Y + WBAR_H / 2;
  Object.assign(o, { on: true, x, y, sx: x, sy: y, tx, ty, cx: x + (Math.random() - 0.5) * 160, cy: Math.min(y, ty) - 40 - Math.random() * 80, t: -delay, d: 0.45 + Math.random() * 0.2, color, gi, val });
}
// wreckage: spinning chunks thrown out and falling
function debris(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 200;
    S.fx.push({ type: 'debris', x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 30, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 5 + Math.random() * 10, h: 3 + Math.random() * 6, color: Math.random() < 0.5 ? color : '#59626b', t: 0, d: 1.6 });
  }
}
function text(x, y, str, color, size = 14, life = 0.9, rise = 36) {
  if (S.texts.length > 30) S.texts.shift();
  S.texts.push({ x, y, str, color, size, t: 0, life, rise });
}

// ================================================================ sprites
const SPR = {};
function sprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * k));
  c.height = Math.max(1, Math.ceil(h * k));
  const g = c.getContext('2d');
  g.scale(k, k);
  draw(g);
  return c;
}
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function glow(color, size, a = 0.5) {
  return sprite(size, size, (g) => {
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, rgba(color, a));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  });
}
function lin(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => gr.addColorStop(o, c));
  return gr;
}

// --- munition icons, drawn around (0,0), about 34 units tall
function drawMunition(g, c) {
  g.save();
  if (c === 0) { // brass cartridge with copper bullet
    g.rotate(0.38);
    g.fillStyle = lin(g, -6, 0, 6, 0, [[0, '#8a6418'], [0.45, '#ffe9a6'], [1, '#7a5612']]);
    rr(g, -6, -4, 12, 17, 2);
    g.fill();
    g.fillStyle = '#5c420c';
    g.fillRect(-6.5, 10.5, 13, 2.6);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(-6, 4, 12, 1.2);
    g.fillStyle = lin(g, -6, 0, 6, 0, [[0, '#7a3b17'], [0.45, '#f0a26a'], [1, '#6b2f10']]);
    g.beginPath(); g.moveTo(-6, -4); g.quadraticCurveTo(-6, -14, 0, -18); g.quadraticCurveTo(6, -14, 6, -4); g.closePath(); g.fill();
  } else if (c === 1) { // artillery shell
    g.rotate(-0.62);
    g.fillStyle = lin(g, -7, 0, 7, 0, [[0, '#3e4a26'], [0.45, '#8fa25a'], [1, '#353f1f']]);
    g.fillRect(-7, -5, 14, 18);
    g.fillStyle = lin(g, -7, 0, 7, 0, [[0, '#7a3b17'], [0.5, '#f0a26a'], [1, '#6b2f10']]);
    g.fillRect(-7.5, 8, 15, 3.4);
    g.fillStyle = '#2a2f1c';
    g.fillRect(-7, 13, 14, 2);
    g.fillStyle = lin(g, -7, 0, 7, 0, [[0, '#4b5258'], [0.45, '#c9d1d8'], [1, '#41474d']]);
    g.beginPath(); g.moveTo(-7, -5); g.quadraticCurveTo(-7, -15, 0, -19); g.quadraticCurveTo(7, -15, 7, -5); g.closePath(); g.fill();
    g.fillStyle = '#f5c542';
    g.fillRect(-7, -1, 14, 1.6);
  } else if (c === 2) { // missile
    g.rotate(0.72);
    g.fillStyle = '#e94b3c';
    g.beginPath(); g.moveTo(-4, 8); g.lineTo(-9, 15); g.lineTo(-4, 14); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(4, 8); g.lineTo(9, 15); g.lineTo(4, 14); g.closePath(); g.fill();
    g.fillStyle = lin(g, -4, 0, 4, 0, [[0, '#9aa4ad'], [0.45, '#ffffff'], [1, '#8a939b']]);
    g.fillRect(-4, -11, 8, 25);
    g.fillStyle = '#e94b3c';
    g.beginPath(); g.moveTo(-4, -11); g.quadraticCurveTo(-4, -18, 0, -21); g.quadraticCurveTo(4, -18, 4, -11); g.closePath(); g.fill();
    g.fillStyle = '#2b2f36';
    g.fillRect(-4, -2, 8, 2);
    g.fillStyle = '#ffb347';
    g.beginPath(); g.moveTo(-3, 14); g.lineTo(0, 20); g.lineTo(3, 14); g.closePath(); g.fill();
  } else if (c === 3) { // armour plate (heater shield)
    g.fillStyle = lin(g, -12, -14, 12, 14, [[0, '#e6edf3'], [0.5, '#8b98a5'], [1, '#4b5662']]);
    g.beginPath(); g.moveTo(0, -15); g.lineTo(12, -10); g.lineTo(11, 3); g.quadraticCurveTo(8, 11, 0, 16); g.quadraticCurveTo(-8, 11, -11, 3); g.lineTo(-12, -10); g.closePath(); g.fill();
    g.strokeStyle = '#2d3640'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#3FC8FF';
    g.beginPath(); g.moveTo(-7, -3); g.lineTo(0, 3); g.lineTo(7, -3); g.lineTo(7, 1); g.lineTo(0, 7); g.lineTo(-7, 1); g.closePath(); g.fill();
    g.fillStyle = '#2d3640';
    for (const [x, y] of [[-8, -8], [8, -8], [-7, 5], [7, 5]]) { g.beginPath(); g.arc(x, y, 1.3, 0, Math.PI * 2); g.fill(); }
  } else if (c === 4) { // wrench
    g.rotate(-0.78);
    g.fillStyle = lin(g, -3, 0, 3, 0, [[0, '#7d8790'], [0.5, '#eef2f5'], [1, '#6b747c']]);
    rr(g, -2.8, -6, 5.6, 22, 2.6);
    g.fill();
    g.beginPath();
    g.moveTo(-8, -6); g.lineTo(-8, -13); g.lineTo(-3.5, -19); g.lineTo(-2.6, -11); g.lineTo(2.6, -11); g.lineTo(3.5, -19); g.lineTo(8, -13); g.lineTo(8, -6); g.quadraticCurveTo(0, -1, -8, -6);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.arc(0, 12, 1.6, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function drawToken(g, c, sz) {
  const m = 3.5, s = sz - 2 * m, gm = GEMS[c];
  rr(g, m, m + 1.5, s, s, 11);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fill();
  rr(g, m, m, s, s, 11);
  const gr = g.createRadialGradient(sz / 2 - 6, sz / 2 - 9, 2, sz / 2, sz / 2, s * 0.75);
  gr.addColorStop(0, gm.color);
  gr.addColorStop(1, gm.dark);
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 1.4;
  g.strokeStyle = rgba(gm.color, 0.9);
  g.stroke();
  g.save();
  rr(g, m, m, s, s, 11);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(m, m, s, s * 0.4);
  g.restore();
  g.save();
  g.translate(sz / 2, sz / 2);
  g.scale(0.92, 0.92);
  drawMunition(g, c);
  g.restore();
}
function drawJet(g, w, color = '#9aa6b2') { // top view, nose pointing +x, centered
  const h = w * 0.62;
  g.fillStyle = lin(g, 0, -h / 2, 0, h / 2, [[0, '#d9e0e6'], [0.5, color], [1, '#4e5862']]);
  g.beginPath();
  g.moveTo(w * 0.5, 0);
  g.lineTo(w * 0.3, -w * 0.05); g.lineTo(w * 0.05, -w * 0.06);
  g.lineTo(-w * 0.12, -h / 2); g.lineTo(-w * 0.22, -h / 2); g.lineTo(-w * 0.12, -w * 0.07);
  g.lineTo(-w * 0.36, -w * 0.07); g.lineTo(-w * 0.46, -h * 0.3); g.lineTo(-w * 0.5, -h * 0.3); g.lineTo(-w * 0.46, 0);
  g.lineTo(-w * 0.5, h * 0.3); g.lineTo(-w * 0.46, h * 0.3); g.lineTo(-w * 0.36, w * 0.07);
  g.lineTo(-w * 0.12, w * 0.07); g.lineTo(-w * 0.22, h / 2); g.lineTo(-w * 0.12, h / 2); g.lineTo(w * 0.05, w * 0.06);
  g.lineTo(w * 0.3, w * 0.05);
  g.closePath();
  g.fill();
  g.fillStyle = '#7fd4ff';
  g.beginPath(); g.ellipse(w * 0.24, 0, w * 0.07, w * 0.025, 0, 0, Math.PI * 2); g.fill();
}

function buildSprites() {
  SPR.gem = [];
  SPR.glow = [];
  SPR.icon = [];
  GEMS.forEach((gm, c) => {
    SPR.glow[c] = glow(gm.color, 60, 0.55);
    SPR.gem[c] = sprite(CELL, CELL, (g) => drawToken(g, c, CELL));
    SPR.icon[c] = sprite(40, 40, (g) => { g.translate(20, 20); drawMunition(g, c); });
  });
  SPR.core = sprite(CELL, CELL, (g) => { // airstrike beacon
    const m = 3.5, s = CELL - 2 * m;
    rr(g, m, m, s, s, 11);
    g.fillStyle = lin(g, 0, m, 0, m + s, [[0, '#3a3f47'], [1, '#14171c']]);
    g.fill();
    g.strokeStyle = '#ff4a4a';
    g.lineWidth = 1.6;
    g.stroke();
    g.fillStyle = '#2b3036';
    g.fillRect(CELL / 2 - 7, CELL / 2 + 2, 14, 9);
    g.fillStyle = '#ff3b3b';
    g.beginPath(); g.arc(CELL / 2, CELL / 2 + 1, 7, Math.PI, 0); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(CELL / 2 - 2, CELL / 2 - 2, 2, 0, Math.PI * 2); g.fill();
  });
  SPR.white = glow('#ffffff', 40, 0.95);
  SPR.boom = glow('#ffb347', 120, 0.7);
  SPR.red = glow('#ff4a4a', 40, 0.95);
  SPR.flame = glow('#ffb347', 30, 0.95);
  SPR.dot = {};
  [...GEMS.map((g) => g.color), '#ff4a4a', '#ffffff', '#ffb347', ...BOSSES.map((b) => b.color)].forEach((c) => { SPR.dot[c] = glow(c, 24, 0.95); });
  SPR.jet = sprite(70, 46, (g) => { g.translate(35, 23); drawJet(g, 64); });
  SPR.bomber = sprite(120, 80, (g) => { g.translate(60, 40); drawJet(g, 112, '#6f7a85'); });
  SPR.board = sprite(N * CELL + 16, N * CELL + 16, (g) => {
    rr(g, 2, 2, N * CELL + 12, N * CELL + 12, 16);
    g.fillStyle = 'rgba(14, 18, 14, 0.9)';
    g.fill();
    g.strokeStyle = 'rgba(160,180,140,0.18)';
    g.lineWidth = 1;
    g.stroke();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if ((r + c) % 2) continue;
      g.fillStyle = 'rgba(200,220,170,0.035)';
      g.fillRect(8 + c * CELL, 8 + r * CELL, CELL, CELL);
    }
    // stencil corners
    g.strokeStyle = 'rgba(245,197,66,0.35)';
    g.lineWidth = 2;
    const e = N * CELL + 8;
    for (const [x, y, dx, dy] of [[8, 8, 1, 1], [e, 8, -1, 1], [8, e, 1, -1], [e, e, -1, -1]]) {
      g.beginPath(); g.moveTo(x, y + dy * 14); g.lineTo(x, y); g.lineTo(x + dx * 14, y); g.stroke();
    }
  });
}

function drawBackground(c, night) {
  c.width = Math.ceil(W * k);
  c.height = Math.ceil(H * k);
  const g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, BASE_Y);
  if (night) { sky.addColorStop(0, '#04050a'); sky.addColorStop(0.6, '#1c0d14'); sky.addColorStop(1, '#4a1410'); }
  else { sky.addColorStop(0, '#16202b'); sky.addColorStop(0.6, '#3d4a4f'); sky.addColorStop(1, '#a0794a'); }
  g.fillStyle = sky;
  g.fillRect(0, 0, W, BASE_Y + 40);
  const sun = g.createRadialGradient(W / 2, BASE_Y, 0, W / 2, BASE_Y, 240);
  sun.addColorStop(0, night ? 'rgba(255,90,40,0.3)' : 'rgba(255,190,90,0.35)');
  sun.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, BASE_Y + 40);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // ridge line and a ruined skyline
  g.fillStyle = night ? '#0e0909' : '#2a2c2a';
  g.beginPath();
  g.moveTo(0, BASE_Y);
  for (let x = 0; x <= W; x += 26) g.lineTo(x, BASE_Y - 26 - rnd() * 40);
  g.lineTo(W, BASE_Y);
  g.fill();
  g.fillStyle = night ? '#080506' : '#1d1f1e';
  for (let x = 0; x < W;) {
    const w = 12 + rnd() * 22, h = 10 + rnd() * 36;
    g.fillRect(x, BASE_Y - h, w - 3, h);
    if (rnd() > 0.6) { g.clearRect(x + w * 0.4, BASE_Y - h, w * 0.3, h * 0.35); }
    x += w;
  }
  if (night) { // distant fires
    for (let i = 0; i < 6; i++) {
      const x = rnd() * W, gr = g.createRadialGradient(x, BASE_Y - 6, 0, x, BASE_Y - 6, 26);
      gr.addColorStop(0, 'rgba(255,120,40,0.45)');
      gr.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = gr;
      g.fillRect(x - 26, BASE_Y - 32, 52, 52);
    }
  }
  const ground = g.createLinearGradient(0, BASE_Y, 0, H);
  ground.addColorStop(0, night ? '#0d0b08' : '#15170f');
  ground.addColorStop(1, '#050504');
  g.fillStyle = ground;
  g.fillRect(0, BASE_Y, W, H - BASE_Y);
  // camo-ish ground blotches
  seed = 77;
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${night ? '60,50,40' : '80,95,60'},0.07)`;
    g.beginPath();
    g.ellipse(rnd() * W, BASE_Y + 90 + rnd() * (H - BASE_Y - 90), 20 + rnd() * 40, 8 + rnd() * 18, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
}
const STARS = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97.3) % W, y: SKY_TOP + ((i * 53.7) % (BASE_Y - SKY_TOP - 80)), p: i * 1.3, s: i % 6 === 0 ? 2 : 1.2 }));

function resize() {
  scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.width = `${W * scale}px`;
  stage.style.height = `${H * scale}px`;
  stage.style.setProperty('--u', `${scale}px`);
  k = scale * dpr;
  cv.width = Math.ceil(W * k);
  cv.height = Math.ceil(H * k);
  buildSprites();
  if (typeof rv !== 'undefined') { rv.cv.width = rv.cv.height = Math.ceil(64 * k); if (RIVAL) RIVAL.dirty = true; }
  drawBackground(bgDay, false);
  drawBackground(bgNight, true);
}
window.addEventListener('resize', resize);

// ================================================================ UI helpers
let toastTimer = 0, warnUntil = 0;
function toast(html, warn = false, ms = 2800) {
  const now = performance.now();
  if (!warn && now < warnUntil) return; // never bury an important warning under a tip
  if (warn) warnUntil = now + ms;
  ui.toast.innerHTML = html;
  ui.toast.classList.toggle('warn', warn);
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}
function banner(a, b = '') {
  ui.b1.textContent = a;
  ui.b2.textContent = b;
  ui.banner.classList.remove('show');
  void ui.banner.offsetWidth;
  ui.banner.classList.add('show');
}
function buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } }
let shownScore = 0;
function addScore(n) { S.score += Math.round(n); }
function syncHud() {
  ui.stage.textContent = `STAGE ${S.stageNo}`;
  ui.moves.textContent = S.moves;
  ui.moves.classList.toggle('zero', S.moves <= 3 && S.phase === 'day');
  ui.strikeTxt.textContent = S.strikes;
  ui.strikeBadge.classList.toggle('on', S.strikes > 0);
  ui.strikeBtnN.textContent = `x${S.strikes}`;
  ui.strikeBtn.classList.toggle('show', S.phase === 'night' && S.strikes > 0 && S.boss && S.boss.dying < 0);
  if (S.phase === 'night') {
    ui.statusLbl.textContent = 'UNDER ATTACK';
    ui.statusTxt.textContent = S.boss ? S.boss.name : '';
    ui.status.classList.remove('danger');
  } else {
    ui.statusLbl.textContent = S.boss && S.boss.present ? 'NEXT ASSAULT IN' : 'ENEMY ARRIVES IN';
    ui.statusTxt.textContent = `${S.moves} move${S.moves === 1 ? '' : 's'}`;
    ui.status.classList.toggle('danger', S.moves <= 3);
  }
}
function bumpMoves() {
  ui.moves.classList.remove('bump');
  void ui.moves.offsetWidth;
  ui.moves.classList.add('bump');
}
function strikeEarned(reason, x, y) {
  text(x, y, `+1 AIRSTRIKE`, '#FFD23F', 13, 1.1, 40);
  ui.strikeBadge.classList.remove('bump');
  void ui.strikeBadge.offsetWidth;
  ui.strikeBadge.classList.add('bump');
  syncHud();
  if (S.strikes === 1 && reason) toast(`${reason} earned an <b>airstrike</b>. Call it in during the attack!`, false, 3400);
}

// ================================================================ board (the rules live in engine.js; this file animates them)
function gem(c, x, y, sp = null) { return { c, sp, x, y, vy: 0, s: 1, sv: 0, sq: 0, a: 1, pop: -1, sw: null }; }
const mkGem = (col, r, c, spawn) => (spawn < 0 ? gem(col, cellX(c), cellY(r) - 420 - (N - r) * 18 - c * 6) : gem(col, cellX(c), BY - spawn * CELL - 6));
let RUN = null; // { st: S, G, R, CR }: the engine's view of this game
let LOG = []; // every action, so the score can be replayed and verified
let MODE = { kind: 'solo', level: null, seed: 0, ghost: null };
let RIVAL = null;
let NIGHT = null;
const findMove = () => E.findMove(G);

// the engine calls these as things happen, so the board can show them
let popN = 0, popX = 0, popY = 0;
const FX = {
  strafe(h, r, c) { // fighter jet strafing run
    S.fx.push({ type: 'strafe', h, i: h ? r : c, t: 0, d: 0.42 });
    for (let i = 0; i < N; i++) S.fx.push({ type: 'boom', x: h ? cellX(i) : cellX(c), y: h ? cellY(r) : cellY(i), r: 0, max: 26, t: -(i / N) * 0.3, d: 0.3 });
    sfx.jet();
  },
  grenade(r, c) {
    S.fx.push({ type: 'boom', x: cellX(c), y: cellY(r), r: 0, max: CELL * 2.4, t: 0, d: 0.5 });
    S.fx.push({ type: 'ring', x: cellX(c), y: cellY(r), r: 0, max: CELL * 2, t: 0, d: 0.4, color: '#ffb347' });
    spark(cellX(c), cellY(r), '#ffb347', 20, 220, 3, 0.5);
    S.shake = Math.max(S.shake, 9);
    sfx.bomb();
  },
  pop(g, mul) {
    g.pop = 0;
    popN++; popX += g.x; popY += g.y;
    if (g.c < CORE) {
      orb(g.x, g.y, GEMS[g.c].color, g.c, mul, Math.random() * 0.08);
      spark(g.x, g.y, GEMS[g.c].color, lowPower ? 3 : 6, 120, 2.6, 0.4);
    }
  },
  create(g, sp) {
    g.s = 0.3;
    g.sv = 14;
    spark(g.x, g.y, '#ffffff', 14, 160, 2.4, 0.5);
    text(g.x, g.y - 20, sp === 'core' ? 'AIRSTRIKE BEACON' : sp === 'bomb' ? 'GRENADE' : 'JET STRIKE', '#ffffff', 11);
  },
  strike(reason, g) { strikeEarned(reason, g ? g.x : 195, g ? g.y - 36 : BY + 150); },
  chain(n) {
    banner(n >= 5 ? 'DEVASTATING!' : n >= 4 ? 'OUTSTANDING!' : 'NICE CHAIN!', `${n}x chain`);
    sfx.combo(n);
    buzz(25);
  },
  shuffle() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { G[r][c].s = 0.4; G[r][c].sv = 6; }
    toast('No moves left, <b>reshuffling supplies</b>');
  },
};

function clearAndAnimate(clear, creates) {
  popN = popX = popY = 0;
  E.applyClear(S, G, clear, creates, FX);
  if (popN) {
    sfx.match(S.cascade - 1);
    if (S.cascade >= 2) text(popX / popN, popY / popN, `x${S.cascade}`, '#FFD23F', 20 + Math.min(16, S.cascade * 3), 1.0, 30);
    if (S.tut === 0) { S.tut = 1; setTimeout(() => toast('Each munition <b>arms a weapon</b>. Stack one kind to upgrade it!', false, 3600), 300); }
  }
  S.popT = 0.2;
  S.bstate = 'pop';
}

function startSwap(a, b) {
  const ga = G[a[0]][a[1]], gb = G[b[0]][b[1]];
  if (!ga || !gb) return;
  E.swapGrid(G, a, b);
  ga.sw = { fx: ga.x, fy: ga.y, tx: cellX(b[1]), ty: cellY(b[0]), t: 0 };
  gb.sw = { fx: gb.x, fy: gb.y, tx: cellX(a[1]), ty: cellY(a[0]), t: 0 };
  S.swap = { a, b, back: false };
  S.bstate = 'swap';
  S.sel = null;
  S.hint = null;
  S.idleT = 0;
  sfx.swap();
}

function afterSwap() {
  const { a, b, back } = S.swap;
  if (back) { S.swap = null; S.bstate = 'idle'; return; }
  const ga = G[b[0]][b[1]], gb = G[a[0]][a[1]];
  const j = E.judgeSwap(G, a, b);
  if (!j) {
    E.swapGrid(G, a, b);
    ga.sw = { fx: ga.x, fy: ga.y, tx: cellX(a[1]), ty: cellY(a[0]), t: 0 };
    gb.sw = { fx: gb.x, fy: gb.y, tx: cellX(b[1]), ty: cellY(b[0]), t: 0 };
    S.swap.back = true;
    sfx.deny();
    buzz(15);
    return;
  }
  LOG.push(E.encodeMove(a, b));
  useMove();
  S.cascade = 1;
  if (j.core) { // airstrike beacon: a bomber hits every item of that kind
    S.fx.push({ type: 'bomber', t: 0, d: 0.75 });
    let n = 0;
    for (const key of j.clear) { const r = Math.floor(key / N), c = key % N; S.fx.push({ type: 'boom', x: cellX(c), y: cellY(r), r: 0, max: 34, t: -(0.05 + (c / N) * 0.35 + (n++ % 3) * 0.02), d: 0.35 }); }
    S.shake = 12;
    sfx.jet();
    setTimeout(() => sfx.bomb(), 220);
    buzz(40);
  }
  clearAndAnimate(j.clear, j.creates);
}

function useMove() {
  const shot = E.useMove(S);
  bumpMoves();
  syncHud();
  if (shot) bossFire(shot);
  else if (S.moves === 3) toast(`${S.boss && S.boss.present ? 'Next assault' : 'Enemy arrives'} in <b>3 moves</b>!`, true);
}

function dropAndRefill() {
  E.dropAndRefill(G, RUN.R, mkGem);
  S.bstate = 'fall';
}
function settled() {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const g = G[r][c];
    if (g.sw || g.y !== cellY(r) || g.pop >= 0) return false;
  }
  return true;
}
function endTurn() {
  const status = E.finishTurn(S, G, RUN.R, FX);
  S.bstate = 'idle';
  S.idleT = 0;
  if (status === 'over') { S.bstate = 'locked'; setTimeout(gameOver, 1300); }
  else if (status === 'night') { S.bstate = 'locked'; setTimeout(startNight, 450); }
}

// ================================================================ input
function pt(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
function cellAt(p) {
  const c = Math.floor((p.x - BX) / CELL), r = Math.floor((p.y - BY) / CELL);
  return r >= 0 && r < N && c >= 0 && c < N ? [r, c] : null;
}
cv.addEventListener('pointerdown', (e) => {
  unlockAudio();
  const pb = pt(e);
  if (pb.y < 104 && S.boss && (S.phase === 'day' || S.phase === 'night')) { // the boss bar: inspect its brain chip
    const b = S.boss, live = S.phase === 'night' && NIGHT && S.chip ? S.chip.state : b.brain;
    openChips(b.type, { state: live, inputs: E.brainInputs(b.hp, b.max, S.base, S.baseMax, S.shield, b.rage) });
    return;
  }
  if (S.phase !== 'day' || S.bstate !== 'idle') return;
  const p = pt(e), cell = cellAt(p);
  if (!cell) { S.sel = null; return; }
  S.press = { cell, x: p.x, y: p.y, done: false };
  try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
cv.addEventListener('pointermove', (e) => {
  const pr = S.press;
  if (!pr || pr.done || S.bstate !== 'idle') return;
  const p = pt(e), dx = p.x - pr.x, dy = p.y - pr.y;
  if (Math.hypot(dx, dy) < 14) return;
  const [r, c] = pr.cell;
  const t = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
  pr.done = true;
  if (t[0] < 0 || t[0] >= N || t[1] < 0 || t[1] >= N) return;
  startSwap(pr.cell, t);
});
cv.addEventListener('pointerup', () => {
  const pr = S.press;
  S.press = null;
  if (!pr || pr.done || S.bstate !== 'idle') return;
  const [r, c] = pr.cell;
  if (S.sel && Math.abs(S.sel[0] - r) + Math.abs(S.sel[1] - c) === 1) { startSwap(S.sel, pr.cell); return; }
  S.sel = S.sel && S.sel[0] === r && S.sel[1] === c ? null : pr.cell;
  if (S.sel) sfx.select();
});
cv.addEventListener('pointercancel', () => { S.press = null; });
// title: pick a mode
let pick = { kind: 'solo', level: 'normal' };
try { Object.assign(pick, JSON.parse(localStorage.getItem('nw-pick') || '{}')); } catch { /* ignore */ }
let DUEL = null;
const HINTS = {
  solo: 'Hold the line as long as you can.',
  ai: 'Same battlefield, same supplies. Outscore the AI commander, live.',
  daily: 'One battlefield for everyone today. New one at 00:00 UTC.',
};
function syncPick() {
  if (pick.kind === 'duel' && !DUEL) pick.kind = 'solo';
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === pick.kind));
  document.querySelectorAll('#lvlSeg button').forEach((b) => b.classList.toggle('on', b.dataset.l === pick.level));
  $('lvlSeg').classList.toggle('on', pick.kind === 'ai');
  $('modeHint').textContent = pick.kind === 'duel' ? '' : HINTS[pick.kind];
  $('duelCard').classList.toggle('on', pick.kind === 'duel');
  const best = loadRuns().filter((r) => r.mode === pick.kind).reduce((m, r) => Math.max(m, r.score), pick.kind === 'solo' ? S.best : 0);
  ui.best.textContent = fmt(best);
  try { localStorage.setItem('nw-pick', JSON.stringify({ level: pick.level })); } catch { /* ignore */ }
}
document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => { pick.kind = b.dataset.m; sfx.select(); syncPick(); }));
document.querySelectorAll('#lvlSeg button').forEach((b) => b.addEventListener('click', () => { pick.level = b.dataset.l; sfx.select(); syncPick(); }));
function modeFromPick() {
  if (pick.kind === 'ai') return { kind: 'ai', level: pick.level, seed: 0 };
  if (pick.kind === 'daily') return { kind: 'daily', level: null, seed: todaySeed(), day: E.dayNumber() };
  if (pick.kind === 'duel') return { kind: 'duel', level: null, seed: DUEL.seed, ghost: DUEL };
  return { kind: 'solo', level: null, seed: 0 };
}
$('playBtn').addEventListener('click', () => { unlockAudio(); newGame(modeFromPick()); });
$('againBtn').addEventListener('click', () => { unlockAudio(); newGame({ ...MODE, seed: MODE.kind === 'solo' || MODE.kind === 'ai' ? 0 : MODE.seed }); });
$('menuBtn').addEventListener('click', () => { ui.over.classList.remove('show'); ui.title.classList.add('show'); RIVAL = null; rv.box.classList.remove('show'); S.phase = 'title'; syncPick(); });
$('duelBtn').addEventListener('click', () => { unlockAudio(); openSheet('duel'); });
$('shareLinkBtn').addEventListener('click', () => { closeSheet(); shareDuel(); });
$('sheetBg').addEventListener('click', closeSheet);
$('inboxBtn').addEventListener('click', () => { sfx.select(); openSheet('inbox'); });
$('tsSendBtn').addEventListener('click', () => { unlockAudio(); sendTapeSend(); });
$('ibLoadBtn').addEventListener('click', () => { unlockAudio(); loadInbox(); });
$('inboxLink').hidden = !C.hasWallet() && !new URLSearchParams(location.search).has('rpc');
$('chainBtn').addEventListener('click', () => { unlockAudio(); submitToChain(); });
document.querySelector('#rankSeg button[data-m=chain]').hidden = !C.enabled();
$('ranksBtn').addEventListener('click', () => { sfx.select(); showRanks(pick.kind === 'duel' ? 'solo' : pick.kind); });
document.querySelectorAll('#rankSeg button').forEach((b) => b.addEventListener('click', () => showRanks(b.dataset.m)));
$('ranksBack').addEventListener('click', () => { ui.ranks.classList.remove('show'); ui.title.classList.add('show'); syncPick(); });
ui.strikeBtn.addEventListener('click', () => { unlockAudio(); callAirstrike(); });
ui.mute.classList.toggle('off', isMuted());
ui.mute.addEventListener('click', () => { unlockAudio(); ui.mute.classList.toggle('off', toggleMute()); });

// ================================================================ flow
const todaySeed = () => E.dailySeed(E.dayNumber());
function newGame(mode = MODE) {
  MODE = { ...mode, seed: mode.seed || E.randomSeed() };
  RUN = E.newRun(MODE.seed, mkGem);
  Object.assign(S, RUN.st, {
    events: [], proj: [], fx: [], texts: [], bstate: 'idle', sel: null, press: null, hint: null, swap: null, tut: 0, slow: 1,
    shown: [0, 0, 0, 0, 0], tierShown: [0, 0, 0, 0, 0], baseHold: 0, shieldHold: 0, lead: 0, leadT: 0,
  });
  RUN.st = S;
  G = RUN.G;
  LOG = [];
  NIGHT = null;
  RIVAL = MODE.kind === 'ai' ? makeRival(MODE.seed, MODE.level) : MODE.kind === 'duel' ? makeRival(MODE.seed, 'ghost', MODE.ghost.actions) : null;
  rv.box.classList.toggle('show', !!RIVAL);
  rvLast = {};
  if (RIVAL) rv.name.textContent = MODE.kind === 'duel' ? 'FRIEND' : `AI · ${LEVELS[MODE.level].label}`;
  ORBS.forEach((o) => { o.on = false; });
  P.forEach((p) => { p.on = false; });
  shownScore = 0;
  ui.score.textContent = '0';
  S.bp = { x: 195, y: 112, s: 0.36 };
  ui.title.classList.remove('show');
  ui.over.classList.remove('show');
  ui.ranks.classList.remove('show');
  startDay(true);
}
function startDay(first = false) {
  S.phase = 'day';
  stage.classList.remove('night');
  if (!first && E.startDay(RUN)) FX.shuffle();
  S.bstate = first ? 'fall' : 'idle';
  syncHud();
  bumpMoves();
  if (first) {
    const msg = MODE.kind === 'ai' ? `Same battlefield as the <b>AI commander</b>. Outscore it!`
      : MODE.kind === 'duel' ? `Your friend scored <b>${MODE.ghost.score}</b> on this exact battlefield. Beat it!`
        : MODE.kind === 'daily' ? `<b>Daily Op</b>: everyone fights this battlefield today.`
          : `<b>${S.boss.name}</b> is inbound. Swap supplies to <b>match 3</b> and arm the base.`;
    setTimeout(() => toast(msg, false, 3600), 500);
  }
}

function startNight() {
  if (S.phase !== 'day') return;
  S.phase = 'night';
  S.bstate = 'locked';
  S.sel = null;
  S.hint = null;
  stage.classList.add('night');
  ORBS.forEach((o) => { if (o.on) { S.shown[o.gi] += o.val; o.on = false; } });
  const plan = E.planNight(S);
  NIGHT = { plan, cr: RUN.CR.s, strikes: [], i: 0, endAt: -1, tx: {} };
  NIGHT.script = E.simNight(plan, [], NIGHT.cr);
  S.shown = S.charge.map((v) => v / 2);
  S.nt = 0;
  syncHud();
  banner('INCOMING!', `${S.boss.name} · ${S.boss.role}`);
  sfx.siren();
  buzz(40);
  if (S.strikes > 0) setTimeout(() => toast('Tap <b>CALL AIRSTRIKE</b> to send in the jets!', false, 3000), 1500);
  else if (!plan.events.some((e) => e.kind !== 'boss')) setTimeout(() => toast('<b>No weapons armed!</b> Brace for impact.', true, 3200), 1400);
}

// play the engine's fight script: every number comes from it, the animation only shows it
function nightEntry(e) {
  const b = S.boss;
  if (!b) return;
  switch (e.type) {
    case 'heal':
      S.base = e.base;
      text(195, BASE_Y - 40, `+${e.v / 10} REPAIRED`, '#3DDC97', 15);
      spark(195, BASE_Y, '#3DDC97', 30, 160, 2.6, 0.7);
      sfx.repair();
      break;
    case 'fire': fireWeapon(e); break;
    case 'hit': hitBoss(e); break;
    case 'kill': bossKilled(); break;
    case 'bfire': { // the brain chip just stepped: telegraph its decision
      b.charge = e.action === 1 ? 0.9 : 0.45;
      NIGHT.tx[e.id] = 40 + Math.random() * (W - 80);
      S.chip = { action: e.action, t: S.time, state: e.brain };
      if (e.action) {
        text(S.bp.x, S.bp.y - 70 * S.bp.s - 14, E.ACTIONS[e.action], ACTION_COL[e.action], 14, 1.0, 16);
        if (e.action === 1) sfx.siren();
      }
      break;
    }
    case 'blaunch':
      if (e.action === 3) { spark(S.bp.x, S.bp.y, '#3DDC97', 26, 140, 2.6, 0.8); sfx.repair(); }
      else launchBossShot(NIGHT.tx[e.id] ?? 195, 0, e.action);
      break;
    case 'bhit':
      S.shield = e.shield;
      S.base = e.base;
      if (e.action === 3) { b.hp = e.hp; text(S.bp.x, S.bp.y - 20, `+${Math.round(b.max * 0.008)} REPAIRED`, '#3DDC97', 15, 1.1, 30); break; }
      if (e.action === 2) { S.fx.push({ type: 'shieldHit', t: 0, d: 0.6 }); S.fx.push({ type: 'ring', x: NIGHT.tx[e.id] ?? 195, y: BASE_Y - 20, r: 0, max: 120, t: 0, d: 0.5, color: '#3FC8FF' }); text(195, BASE_Y - 70, e.absorbed > 0 ? 'EMP · SHIELD DOWN' : 'EMP', '#3FC8FF', 14); sfx.shield(); if (e.rest > 0) damageFx(e.rest, NIGHT.tx[e.id] ?? 195); break; }
      shotLandsFx(e.absorbed, e.rest, NIGHT.tx[e.id] ?? 195, e.shield);
      break;
    case 'strike': S.strikes = e.strikes; syncHud(); break;
    case 'slamfire': { // arsenal spent, war machine still standing: its signature weapon
      if (e.k === 0) {
        banner(`${E.SIGNATURE[b.type]}!`, `${b.name} unleashes its weapon`);
        sfx.siren();
        b.charge = 0.9;
        S.shake = Math.max(S.shake, 6);
      }
      const tx = 50 + Math.random() * (W - 100);
      NIGHT.tx[`s${e.k}`] = tx;
      b.recoil = 1;
      const sx = S.bp.x + (Math.random() - 0.5) * 60 * S.bp.s, sy = S.bp.y + 26 * S.bp.s;
      S.proj.push({ kind: 'slam', style: b.type, sx, sy, cx: (sx + tx) / 2 + (b.type === 1 ? (Math.random() - 0.5) * 220 : 0), cy: b.type === 2 ? sy + 20 : sy + 60, tx, ty: BASE_Y - 6, t: 0, d: 0.45, color: b.color });
      if (b.type === 0) sfx.laser(); else if (b.type === 2) sfx.cannon(); else sfx.missile();
      break;
    }
    case 'slam':
      S.shield = e.shield;
      S.base = e.base;
      shotLandsFx(e.absorbed, e.rest, NIGHT.tx[`s${e.k}`] ?? 195, e.shield);
      break;
    case 'over': closeNight(); gameOver(); break;
    default:
  }
}

function fireWeapon(e) {
  const b = S.boss;
  const w = e.w, tur = TURRETS[w], tier = e.tier;
  S.ammo[w] = Math.max(0, S.ammo[w] - 1);
  S.wpulse[w] = 1;
  const hx = S.bp.x + (Math.random() - 0.5) * 80 * S.bp.s, hy = S.bp.y + (Math.random() - 0.3) * 44 * S.bp.s;
  const ang = Math.atan2(hy - tur.y, hx - tur.x);
  const mx = tur.x + Math.cos(ang) * 20, my = tur.y + Math.sin(ang) * 20;
  b.look = Math.atan2(tur.y - S.bp.y, tur.x - S.bp.x);
  const vol = E.volley(w, tier, 0);
  vol.forEach((v, j) => {
    const t0 = -v.delay / v.d, vd = v.d / 1000;
    if (w === 0) { // machine gun tracers
      const tx = hx + (Math.random() - 0.5) * 30, ty = hy + (Math.random() - 0.5) * 20;
      S.proj.push({ kind: 'tracer', sx: mx, sy: my, cx: (mx + tx) / 2, cy: (my + ty) / 2, tx, ty, t: t0, d: vd, color: '#FFE08A' });
    } else if (w === 1) { // mortar / howitzer shells, MLRS rockets
      const n = vol.length;
      S.proj.push({ kind: tier === 2 ? 'rocket' : 'shell', sx: mx, sy: my, cx: (mx + hx) / 2 + (j - (n - 1) / 2) * 30, cy: Math.min(my, hy) - (tier === 0 ? 130 : 90), tx: hx + (j - (n - 1) / 2) * 16, ty: hy, t: t0, d: vd, color: GEMS[1].color, splash: true });
    } else { // guided missile salvo
      S.proj.push({ kind: 'missile', sx: mx, sy: my, cx: tur.x + (Math.random() - 0.5) * 280, cy: tur.y - 60 - Math.random() * 120, tx: hx + (j - vol.length / 2) * 12, ty: hy, t: t0, d: vd, color: GEMS[2].color });
    }
  });
  if (w === 0) { sfx.mg(); setTimeout(() => sfx.mg(), 70); setTimeout(() => sfx.mg(), 140); }
  else if (w === 1) { spark(mx, my, '#ffd28a', 10, 100, 2.6, 0.3); smoke(mx, my, 4); sfx.cannon(); }
  else sfx.missile();
}

function callAirstrike() {
  const b = S.boss;
  if (S.phase !== 'night' || !NIGHT || S.strikes <= 0 || !b || b.dying >= 0) return;
  const ts = Math.floor(S.nt * 1000); // ms
  NIGHT.strikes.push(ts);
  NIGHT.script = E.simNight(NIGHT.plan, NIGHT.strikes, NIGHT.cr);
  const en = NIGHT.script.entries;
  let i = 0;
  while (i < en.length && en[i].t <= ts) i++;
  NIGHT.i = i;
  NIGHT.endAt = -1;
  S.strikes--;
  syncHud();
  const y0 = Math.max(SKY_TOP + 40, S.bp.y - 70);
  S.fx.push({ type: 'flyover', y: y0, t: 0, d: 1.1 });
  for (let j = 0; j < 3; j++) {
    const dx = (j - 1) * 46, v = E.BOMB(j);
    S.proj.push({ kind: 'bomb', sx: S.bp.x + dx - 60, sy: y0 + (j - 1) * 6, cx: S.bp.x + dx - 20, cy: y0, tx: S.bp.x + dx * 0.6, ty: S.bp.y + 6, t: -v.delay / v.d, d: v.d / 1000, color: '#ffb347', splash: true });
  }
  sfx.strike();
  buzz(50);
  banner('AIRSTRIKE', 'jets inbound');
}

function hitBoss(e) {
  const b = S.boss;
  b.hp = e.hp;
  S.score = e.score;
  b.flash = 0.08;
  const big = e.src === 1 || e.src === 'bomb';
  const color = e.src === 'bomb' ? '#ffb347' : GEMS[e.src].color;
  const x = S.bp.x + (Math.random() - 0.5) * 80 * S.bp.s, y = S.bp.y + (Math.random() - 0.3) * 44 * S.bp.s;
  spark(x, y, color, lowPower ? 4 : big ? 14 : 7, big ? 220 : 160, 2.6, 0.4);
  if (e.d >= 30 || e.crit) text(x + (Math.random() - 0.5) * 24, y - 10, e.crit ? `CRIT ${Math.ceil(e.d / 10)}` : `${Math.ceil(e.d / 10)}`, e.crit ? '#FFD23F' : '#ffffff', e.crit ? 17 : big ? 15 : 12, 0.8, 44);
  sfx.impact();
}
function bossKilled() {
  const b = S.boss;
  b.dying = 2.2;
  S.slow = 0.35;
  S.proj = S.proj.filter((p) => p.kind !== 'bossShot');
  ui.strikeBtn.classList.remove('show');
  sfx.bossDown();
  buzz(80);
}

function bossFire(shot) { // daytime: a boss holding the sky shells the base (the engine already counted it)
  const b = S.boss;
  if (!b) return;
  b.charge = 0.45;
  S.baseHold += shot.rest;
  S.shieldHold = (S.shieldHold || 0) + shot.absorbed;
  const tx = 40 + Math.random() * (W - 80);
  setTimeout(() => launchBossShot(tx, shot), 380);
}
const ACTION_COL = ['#ff8a8a', '#ff4a4a', '#3FC8FF', '#3DDC97'];
function launchBossShot(tx, dayShot = null, action = 0) {
  if (!S.boss || S.boss.dying >= 0 || S.phase === 'over' || S.phase === 'title') { if (dayShot) { S.baseHold = 0; S.shieldHold = 0; } return; }
  S.boss.recoil = 1;
  const sx = S.bp.x, sy = S.bp.y + 30 * S.bp.s;
  S.proj.push({ kind: 'bossShot', sx, sy, cx: (sx + tx) / 2 + (Math.random() - 0.5) * 140, cy: sy + 50, tx, ty: BASE_Y - 6, t: 0, d: E.BOSS_FLIGHT / 1000, dayShot, action, color: action === 2 ? '#3FC8FF' : '#ff4a4a' });
  if (action === 1) { smoke(sx, sy, 6); S.shake = Math.max(S.shake, 6); }
  smoke(sx, sy, 5);
  sfx.bossShot();
}
function shotLandsFx(absorbed, rest, x, shieldLeft) {
  if (absorbed > 0) {
    S.fx.push({ type: 'shieldHit', t: 0, d: 0.4 });
    S.fx.push({ type: 'boom', x, y: BASE_Y - 56, r: 0, max: 36, t: 0, d: 0.35 });
    spark(x, BASE_Y - 56, '#3FC8FF', 14, 160, 2.4, 0.45);
    text(x, BASE_Y - 66, shieldLeft <= 0 ? 'SHIELD DOWN' : 'INTERCEPTED', '#3FC8FF', 12);
    sfx.shield();
  }
  if (rest > 0) damageFx(rest, x);
}
function damageFx(d, x) {
  S.shake = 12;
  S.flash = 0.45;
  S.flashCol = '255,60,60';
  spark(x, BASE_Y - 6, '#ff6b6b', 24, 200, 2.8, 0.6, 300);
  smoke(x, BASE_Y - 10, 8);
  S.fx.push({ type: 'boom', x, y: BASE_Y - 6, r: 0, max: 60, t: 0, d: 0.45 });
  text(x, BASE_Y - 30, `-${Math.round(d / 10)}`, '#ff6b6b', 16);
  sfx.baseHit();
  buzz(45);
}

function closeNight() { // log the night and hand the result to the engine
  if (!NIGHT) return;
  LOG.push(E.encodeNight(NIGHT.strikes));
  E.finishNight(RUN, NIGHT.script);
  NIGHT = null;
}
function endNight() {
  const b = S.boss;
  closeNight();
  E.bossHolds(S);
  const first = b.rage === 1;
  ui.strikeBtn.classList.remove('show');
  banner(`${b.name} HOLDS THE SKY`, `Rage ${b.rage}  ·  ${Math.ceil(b.hp / 10)} HP left`);
  sfx.siren();
  setTimeout(() => {
    if (S.phase !== 'night') return;
    startDay();
    toast(first
      ? `It won't leave. <b>Every 4 moves it fires</b> at your base, and each assault hits harder. Arm up and finish it.`
      : `Rage ${b.rage}: the next assault hits <b>${Math.round(25 * b.rage)}% harder</b>.`, true, 4200);
  }, 1600);
}
function bossDefeated() {
  const refund = NIGHT ? NIGHT.script.refund : [0, 0, 0];
  closeNight();
  S.shown = S.charge.map((v) => v / 2);
  const back = refund.reduce((a, v) => a + v / 6, 0);
  if (back > 0) setTimeout(() => toast(`<b>${back} unfired shot${back > 1 ? 's' : ''}</b> returned to the arsenal`, false, 3000), 900);
  const bonus = E.bossDefeated(S);
  S.boss = null;
  banner('TARGET DESTROYED', `+${bonus}  ·  base repaired`);
  S.flash = 0.8;
  S.flashCol = '255,255,255';
  S.slow = 1;
  setTimeout(() => {
    if (S.phase === 'over') return;
    E.nextStage(S);
    S.bp = { x: 195, y: -80, s: 0.3 };
    startDay();
    toast(`Stage ${S.stageNo}: <b>${S.boss.name}</b> (${S.boss.role}) inbound`, true, 3000);
  }, 2000);
}

// ================================================================ runs, leaderboard, duels
function loadRuns() { try { return JSON.parse(localStorage.getItem('nw-runs') || '[]'); } catch { return []; } }
function saveRun(run) {
  const all = loadRuns();
  all.push(run);
  const keep = [];
  for (const m of ['solo', 'ai', 'daily', 'duel']) keep.push(...all.filter((r) => r.mode === m).sort((a, b) => b.score - a.score).slice(0, 15));
  try { localStorage.setItem('nw-runs', JSON.stringify(keep)); } catch { /* storage full or blocked */ }
}
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function duelLink() {
  const data = { s: MODE.seed, sc: S.score, st: S.stageNo, a: LOG.join(',') };
  return `${location.origin}${location.pathname}#duel=${b64(JSON.stringify(data))}`;
}
// a friend's challenge link: their seed and every move they made, checked by replaying it before you fight it
function readDuel() {
  const m = location.hash.match(/duel=([\w-]+)/);
  if (!m) return null;
  try {
    const d = JSON.parse(unb64(m[1]));
    const actions = d.a ? d.a.split(',') : [];
    const check = E.replay(d.s >>> 0, actions);
    if (!check.ok || !check.st.over || check.st.score !== d.sc) return { bad: true };
    return { seed: d.s >>> 0, actions, score: d.sc, stage: d.st };
  } catch { return { bad: true }; }
}

let lastResult = null;
function gameOver() {
  if (S.phase === 'over') return;
  S.phase = 'over';
  S.slow = 0.3;
  ui.strikeBtn.classList.remove('show');
  sfx.over();
  closeNight();
  const check = E.replay(MODE.seed, LOG);
  const ok = check.ok && check.st.over && check.st.score === S.score;
  const prev = loadRuns().filter((r) => r.mode === MODE.kind).reduce((m, r) => Math.max(m, r.score), 0);
  const isBest = S.score > prev;
  lastResult = { mode: MODE.kind, level: MODE.level, score: S.score, stage: S.stageNo, kills: S.bossesDown, t: Date.now(), seed: MODE.seed, ok, log: LOG.join(',') };
  if (S.score > 0) saveRun(lastResult);
  if (MODE.kind === 'solo' && isBest) { S.best = S.score; try { localStorage.setItem('nw-best', String(S.best)); } catch { /* ignore */ } }
  setTimeout(() => {
    $('ovTitle').textContent = 'The base fell';
    $('ovTitle').className = 'ov-title';
    $('ovDay').textContent = `Reached stage ${S.stageNo}${MODE.kind === 'daily' ? ' · Daily Op' : ''}`;
    $('ovScore').textContent = fmt(S.score);
    $('ovKills').textContent = S.bossesDown;
    $('ovBest').textContent = fmt(Math.max(prev, S.score));
    $('ovNew').classList.toggle('on', isBest && S.score > 0);
    $('ovVerify').innerHTML = ok
      ? `<span class="ok">✓</span> Score verified by replaying all ${LOG.length} actions · seed ${MODE.seed.toString(16).toUpperCase()}`
      : `<span class="bad">✗</span> Replay mismatch (${check.reason || (!check.st.over ? 'replay did not end the run' : `replay gave ${check.st.score}`)})`;
    $('ovVs').classList.toggle('on', !!RIVAL);
    $('chainRow').classList.toggle('on', C.enabled() && ok && MODE.kind !== 'duel' && S.score > 0);
    $('chainBtn').disabled = false;
    $('chainSt').textContent = MODE.kind === 'daily' ? 'Replayed by the Nightwire engine on X Layer, then ranked on today\'s board.' : 'Replayed by the Nightwire engine on X Layer, then ranked all-time.';
    if (RIVAL) {
      $('vsYou').textContent = fmt(S.score);
      $('vsYouS').textContent = `stage ${S.stageNo}`;
      $('vsThemL').textContent = rv.name.textContent;
      const show = () => {
        const them = RIVAL.st;
        $('vsThem').textContent = fmt(them.score);
        $('vsThemS').textContent = `stage ${them.stageNo}`;
        const win = S.score > them.score, draw = S.score === them.score;
        $('ovTitle').textContent = draw ? 'DRAW' : win ? 'VICTORY' : 'DEFEATED';
        $('ovTitle').className = `ov-title ${win ? 'win' : draw ? '' : ''}`;
        if (win) sfx.bossDown();
      };
      if (RIVAL.finished) show();
      else { $('vsThem').textContent = '…'; $('vsThemS').textContent = 'still fighting'; RIVAL.fastForward(show); }
    }
    ui.toast.classList.remove('show');
    rv.box.classList.remove('show');
    ui.over.classList.add('show');
  }, 1300);
}

// ---------------------------------------------------------------- TapeSend (challenges between TapeOut containers)
let myCircuit = '';
try { myCircuit = localStorage.getItem('nw-circuit') || ''; } catch { /* ignore */ }
function openSheet(kind) {
  $('sheet2').className = `show ${kind}`;
  $('sheetBg').classList.add('show');
  $('tsFrom').value = myCircuit;
  $('ibName').value = myCircuit;
}
function closeSheet() { $('sheet2').className = ''; $('sheetBg').classList.remove('show'); paused = false; }

// ---------------------------------------------------------------- chip inspector
const PERSONA = [
  'Relentless: every third shot is focus fire. Two LATCHes count its shots.',
  'Hunter: knocks out a raised shield with an EMP, then follows up with focus fire. One LATCH remembers the EMP.',
  'Fortress: repairs itself once when below half health, and focus-fires once enraged. One LATCH remembers the repair.',
  'Swarm: alternates barrage and focus fire, EMPs shields when enraged, keeps one emergency repair. Two LATCHes.',
  'Siege: focus fire every other shot; once rage reaches 2 it EMPs any raised shield. One LATCH keeps the rhythm.',
  'Stealth: one cloaked repair as soon as it drops below 75%, then EMPs every raised shield. One LATCH remembers the cloak.',
  'Gait: barrage, barrage, focus, in step with its six legs; always focus fire when critical. Two LATCHes count the steps.',
  'Orbital: charges its lance every other beat; when critical it repairs on the off-beats. One LATCH is the charge.',
];
const inspector = makeInspector($('chipSheet'), {
  onTap: () => sfx.select(),
  onInfo: ({ type, c }) => {
    const b = E.BOSSES[type], ch = E.brainOf(type).chip;
    $('chName').textContent = `${b.name} brain`;
    const where = ONCHAIN && ONCHAIN.processor ? `Circuit #${type + 1} on the Nightwire Armory, X Layer.` : 'Taped out on the Nightwire Armory processor at launch.';
    $('chInfo').textContent = `${c.nand} NAND + ${c.latch} LATCH · ${(ch.netlist.length - 2) / 2}-byte netlist. ${PERSONA[type]} ${where}`;
    document.querySelectorAll('#chSeg button').forEach((x) => x.classList.toggle('on', Number(x.dataset.t) === type));
  },
});
function openChips(type, live) {
  if (S.phase === 'day' || S.phase === 'night') paused = true;
  openSheet('chip');
  requestAnimationFrame(() => inspector.open(type, live && live.state, live && live.inputs));
}
document.querySelectorAll('#chSeg button').forEach((x) => x.addEventListener('click', () => { sfx.select(); inspector.open(Number(x.dataset.t)); }));
$('chStep').addEventListener('click', () => { sfx.select(); inspector.step(); });
$('chReset').addEventListener('click', () => inspector.reset());
$('chipsBtn').addEventListener('click', () => { unlockAudio(); openChips(0); });
function rememberCircuit(v) { myCircuit = v.trim(); try { localStorage.setItem('nw-circuit', myCircuit); } catch { /* ignore */ } }
async function sendTapeSend() {
  const st = $('tsSt'), btn = $('tsSendBtn');
  const from = $('tsFrom').value.trim(), to = $('tsTo').value.trim();
  if (!TS.parseName(from) || !TS.parseName(to)) { st.innerHTML = '<span class="bad">✗</span> Use X Layer TapeOut names like <b>7.2.231</b>.'; return; }
  rememberCircuit(from);
  btn.disabled = true;
  try {
    st.textContent = 'Checking both circuits on X Layer…';
    const payload = TS.challengePayload({ score: S.score, stage: S.stageNo, link: duelLink() });
    const { hash } = await TS.sendChallenge(from, to, payload);
    st.innerHTML = `Sent. Waiting for X Layer… <a href="${C.txUrl(hash)}" target="_blank" rel="noopener">view tx</a>`;
    const ok = await C.waitFor(hash);
    st.innerHTML = ok ? `<span class="ok">✓ Delivered</span> to ${to}'s TapeSend inbox. <a href="${C.txUrl(hash)}" target="_blank" rel="noopener">view tx</a>` : `<span class="bad">✗</span> The transaction failed.`;
    if (ok) sfx.upgrade();
  } catch (e) {
    const m = String(e.message || e);
    const why = /853f2907|NotCPU/.test(m) ? 'TapeSend does not accept circuits from processors made after TapeOut\'s factory upgrade yet. Try a circuit on an older processor.'
      : /NotHolder|7623fb52/.test(m) ? 'Your connected wallet does not hold that circuit.'
        : /NotOpened|6d36408a/.test(m) ? 'That circuit\'s container is not opened yet (open it once in TapeOut).' : m.slice(0, 140);
    st.innerHTML = `<span class="bad">✗</span> ${why}`;
  }
  btn.disabled = false;
}
async function loadInbox() {
  const name = $('ibName').value.trim(), list = $('ibList');
  if (!TS.parseName(name)) { list.innerHTML = '<li class="empty">Use an X Layer TapeOut name like 7.2.231.</li>'; return; }
  rememberCircuit(name);
  list.innerHTML = '<li class="empty">Reading your inbox on X Layer…</li>';
  try {
    const msgs = await TS.inbox(name);
    list.innerHTML = msgs.length ? msgs.map((m, i) => `<li><span class="rm">${C.short(m.from)} · ${new Date(m.at * 1000).toLocaleDateString()}</span><button class="play" data-i="${i}">Play</button><span class="msg">${m.body.replace(/https?:\/\/\S+/, '').replace(/[<>&]/g, '')}</span></li>`).join('')
      : '<li class="empty">No Nightwire challenges yet.</li>';
    list.querySelectorAll('.play').forEach((b) => b.addEventListener('click', () => {
      const hash = msgs[Number(b.dataset.i)].link.split('#')[1];
      location.hash = hash;
      location.reload();
    }));
  } catch (e) {
    list.innerHTML = `<li class="empty">Couldn't read the inbox (${String(e.message || e).slice(0, 80)}).</li>`;
  }
}

function shareDuel() {
  if (!lastResult) return;
  const url = duelLink();
  const msg = `I scored ${fmt(S.score)} on Nightwire (stage ${S.stageNo}). Same battlefield, same supplies. Beat me:`;
  if (navigator.share) { navigator.share({ title: 'Nightwire duel', text: msg, url }).catch(() => {}); return; }
  const done = () => toast('<b>Challenge link copied.</b> Send it to a friend!', false, 2600);
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(`${msg} ${url}`).then(done, () => window.prompt('Copy this link', url));
  else window.prompt('Copy this challenge link', url);
}

// put a finished run on X Layer: a free dry run first, then the player's wallet sends it
async function submitToChain() {
  if (!lastResult) return;
  const st = $('chainSt'), btn = $('chainBtn');
  const hex = E.encodeBinary(lastResult.log.split(','));
  const day = MODE.kind === 'daily' ? MODE.day : C.FREE_PLAY;
  btn.disabled = true;
  try {
    st.textContent = 'Asking X Layer to replay your run…';
    const chk = await C.checkRun(lastResult.seed, hex);
    if (chk.tooLong) st.innerHTML = 'A long campaign: too big for a free preview, X Layer will replay it when you submit. Confirm in your wallet…';
    else {
      if (!chk.ok || !chk.over || chk.score !== lastResult.score) { st.innerHTML = `<span class="bad">✗</span> X Layer's replay disagrees (${chk.score}).`; btn.disabled = false; return; }
      let fee = null;
      try { fee = await C.estimateFee(day, lastResult.seed, hex); } catch { /* shown without a fee */ }
      st.innerHTML = `<span class="ok">✓</span> X Layer replayed it: <b>${fmt(chk.score)}</b>${fee !== null ? ` · fee ≈ ${fee.toFixed(4)} OKB` : ''}. Confirm in your wallet…`;
    }
    const { hash } = await C.submitRun(day, lastResult.seed, hex);
    st.innerHTML = `Sent. Waiting for X Layer… <a href="${C.txUrl(hash)}" target="_blank" rel="noopener">view tx</a>`;
    const good = await C.waitFor(hash);
    if (!good) { st.innerHTML = `<span class="bad">✗</span> The transaction failed. <a href="${C.txUrl(hash)}" target="_blank" rel="noopener">details</a>`; btn.disabled = false; return; }
    const board = MODE.kind === 'daily' ? await C.dailyBoard(day) : await C.allTimeBoard();
    const rank = board.findIndex((e) => e.score === lastResult.score) + 1;
    st.innerHTML = `<span class="ok">✓ On chain.</span> ${rank ? `Rank <b>#${rank}</b> ${MODE.kind === 'daily' ? 'today' : 'all-time'}. ` : ''}<a href="${C.txUrl(hash)}" target="_blank" rel="noopener">view tx</a>`;
    sfx.upgrade();
  } catch (e) {
    st.innerHTML = `<span class="bad">✗</span> ${String(e.message || e).slice(0, 140)}`;
    btn.disabled = false;
  }
}

async function showChainRanks() {
  const list = $('rankList');
  list.innerHTML = '<li class="empty">Reading X Layer…</li>';
  try {
    const day = await C.today();
    const [d, a] = await Promise.all([C.dailyBoard(day), C.allTimeBoard()]);
    const rows = (xs) => (xs.length ? xs.map((r, i) => `<li><span class="rk">${i + 1}</span><span class="rs">${fmt(r.score)}</span><span class="rm">stage ${r.stage}<br>${C.short(r.player)}</span><span class="rv ok">✓</span></li>`).join('') : '<li class="empty">No verified runs yet.</li>');
    list.innerHTML = `<li class="sec"><span>TODAY'S DAILY OP</span></li>${rows(d.slice(0, 5))}<li class="sec"><span>ALL-TIME</span></li>${rows(a.slice(0, 5))}`;
  } catch (e) {
    list.innerHTML = `<li class="empty">Couldn't reach X Layer (${String(e.message || e).slice(0, 60)}).</li>`;
  }
}

function showRanks(mode) {
  if (mode === 'chain') {
    ui.ranks.classList.add('show');
    ui.title.classList.remove('show');
    document.querySelectorAll('#rankSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    $('rankNote').textContent = 'Every run here was replayed by the Nightwire engine on X Layer; the war machines think with TapeOut circuits.';
    showChainRanks();
    return;
  }
  $('rankNote').textContent = 'Runs on this device. ✓ means the score was re-checked by replaying every move from the seed.';
  ui.ranks.classList.add('show');
  ui.title.classList.remove('show');
  document.querySelectorAll('#rankSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
  const rows = loadRuns().filter((r) => r.mode === mode).sort((a, b) => b.score - a.score).slice(0, 10);
  $('rankList').innerHTML = rows.length ? rows.map((r, i) => `<li><span class="rk">${i + 1}</span><span class="rs">${fmt(r.score)}</span><span class="rm">stage ${r.stage}${r.level ? ` · ${r.level}` : ''}<br>${new Date(r.t).toLocaleDateString()}</span><span class="rv ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span></li>`).join('')
    : '<li class="empty">No runs yet. Go hold the line.</li>';
}

// ================================================================ rival panel
const rv = { box: $('rival'), cv: $('rivalCv'), name: $('rvName'), stage: $('rvStage'), score: $('rvScore'), base: $('rvBase'), status: $('rvStatus'), lead: $('rvLead'), pop: $('rvPop') };
const rctx = rv.cv.getContext('2d');
let rvLast = {};
function setTxt(el, key, v) { if (rvLast[key] !== v) { rvLast[key] = v; el.textContent = v; } }
function rvPop(str, col = '#FFD23F') {
  rv.pop.textContent = str;
  rv.pop.style.color = col;
  rv.pop.classList.remove('show');
  void rv.pop.offsetWidth;
  rv.pop.classList.add('show');
}
function rivalEvents() {
  for (const e of RIVAL.ev.splice(0)) {
    if (e.type === 'chain') rvPop(`x${e.n} CHAIN`);
    else if (e.type === 'strike') rvPop('AIRSTRIKE');
    else if (e.type === 'bomber') rvPop('BOMBER', '#ff7a7a');
    else if (e.type === 'hit') { rv.box.classList.remove('hit'); void rv.box.offsetWidth; rv.box.classList.add('hit'); }
    else if (e.type === 'kill') { rvPop(`${e.name} DOWN`, '#3DDC97'); toast(`${rv.name.textContent} destroyed <b>${e.name}</b>`, false, 2400); }
    else if (e.type === 'fell') { rvPop('BASE FELL', '#ff6b6b'); toast(`The rival's base fell at stage ${RIVAL.st.stageNo}. Beat <b>${fmt(RIVAL.st.score)}</b>!`, false, 3200); }
  }
  // lead changes
  const d = S.score - RIVAL.st.score, sgn = Math.sign(d);
  if (sgn && sgn !== S.lead && S.time - S.leadT > 4 && S.score + RIVAL.st.score > 300) {
    S.leadT = S.time;
    if (sgn > 0) { text(195, 214, 'YOU TOOK THE LEAD', '#3DDC97', 14, 1.6, 10); sfx.upgrade(); }
    else text(195, 214, 'RIVAL TAKES THE LEAD', '#ff6b6b', 14, 1.6, 10);
  }
  if (sgn) S.lead = sgn;
}
function drawRival() {
  const R = RIVAL, st = R.st, sz = rv.cv.width, cs = sz / N;
  if (R.dirty || R.flash.length || R.phase === 'night' || rvLast.night) {
    R.dirty = false;
    rctx.clearRect(0, 0, sz, sz);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const g = R.run.G[r][c];
      rctx.fillStyle = g.c === CORE ? '#ff4a4a' : GEMS[g.c].color;
      rctx.globalAlpha = R.phase === 'night' ? 0.35 : 0.9;
      rctx.fillRect(c * cs + 0.6, r * cs + 0.6, cs - 1.2, cs - 1.2);
      if (g.sp) { rctx.globalAlpha = 1; rctx.fillStyle = '#fff'; rctx.fillRect(c * cs + cs * 0.35, r * cs + cs * 0.35, cs * 0.3, cs * 0.3); }
    }
    rctx.fillStyle = '#fff';
    for (const [r, c, t] of R.flash) { if (t <= 0) continue; rctx.globalAlpha = t / 0.35; rctx.fillRect(c * cs, r * cs, cs, cs); }
    rctx.globalAlpha = 1;
    rvLast.night = R.phase === 'night';
    if (R.phase === 'night') { // the rival's fight: boss health draining
      const hp = R.night.hp / st.boss.max;
      rctx.fillStyle = 'rgba(0,0,0,0.6)';
      rctx.fillRect(sz * 0.1, sz * 0.44, sz * 0.8, sz * 0.12);
      rctx.fillStyle = st.boss.color;
      rctx.fillRect(sz * 0.1, sz * 0.44, sz * 0.8 * hp, sz * 0.12);
    }
  }
  setTxt(rv.stage, 'stage', `S${st.stageNo}`);
  setTxt(rv.score, 'score', fmt(st.score));
  const base = R.phase === 'night' ? R.night.base : st.base;
  const bw = `${Math.max(0, base / st.baseMax) * 100}%`;
  if (rvLast.bw !== bw) { rvLast.bw = bw; rv.base.style.width = bw; }
  setTxt(rv.status, 'status', R.phase === 'over' ? 'BASE FELL' : R.phase === 'night' ? `vs ${st.boss.name}` : `${st.moves} moves left`);
  const d = S.score - st.score;
  setTxt(rv.lead, 'lead', d === 0 ? 'TIED' : d > 0 ? `YOU +${fmt(d)}` : `YOU −${fmt(-d)}`);
  rv.lead.className = `rv-lead ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`;
}

// ================================================================ update
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const bez = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

function updateBoard(dt) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const g = G[r][c];
    if (!g) continue;
    if (g.sw) {
      g.sw.t = Math.min(1, g.sw.t + dt / 0.16);
      const e = ease(g.sw.t);
      g.x = g.sw.fx + (g.sw.tx - g.sw.fx) * e;
      g.y = g.sw.fy + (g.sw.ty - g.sw.fy) * e;
      if (g.sw.t >= 1) { g.x = g.sw.tx; g.y = g.sw.ty; g.sw = null; }
    } else if (g.pop < 0) {
      const ty = cellY(r);
      g.x += (cellX(c) - g.x) * Math.min(1, dt * 20);
      if (Math.abs(cellX(c) - g.x) < 0.3) g.x = cellX(c);
      if (g.y < ty) {
        g.vy += 2600 * dt;
        g.y += g.vy * dt;
        if (g.y >= ty) { g.y = ty; if (g.vy > 260) g.sq = Math.min(1, g.vy / 1100); g.vy = 0; }
      } else if (g.y > ty) g.y = ty;
    }
    if (g.pop >= 0) g.pop += dt / 0.2;
    g.sv += ((1 - g.s) * 260 - g.sv * 16) * dt;
    g.s += g.sv * dt;
    g.sq = Math.max(0, g.sq - dt * 6);
  }
  if (S.bstate === 'swap' && !G.some((row) => row.some((g) => g && g.sw))) afterSwap();
  else if (S.bstate === 'pop') { S.popT -= dt; if (S.popT <= 0) dropAndRefill(); }
  else if (S.bstate === 'fall' && settled()) {
    const runs = E.findRuns(G);
    if (runs.length) { S.cascade++; const rr = E.resolveRuns(G, runs, null); clearAndAnimate(rr.clear, rr.creates); } else endTurn();
  } else if (S.bstate === 'idle' && S.phase === 'day') {
    S.idleT += dt;
    if (S.idleT > 6 && !S.hint) S.hint = findMove();
  }
}

function update(dt) {
  S.time += dt;
  S.nb += ((S.phase === 'night' ? 1 : 0) - S.nb) * Math.min(1, dt * 2);
  S.shake = Math.max(0, S.shake - dt * 30);
  S.flash = Math.max(0, S.flash - dt * 2.2);
  for (let i = 0; i < 5; i++) S.wpulse[i] = Math.max(0, S.wpulse[i] - dt * 4);
  updateBoard(dt);

  const b = S.boss;
  if (b) {
    const day = S.phase !== 'night' && !(b.dying >= 0);
    const prog = 1 - S.moves / MOVES_PER_DAY;
    const tgt = !day ? { x: 195, y: 172, s: 1 }
      : b.present ? { x: 195 + Math.sin(S.time * 0.6) * 40, y: 150 + prog * 12, s: 0.72 + prog * 0.18 }
        : { x: 195, y: 112 + prog * 26, s: 0.36 + prog * 0.24 };
    const f = Math.min(1, dt * (day ? 3 : 2.4));
    S.bp.x += (tgt.x - S.bp.x) * f;
    S.bp.y += (tgt.y - S.bp.y) * f;
    S.bp.s += (tgt.s - S.bp.s) * f;
    b.flash = Math.max(0, b.flash - dt);
    b.charge = Math.max(0, b.charge - dt);
    b.recoil = Math.max(0, b.recoil - dt * 4);
    b.lag += (b.hp - b.lag) * Math.min(1, dt * 3);
    if (Math.random() < dt * (b.hp / b.max < 0.5 ? 6 : 0)) smoke(S.bp.x + (Math.random() - 0.5) * 60 * S.bp.s, S.bp.y - 10 * S.bp.s, 1); // damaged: smoking
    b.age = (b.age || 0) + dt;
    if (b.dying < 0 && b.hp / b.max < 0.5 && Math.random() < dt * (b.hp / b.max < 0.25 ? 7 : 2.5)) { // damaged: sparks, then fire
      const x = S.bp.x + (Math.random() - 0.5) * 90 * S.bp.s, y = S.bp.y + (Math.random() - 0.5) * 50 * S.bp.s;
      spark(x, y, b.hp / b.max < 0.25 ? '#ffb347' : '#FFE08A', 5, 120, 2, 0.4, 200);
      if (b.hp / b.max < 0.25) { smoke(x, y, 2); if (Math.random() < 0.3) S.fx.push({ type: 'boom', x, y, r: 0, max: 18, t: 0, d: 0.3 }); }
    }
    if (b.dying >= 0) {
      b.dying -= dt;
      if (Math.random() < dt * 8) debris(S.bp.x, S.bp.y, b.color, 1);
      if (Math.random() < dt * 22) {
        const x = S.bp.x + (Math.random() - 0.5) * 150, y = S.bp.y + (Math.random() - 0.5) * 90;
        S.fx.push({ type: 'boom', x, y, r: 0, max: 40 + Math.random() * 40, t: 0, d: 0.45 });
        spark(x, y, b.color, 10, 220, 3, 0.6);
        smoke(x, y, 3);
        S.shake = 9;
      }
      if (b.dying < 0) {
        spark(S.bp.x, S.bp.y, '#ffffff', 60, 320, 3.4, 0.9);
        spark(S.bp.x, S.bp.y, b.color, 60, 260, 3, 1.0);
        S.fx.push({ type: 'boom', x: S.bp.x, y: S.bp.y, r: 0, max: 230, t: 0, d: 0.7 });
        debris(S.bp.x, S.bp.y, b.color, lowPower ? 10 : 22);
        S.shake = 16;
        bossDefeated();
      }
    }
  }

  if (S.phase === 'night' && NIGHT) {
    S.nt += dt;
    const en = NIGHT.script.entries;
    while (NIGHT && NIGHT.i < en.length && en[NIGHT.i].t <= S.nt * 1000) nightEntry(en[NIGHT.i++]);
    // the boss survived the volley: give the player a moment to call a strike, then it holds the sky
    if (NIGHT && S.phase === 'night' && NIGHT.script.outcome === 'hold' && NIGHT.i >= en.length && !S.proj.length) {
      if (NIGHT.endAt < 0) NIGHT.endAt = S.nt + (S.strikes > 0 ? 3.5 : 0.9);
      else if (S.nt >= NIGHT.endAt) endNight();
    }
  }

  for (let j = S.proj.length - 1; j >= 0; j--) {
    const p = S.proj[j];
    p.t += dt / p.d;
    if (p.t < 0) continue;
    const t = Math.min(1, p.t);
    p.px = p.x ?? p.sx;
    p.py = p.y ?? p.sy;
    p.x = bez(p.sx, p.cx, p.tx, t);
    p.y = bez(p.sy, p.cy, p.ty, t);
    if ((p.kind === 'missile' || p.kind === 'rocket' || p.kind === 'bossShot' || (p.kind === 'slam' && p.style !== 0)) && Math.random() < 0.85) smoke(p.x, p.y, 1);
    if (p.kind === 'shell' && Math.random() < 0.4) smoke(p.x, p.y, 1);
    if (p.t >= 1) {
      S.proj.splice(j, 1);
      if (p.kind === 'bossShot') {
        if (p.dayShot) {
          S.baseHold = Math.max(0, S.baseHold - p.dayShot.rest);
          S.shieldHold = Math.max(0, (S.shieldHold || 0) - p.dayShot.absorbed);
          shotLandsFx(p.dayShot.absorbed, p.dayShot.rest, p.tx, S.shield);
        }
      } else if (p.kind === 'slam') { smoke(p.tx, p.ty - 10, 3); }
      else {
        spark(p.tx, p.ty, p.color, lowPower ? 2 : 4, 140, 2.4, 0.3);
        if (p.splash) { S.fx.push({ type: 'boom', x: p.tx, y: p.ty, r: 0, max: p.kind === 'bomb' ? 80 : 46, t: 0, d: 0.42 }); smoke(p.tx, p.ty, 4); S.shake = Math.max(S.shake, p.kind === 'bomb' ? 12 : 5); }
        if (p.kind === 'bomb') sfx.bomb();
      }
    }
  }
  for (let j = S.fx.length - 1; j >= 0; j--) {
    const f = S.fx[j];
    f.t += dt / f.d;
    if (f.max) f.r = f.max * (1 - (1 - Math.max(0, Math.min(1, f.t))) ** 3);
    if (f.t >= 1) S.fx.splice(j, 1);
  }
  for (let j = S.texts.length - 1; j >= 0; j--) {
    const t = S.texts[j];
    t.t += dt;
    t.y -= dt * t.rise;
    if (t.t > t.life) S.texts.splice(j, 1);
  }
  for (const o of ORBS) {
    if (!o.on) continue;
    o.t += dt / o.d;
    if (o.t < 0) continue;
    const t = Math.min(1, o.t), e = t * t;
    o.x = bez(o.sx, o.cx, o.tx, e);
    o.y = bez(o.sy, o.cy, o.ty, e);
    if (t >= 1) {
      o.on = false;
      S.shown[o.gi] += o.val;
      S.wpulse[o.gi] = 1;
      sfx.orb();
      const v = o.gi < 3 ? Math.floor(S.shown[o.gi] / 3) : o.gi === 3 ? Math.round(S.shown[o.gi] * 2) : S.shown[o.gi];
      const tier = tierOf(o.gi, v);
      if (tier > S.tierShown[o.gi]) {
        S.tierShown[o.gi] = tier;
        text(wbarX(o.gi) + 35, WBAR_Y - 6, `${GEMS[o.gi].tiers[tier]}!`, GEMS[o.gi].color, 13, 1.3, 26);
        spark(wbarX(o.gi) + 35, WBAR_Y + WBAR_H / 2, GEMS[o.gi].color, 18, 140, 2.6, 0.6);
        sfx.upgrade();
        if (!S.tutUp) { S.tutUp = true; toast(`Upgraded to <b>${GEMS[o.gi].tiers[tier]}</b>! Keep stacking for the top tier.`, false, 3000); }
      }
    }
  }
  if (S.phase === 'night') S.tierShown = [S.wtier[0], S.wtier[1], S.wtier[2], 0, 0];
  for (let j = 0; j < MAXP; j++) {
    const p = P[j];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) { p.on = false; continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - dt * 3;
    p.vy *= 1 - dt * 3;
  }
  if (shownScore !== S.score) {
    shownScore = Math.min(S.score, shownScore + Math.max(1, Math.ceil((S.score - shownScore) * Math.min(1, dt * 10))));
    ui.score.textContent = shownScore;
  }
}

// ================================================================ render
function render() {
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  if (S.nb > 0.02) {
    ctx.fillStyle = '#ffe9d6';
    for (const s of STARS) { ctx.globalAlpha = S.nb * (0.25 + 0.3 * Math.sin(S.time * 1.7 + s.p)); ctx.fillRect(s.x, s.y, s.s, s.s); }
    ctx.globalAlpha = 1;
    // searchlights sweeping the night sky
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [x, ph] of [[60, 0], [330, 2]]) {
      const a = -Math.PI / 2 + Math.sin(S.time * 0.5 + ph) * 0.5;
      ctx.globalAlpha = S.nb * 0.08;
      ctx.fillStyle = '#fff4c8';
      ctx.beginPath();
      ctx.moveTo(x, BASE_Y);
      ctx.lineTo(x + Math.cos(a - 0.07) * 320, BASE_Y + Math.sin(a - 0.07) * 320);
      ctx.lineTo(x + Math.cos(a + 0.07) * 320, BASE_Y + Math.sin(a + 0.07) * 320);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  drawBossBar();
  drawBoss();
  drawBase();
  for (const f of S.fx) if (f.t >= 0 && f.type !== 'strafe' && f.type !== 'bomber') drawFx(f);
  drawProjectiles();
  drawWeapons();
  drawBoard();
  for (const f of S.fx) if (f.t >= 0 && (f.type === 'strafe' || f.type === 'bomber')) drawFx(f);

  ctx.globalCompositeOperation = 'lighter';
  for (const o of ORBS) {
    if (!o.on || o.t < 0) continue;
    ctx.drawImage(SPR.dot[o.color], o.x - 9, o.y - 9, 18, 18);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let j = 0; j < MAXP; j++) {
    const p = P[j];
    if (!p.on) continue;
    const a = Math.max(0, p.life / p.max);
    if (p.color === '#9aa3ad') { // smoke grows and fades
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = p.color;
      const s = p.size * (2 - a);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let j = 0; j < MAXP; j++) {
    const p = P[j];
    if (!p.on || p.color === '#9aa3ad') continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of S.texts) {
    const a = 1 - t.t / t.life, pop = t.t < 0.12 ? 0.6 + t.t / 0.12 * 0.4 : 1;
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = `800 ${t.size * pop}px "JetBrains Mono", monospace`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,8,15,0.85)';
    ctx.strokeText(t.str, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.str, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  if (S.flash > 0) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = `rgba(${S.flashCol},${S.flash * 0.25})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawProjectiles() {
  for (const p of S.proj) {
    if (p.t < 0 || p.x === undefined) continue;
    const ang = Math.atan2(p.y - p.py, p.x - p.px);
    if (p.kind === 'slam') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.globalCompositeOperation = 'lighter';
      if (p.style === 0) { // rail cannon slug: a long hot streak
        ctx.strokeStyle = '#ff6a4a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(6, 0); ctx.stroke();
        ctx.drawImage(SPR.red, -12, -12, 24, 24);
      } else if (p.style === 3) { // kamikaze drone
        ctx.drawImage(SPR.flame, -20, -7, 14, 14);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#59626b'; ctx.fillRect(-8, -2, 16, 4); ctx.fillRect(-2, -7, 4, 14);
        ctx.fillStyle = '#FF4FD8'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      } else if (p.style === 2) { // heavy bomb
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#2b3036'; ctx.beginPath(); ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#45B4E8'; ctx.fillRect(-12, -4, 3, 8);
      } else { // rocket pod salvo
        ctx.drawImage(SPR.flame, -22, -8, 16, 16);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#4a4f55'; ctx.fillRect(-9, -2.4, 15, 4.8);
        ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.moveTo(6, -2.4); ctx.lineTo(11, 0); ctx.lineTo(6, 2.4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      continue;
    }
    if (p.kind === 'tracer') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#FFE08A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(ang) * 14, p.y - Math.sin(ang) * 14);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    if (p.kind !== 'shell' && p.kind !== 'bomb') ctx.drawImage(SPR.flame, -22, -8, 16, 16);
    ctx.globalCompositeOperation = 'source-over';
    if (p.kind === 'shell') { ctx.fillStyle = '#5a6233'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 3.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c9d1d8'; ctx.beginPath(); ctx.ellipse(3, 0, 3, 2.6, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (p.kind === 'bomb') { ctx.fillStyle = '#3b4248'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ffb347'; ctx.fillRect(-9, -3, 2, 6); }
    else {
      const enemy = p.kind === 'bossShot';
      ctx.fillStyle = enemy ? '#4a4f55' : '#eef2f5';
      ctx.fillRect(-9, -2.4, 15, 4.8);
      ctx.fillStyle = enemy ? (p.action === 2 ? '#3FC8FF' : '#ff4a4a') : GEMS[2].color;
      ctx.beginPath(); ctx.moveTo(6, -2.4); ctx.lineTo(11, 0); ctx.lineTo(6, 2.4); ctx.closePath(); ctx.fill();
      ctx.fillRect(-9, -4.5, 3, 9);
    }
    ctx.restore();
  }
}

function drawBossBar() {
  const b = S.boss;
  if (!b) return;
  const y = 70, x = 14, w = W - 28;
  ctx.font = '800 11px "JetBrains Mono", monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = b.color;
  ctx.fillText(b.name + (b.rage ? `  RAGE ${b.rage}` : ''), x, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(232,238,247,0.8)';
  ctx.fillText(`${Math.ceil(b.hp / 10)} / ${Math.ceil(b.max / 10)}`, x + w, y);
  rr(ctx, x, y + 5, w, 8, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(x + 1, y + 6, (w - 2) * (b.lag / b.max), 6);
  ctx.fillStyle = b.color;
  ctx.fillRect(x + 1, y + 6, (w - 2) * (b.hp / b.max), 6);
  // live readout of the boss's brain chip (a TapeOut circuit)
  const br = E.brainOf(b.type), c = S.chip, fresh = c && S.time - c.t < 2.2 && S.phase === 'night';
  ctx.font = '700 8.5px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(232,238,247,0.5)';
  const label = `BRAIN CHIP · ${br.circuit.nand} NAND + ${br.circuit.latch} LATCH · state ${(S.phase === 'night' && NIGHT && c ? c.state : b.brain).join('')}`;
  ctx.fillText(label, x, y + 24);
  if (fresh) {
    ctx.textAlign = 'right';
    ctx.fillStyle = ACTION_COL[c.action];
    ctx.globalAlpha = Math.min(1, 2.2 - (S.time - c.t));
    ctx.fillText(`OUT ${c.action.toString(2).padStart(2, '0')} → ${E.ACTIONS[c.action]}`, x + w, y + 24);
    ctx.globalAlpha = 1;
  }
}

// war machines, drawn around (0,0); returns the sensor (eye) position
function bossShape(type, t, white, col, recoil) {
  const steel = white ? '#fff' : '#59626b', dark = white ? '#fff' : '#2b3036', hi = white ? '#fff' : '#8a949e', acc = white ? '#fff' : col;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (type >= 4) return bossShape2(type, t, white, col, recoil, steel, dark, hi, acc);
  if (type === 0) { // assault mech walker
    const step = Math.sin(t * 3);
    for (const sd of [-1, 1]) {
      const lift = sd * step * 6;
      ctx.strokeStyle = steel; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(sd * 22, 20); ctx.lineTo(sd * 40, 46 - lift); ctx.lineTo(sd * 30, 74 - lift); ctx.stroke();
      ctx.fillStyle = dark; ctx.fillRect(sd * 30 - 12, 72 - lift, 24, 7);
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(sd * 40, 46 - lift, 4, 0, Math.PI * 2); ctx.fill();
    }
    for (const sd of [-1, 1]) { // arm cannons
      ctx.fillStyle = dark; ctx.fillRect(sd * 52 - 9, -8, 18, 30);
      ctx.fillStyle = steel; ctx.fillRect(sd * 52 - 4, 18 - recoil * 6, 8, 26);
      ctx.fillStyle = acc; ctx.fillRect(sd * 52 - 9, -8, 18, 4);
    }
    ctx.fillStyle = steel; rr(ctx, -42, -30, 84, 54, 10); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(-42, 8, 84, 6);
    ctx.fillStyle = hi; ctx.fillRect(-36, -26, 72, 4);
    ctx.fillStyle = acc; ctx.fillRect(-30, 16, 12, 5); ctx.fillRect(18, 16, 12, 5);
    ctx.fillStyle = dark; rr(ctx, -16, -44, 32, 18, 6); ctx.fill();
    return { ex: 0, ey: -8, er: 11 };
  }
  if (type === 1) { // attack helicopter gunship
    ctx.fillStyle = steel;
    ctx.beginPath(); ctx.moveTo(-30, -6); ctx.lineTo(-110, -14); ctx.lineTo(-114, -2); ctx.lineTo(-30, 10); ctx.closePath(); ctx.fill(); // tail boom
    ctx.fillStyle = dark; ctx.fillRect(-118, -24, 8, 24);
    const tr = Math.abs(Math.sin(t * 40)) * 14; ctx.fillStyle = 'rgba(200,210,220,0.5)'; ctx.fillRect(-116, -12 - tr, 3, tr * 2);
    ctx.fillStyle = steel; ctx.beginPath(); ctx.ellipse(6, 4, 48, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white ? '#fff' : '#9fd8ff'; ctx.beginPath(); ctx.ellipse(34, -2, 16, 11, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(-26, 24, 60, 4); ctx.fillRect(-20, 20, 4, 8); ctx.fillRect(24, 20, 4, 8); // skids
    for (const sd of [-1, 1]) { ctx.fillStyle = dark; ctx.fillRect(-6, 8 + sd * 4, 28, 7); ctx.fillStyle = acc; ctx.fillRect(18, 8 + sd * 4, 6, 7); } // rocket pods
    ctx.fillStyle = dark; ctx.fillRect(-4, -26, 12, 8);
    const rot = Math.cos(t * 30); ctx.strokeStyle = 'rgba(220,230,240,0.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(2 - 110 * rot, -28); ctx.lineTo(2 + 110 * rot, -28); ctx.stroke();
    ctx.fillStyle = acc; ctx.fillRect(-60, -6, 18, 3);
    return { ex: 50, ey: 10, er: 7 };
  }
  if (type === 2) { // armoured airship
    for (const sd of [-1, 1]) { const r2 = Math.abs(Math.sin(t * 25)) * 16; ctx.fillStyle = 'rgba(200,210,220,0.45)'; ctx.fillRect(sd * 100 - 2, -r2, 4, r2 * 2); ctx.fillStyle = dark; ctx.fillRect(sd * 100 - (sd > 0 ? 18 : -2), -4, 16, 8); }
    ctx.fillStyle = steel; ctx.beginPath(); ctx.ellipse(0, -14, 96, 36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 2;
    for (let j = -2; j <= 2; j++) { ctx.beginPath(); ctx.ellipse(0, -14, Math.abs(j) * 22 + 6, 36, 0, -Math.PI / 2, Math.PI / 2, j < 0); ctx.stroke(); }
    ctx.fillStyle = hi; ctx.beginPath(); ctx.ellipse(-10, -34, 60, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = acc; ctx.fillRect(-96, -18, 192, 5);
    ctx.fillStyle = dark; rr(ctx, -40, 18, 80, 24, 8); ctx.fill();
    for (const sx of [-28, 0, 28]) { ctx.fillStyle = steel; ctx.beginPath(); ctx.arc(sx, 42, 7, 0, Math.PI); ctx.fill(); ctx.fillRect(sx - 2, 44, 4, 12 - recoil * 4); }
    return { ex: 0, ey: 28, er: 8 };
  }
  // drone carrier with launch bays and orbiting drones
  for (let j = 0; j < 5; j++) {
    const a = t * 1.3 + j * Math.PI * 2 / 5, x = Math.cos(a) * 112, y = Math.sin(a) * 34 + 8;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(a) * 0.3);
    ctx.fillStyle = steel; ctx.fillRect(-9, -2, 18, 4); ctx.fillRect(-2, -6, 4, 12);
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = steel;
  ctx.beginPath(); ctx.moveTo(-98, 6); ctx.lineTo(-66, -26); ctx.lineTo(66, -26); ctx.lineTo(98, 6); ctx.lineTo(66, 30); ctx.lineTo(-66, 30); ctx.closePath(); ctx.fill();
  ctx.fillStyle = dark; ctx.fillRect(-70, -6, 140, 10);
  for (let j = -2; j <= 2; j++) { ctx.fillStyle = white ? '#fff' : rgba(col, 0.55 + 0.45 * Math.sin(t * 5 + j)); ctx.fillRect(j * 26 - 8, -4, 16, 6); }
  ctx.fillStyle = hi; ctx.fillRect(-60, -24, 120, 4);
  ctx.fillStyle = dark; rr(ctx, -20, -46, 40, 22, 6); ctx.fill();
  return { ex: 0, ey: 18, er: 9 };
}

// the second wave of war machines
function bossShape2(type, t, white, col, recoil, steel, dark, hi, acc) {
  if (type === 4) { // BEHEMOTH: siege tank with rolling treads and a sweeping main gun
    ctx.fillStyle = dark; rr(ctx, -94, 22, 188, 34, 16); ctx.fill();
    for (let j = 0; j < 6; j++) {
      const wx = -72 + j * 29;
      ctx.fillStyle = steel; ctx.beginPath(); ctx.arc(wx, 39, 11, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(wx, 39); ctx.rotate(t * 4); ctx.fillStyle = dark; ctx.fillRect(-1.6, -9, 3.2, 18); ctx.fillRect(-9, -1.6, 18, 3.2); ctx.restore();
    }
    ctx.fillStyle = hi;
    for (let x = -88 + ((t * 40) % 14); x < 86; x += 14) { ctx.fillRect(x, 21, 6, 3); ctx.fillRect(x, 54, 6, 3); }
    ctx.fillStyle = steel; ctx.beginPath(); ctx.moveTo(-98, 24); ctx.lineTo(-70, -6); ctx.lineTo(74, -6); ctx.lineTo(102, 24); ctx.closePath(); ctx.fill();
    ctx.fillStyle = acc; ctx.fillRect(-62, 8, 124, 5);
    ctx.fillStyle = dark; for (let j = -2; j <= 2; j++) ctx.fillRect(j * 22 - 6, -2, 12, 6);
    ctx.fillStyle = hi; ctx.beginPath(); ctx.ellipse(0, -8, 44, 24, 0, Math.PI, 0); ctx.fill();
    ctx.save(); ctx.translate(0, -14); ctx.rotate(Math.sin(t * 0.7) * 0.45);
    ctx.fillStyle = dark; ctx.fillRect(-6, 0, 12, 76 - recoil * 16);
    ctx.fillStyle = acc; ctx.fillRect(-8.5, 66 - recoil * 16, 17, 9);
    ctx.restore();
    return { ex: 0, ey: -20, er: 9 };
  }
  if (type === 5) { // SPECTRE: stealth flying wing that shimmers in and out of its cloak
    const keep = ctx.globalAlpha;
    ctx.globalAlpha = keep * (white ? 1 : 0.5 + 0.5 * Math.abs(Math.sin(t * 0.9)));
    const wing = () => { ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(124, 24); ctx.lineTo(84, 30); ctx.lineTo(50, 16); ctx.lineTo(26, 28); ctx.lineTo(0, 18); ctx.lineTo(-26, 28); ctx.lineTo(-50, 16); ctx.lineTo(-84, 30); ctx.lineTo(-124, 24); ctx.closePath(); };
    wing(); ctx.fillStyle = white ? '#fff' : '#1c232a'; ctx.fill();
    ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.stroke();
    if (!white) { // cloak shimmer sweeping across
      ctx.save(); wing(); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(col, 0.35);
      const band = ((t * 90) % 300) - 150;
      ctx.beginPath(); ctx.moveTo(band, -40); ctx.lineTo(band + 14, -40); ctx.lineTo(band + 44, 40); ctx.lineTo(band + 30, 40); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = hi; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(14, 2); ctx.lineTo(-14, 2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = keep;
    return { ex: 0, ey: -6, er: 6 };
  }
  if (type === 6) { // TITAN: six-legged spider walker with a plasma mortar on its back
    for (let j = 0; j < 6; j++) {
      const sd = j < 3 ? -1 : 1, k = j % 3, ph = t * 3.2 + k * 2.1 + (sd > 0 ? Math.PI : 0);
      const lift = Math.max(0, Math.sin(ph)) * 10;
      const hx = sd * (26 + k * 6), hy = k * 9;
      const kx = sd * (70 + k * 10), ky = -28 + k * 14 - lift;
      const fx = sd * (94 + k * 8) + Math.cos(ph) * 6 * sd, fy = 54 + k * 6 - lift * 0.6;
      ctx.strokeStyle = steel; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(kx, ky, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = steel; ctx.beginPath(); ctx.ellipse(0, 6, 48, 30, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, -14, 30, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hi; ctx.fillRect(-9, -44 + recoil * 8, 18, 28);
    ctx.fillStyle = white ? '#fff' : rgba(col, 0.5 + 0.5 * Math.sin(t * 5));
    ctx.beginPath(); ctx.arc(0, -46 + recoil * 8, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white ? '#fff' : '#ff5050';
    for (const [ex, ey] of [[-14, 18], [14, 18], [-8, 26], [8, 26]]) { ctx.beginPath(); ctx.arc(ex, ey, 2.4, 0, Math.PI * 2); ctx.fill(); }
    return { ex: 0, ey: 10, er: 8 };
  }
  // WARDEN: orbital platform with turning solar wings and a lance emitter charging underneath
  const tilt = Math.cos(t * 0.8);
  for (const sd of [-1, 1]) {
    ctx.save(); ctx.translate(sd * 40, 0); ctx.scale(1, 0.35 + 0.65 * Math.abs(tilt));
    ctx.fillStyle = white ? '#fff' : '#1e3a66'; ctx.fillRect(sd > 0 ? 0 : -76, -18, 76, 36);
    ctx.strokeStyle = white ? '#fff' : '#6fa8ff'; ctx.lineWidth = 1;
    for (let gx = 0; gx <= 76; gx += 19) { ctx.beginPath(); ctx.moveTo((sd > 0 ? 0 : -76) + gx, -18); ctx.lineTo((sd > 0 ? 0 : -76) + gx, 18); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(sd > 0 ? 0 : -76, 0); ctx.lineTo(sd > 0 ? 76 : 0, 0); ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = steel; ctx.lineWidth = 4; ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 30;
  ctx.beginPath(); ctx.ellipse(0, 0, 46, 14, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = steel; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hi; ctx.beginPath(); ctx.arc(-8, -8, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-14, 20); ctx.lineTo(14, 20); ctx.lineTo(5, 46 - recoil * 6); ctx.lineTo(-5, 46 - recoil * 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = white ? '#fff' : rgba(col, 0.4 + 0.6 * Math.abs(Math.sin(t * 3)));
  ctx.beginPath(); ctx.arc(0, 48 - recoil * 6, 5, 0, Math.PI * 2); ctx.fill();
  return { ex: 0, ey: 2, er: 9 };
}

const FLYERS = new Set([1, 2, 3, 5, 7]);
function drawBoss() {
  const b = S.boss;
  if (!b) return;
  const { x, y, s } = S.bp;
  const t = S.time, bob = Math.sin(t * 1.8) * 5;
  const sh = b.dying >= 0 ? (Math.random() - 0.5) * 8 : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, SKY_TOP + 20, W, BASE_Y - SKY_TOP - 20);
  ctx.clip();
  ctx.globalAlpha = 0.45 * (0.5 + S.nb * 0.5);
  const gsz = 320 * s;
  ctx.drawImage(SPR.dot[b.color], x - gsz / 2, y + bob - gsz / 2, gsz, gsz);
  if (b.rage > 0 && b.dying < 0) { // enraged: a pulsing red aura
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.25 + 0.1 * Math.min(3, b.rage)) * (0.6 + 0.4 * Math.sin(t * 5));
    const rs = (260 + 30 * Math.min(3, b.rage)) * s;
    ctx.drawImage(SPR.red, x - rs / 2, y + bob - rs / 2, rs, rs);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = S.phase === 'night' || b.dying >= 0 || b.present ? 1 : 0.85;
  ctx.translate(x + sh, y + bob + sh);
  ctx.scale(s, s);
  const hurt = 1 - b.hp / b.max;
  if (FLYERS.has(b.type)) {
    ctx.rotate(Math.sin(t * 2.1) * 0.05 * hurt); // a damaged flyer wobbles
    ctx.globalCompositeOperation = 'lighter'; // thrusters
    for (const tx of [-34, 34]) { const f = 14 + Math.random() * 8; ctx.drawImage(SPR.flame, tx - f / 2, 30, f, f * 1.6); }
    ctx.globalCompositeOperation = 'source-over';
  }
  const warp = Math.min(1, (b.age || 0) / 1.3); // entrance: materialises top to bottom behind a scanline
  if (warp < 1) { ctx.save(); ctx.beginPath(); ctx.rect(-180, -140, 360, 280 * warp); ctx.clip(); }
  const eye = bossShape(b.type, t, false, b.color, b.recoil);
  if (b.flash > 0) {
    const keep = ctx.globalAlpha;
    ctx.globalAlpha = keep * 0.5 * Math.min(1, b.flash / 0.08);
    bossShape(b.type, t, true, b.color, b.recoil);
    ctx.globalAlpha = keep;
  }
  if (warp < 1) {
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(b.color, 0.9);
    ctx.fillRect(-180, -140 + 280 * warp - 2, 360, 3);
    ctx.globalAlpha = 0.25 * (1 - warp);
    ctx.fillRect(-180, -140, 360, 280 * warp);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  // targeting sensor: glows when locking on
  ctx.fillStyle = '#111418';
  ctx.beginPath(); ctx.arc(eye.ex, eye.ey, eye.er, 0, Math.PI * 2); ctx.fill();
  const lock = b.charge > 0 ? 1 : 0.55 + 0.25 * Math.sin(t * 4);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = lock;
  const gs = eye.er * (b.charge > 0 ? 7 : 3.4);
  ctx.drawImage(SPR.red, eye.ex - gs / 2, eye.ey - gs / 2, gs, gs);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#ff5050';
  ctx.beginPath(); ctx.arc(eye.ex, eye.ey, eye.er * 0.45, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawTurret(w, tier, pulse) {
  const col = GEMS[w].color;
  ctx.fillStyle = '#3a4048';
  if (w === 0) {
    if (tier === 2) { ctx.fillStyle = '#d9dee3'; ctx.beginPath(); ctx.arc(0, -10, 8, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#3a4048'; ctx.fillRect(-8, -10, 16, 10); }
    const n = [1, 3, 5][tier];
    for (let j = 0; j < n; j++) ctx.fillRect(-n * 1.6 + j * 3.2 - 1.2, -26 + pulse * 3, 2.4, 22);
    ctx.fillStyle = col; ctx.fillRect(-6, -8, 12, 5);
  } else if (w === 1) {
    if (tier === 2) {
      ctx.fillStyle = '#4a5233'; ctx.fillRect(-12, -24 + pulse * 3, 24, 18);
      ctx.fillStyle = '#1e2214';
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { ctx.beginPath(); ctx.arc(-7 + c * 7, -19 + r * 8 + pulse * 3, 2.4, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = '#4a5233';
      const len = tier === 0 ? 14 : 26, wd = tier === 0 ? 10 : 7;
      ctx.fillRect(-wd / 2, -len - 4 + pulse * 6, wd, len);
      if (tier === 1) { ctx.fillStyle = '#2a2f1c'; ctx.fillRect(-5.5, -30 + pulse * 6, 11, 4); }
    }
    ctx.fillStyle = col; ctx.fillRect(-7, -8, 14, 5);
  } else {
    const n = [1, 2, 4][tier];
    for (let j = 0; j < n; j++) {
      const ox = (j - (n - 1) / 2) * 6;
      ctx.fillStyle = '#3a4048'; ctx.fillRect(ox - 2.6, -24 + pulse * 2, 5.2, 20);
      ctx.fillStyle = '#eef2f5'; ctx.fillRect(ox - 1.6, -28 + pulse * 2, 3.2, 8);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ox - 1.6, -28 + pulse * 2); ctx.lineTo(ox, -32 + pulse * 2); ctx.lineTo(ox + 1.6, -28 + pulse * 2); ctx.fill();
    }
  }
}

function drawBase() {
  const shownShield = S.shield + (S.shieldHold || 0);
  if (shownShield > 0) {
    const a = (S.phase === 'night' ? 0.16 : 0.08) + 0.3 * Math.min(1, shownShield / Math.max(1, S.shieldMax));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#3FC8FF', a + 0.25);
    ctx.lineWidth = 2.5;
    ctx.fillStyle = rgba('#3FC8FF', a * 0.3);
    ctx.beginPath();
    ctx.ellipse(195, BASE_Y + 6, 200, 76, 0, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    // hex pattern hint
    ctx.globalAlpha = a * 0.6;
    for (let j = 0; j < 9; j++) { const ang = Math.PI + (j + 0.5) * Math.PI / 9; ctx.beginPath(); ctx.arc(195 + Math.cos(ang) * 170, BASE_Y + 6 + Math.sin(ang) * 60, 6, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  // bunker + sandbags
  ctx.fillStyle = '#2b2f26';
  ctx.fillRect(10, BASE_Y - 4, W - 20, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(10, BASE_Y - 4, W - 20, 2);
  for (let x = 16, j = 0; x < W - 12; x += 17, j++) {
    ctx.fillStyle = j % 2 ? '#a08a5c' : '#8f7a4f';
    ctx.beginPath(); ctx.ellipse(x, BASE_Y - 6, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  TURRETS.forEach((tu, w) => {
    const pulse = S.wpulse[w];
    const tier = S.phase === 'night' ? S.wtier[w] : S.tierShown[w];
    ctx.save();
    ctx.translate(tu.x, tu.y);
    ctx.fillStyle = '#3d4436';
    ctx.beginPath(); ctx.arc(0, 8, 18, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = GEMS[w].color; ctx.lineWidth = 1.6; ctx.stroke();
    let ang = -Math.PI / 2;
    if (S.boss && (S.phase === 'night' || S.boss.present)) ang = Math.atan2(S.bp.y - tu.y, S.bp.x - tu.x);
    ctx.rotate(ang + Math.PI / 2);
    drawTurret(w, tier, pulse);
    if (pulse > 0.6 && S.phase === 'night') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (pulse - 0.6) / 0.4;
      ctx.drawImage(SPR.flame, -14, -46, 28, 28);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  });
  const shownBase = Math.min(S.baseMax, S.base + (S.baseHold || 0));
  const ratio = shownBase / S.baseMax;
  const col = ratio > 0.6 ? '#3DDC97' : ratio > 0.3 ? '#FBBF24' : '#FF6B6B';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(14, BASE_Y + 24, W - 28, 5);
  ctx.fillStyle = col;
  ctx.fillRect(14, BASE_Y + 24, (W - 28) * ratio, 5);
  ctx.font = '800 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(232,238,247,0.75)';
  ctx.fillText(`BASE ${Math.ceil(shownBase / 10)}`, 14, BASE_Y + 21);
  if (shownShield > 0) { ctx.textAlign = 'right'; ctx.fillStyle = '#3FC8FF'; ctx.fillText(`SHIELD ${Math.ceil(shownShield / 10)}`, W - 14, BASE_Y + 21); }
}

function drawWeapons() {
  for (let i = 0; i < 5; i++) {
    const x = wbarX(i), y = WBAR_Y, w = 70, h = WBAR_H, gm = GEMS[i], pulse = S.wpulse[i];
    rr(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(12,14,12,0.88)';
    ctx.fill();
    ctx.strokeStyle = pulse > 0 ? rgba(gm.color, 0.4 + pulse * 0.6) : 'rgba(160,180,140,0.16)';
    ctx.lineWidth = 1 + pulse * 1.5;
    ctx.stroke();
    if (pulse > 0) { ctx.globalAlpha = pulse; ctx.drawImage(SPR.glow[i], x + 16 - 24, y + h / 2 - 24, 48, 48); ctx.globalAlpha = 1; }
    const is = 30 + pulse * 6;
    ctx.drawImage(SPR.icon[i], x + 16 - is / 2, y + h / 2 - is / 2, is, is);
    const v = S.shown[i];
    let big, prog = null, val;
    if (i < 3) { val = S.phase === 'night' ? S.ammo[i] : Math.floor(v / 3); big = `x${val}`; prog = S.phase === 'night' ? null : (v % 3) / 3; }
    else if (i === 3) { val = S.phase === 'night' ? Math.ceil(S.shield / 10) : Math.round(v * 2); big = `${val}`; }
    else { val = Math.round(v); big = `+${val}`; }
    const tier = i < 3 && S.phase === 'night' ? S.wtier[i] : tierOf(i, i < 3 ? Math.floor(v / 3) : val);
    ctx.font = '800 7.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = tier ? gm.color : 'rgba(150,160,150,1)';
    ctx.fillText(gm.tiers[tier], x + 32, y + 16);
    ctx.font = '800 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#eef0ea';
    ctx.fillText(big, x + 32, y + 35);
    for (let j = 0; j < 3; j++) { ctx.fillStyle = j <= tier ? gm.color : 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 32 + j * 6, y + 41, 4, 3); }
    if (prog !== null) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x + 52, y + 41, 12, 3);
      ctx.fillStyle = gm.color;
      ctx.fillRect(x + 52, y + 41, 12 * prog, 3);
    }
  }
}

function drawBoard() {
  const dim = 1 - S.nb * 0.5;
  ctx.globalAlpha = dim;
  ctx.drawImage(SPR.board, BX - 8, BY - 8, N * CELL + 16, N * CELL + 16);
  ctx.save();
  ctx.beginPath();
  ctx.rect(BX - 4, BY - 4, N * CELL + 8, N * CELL + 8);
  ctx.clip();
  const hp = 0.5 + 0.5 * Math.sin(S.time * 7);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const g = G[r][c];
    if (!g) continue;
    let s = g.s, a = dim;
    if (g.pop >= 0) { const t = Math.min(1, g.pop); s *= t < 0.35 ? 1 + t * 0.7 : (1 - t) * 1.6; a *= 1 - t * 0.3; }
    if (S.hint && S.hint.some(([hr, hc]) => hr === r && hc === c)) s *= 1 + hp * 0.1;
    const sel = S.sel && S.sel[0] === r && S.sel[1] === c;
    if (sel) { ctx.globalAlpha = dim * (0.6 + hp * 0.4); ctx.drawImage(SPR.glow[g.c === CORE ? 0 : g.c], g.x - 32, g.y - 32, 64, 64); s *= 1.08; }
    const sx = 1 + g.sq * 0.18, sy = 1 - g.sq * 0.18;
    const w = CELL * s * sx, h = CELL * s * sy;
    ctx.globalAlpha = Math.max(0, a);
    ctx.drawImage(g.c === CORE ? SPR.core : SPR.gem[g.c], g.x - w / 2, g.y - h / 2 + (CELL * s - h) / 2, w, h);
    if (g.c === CORE) { // beacon blink + radio waves
      const ph = (S.time * 1.6) % 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * (1 - ph);
      ctx.strokeStyle = '#ff4a4a';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(g.x, g.y, 8 + ph * 16, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.globalAlpha = a * (0.5 + 0.5 * Math.sin(S.time * 10));
      ctx.drawImage(SPR.red, g.x - 12, g.y - 11, 24, 24);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (g.sp) drawSpecial(g, s);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawSpecial(g, s) {
  const p = 0.5 + 0.5 * Math.sin(S.time * 6 + g.x);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(s, s);
  if (g.sp === 'row' || g.sp === 'col') { // jet-strike marker: mini jet + direction chevrons
    if (g.sp === 'col') ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(SPR.jet, -13, -18, 26, 17);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${0.55 + p * 0.45})`;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * 21, 0); ctx.lineTo(sd * 15, -5); ctx.lineTo(sd * 15, 5); ctx.fill(); }
  } else if (g.sp === 'bomb') { // grenade: rotating hazard ring + pin
    ctx.rotate(S.time * 2);
    ctx.strokeStyle = `rgba(255,180,71,${0.6 + p * 0.4})`;
    ctx.lineWidth = 2.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-S.time * 2);
    ctx.fillStyle = '#4a5233';
    ctx.beginPath(); ctx.ellipse(10, -11, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d9dee3'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(14, -16, 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawFx(f) {
  const a = 1 - Math.min(1, f.t);
  if (f.type === 'strafe') {
    const t = Math.min(1, f.t), span = N * CELL + 100;
    ctx.save();
    if (f.h) { ctx.translate(BX - 50 + span * t, cellY(f.i) - 4); }
    else { ctx.translate(cellX(f.i) + 4, BY - 50 + span * t); ctx.rotate(Math.PI / 2); }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffd28a';
    ctx.fillRect(-90, -2, 60, 4); // contrail
    ctx.globalAlpha = 1;
    ctx.drawImage(SPR.flame, -44, -10, 20, 20);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(SPR.jet, -35, -23, 70, 46);
    ctx.restore();
  } else if (f.type === 'bomber') {
    const t = Math.min(1, f.t);
    ctx.save();
    ctx.translate(-80 + (W + 160) * t, BY + N * CELL / 2 - 30 + Math.sin(t * 3) * 10);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(10, 60, 50, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(SPR.bomber, -60, -40, 120, 80);
    ctx.restore();
  } else if (f.type === 'flyover') {
    const t = Math.min(1, f.t);
    for (let j = 0; j < 3; j++) {
      const x = -90 + (W + 180) * t - j * 40, y = f.y + (j - 1) * 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(SPR.flame, -42, -9, 18, 18);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(SPR.jet, -35, -23, 70, 46);
      ctx.restore();
    }
  } else if (f.type === 'ring') {
    ctx.globalAlpha = a;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (f.type === 'boom') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(SPR.boom, f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    ctx.globalAlpha = a * 0.8;
    ctx.drawImage(SPR.white, f.x - f.r * 0.35, f.y - f.r * 0.35, f.r * 0.7, f.r * 0.7);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else if (f.type === 'debris') {
    const e = Math.max(0, f.t) * f.d;
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - f.t) * 2);
    ctx.translate(f.x + f.vx * e, f.y + f.vy * e + 260 * e * e);
    ctx.rotate(f.rot + f.vr * e);
    ctx.fillStyle = f.color;
    ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
    ctx.restore();
  } else if (f.type === 'shieldHit') {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#9ee6ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(195, BASE_Y + 6, 200, 76, 0, Math.PI, 0);
    ctx.stroke();
    ctx.restore();
  }
}

// ================================================================ loop
let last = 0, raf = 0, slowFrames = 0, frames = 0, paused = false;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  frames++;
  if (!lowPower && frames > 90) {
    slowFrames = real > 0.026 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45) { lowPower = true; dpr = 1; MAXP = 200; resize(); }
  }
  if (S.slow < 1 && S.phase !== 'over') S.slow = Math.min(1, S.slow + real * 0.6);
  if (paused) { render(); return; }
  if (S.phase !== 'title') update(real * S.slow);
  else S.time += real;
  if (RIVAL && (S.phase === 'day' || S.phase === 'night')) { RIVAL.update(real); rivalEvents(); }
  render();
  if (RIVAL) drawRival();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
  else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
});

resize();
DUEL = readDuel();
if (DUEL && !DUEL.bad) { pick.kind = 'duel'; $('duelScore').textContent = fmt(DUEL.score); }
else if (DUEL && DUEL.bad) setTimeout(() => toast('That challenge link did not pass the replay check.', true, 3600), 600);
syncPick();
RUN = E.newRun(E.randomSeed(), mkGem);
G = RUN.G;
S.boss = RUN.st.boss;
syncHud();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildSprites());
raf = requestAnimationFrame(frame);

// test hook (used by automated play-tests)
window.__nw = { S, E, get G() { return G; }, get LOG() { return LOG; }, get MODE() { return MODE; }, get RIVAL() { return RIVAL; }, get NIGHT() { return NIGHT; }, startSwap, findMove, cellX, cellY, startNight, newGame, callAirstrike, makeBoss: E.makeBoss };
