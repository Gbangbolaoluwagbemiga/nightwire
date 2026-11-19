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
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_BODY = 64 * 1024;
const MODES = new Set(['solo', 'ai', 'daily', 'duel']);
const LEVELS = new Set(['easy', 'normal', 'hard']);

fs.mkdirSync(DATA, { recursive: true });
const BACKUPS = path.join(DATA, 'backups');
fs.mkdirSync(BACKUPS, { recursive: true });
let db = { runs: [], duels: {}, raids: [] };
// load the data file; if it is ever unreadable, fall back to the newest daily backup instead of starting empty
function loadDb() {
  if (fs.existsSync(FILE)) {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('data file unreadable, trying backups:', e.message); }
  }
  for (const f of fs.readdirSync(BACKUPS).filter((x) => x.endsWith('.json')).sort().reverse()) {
    try { const d = JSON.parse(fs.readFileSync(path.join(BACKUPS, f), 'utf8')); console.error('restored from backup', f); return d; } catch { /* try older */ }
  }
  if (fs.existsSync(FILE)) throw new Error('data file and all backups unreadable; refusing to start with empty data');
  return null;
}
db = loadDb() || db;
db.raids ??= [];
db.forge ??= {};
const RAID_POOL = Number(process.env.RAID_POOL || 1_500_000); // OMEGA's weekly health, tenths of HP
// every change is on disk before the reply goes out: temp file, fsync, atomic rename
function persist() {
  const tmp = `${FILE}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, JSON.stringify(db));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, FILE);
}
// one backup per day, 14 days kept
function backup() { // from memory (never copy a possibly damaged file over a good backup)
  const name = `nightwire-${new Date().toISOString().slice(0, 10)}.json`;
  const tmp = path.join(BACKUPS, `${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, path.join(BACKUPS, name));
  const all = fs.readdirSync(BACKUPS).filter((x) => x.endsWith('.json')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(BACKUPS, old));
}
persist(); // also repairs the data file after a restore from backup
backup();
setInterval(backup, 6 * 3600 * 1000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { persist(); } finally { process.exit(0); } });

// players: a random secret id kept on the device; only its hash is stored, and it owns that player's entries
const ownerOf = (pid) => (typeof pid === 'string' && /^[\w-]{16,64}$/.test(pid) ? crypto.createHash('sha256').update(pid).digest('hex').slice(0, 16) : null);
const keyOf = (r) => r.owner || `name:${r.name}`;

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

function board(mode, day, level, me = null) {
  const best = new Map(); // one entry per player
  for (const r of db.runs) {
    if (r.mode !== mode) continue;
    if (mode === 'daily' && r.day !== day) continue;
    if (mode === 'ai' && level && r.level !== level) continue;
    const cur = best.get(keyOf(r));
    if (!cur || r.score > cur.score) best.set(keyOf(r), r);
  }
  const all = [...best.values()].sort((a, b) => b.score - a.score);
  const rows = all.slice(0, 20).map((r) => ({ name: r.name, score: r.score, stage: r.stage, bossesDown: r.bossesDown, level: r.level, at: r.at, me: !!me && r.owner === me }));
  const mineAt = me ? all.findIndex((r) => r.owner === me) : -1;
  const mine = mineAt >= 0 ? { rank: mineAt + 1, score: all[mineAt].score, stage: all[mineAt].stage } : null;
  return { rows, mine, players: all.length };
}

function raidState(week, me = null) {
  const runs = db.raids.filter((r) => r.week === week);
  const per = new Map();
  let dealt = 0, downAt = null;
  for (const r of runs.sort((a, b) => a.at - b.at)) {
    dealt += r.damage;
    if (downAt === null && dealt >= RAID_POOL) downAt = r.at;
    const p = per.get(keyOf(r)) || { name: r.name, damage: 0, runs: 0, best: 0, me: !!me && r.owner === me };
    p.name = r.name;
    p.damage += r.damage; p.runs++; p.best = Math.max(p.best, r.damage);
    per.set(keyOf(r), p);
  }
  const top = [...per.values()].sort((a, b) => b.damage - a.damage).slice(0, 20);
  return { week, poolHp: RAID_POOL, dealt: Math.min(dealt, RAID_POOL), overkill: Math.max(0, dealt - RAID_POOL), down: downAt !== null, downAt, runs: runs.length, raiders: per.size, endsAt: (week + 1) * 7 * 86400000, top };
}

