// TapeSend duels: send a Nightwire challenge from your TapeOut circuit's container to a friend's, through the
// DeWEB hub on X Layer (TAP-10). Challenges are public TapeSend messages ('TS', v2, public) that the official
// TapeSend app shows too; Nightwire reads your inbox and checks every message's digest against the chain.
import { keccak256 } from './keccak.js';
import { NET, call, encode, rpc, sendTx, word, words } from './chain.js';

export const HUB = '0xe61A9C7213a6Aa616C246a2B569e555B417b25ee';
const FACTORY = '0x1f09DAeFA827f02CBb40967cc91b259763760761';
const SENT = '0xd75bb8082dd3ae8bb88682115ee1412a8e8051cc81d0e4c01dc3b06c0cf61020';
const SEL = { send: 'a181b579', inboxCount: '9343ecd9', inboxPage: '2eec4913', cpuAt: '4bc7cbbd', keyFor: '3145c6cb' };

const hexOf = (b) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const bytesOf = (h) => Uint8Array.from((h.replace('0x', '').match(/../g) || []).map((x) => parseInt(x, 16)));
const addr = (w) => `0x${w.slice(24)}`;

/** "1.2.424", "1.2.424.tape" or "#1@2.424" (2 = X Layer's area code) */
export function parseName(s) {
  const m = String(s).trim().toLowerCase().match(/^#?(\d+)[.@]2\.(\d+)(?:\.tape)?$/);
  return m ? { id: BigInt(m[1]), cpuNo: BigInt(m[2]) } : null;
}

/** Resolve a name to its processor, container and endpoint, and whether it can send (opened) */
export async function resolve(name) {
  const n = parseName(name);
  if (!n) throw new Error(`"${name}" is not an X Layer TapeOut name (like 1.2.424)`);
  const processor = addr(words(await call(FACTORY, `0x${SEL.cpuAt}${word(n.cpuNo)}`))[0]);
  const kv = words(await call(HUB, `0x${SEL.keyFor}${processor.replace('0x', '').padStart(64, '0')}${word(n.id)}`));
  return { ...n, processor, container: addr(kv[0]), endpoint: `0x${kv[1]}`, opened: BigInt(`0x${kv[2]}`) === 1n, holder: addr(kv[3]) };
}

/** Public TapeSend message (TAP-10 §5.2 + §6): 'TS' 0x02 0x00 then the JSON content */
export function challengePayload({ score, stage, link }) {
  const content = JSON.stringify({ v: 1, kind: 'message', subject: 'Nightwire duel', body: `I scored ${score.toLocaleString('en-US')} on Nightwire (stage ${stage}). Same battlefield, same supplies. Beat me: ${link}`, ts: Date.now() });
  const body = new TextEncoder().encode(content);
  const out = new Uint8Array(4 + body.length);
  out.set([0x54, 0x53, 0x02, 0x00]);
  out.set(body, 4);
  return out;
}

export async function sendChallenge(fromName, toName, payload) {
  const from = await resolve(fromName);
  if (!from.opened) throw new Error(`${fromName} has no opened container yet (open it once in TapeOut to send).`);
  const to = await resolve(toName);
  const data = encode(SEL.send, [from.processor.replace('0x', '').padStart(64, '0'), word(from.id), to.endpoint.replace('0x', ''), word(0)], hexOf(payload));
  return sendTx(HUB, data);
}

/** Nightwire challenges in a name's inbox, newest first, each checked against its on-chain digest */
export async function inbox(name, max = 15) {
  const me = await resolve(name);
  const count = Number(BigInt(await call(HUB, `0x${SEL.inboxCount}${me.endpoint.replace('0x', '')}`)));
  if (!count) return [];
  const start = Math.max(0, count - max);
  const w = words(await call(HUB, `0x${SEL.inboxPage}${me.endpoint.replace('0x', '')}${word(start)}${word(count - start)}`));
  const n = Number(BigInt(`0x${w[1]}`));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const e = w.slice(2 + i * 4, 6 + i * 4);
    const from = addr(e[0]), block = BigInt(`0x${e[1]}`), ts = Number(BigInt(`0x${e[2]}`)), digest = `0x${e[3]}`;
    const logs = await rpc('eth_getLogs', [{ address: HUB, fromBlock: `0x${block.toString(16)}`, toBlock: `0x${block.toString(16)}`, topics: [SENT, me.endpoint] }]);
    const log = logs.find((l) => Number(BigInt(`0x${words(l.data)[0]}`)) === start + i);
    if (!log) continue;
    const d = words(log.data);
    const len = Number(BigInt(`0x${d[3]}`));
    const payload = bytesOf(d.slice(4).join('')).subarray(0, len);
    const ref = bytesOf(log.topics[3]);
    const check = new Uint8Array(64);
    check.set(ref);
    check.set(keccak256(payload), 32);
    if (hexOf(keccak256(check)) !== digest) continue; // not what the hub recorded: ignore
    if (payload[0] !== 0x54 || payload[1] !== 0x53 || payload[2] !== 0x02 || payload[3] !== 0x00) continue; // encrypted or other
    let msg;
    try { msg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(4))); } catch { continue; }
    const link = typeof msg.body === 'string' && (msg.body.match(/https?:\/\/\S*#duel=[\w-]+/) || [])[0];
    if (!link) continue;
    out.push({ from, at: ts, body: msg.body, link, tx: log.transactionHash });
  }
  return out;
}
export const explorerTx = (h) => `${NET.explorer}/tx/${h}`;
