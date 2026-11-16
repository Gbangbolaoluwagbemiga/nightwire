// X Layer client for Nightwire. No libraries: reads go to a public RPC, writes go through the player's
// wallet (OKX Wallet, MetaMask, any EIP-1193 provider). Every run is replayed by NightwireEngine on chain.
import { DEPLOY } from './deploy.js';

const params = new URLSearchParams(location.search);
export const NET = {
  chainId: DEPLOY.chainId,
  rpc: params.get('rpc') || DEPLOY.rpc, // ?rpc=…&ladder=… point the game at a local fork for testing
  ladder: params.get('ladder') || DEPLOY.ladder,
  engine: params.get('engine') || DEPLOY.engine,
  explorer: DEPLOY.explorer,
};
export const enabled = () => !!NET.ladder;
export const FREE_PLAY = (1n << 256n) - 1n; // day value for an any-seed run

// ---------------------------------------------------------------- ABI (just what we use)
const SEL = {
  submit: '3ddd836b', dailyBoard: 'a78009b1', allTimeBoard: '8203b088', today: 'b74e452b', dailySeed: '821d5313',
  openDuel: '938326b6', answerDuel: '97a231de', revealDuel: 'cfa07d39', replay: '91ced2c8', dailyPool: 'fb3fa02a',
};
export const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace('0x', '').padStart(64, '0');
function bytesTail(hex) {
  const h = hex.replace('0x', '');
  return word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
}
// encode a call whose arguments are static words plus at most one trailing `bytes`
export function encode(sel, statics, bytesHex = null, after = []) {
  const heads = statics.slice();
  if (bytesHex !== null) heads.push(word((statics.length + 1 + after.length) * 32));
  heads.push(...after);
  return `0x${sel}${heads.join('')}${bytesHex !== null ? bytesTail(bytesHex) : ''}`;
}
export const words = (hex) => { const h = hex.replace('0x', ''); return Array.from({ length: h.length / 64 }, (_, i) => h.slice(i * 64, i * 64 + 64)); };

// ---------------------------------------------------------------- RPC
let rid = 0;
// On DeWEB the gateway blocks off-chain fetches by default, so reads go through the wallet when there is one.
export async function rpc(method, p) {
  const w = wallet();
  if (w && NET.rpc === DEPLOY.rpc) {
    try { return await w.request({ method, params: p }); } catch (e) { if (method === 'eth_call' || method === 'eth_estimateGas') throw e; }
  }
  const r = await fetch(NET.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params: p }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}
export const call = (to, data, gas = '0x10000000') => rpc('eth_call', [{ to, data, gas }, 'latest']);

// ---------------------------------------------------------------- reads
export async function today() { return Number(BigInt(await call(NET.ladder, `0x${SEL.today}`))); }

function decodeEntries(hex) {
  const w = words(hex);
  const n = Number(BigInt(`0x${w[1]}`));
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = w.slice(2 + i * 6, 8 + i * 6).map((x) => BigInt(`0x${x}`));
    out.push({ player: `0x${w[2 + i * 6].slice(24)}`, score: Number(e[1]), stage: Number(e[2]), bossesDown: Number(e[3]), seed: Number(e[4]), at: Number(e[5]) });
  }
  return out;
}
export async function dailyBoard(day) { return decodeEntries(await call(NET.ladder, `0x${SEL.dailyBoard}${word(day)}`)); }
export async function allTimeBoard() { return decodeEntries(await call(NET.ladder, `0x${SEL.allTimeBoard}`)); }

/// Free dry run: X Layer replays the run and says what it scores (no wallet, no gas paid).
export async function checkRun(seed, actionsHex) {
  const out = words(await call(NET.engine, encode(SEL.replay, [word(seed)], actionsHex), '0x2FAF080')); // public RPC cap: 50M
  return { ok: BigInt(`0x${out[0]}`) === 1n, over: BigInt(`0x${out[1]}`) === 1n, score: Number(BigInt(`0x${out[2]}`)), stage: Number(BigInt(`0x${out[3]}`)) };
}

// ---------------------------------------------------------------- wallet
function wallet() { return window.okxwallet || window.ethereum || null; }
export const hasWallet = () => !!wallet();
let account = null;
export async function connect() {
  const w = wallet();
  if (!w) throw new Error('No wallet found. Open this page in OKX Wallet or a browser with a wallet.');
  [account] = await w.request({ method: 'eth_requestAccounts' });
  const hex = `0x${NET.chainId.toString(16)}`;
  if ((await w.request({ method: 'eth_chainId' })) !== hex) {
    try { await w.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); }
    catch (e) {
      if (e.code !== 4902) throw e;
      await w.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: 'X Layer', nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: [DEPLOY.rpc], blockExplorerUrls: [NET.explorer] }] });
    }
  }
  return account;
}

export async function sendTx(to, data, value = 0n) {
  if (!account) await connect();
  const tx = { from: account, to, data, value: `0x${value.toString(16)}` };
  const est = BigInt(await rpc('eth_estimateGas', [tx]));
  const gasPrice = BigInt(await rpc('eth_gasPrice', []));
  tx.gas = `0x${((est * 12n) / 10n).toString(16)}`;
  const hash = await wallet().request({ method: 'eth_sendTransaction', params: [tx] });
  return { hash, fee: Number((est * gasPrice) / 10n ** 12n) / 1e6 }; // OKB
}
export async function waitFor(hash, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const r = await rpc('eth_getTransactionReceipt', [hash]);
    if (r) return r.status === '0x1';
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}
export async function estimateFee(day, seed, actionsHex) {
  const from = account || '0x000000000000000000000000000000000000dEaD';
  const data = encode(SEL.submit, [word(day), word(seed)], actionsHex);
  const [est, gp] = await Promise.all([rpc('eth_estimateGas', [{ from, to: NET.ladder, data }]), rpc('eth_gasPrice', [])]);
  return Number((BigInt(est) * BigInt(gp)) / 10n ** 12n) / 1e6;
}
export const submitRun = (day, seed, actionsHex) => sendTx(NET.ladder, encode(SEL.submit, [word(day), word(seed)], actionsHex));
export const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const txUrl = (h) => `${NET.explorer}/tx/${h}`;
export { addrWord };
