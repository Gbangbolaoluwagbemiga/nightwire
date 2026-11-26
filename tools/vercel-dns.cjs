// Steer Node away from the one Vercel IP this ISP blocks (76.76.21.21) to another Vercel edge IP.
const dns = require('dns');
const orig = dns.lookup;
const ALT = '76.76.21.9';
dns.lookup = function (host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  return orig.call(dns, host, opts, (err, addr, fam) => {
    const fix = (a) => (a === '76.76.21.21' ? ALT : a);
    if (err) return cb(err, addr, fam);
    if (Array.isArray(addr)) return cb(null, addr.map((x) => ({ ...x, address: fix(x.address) })));
    return cb(null, fix(addr), fam);
  });
};