// live 1v1 rooms live in memory only (a redeploy ends open matches; nothing is scored from them)
const rooms = new Map();
const ROOM_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const QUICK_WAIT = Number(process.env.QUICK_WAIT_MS || 60_000); // an open quick-match room waits this long for an opponent
function sweepRooms() { const old = Date.now() - 3600_000; for (const [k, r] of rooms) if (r.at < old) { for (const pl of r.p) for (const s of pl.subs) s.end(); rooms.delete(k); } }
setInterval(sweepRooms, 600_000).unref();
function roomPush(pl, ev, data, only = null) {
  const msg = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const s of only ? [only] : pl.subs) s.write(msg);
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
      return send(res, 200, { mode, day, ...board(mode, day, url.searchParams.get('level'), ownerOf(url.searchParams.get('pid'))) });
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
      const run = { key, owner: ownerOf(b.pid), name: cleanName(b.name), mode, level: mode === 'ai' && LEVELS.has(b.level) ? b.level : null, day, seed, score: v.st.score, stage: v.st.stageNo, bossesDown: v.st.bossesDown, at: Date.now() };
      db.runs.push(run);
      persist();
      const bd = board(mode, day, run.level, run.owner);
      return send(res, 200, { ok: true, score: run.score, rank: bd.mine ? bd.mine.rank : bd.rows.findIndex((r) => r.name === run.name && r.score === run.score) + 1 || null, best: bd.mine });
    }

    if (req.method === 'POST' && url.pathname === '/duels') {
      if (limited(ip, 20)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      const hard = !!b.hard;
      const v = verify(b.seed >>> 0, b.actions, { hard });
      if (v.error) return send(res, 422, { error: v.error });
      const id = crypto.randomBytes(5).toString('base64url');
      db.duels[id] = { seed: b.seed >>> 0, actions: b.actions, score: v.st.score, stage: v.st.stageNo, name: cleanName(b.name), owner: ownerOf(b.pid), hard, at: Date.now() };
      persist();
      return send(res, 200, { id });
    }

    if (req.method === 'GET' && url.pathname === '/raid') {
      const week = Number(url.searchParams.get('week') || E.weekNumber(E.dayNumber()));
      return send(res, 200, raidState(week, ownerOf(url.searchParams.get('pid'))));
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
      const owner = ownerOf(b.pid);
      db.raids.push({ key, owner, week, name, damage: v.st.damage, score: v.st.score, at: Date.now() });
      persist();
      const st = raidState(week, owner);
      return send(res, 200, { ok: true, damage: v.st.damage, rank: st.top.findIndex((p) => (owner ? p.me : p.name === name)) + 1 || null, raid: st });
    }

    // ---- your callsign: renaming updates every entry you own
    if (req.method === 'POST' && url.pathname === '/me/name') {
      if (limited(ip, 10)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      const owner = ownerOf(b.pid);
      if (!owner) return send(res, 400, { error: 'bad player id' });
      const name = cleanName(b.name);
      let n = 0;
      for (const r of db.runs) if (r.owner === owner) { r.name = name; n++; }
      for (const r of db.raids) if (r.owner === owner) { r.name = name; n++; }
      for (const f of Object.values(db.forge)) {
        if (f.authorOwner === owner) { f.author = name; n++; }
        for (const r of f.runs) if (r.owner === owner) { r.name = name; n++; }
      }
      for (const d of Object.values(db.duels)) if (d.owner === owner) { d.name = name; n++; }
      persist();
      return send(res, 200, { ok: true, name, updated: n });
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
        persist();
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
      if (!db.forge[id]) { db.forge[id] = { id, design, author: cleanName(b.author), authorOwner: ownerOf(b.pid), gates: chip.gates, latches: chip.latch, threat: Number(b.threat) || null, created: Date.now(), plays: 0, runs: [] }; persist(); }
      return send(res, 200, { id, existed: db.forge[id].created < Date.now() - 1000 });
    }
    if (req.method === 'GET' && url.pathname === '/forge') {
      const list = Object.values(db.forge).map(({ runs, authorOwner, ...f }) => ({ ...f, best: runs.length ? Math.max(...runs.map((r) => r.score)) : 0 }))
        .sort((a, b) => b.plays - a.plays || b.created - a.created).slice(0, 30);
      return send(res, 200, { machines: list });
    }
    const fm = url.pathname.match(/^\/forge\/([\w-]{8})(\/runs)?$/);
    if (fm) {
      const f = db.forge[fm[1]];
      if (!f) return send(res, 404, { error: 'no such war machine' });
      if (req.method === 'GET' && !fm[2]) {
        const best = new Map();
        const me = ownerOf(url.searchParams.get('pid'));
        for (const r of f.runs) if (!best.has(keyOf(r)) || r.score > best.get(keyOf(r)).score) best.set(keyOf(r), r);
        const { runs, authorOwner, ...rest } = f;
        return send(res, 200, { ...rest, mine: !!me && authorOwner === me, seed: E.forgeSeed(f.design), top: [...best.values()].sort((a, b) => b.score - a.score).slice(0, 10).map((r) => ({ name: r.name, score: r.score, stage: r.stage, at: r.at, me: !!me && r.owner === me })) });
      }
      if (req.method === 'POST' && fm[2]) {
        if (limited(ip)) return send(res, 429, { error: 'slow down' });
        const b = await body(req);
        const v = verify(E.forgeSeed(f.design), b.actions, { forge: f.design });
        if (v.error) return send(res, 422, { error: v.error });
        const key = crypto.createHash('sha256').update(`forge:${f.id}:${b.actions.join(',')}`).digest('hex');
        if (f.runs.some((r) => r.key === key)) return send(res, 409, { error: 'this run was already submitted' });
        const run = { key, owner: ownerOf(b.pid), name: cleanName(b.name), score: v.st.score, stage: v.st.stageNo, bossesDown: v.st.bossesDown, at: Date.now() };
        f.runs.push(run);
        f.plays++;
        persist();
        const ranked = [...f.runs].sort((a, b2) => b2.score - a.score);
        return send(res, 200, { ok: true, score: run.score, rank: ranked.findIndex((r) => r.key === key) + 1, plays: f.plays });
      }
    }

    // ---- quick match: join the oldest open room still waiting, or open one that waits QUICK_WAIT for an opponent.
    // Separate from invite rooms: only rooms opened here are ever matched with strangers.
    if (req.method === 'POST' && url.pathname === '/live/quick') {
      if (limited(ip, 20)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      const me = ownerOf(b.pid);
      const now = Date.now();
      for (const [code, room] of rooms) {
        if (!room.quick || room.startAt || room.p.length !== 1 || now - room.created > QUICK_WAIT || (me && room.owner === me)) continue;
        if (!room.p[0].subs.size) continue; // its host is gone
        const tok = crypto.randomBytes(12).toString('base64url');
        room.p.push({ tok, name: cleanName(b.name), acts: [], subs: new Set() });
        room.startAt = now + 4000;
        room.at = now;
        for (const pl of room.p) roomPush(pl, 'start', { startAt: room.startAt, now, names: room.p.map((x) => x.name) });
        return send(res, 200, { code, tok, seed: room.seed, slot: 1, host: room.p[0].name, startAt: room.startAt, now, matched: true });
      }
      sweepRooms();
      if (rooms.size > 2000) return send(res, 503, { error: 'too many rooms, try again soon' });
      let code;
      do code = Array.from(crypto.randomBytes(4), (x) => ROOM_ABC[x % ROOM_ABC.length]).join(''); while (rooms.has(code));
      const tok = crypto.randomBytes(12).toString('base64url');
      rooms.set(code, { quick: true, owner: me, created: now, seed: crypto.randomBytes(4).readUInt32BE(0), at: now, startAt: 0, p: [{ tok, name: cleanName(b.name), acts: [], subs: new Set() }] });
      return send(res, 200, { code, tok, seed: rooms.get(code).seed, slot: 0, wait: QUICK_WAIT, matched: false });
    }

    // ---- live 1v1: two players, one battlefield, each one's moves relayed to the other as they happen
    if (req.method === 'POST' && url.pathname === '/live') {
      if (limited(ip, 20)) return send(res, 429, { error: 'slow down' });
      const b = await body(req);
      sweepRooms();
      if (rooms.size > 2000) return send(res, 503, { error: 'too many rooms, try again soon' });
      let code;
      do code = Array.from(crypto.randomBytes(4), (x) => ROOM_ABC[x % ROOM_ABC.length]).join(''); while (rooms.has(code));
      const tok = crypto.randomBytes(12).toString('base64url');
      rooms.set(code, { seed: crypto.randomBytes(4).readUInt32BE(0), at: Date.now(), startAt: 0, p: [{ tok, name: cleanName(b.name), acts: [], subs: new Set() }] });
      return send(res, 200, { code, tok, seed: rooms.get(code).seed, slot: 0 });
    }
    const lm = url.pathname.match(/^\/live\/([A-Z]{4})\/(join|events|act|leave)$/);
    if (lm) {
      const room = rooms.get(lm[1]);
      if (!room) return send(res, 404, { error: 'no such room (codes expire after an hour)' });
      if (req.method === 'POST' && lm[2] === 'join') {
        if (limited(ip, 30)) return send(res, 429, { error: 'slow down' });
        const b = await body(req);
        if (room.p.length >= 2) return send(res, 409, { error: 'this room is full' });
        const tok = crypto.randomBytes(12).toString('base64url');
        room.p.push({ tok, name: cleanName(b.name), acts: [], subs: new Set() });
        room.startAt = Date.now() + 4000; // both sides count down to the same moment
        room.at = Date.now();
        for (const pl of room.p) roomPush(pl, 'start', { startAt: room.startAt, now: Date.now(), names: room.p.map((x) => x.name) });
        return send(res, 200, { tok, seed: room.seed, slot: 1, host: room.p[0].name, startAt: room.startAt, now: Date.now() });
      }
      const me = room.p.findIndex((x) => x.tok === url.searchParams.get('tok'));
      if (me < 0) return send(res, 403, { error: 'not in this room' });
      const them = room.p[1 - me];
      if (req.method === 'POST' && lm[2] === 'leave') { // the host gave up waiting: close the room so nobody joins an empty one
        if (!room.startAt) { for (const pl of room.p) for (const s2 of pl.subs) s2.end(); rooms.delete(lm[1]); }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && lm[2] === 'events') { // server-sent events: catch up from ?from=n, then live
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*', 'x-accel-buffering': 'no' });
        res.write(': open\n\n');
        const pl = room.p[me];
        pl.subs.add(res);
        if (room.startAt) roomPush(pl, 'start', { startAt: room.startAt, now: Date.now(), names: room.p.map((x) => x.name) }, res);
        const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
        if (them && them.acts.length > from) roomPush(pl, 'act', { from, acts: them.acts.slice(from) }, res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          pl.subs.delete(res);
          if (room.quick && !room.startAt && !pl.subs.size) setTimeout(() => { if (!room.startAt && !pl.subs.size) rooms.delete(lm[1]); }, 8000); // host left the queue
        });
        return;
      }
      if (req.method === 'POST' && lm[2] === 'act') {
        const b = await body(req);
        const pl = room.p[me];
        const from = Number(b.from);
        if (!Array.isArray(b.acts) || !Number.isInteger(from) || from < 0 || from > pl.acts.length || from + b.acts.length > 1600 || !b.acts.every((a) => typeof a === 'string' && (ACTION.test(a) || a === 'Q'))) return send(res, 400, { error: 'bad actions' });
        const fresh = b.acts.slice(pl.acts.length - from); // a resend after a dropped reply only adds what is new
        if (fresh.length) {
          pl.acts.push(...fresh);
          room.at = Date.now();
          if (them) roomPush(them, 'act', { from: pl.acts.length - fresh.length, acts: fresh });
        }
        return send(res, 200, { ok: true, n: pl.acts.length });
      }
    }

    const m = url.pathname.match(/^\/duels\/([\w-]{4,12})$/);
    if (req.method === 'GET' && m) {
      const d = db.duels[m[1]];
      if (!d) return send(res, 404, { error: 'no such duel' });
      const { owner, ...pub } = d;
      return send(res, 200, pub);
    }
    // ---- backup mirror of the game itself (the main site is on Vercel)
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (/^(index\.html|style\.css|src\/[a-z0-9]+\.js)$/.test(rel)) {
        const file = path.join(ROOT, rel);
        if (fs.existsSync(file)) {
          const type = rel.endsWith('.html') ? 'text/html; charset=utf-8' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
          res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=0, must-revalidate', 'x-content-type-options': 'nosniff' });
          return res.end(fs.readFileSync(file));
        }
      }
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 400, { error: String(e.message || e).slice(0, 120) });
  }
});
server.listen(PORT, () => console.log(`nightwire api on :${PORT}, data in ${FILE}`));
