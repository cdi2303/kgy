'use strict';

// SSRF guard for user-supplied webhook URLs. Resolves the host and rejects
// private/loopback/link-local/metadata targets so a check's webhook_url can't
// be pointed at internal services (e.g. cloud metadata 169.254.169.254).

const dns = require('dns').promises;
const net = require('net');

function ipv4IsPrivate(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // malformed → block
  const [a, b] = p;
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 127) return true;                        // loopback
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 169 && b === 254) return true;           // link-local incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true;                         // multicast/reserved
  return false;
}

function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) return ipv4IsPrivate(ip);
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;             // loopback / unspecified
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true; // link-local / ULA
  const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);        // IPv4-mapped
  if (m) return ipv4IsPrivate(m[1]);
  return false;
}

// Throws if the URL is not a safe public http(s) target.
async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) allowed');

  const host = u.hostname;
  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error('private address blocked');
    return;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length) throw new Error('host does not resolve');
  for (const { address } of addrs) {
    if (ipIsPrivate(address)) throw new Error('host resolves to a private address');
  }
}

module.exports = { assertPublicUrl, ipIsPrivate };
