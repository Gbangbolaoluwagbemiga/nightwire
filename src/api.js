// Nightwire API (Railway): global leaderboard for everyone (no wallet needed) and short duel links.
// The server replays every run with the same engine before accepting it.
import { DEPLOY } from './deploy.js';

const base = new URLSearchParams(location.search).get('api') || DEPLOY.api;
export const enabled = () => !!base;
// a random secret id for this device: it owns your entries on the boards (only its hash is stored)
export const playerId = (() => {
  let id = null;
  try { id = localStorage.getItem('nw-pid'); } catch { /* storage blocked */ }
  if (!id) {
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    id = `p-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
    try { localStorage.setItem('nw-pid', id); } catch { /* ignore */ }
  }
  return id;
})();
async function req(path, body) {
  const r = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export const submitRun = (run) => req('/runs', { ...run, pid: playerId });
export const board = (mode, extra = '') => req(`/boards?mode=${mode}${extra}&pid=${playerId}`);
export const rename = (name) => req('/me/name', { pid: playerId, name });
export const createDuel = (d) => req('/duels', { ...d, pid: playerId });
export const getDuel = (id) => req(`/duels/${encodeURIComponent(id)}`);
export const raidState = () => req(`/raid?pid=${playerId}`);
export const submitRaid = (r) => req('/raid', { ...r, pid: playerId });
export const publishMachine = (design, author, threat) => req('/forge', { design, author, threat, pid: playerId });
export const listMachines = () => req('/forge');
export const getMachine = (id) => req(`/forge/${encodeURIComponent(id)}?pid=${playerId}`);
export const submitForgeRun = (id, actions, name) => req(`/forge/${encodeURIComponent(id)}/runs`, { actions, name, pid: playerId });
// live 1v1 rooms
export const createLive = (name) => req('/live', { name });
export const joinLive = (code, name) => req(`/live/${code}/join`, { name });
export const liveAct = (code, tok, from, acts) => req(`/live/${code}/act?tok=${encodeURIComponent(tok)}`, { from, acts });
export const liveEvents = (code, tok, from) => new EventSource(`${base}/live/${code}/events?tok=${encodeURIComponent(tok)}&from=${from}`);
