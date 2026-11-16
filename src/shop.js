// The "+" shop: cosmetics only (they never touch a score) and war-machine tape-outs. Paid in OKB on X Layer.
export const ITEMS = [
  { id: 1, slot: 'camo', name: 'Desert camo', note: 'Sand-coloured sandbags and bunker', colors: ['#d9b77a', '#c49a5a', '#4a3d26'] },
  { id: 2, slot: 'camo', name: 'Arctic camo', note: 'White-out base for night raids', colors: ['#e6eef2', '#b9c9d3', '#3a4650'] },
  { id: 3, slot: 'camo', name: 'Urban camo', note: 'Concrete greys', colors: ['#7d8590', '#5c636c', '#24282e'] },
  { id: 11, slot: 'tracer', name: 'Plasma tracers', note: 'Electric-blue machine-gun fire', color: '#6FD3FF' },
  { id: 12, slot: 'tracer', name: 'Inferno tracers', note: 'Burning orange rounds', color: '#FF6A3D' },
  { id: 13, slot: 'tracer', name: 'Toxic tracers', note: 'Acid-green rounds', color: '#9DFF5A' },
];
export const DEFAULT = { camo: ['#a08a5c', '#8f7a4f', '#2b2f26'], tracer: '#FFE08A' };

let owned = new Set(), equipped = { camo: 0, tracer: 0 };
try {
  owned = new Set(JSON.parse(localStorage.getItem('nw-owned') || '[]'));
  equipped = { ...equipped, ...JSON.parse(localStorage.getItem('nw-equip') || '{}') };
} catch { /* defaults */ }
const save = () => { try { localStorage.setItem('nw-owned', JSON.stringify([...owned])); localStorage.setItem('nw-equip', JSON.stringify(equipped)); } catch { /* ignore */ } };

export const isOwned = (id) => owned.has(id);
export function setOwned(ids) { owned = new Set(ids); for (const s of ['camo', 'tracer']) if (equipped[s] && !owned.has(equipped[s])) equipped[s] = 0; save(); }
export function addOwned(id) { owned.add(id); save(); }
export const equippedId = (slot) => equipped[slot];
export function equip(slot, id) { equipped[slot] = id && owned.has(id) ? id : 0; save(); }
export function camo() { const it = ITEMS.find((i) => i.id === equipped.camo); return it ? it.colors : DEFAULT.camo; }
export function tracer() { const it = ITEMS.find((i) => i.id === equipped.tracer); return it ? it.color : DEFAULT.tracer; }
