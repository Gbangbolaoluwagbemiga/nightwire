// Plays many full games with the AI (all levels) and writes contracts/test/fixtures.json for the
// Solidity differential test: the on-chain engine must reproduce every score exactly.  node tools/fixtures.mjs [count]
import fs from 'fs';
import * as E from '../src/engine.js';
import { makeRival } from '../src/rival.js';
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
fs.writeFileSync(new URL('../contracts/test/fixtures.json', import.meta.url), JSON.stringify({ count: games.length, games }));
console.log(`wrote ${games.length} games; actions ${Math.min(...games.map((g) => g.n))}..${Math.max(...games.map((g) => g.n))}; bytes up to ${Math.max(...games.map((g) => (g.actions.length - 2) / 2))}`);
