// Who is asking. The panel sits behind Traefik (and k3s), so the socket's address is the proxy's;
// the real client comes from X-Forwarded-For, but only when the proxy itself is one we trust.

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// "10.2.0.0/16", "10.2.3.4", "192.168.1.0/24" -> a test function. IPv6 is compared as text.
function matcher(rule) {
  const [addr, bitsRaw] = rule.trim().split('/');
  const m = V4.exec(addr);
  if (!m) return (ip) => ip === addr;                       // exact, including IPv6
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return () => false;
  const toInt = (a) => a.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = toInt(addr) & mask;
  return (ip) => { const p = V4.exec(ip); return Boolean(p) && (toInt(ip) & mask) === net; };
}

export function netList(rules) {
  const tests = (rules || []).map(matcher);
  return (ip) => Boolean(ip) && tests.some((t) => t(ip));
}

const clean = (ip) => String(ip || '').trim().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');

// The client's address: the socket's peer, or the last hop named in X-Forwarded-For when that peer
// is a proxy we trust. A forwarded request from a peer that is not a trusted proxy is nobody we
// can name: using the peer's own address would let an unlisted proxy (or anyone who can add the
// header) sit inside TRUST_NETWORKS on behalf of every visitor, so it returns null, which no
// network rule matches. Direct connections without the header are still the peer itself.
export function clientIp(req, isTrustedProxy) {
  const peer = clean(req.socket.remoteAddress);
  const forwarded = req.headers['x-forwarded-for'];
  if (!isTrustedProxy(peer)) return forwarded === undefined ? peer : null;
  const chain = String(forwarded || '').split(',').map(clean).filter(Boolean);
  return chain.length ? chain[chain.length - 1] : peer;
}
