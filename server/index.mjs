// Nightwire API: a global leaderboard for players without wallets, and short duel links.
// Every run is replayed with the game's own engine (src/engine.js) before it is accepted, so a submitted
// score is exactly what the moves produce. No dependencies; data is one JSON file on a volume.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as E from '../src/engine.js';
import * as F from '../src/forge.js';

const PORT = Number(process.env.PORT || 8080);
const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA, 'nightwire.json');
const MAX_BODY = 64 * 1024;
const MODES = new Set(['solo', 'ai', 'daily', 'duel']);
const LEVELS = new Set(['easy', 'normal', 'hard']);

fs.mkdirSync(DATA, { recursive: true });
let db = { runs: [], duels: {}, raids: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first start */ }
db.raids ??= [];
db.forge ??= {};
const RAID_POOL = Number(process.env.RAID_POOL || 1_500_000); // OMEGA's weekly health, tenths of HP
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}, 2000).unref();

// a small per-IP rate limit
const hits = new Map();
function limited(ip, max = 30) {
  const now = Date.now(), h = hits.get(ip) || { n: 0, t: now };
  if (now - h.t > 60_000) { h.n = 0; h.t = now; }
  h.n++;
  hits.set(ip, h);
  return h.n > max;
}

const ACTION = /^(\d{4}|N(\d{1,5}(\|\d{1,5}){0,8})?)$/;
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Anonymous';

function verify(seed, actions, opts = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return { error: 'bad seed' };
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 1500 || !actions.every((a) => typeof a === 'string' && ACTION.test(a))) return { error: 'bad actions' };
  const r = E.replay(seed, actions, opts);
  if (!r.ok) return { error: `replay failed: ${r.reason}` };
  if (!r.st.over) return { error: 'the run has not ended' };
  return { st: r.st };
}

function board(mode, day, level) {
  const best = new Map(); // one entry per player name
  for (const r of db.runs) {
    if (r.mode !== mode) continue;
    if (mode === 'daily' && r.day !== day) continue;
    if (mode === 'ai' && level && r.level !== level) continue;
    const cur = best.get(r.name);
    if (!cur || r.score > cur.score) best.set(r.name, r);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 20)
    .map(({ name, score, stage, bossesDown, level: lv, at }) => ({ name, score, stage, bossesDown, level: lv, at }));
}

function raidState(week) {
  const runs = db.raids.filter((r) => r.week === week);
  const per = new Map();
  let dealt = 0, downAt = null;
  for (const r of runs.sort((a, b) => a.at - b.at)) {
    dealt += r.damage;
    if (downAt === null && dealt >= RAID_POOL) downAt = r.at;
    const p = per.get(r.name) || { name: r.name, damage: 0, runs: 0, best: 0 };
    p.damage += r.damage; p.runs++; p.best = Math.max(p.best, r.damage);
    per.set(r.name, p);
  }
  const top = [...per.values()].sort((a, b) => b.damage - a.damage).slice(0, 20);
  return { week, poolHp: RAID_POOL, dealt: Math.min(dealt, RAID_POOL), overkill: Math.max(0, dealt - RAID_POOL), down: downAt !== null, downAt, runs: runs.length, raiders: per.size, endsAt: (week + 1) * 7 * 86400000, top };
}

