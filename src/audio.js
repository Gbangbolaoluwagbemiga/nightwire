// Tiny synthesized sound effects (no audio files to download). Created on the first tap, as mobile browsers require.
let ac = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('nw-muted') === '1'; } catch { /* storage blocked */ }

const last = {};
function throttled(key, ms) {
  const now = performance.now();
  if (last[key] && now - last[key] < ms) return true;
  last[key] = now;
  return false;
}

export function unlockAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.45;
  master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.4, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('nw-muted', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : 0.45;
  return muted;
}

function tone(f, dur, type = 'triangle', vol = 0.15, slide = 0, delay = 0) {
  if (!ac || muted) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * (1 + slide)), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol, freq = 1200) {
  if (!ac || muted || !noiseBuf) return;
  const t = ac.currentTime;
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(80, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur);
}

// pentatonic steps so cascades climb musically
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const note = (base, i) => base * 2 ** (STEPS[Math.min(i, STEPS.length - 1)] / 12);

export const sfx = {
  select() { tone(660, 0.05, 'sine', 0.07, 0.2); },
  swap() { tone(420, 0.08, 'triangle', 0.09, 0.4); },
  deny() { tone(180, 0.09, 'square', 0.07, -0.3); tone(150, 0.09, 'square', 0.07, -0.3, 0.09); },
  match(cascade) { const f = note(392, cascade); tone(f, 0.16, 'triangle', 0.16, 0.02); tone(f * 2, 0.12, 'sine', 0.06, 0, 0.03); },
  special() { tone(220, 0.25, 'sawtooth', 0.08, 3); noise(0.3, 0.15, 3000); },
  bomb() { noise(0.45, 0.35, 900); tone(80, 0.4, 'sine', 0.3, -0.6); },
  orb() { if (throttled('orb', 45)) return; tone(1200 + Math.random() * 400, 0.05, 'sine', 0.035, 0.3); },
  combo(n) { [0, 1, 2].forEach((j) => tone(note(523, n + j), 0.14, 'triangle', 0.1, 0, j * 0.06)); },
  laser() { if (throttled('laser', 50)) return; tone(1400, 0.16, 'sawtooth', 0.05, -0.7); },
  cannon() { noise(0.25, 0.3, 700); tone(110, 0.2, 'sine', 0.25, -0.5); },
  missile() { if (throttled('missile', 40)) return; tone(300, 0.25, 'square', 0.035, 1.5); },
  impact() { if (throttled('impact', 50)) return; noise(0.18, 0.2, 1800); },
  bossShot() { tone(160, 0.35, 'sawtooth', 0.1, -0.5); },
  shield() { tone(880, 0.2, 'sine', 0.12, -0.4); tone(1320, 0.15, 'sine', 0.06, -0.3, 0.02); },
  baseHit() { noise(0.4, 0.4, 500); tone(60, 0.35, 'sine', 0.35, -0.4); },
  siren() { [0, 0.45].forEach((d) => { tone(520, 0.4, 'sawtooth', 0.07, -0.35, d); }); },
  repair() { [0, 1, 2, 3].forEach((j) => tone(note(523, j * 2), 0.12, 'sine', 0.07, 0, j * 0.05)); },
  bossDown() { noise(1.2, 0.45, 1400); [262, 330, 392, 523, 659].forEach((f, i) => tone(f, 0.35, 'triangle', 0.12, 0, 0.5 + i * 0.1)); },
  retreat() { tone(392, 0.25, 'triangle', 0.1, -0.2); tone(330, 0.35, 'triangle', 0.1, -0.2, 0.18); },
  jet() { noise(0.9, 0.22, 4000); tone(180, 0.8, 'sawtooth', 0.05, 1.2); },
  mg() { if (throttled('mg', 35)) return; noise(0.05, 0.12, 5000); },
  strike() { noise(1.4, 0.3, 3000); tone(90, 1.2, 'sawtooth', 0.08, -0.4, 0.3); },
  upgrade() { [0, 2, 4, 7].forEach((j) => tone(note(392, j), 0.12, 'square', 0.05, 0, j * 0.04)); },
  over() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, -0.1, i * 0.14)); },
};
