// Plays many full games with the AI (all levels) and writes contracts/test/fixtures.json for the
// Solidity differential test: the on-chain engine must reproduce every score exactly.  node tools/fixtures.mjs [count]
import fs from 'fs';
import * as E from '../src/engine.js';
import { makeRival } from '../src/rival.js';
import * as F from '../src/forge.js';
globalThis.performance ??= { now: () => Date.now() };
const count = Number(process.argv[2] || 60);
const games = [];
for (let i = 0; i < count; i++) {
  const lvl = ['easy', 'normal', 'hard'][i % 3];
  const seed = (0x9e3779b1 * (i + 1)) >>> 0;
  const R = makeRival(seed, lvl);
  while (!R.finished) { if (R.phase === 'night') { R.night.t = R.night.end; R.update(0); } else { R.timer = 0; R.update(0); } }
  const chk = E.replay(seed, R.log);
  if (!chk.ok || chk.st.score !== R.st.score) throw new Error(`JS replay mismatch on game ${i}`);
  games.push({ seed, actions: E.encodeBinary(R.log), score: R.st.score, stage: R.st.stageNo, bossesDown: R.st.bossesDown, over: R.st.over, n: R.log.length });
}
// chaos games: random legal moves and airstrike calls at random (often invalid) times
const chaos = Number(process.argv[3] || 0);
for (let i = 0; i < chaos; i++) {
  const seed = (0x85ebca6b * (i + 7)) >>> 0;
  const run = E.newRun(seed);
  const log = [];
  while (!run.st.over && log.length < 400) {
    if (run.st.moves <= 0) {
      const k = Math.floor(Math.random() * (run.st.strikes + 3));
      const strikes = Array.from({ length: Math.min(k, 5) }, () => Math.floor(Math.random() * 15000));
      log.push(E.encodeNight(strikes));
      E.runNight(run, strikes);
      continue;
    }
    const moves = E.listMoves(run.G);
    const m = moves[Math.floor(Math.random() * moves.length)];
    log.push(E.encodeMove(m[0], m[1]));
    E.playMove(run, m[0], m[1]);
  }
  const chk = E.replay(seed, log);
  if (!chk.ok || chk.st.score !== run.st.score) throw new Error(`JS replay mismatch on chaos game ${i}`);
  games.push({ seed, actions: E.encodeBinary(log), score: run.st.score, stage: run.st.stageNo, bossesDown: run.st.bossesDown, over: run.st.over, n: log.length });
}
// three different finished runs on one Daily Op seed, for the ladder tests
const DAY = 20408;
const daily = ['easy', 'normal', 'hard'].map((lvl) => {
  const seed = E.dailySeed(DAY);
  const R = makeRival(seed, lvl);
  while (!R.finished) { if (R.phase === 'night') { R.night.t = R.night.end; R.update(0); } else { R.timer = 0; R.update(0); } }
  return { seed, actions: E.encodeBinary(R.log), score: R.st.score, half: E.encodeBinary(R.log.slice(0, 20)) };
});
// World Boss raid runs: one week's seed, every AI level, plus chaos; expected damage per run
const WEEK = 2967;
const raid = [];
for (let i = 0; i < 24; i++) {
  const seed = i < 12 ? E.raidSeed(WEEK) : (0x27d4eb2f * (i + 3)) >>> 0;
  const R = makeRival(seed, ['easy', 'normal', 'hard'][i % 3], null, { raid: true });
  while (!R.finished) { if (R.phase === 'night') { R.night.t = R.night.end; R.update(0); } else { R.timer = 0; R.update(0); } }
  const chk = E.replay(seed, R.log, { raid: true });
  if (!chk.ok || chk.st.damage !== R.st.damage) throw new Error(`JS raid replay mismatch ${i}`);
  raid.push({ seed, actions: E.encodeBinary(R.log), damage: R.st.damage, score: R.st.score, over: R.st.over });
}
// Boss Forge designs: compiled netlists and AI fights against them
const designs = [
  { name: 'GRINDER', hull: 6, color: 9, rhythm: [0, 1, 2, 1], repairBelow: 50, emp: 1, focusWeakBase: true, focusEnraged: false },
  { name: 'PUSHOVER', hull: 0, color: 0, rhythm: [0, 0, 0, 0], repairBelow: 0, emp: 0, focusWeakBase: false, focusEnraged: false },
  { name: 'STORMFRONT', hull: 1, color: 5, rhythm: [2, 1, 1, 0], repairBelow: 75, emp: 2, focusWeakBase: false, focusEnraged: true },
];
const forge = [];
designs.forEach((d, di) => {
  const chip = F.compile(d);
  for (let k = 0; k < 4; k++) {
    const seed = (E.forgeSeed(d) + k) >>> 0;
    const R = makeRival(seed, ['normal', 'hard', 'easy', 'normal'][k], null, { forge: d });
    while (!R.finished) { if (R.phase === 'night') { R.night.t = R.night.end; R.update(0); } else { R.timer = 0; R.update(0); } }
    const chk = E.replay(seed, R.log, { forge: d });
    if (!chk.ok || chk.st.score !== R.st.score) throw new Error('JS forge replay mismatch');
    forge.push({ design: di, netlist: chip.netlist, seed, actions: E.encodeBinary(R.log), score: R.st.score, stage: R.st.stageNo });
  }
});
fs.writeFileSync(new URL('../contracts/test/fixtures.json', import.meta.url), JSON.stringify({ count: games.length, games, day: DAY, daily, week: WEEK, raidCount: raid.length, raid, forgeCount: forge.length, forge }));
console.log(`wrote ${games.length} games; actions ${Math.min(...games.map((g) => g.n))}..${Math.max(...games.map((g) => g.n))}; bytes up to ${Math.max(...games.map((g) => (g.actions.length - 2) / 2))}`);