function send(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad json')); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, runs: db.runs.length, today: E.dayNumber() });

    if (req.method === 'GET' && url.pathname === '/boards') {
      const mode = url.searchParams.get('mode') || 'daily';
      if (!MODES.has(mode)) return send(res, 400, { error: 'bad mode' });
      const day = Number(url.searchParams.get('day') || E.dayNumber());
      return send(res, 200, { mode, day, rows: board(mode, day, url.searchParams.get('level')) });
    }

    if (req.method === 'POST' && url.pathname === '/runs') {
      if (limited(ip)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      const mode = MODES.has(b.mode) ? b.mode : null;
      if (!mode || mode === 'duel') return send(res, 400, { error: 'bad mode' });
      const today = E.dayNumber();
      let seed = b.seed >>> 0, day = null;
      if (mode === 'daily') { // today's (or yesterday's, for runs that crossed midnight) board only
        day = Number(b.day);
        if (!(day === today || day === today - 1) || seed !== E.dailySeed(day)) return send(res, 400, { error: 'wrong day' });
      }
      const hard = mode === 'ai' && b.level === 'hard'; // VS AI hard is played on veteran rules
      const v = verify(seed, b.actions, { hard });
      if (v.error) return send(res, 422, { error: v.error });
      const key = crypto.createHash('sha256').update(`${hard ? 'hard:' : ''}${seed}:${b.actions.join(',')}`).digest('hex');
      if (db.runs.some((r) => r.key === key)) return send(res, 409, { error: 'this run was already submitted' });
      const run = { key, name: cleanName(b.name), mode, level: mode === 'ai' && LEVELS.has(b.level) ? b.level : null, day, seed, score: v.st.score, stage: v.st.stageNo, bossesDown: v.st.bossesDown, at: Date.now() };
      db.runs.push(run);
      dirty = true;
      const rows = board(mode, day, run.level);
      return send(res, 200, { ok: true, score: run.score, rank: rows.findIndex((r) => r.name === run.name && r.score === run.score) + 1 || null });
    }

    if (req.method === 'POST' && url.pathname === '/duels') {
      if (limited(ip, 20)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      const hard = !!b.hard;
      const v = verify(b.seed >>> 0, b.actions, { hard });
      if (v.error) return send(res, 422, { error: v.error });
      const id = crypto.randomBytes(5).toString('base64url');
      db.duels[id] = { seed: b.seed >>> 0, actions: b.actions, score: v.st.score, stage: v.st.stageNo, name: cleanName(b.name), hard, at: Date.now() };
      dirty = true;
      return send(res, 200, { id });
    }

    if (req.method === 'GET' && url.pathname === '/raid') {
      const week = Number(url.searchParams.get('week') || E.weekNumber(E.dayNumber()));
      return send(res, 200, raidState(week));
    }
    if (req.method === 'POST' && url.pathname === '/raid') {
      if (limited(ip)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      const week = E.weekNumber(E.dayNumber());
      if (b.week !== undefined && Number(b.week) !== week) return send(res, 400, { error: 'that raid week is over' });
      const seed = E.raidSeed(week);
      const v = verify(seed, b.actions, { raid: true });
      if (v.error) return send(res, 422, { error: v.error });
      const key = crypto.createHash('sha256').update(`raid:${seed}:${b.actions.join(',')}`).digest('hex');
      if (db.raids.some((r) => r.key === key)) return send(res, 409, { error: 'this run was already submitted' });
      const name = cleanName(b.name);
      db.raids.push({ key, week, name, damage: v.st.damage, score: v.st.score, at: Date.now() });
      dirty = true;
      const st = raidState(week);
      return send(res, 200, { ok: true, damage: v.st.damage, rank: st.top.findIndex((p) => p.name === name) + 1 || null, raid: st });
    }

    // ---- admin (moderation / cleanup), only with the ADMIN_TOKEN set on the service
    if (url.pathname.startsWith('/admin/')) {
      const tok = process.env.ADMIN_TOKEN;
      const given = req.headers['x-admin-token'] || '';
      if (!tok || given.length !== tok.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(tok))) return send(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && url.pathname === '/admin/runs') return send(res, 200, { runs: db.runs.map(({ key, mode, level, name, score, stage, at }) => ({ key, mode, level, name, score, stage, at })) });
      if (req.method === 'POST' && url.pathname === '/admin/delete-runs') {
        const b = await body(req);
        const keys = new Set(Array.isArray(b.keys) ? b.keys : []);
        const before = db.runs.length;
        db.runs = db.runs.filter((r) => !keys.has(r.key));
        dirty = true;
        return send(res, 200, { removed: before - db.runs.length });
      }
      return send(res, 404, { error: 'not found' });
    }

    // ---- Boss Forge: community war machines
    if (req.method === 'POST' && url.pathname === '/forge') {
      if (limited(ip, 10)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      let design;
      try { design = F.normalize(b.design || {}); } catch (e) { return send(res, 400, { error: e.message }); }
      const chip = F.compile(design); // compiled here, never trusted from the client
      const id = crypto.createHash('sha256').update(F.designKey(design)).digest('base64url').slice(0, 8);
      if (!db.forge[id]) { db.forge[id] = { id, design, author: cleanName(b.author), gates: chip.gates, latches: chip.latch, threat: Number(b.threat) || null, created: Date.now(), plays: 0, runs: [] }; dirty = true; }
      return send(res, 200, { id, existed: db.forge[id].created < Date.now() - 1000 });
    }
    if (req.method === 'GET' && url.pathname === '/forge') {
      const list = Object.values(db.forge).map(({ runs, ...f }) => ({ ...f, best: runs.length ? Math.max(...runs.map((r) => r.score)) : 0 }))
        .sort((a, b) => b.plays - a.plays || b.created - a.created).slice(0, 30);
      return send(res, 200, { machines: list });
    }
    const fm = url.pathname.match(/^\/forge\/([\w-]{8})(\/runs)?$/);
    if (fm) {
      const f = db.forge[fm[1]];
      if (!f) return send(res, 404, { error: 'no such war machine' });
      if (req.method === 'GET' && !fm[2]) {
        const best = new Map();
        for (const r of f.runs) if (!best.has(r.name) || r.score > best.get(r.name).score) best.set(r.name, r);
        const { runs, ...rest } = f;
        return send(res, 200, { ...rest, seed: E.forgeSeed(f.design), top: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10) });
      }
      if (req.method === 'POST' && fm[2]) {
        if (limited(ip)) return send(res, 429, { error: 'slow down' });
        const b = await body(req);
        const v = verify(E.forgeSeed(f.design), b.actions, { forge: f.design });
        if (v.error) return send(res, 422, { error: v.error });
        const key = crypto.createHash('sha256').update(`forge:${f.id}:${b.actions.join(',')}`).digest('hex');
        if (f.runs.some((r) => r.key === key)) return send(res, 409, { error: 'this run was already submitted' });
        const run = { key, name: cleanName(b.name), score: v.st.score, stage: v.st.stageNo, bossesDown: v.st.bossesDown, at: Date.now() };
        f.runs.push(run);
        f.plays++;
        dirty = true;
        const ranked = [...f.runs].sort((a, b2) => b2.score - a.score);
        return send(res, 200, { ok: true, score: run.score, rank: ranked.findIndex((r) => r.key === key) + 1, plays: f.plays });
      }
    }

    const m = url.pathname.match(/^\/duels\/([\w-]{4,12})$/);
    if (req.method === 'GET' && m) {
      const d = db.duels[m[1]];
      return d ? send(res, 200, d) : send(res, 404, { error: 'no such duel' });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: String(e.message || e).slice(0, 120) });
  }
});
server.listen(PORT, () => console.log(`nightwire api on :${PORT}, data in ${FILE}`));
