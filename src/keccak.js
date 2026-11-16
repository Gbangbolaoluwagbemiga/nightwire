// Keccak-256 (the Ethereum hash), dependency-free, for checking TapeSend digests and building commitments.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

// 32-bit halves are much faster than BigInt in the round function
function f(sh, sl) {
  const bh = new Uint32Array(5), bl = new Uint32Array(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      bh[x] = sh[x] ^ sh[x + 5] ^ sh[x + 10] ^ sh[x + 15] ^ sh[x + 20];
      bl[x] = sl[x] ^ sl[x + 5] ^ sl[x + 10] ^ sl[x + 15] ^ sl[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const nh = bh[(x + 1) % 5], nl = bl[(x + 1) % 5];
      const th = bh[(x + 4) % 5] ^ ((nh << 1) | (nl >>> 31)), tl = bl[(x + 4) % 5] ^ ((nl << 1) | (nh >>> 31));
      for (let y = 0; y < 25; y += 5) { sh[y + x] ^= th; sl[y + x] ^= tl; }
    }
    const th = new Uint32Array(25), tl = new Uint32Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      const i = x + 5 * y, r = ROT[i], j = y + 5 * ((2 * x + 3 * y) % 5);
      let h = sh[i], l = sl[i];
      if (r >= 32) { const t = h; h = l; l = t; }
      const k = r % 32;
      if (k) { const nh = (h << k) | (l >>> (32 - k)); const nl = (l << k) | (h >>> (32 - k)); h = nh; l = nl; }
      th[j] = h; tl[j] = l;
    }
    for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) {
      sh[y + x] = th[y + x] ^ (~th[y + ((x + 1) % 5)] & th[y + ((x + 2) % 5)]);
      sl[y + x] = tl[y + x] ^ (~tl[y + ((x + 1) % 5)] & tl[y + ((x + 2) % 5)]);
    }
    sh[0] ^= Number(RC[round] >> 32n);
    sl[0] ^= Number(RC[round] & 0xffffffffn);
  }
}

export function keccak256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const sh = new Uint32Array(25), sl = new Uint32Array(25);
  for (let o = 0; o < padded.length; o += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const p = o + i * 8;
      sl[i] ^= padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
      sh[i] ^= padded[p + 4] | (padded[p + 5] << 8) | (padded[p + 6] << 16) | (padded[p + 7] << 24);
    }
    f(sh, sl);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    for (let b = 0; b < 4; b++) { out[i * 8 + b] = (sl[i] >>> (8 * b)) & 255; out[i * 8 + 4 + b] = (sh[i] >>> (8 * b)) & 255; }
  }
  return out;
}
