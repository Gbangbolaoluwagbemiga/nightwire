// Nightwire API (Railway): global leaderboard for everyone (no wallet needed) and short duel links.
// The server replays every run with the same engine before accepting it.
import { DEPLOY } from './deploy.js';

const base = new URLSearchParams(location.search).get('api') || DEPLOY.api;
export const enabled = () => !!base;
async function req(path, body) {
  const r = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export const submitRun = (run) => req('/runs', run);
export const board = (mode, extra = '') => req(`/boards?mode=${mode}${extra}`);
export const createDuel = (d) => req('/duels', d);
export const getDuel = (id) => req(`/duels/${encodeURIComponent(id)}`);
export const raidState = () => req('/raid');
export const submitRaid = (r) => req('/raid', r);
