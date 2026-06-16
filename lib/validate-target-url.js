import { isIP } from 'node:net';
import dns from 'node:dns/promises';

const PRIVATE_IPV4_RANGES = [
  [10, 0, 0, 0, 8],      // 10.0.0.0/8
  [172, 16, 0, 0, 12],   // 172.16.0.0/12
  [192, 168, 0, 0, 16],  // 192.168.0.0/16
  [127, 0, 0, 0, 8],     // 127.0.0.0/8
  [169, 254, 0, 0, 16],  // 169.254.0.0/16 link-local
  [224, 0, 0, 0, 4],     // 224.0.0.0/4 multicast
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIPv4(ip) {
  if (ip === '0.0.0.0' || ip === '255.255.255.255' || ip.startsWith('0.')) {
    return true;
  }
  const int = ipv4ToInt(ip);
  for (const [a, b, c, d, bits] of PRIVATE_IPV4_RANGES) {
    const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
    const network = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    if (((int & mask) >>> 0) === network) return true;
  }
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.slice(7);
    if (isIP(ipv4) === 4) return isPrivateIPv4(ipv4);
  }
  return false;
}

function isPrivateIP(ip) {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return false;
}

function decodeOnce(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function validateTargetUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    const err = new Error('Target URL is required');
    err.code = 'MISSING_URL';
    throw err;
  }

  const urlString = decodeOnce(raw);

  // If the URL was fully encoded (e.g. https%3A%2F%2F...) decodeOnce already
  // decoded it.  If it contains a query string with %xx we leave it encoded so
  // that new URL() preserves the intended query values.
  let url;
  try {
    url = new URL(urlString);
  } catch {
    const err = new Error('Invalid target URL');
    err.code = 'INVALID_URL';
    throw err;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('Only http and https targets are allowed');
    err.code = 'INVALID_PROTOCOL';
    throw err;
  }

  if (url.username || url.password) {
    const err = new Error('Embedded credentials are not allowed');
    err.code = 'EMBEDDED_CREDENTIALS';
    throw err;
  }

  const hostname = url.hostname;
  if (!hostname) {
    const err = new Error('Invalid target URL');
    err.code = 'INVALID_URL';
    throw err;
  }

  const ipFamily = isIP(hostname);
  if (ipFamily) {
    if (isPrivateIP(hostname)) {
      const err = new Error('Private or internal target addresses are not allowed');
      err.code = 'PRIVATE_TARGET';
      throw err;
    }
    return url;
  }

  // Hostname: resolve and block DNS rebinding to private addresses.
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    const err = new Error(`Could not resolve target host: ${hostname}`);
    err.code = 'DNS_ERROR';
    throw err;
  }

  if (!records || records.length === 0) {
    const err = new Error(`Could not resolve target host: ${hostname}`);
    err.code = 'DNS_ERROR';
    throw err;
  }

  for (const record of records) {
    if (isPrivateIP(record.address)) {
      const err = new Error('Private or internal target addresses are not allowed');
      err.code = 'PRIVATE_TARGET';
      throw err;
    }
  }

  return url;
}
