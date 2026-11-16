// Builds contracts/deweb.json: every file of the game, SHA-256, split into 24,000-byte chunks for SiteRegistry.
// DeWEB serves code only from chain and blocks off-chain requests by default, so the published index.html
// drops the Google Fonts link (system fonts take over) and the site is 100% on-chain.  node tools/deweb-manifest.mjs
import fs from 'fs';
import crypto from 'crypto';
const root = new URL('..', import.meta.url).pathname;
const FILES = [
  ['index.html', 'text/html'], ['style.css', 'text/css'],
  ...fs.readdirSync(`${root}src`).filter((f) => f.endsWith('.js')).sort().map((f) => [`src/${f}`, 'text/javascript']),
];
const CHUNK = 24000;
const files = FILES.map(([path, ct]) => {
  let buf = fs.readFileSync(root + path);
  if (path === 'index.html') buf = Buffer.from(buf.toString().replace(/\s*<link rel="preconnect"[^>]*>/g, '').replace(/\s*<link href="https:\/\/fonts[^>]*>/g, ''));
  const chunks = [];
  for (let i = 0; i < buf.length; i += CHUNK) chunks.push(`0x${buf.subarray(i, i + CHUNK).toString('hex')}`);
  return { path, contentType: ct, sha256: `0x${crypto.createHash('sha256').update(buf).digest('hex')}`, size: buf.length, chunks };
});
fs.writeFileSync(`${root}contracts/deweb.json`, JSON.stringify({ count: files.length, files }));
console.log(files.map((f) => `${f.path} ${f.size}B ${f.chunks.length} chunk(s)`).join('\n'));
console.log('total', files.reduce((s, f) => s + f.size, 0), 'bytes');
