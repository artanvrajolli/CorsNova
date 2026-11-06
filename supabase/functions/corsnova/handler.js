// CorsNova as a Supabase Edge Function.
//
// This file only uses web-standard APIs (Request, Response, Headers, fetch),
// so the same code runs in the Supabase Edge Runtime (Deno) and under the
// Node test runner. Deno-specific bits (DNS, env) are injected from index.ts.

// Bodies up to this size are buffered so a 307/308 redirect can resend them.
// Larger bodies stream straight to the target without being held in memory.
export const REPLAY_BUFFER_BYTES = 4 * 1024 * 1024;
export const MAX_REDIRECTS = 20;
// Supabase Free plan cuts a request off at 150 s; answer just before that so
// the caller gets a JSON 504 with CORS headers instead of a bare gateway 504.
export const DEFAULT_TIMEOUT_MS = 145_000;
export const DEFAULT_USER_AGENT = 'CorsNova/1.0 (+https://github.com/artanvrajolli/CorsNova)';
export const FUNCTION_NAME = 'corsnova';

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// Headers added by the Supabase gateway, Deno or Vercel. They start with "x-",
// so without this list they would be forwarded upstream with the prefix
// stripped (x-forwarded-for -> forwarded-for) and leak the caller's IP.
const INFRA_HEADER = /^x-(forwarded-|real-ip$|sb-|supabase-|region$|deno-|vercel-|amzn-|invocation-id$|request-id$|client-info$)/;

export class ProxyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

// Accepts both forms:
//   .../corsnova?url=https://example.com/a?b=1&c=2   (preferred)
//   .../corsnova/https://example.com/a               (path form)
// Everything after "url=" is taken verbatim, so an unencoded target keeps its
// own query string.
export function extractTarget(rawUrl, functionName = FUNCTION_NAME) {
  // Drop scheme and host, keep the raw path and query untouched.
  let rest = rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');

  const marker = `/${functionName}`;
  const idx = rest.indexOf(marker);
  if (idx !== -1) {
    const after = rest.slice(idx + marker.length);
    if (after === '' || after[0] === '/' || after[0] === '?') {
      rest = after;
    }
  }

  if (rest.startsWith('/?url=')) return rest.slice('/?url='.length);
  if (rest.startsWith('?url=')) return rest.slice('?url='.length);
  if (rest.startsWith('/')) rest = rest.slice(1);
  if (rest.startsWith('?')) return '';
  return rest;
}

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
].map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (parseIPv4(base) & mask) >>> 0, mask };
});

export function parseIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIPv4Int(int) {
  return BLOCKED_IPV4.some(({ network, mask }) => ((int & mask) >>> 0) === network);
}

// Returns the eight 16-bit groups, or null if the string is not IPv6.
export function parseIPv6(ip) {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(':') || !/^[0-9a-f:.]+$/.test(s)) return null;

  // Rewrite an embedded IPv4 tail (::ffff:1.2.3.4) as two hex groups.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function isBlockedIPv6(h) {
  const zeros = (from, to) => h.slice(from, to).every((x) => x === 0);
  const v4 = (hi, lo) => ((hi << 16) | lo) >>> 0;

  if (zeros(0, 7) && (h[7] === 0 || h[7] === 1)) return true; // :: and ::1
  if (zeros(0, 5) && h[5] === 0xffff) return isBlockedIPv4Int(v4(h[6], h[7])); // ::ffff:a.b.c.d
  if (zeros(0, 6)) return isBlockedIPv4Int(v4(h[6], h[7])); // ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return isBlockedIPv4Int(v4(h[6], h[7])); // NAT64
  if (h[0] === 0x2002) return isBlockedIPv4Int(v4(h[1], h[2])); // 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

// Anything that does not parse as an IP address is treated as blocked.
export function isBlockedAddress(ip) {
  const v4 = parseIPv4(ip);
  if (v4 !== null) return isBlockedIPv4Int(v4);
  const v6 = parseIPv6(ip);
  if (v6 !== null) return isBlockedIPv6(v6);
  return true;
}

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

const DNS_CACHE_MAX_ENTRIES = 1000;
const DNS_CACHE_TTL_MS = 60_000;
const DNS_CACHE_ERROR_TTL_MS = 5_000;

function privateTarget() {
  return new ProxyError(400, 'PRIVATE_TARGET', 'Private or internal target addresses are not allowed');
}

// Turns the raw "url" value into a URL. A fully encoded target
// (https%3A%2F%2F...) is decoded once; anything else is used as-is so that
// %xx sequences inside the target's own query string survive.
export function parseTarget(raw) {
  if (!raw) {
    throw new ProxyError(400, 'MISSING_URL', 'Target URL is required');
  }
  let s = raw;
  if (/^https?%3a/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      throw new ProxyError(400, 'INVALID_URL', 'Invalid target URL');
    }
  }
  // Some edges collapse "//" in paths: https:/example.com -> https://example.com
  s = s.replace(/^(https?):\/(?!\/)/i, '$1://');

  let url;
  try {
    url = new URL(s);
  } catch {
    throw new ProxyError(400, 'INVALID_URL', 'Invalid target URL');
  }
  return url;
}

export function createTargetValidator(resolve, { now = Date.now } = {}) {
  const cache = new Map();

  async function lookupVerdict(hostname) {
    let addresses;
    try {
      addresses = await resolve(hostname);
    } catch {
      return 'DNS_ERROR';
    }
    if (!addresses || addresses.length === 0) return 'DNS_ERROR';
    return addresses.some(isBlockedAddress) ? 'PRIVATE_TARGET' : 'OK';
  }

  // Cache each hostname's verdict briefly; concurrent requests share one lookup.
  function hostVerdict(hostname) {
    const t = now();
    const hit = cache.get(hostname);
    if (hit && hit.expiresAt > t) return hit.verdict;
    cache.delete(hostname);
    if (cache.size >= DNS_CACHE_MAX_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
    const entry = { verdict: lookupVerdict(hostname), expiresAt: t + DNS_CACHE_TTL_MS };
    cache.set(hostname, entry);
    entry.verdict.then((v) => {
      if (v === 'DNS_ERROR') entry.expiresAt = now() + DNS_CACHE_ERROR_TTL_MS;
    });
    return entry.verdict;
  }

  return async function validate(url) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ProxyError(400, 'INVALID_PROTOCOL', 'Only http and https targets are allowed');
    }
    if (url.username || url.password) {
      throw new ProxyError(400, 'EMBEDDED_CREDENTIALS', 'Embedded credentials are not allowed');
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!hostname) {
      throw new ProxyError(400, 'INVALID_URL', 'Invalid target URL');
    }
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw privateTarget();
    }

    // The URL parser already normalised IPv4 shorthands (http://2130706433/).
    if (parseIPv4(hostname) !== null || parseIPv6(hostname) !== null) {
      if (isBlockedAddress(hostname)) throw privateTarget();
      return url;
    }

    const verdict = await hostVerdict(hostname);
    if (verdict === 'DNS_ERROR') {
      throw new ProxyError(400, 'DNS_ERROR', `Could not resolve target host: ${hostname}`);
    }
    if (verdict === 'PRIVATE_TARGET') throw privateTarget();
    return url;
  };
}

// ---------------------------------------------------------------------------
// Rate limiting (per instance, best effort)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_BUCKETS = 50_000;

// A limit of 0 (or less) turns rate limiting off.
export function createRateLimiter(limit, { now = Date.now } = {}) {
  const buckets = new Map();

  return function check(key) {
    if (!(limit > 0)) return { ok: true };
    const t = now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      // Re-inserting keeps the Map ordered by window start, oldest first.
      buckets.delete(key);
      if (buckets.size >= RATE_MAX_BUCKETS) {
        buckets.delete(buckets.keys().next().value);
      }
      buckets.set(key, { count: 1, resetAt: t + RATE_WINDOW_MS });
      return { ok: true };
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return { ok: false, retryAfter: Math.ceil((bucket.resetAt - t) / 1000) };
    }
    return { ok: true };
  };
}

// Supabase's gateway sets cf-connecting-ip and sb-forwarded-for itself and
// drops any client-supplied X-Forwarded-For, so these cannot be spoofed.
export function clientIp(headers) {
  const trusted = headers.get('cf-connecting-ip') || headers.get('sb-forwarded-for');
  if (trusted) return trusted.split(',')[0].trim();
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers.get('x-real-ip') || 'unknown';
}

// ---------------------------------------------------------------------------
// Headers and body
// ---------------------------------------------------------------------------

export function buildUpstreamHeaders(clientHeaders, defaultUserAgent = DEFAULT_USER_AGENT) {
  const out = new Headers();
  const cookie = clientHeaders.get('cookie');
  if (cookie) out.set('cookie', cookie);

  for (const [key, value] of clientHeaders) {
    if (!key.startsWith('x-') || INFRA_HEADER.test(key)) continue;
    const name = key.slice(2);
    if (!name) continue;
    try {
      out.set(name, value);
    } catch {
      // Not a valid header name for fetch; skip it rather than fail the request.
    }
  }

  out.set(
    'user-agent',
    clientHeaders.get('x-user-agent') ?? clientHeaders.get('user-agent') ?? defaultUserAgent,
  );
  return out;
}

function bodyTooLarge(limit) {
  return new ProxyError(413, 'BODY_TOO_LARGE', `Request body exceeds the ${limit} byte limit`);
}

function concat(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// Reads up to `replayLimit` bytes into memory. If the body fits, it is
// returned as bytes and can be resent on a 307/308. If not, the buffered
// part and the rest of the stream are stitched back into one stream that is
// forwarded without buffering (replayable: false). `maxBytes` of 0 or
// Infinity means no size cap.
export async function prepareBody(req, { replayLimit = REPLAY_BUFFER_BYTES, maxBytes = 0 } = {}) {
  if (req.method === 'GET' || req.method === 'HEAD' || !req.body) {
    return { body: null, replayable: true };
  }
  const cap = maxBytes > 0 ? maxBytes : Infinity;

  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > cap) throw bodyTooLarge(cap);

  const reader = req.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { body: total === 0 ? null : concat(chunks, total), replayable: true };
    }
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      throw bodyTooLarge(cap);
    }
    chunks.push(value);
    if (total > replayLimit) break;
  }

  let sent = total;
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      chunks.length = 0;
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      sent += value.byteLength;
      if (sent > cap) {
        controller.error(bodyTooLarge(cap));
        await reader.cancel().catch(() => {});
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { body: stream, replayable: false };
}

function corsHeaders(req) {
  const h = new Headers();
  const origin = req.headers.get('origin');
  if (origin) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Credentials', 'true');
    h.set('Vary', 'Origin');
  } else {
    h.set('Access-Control-Allow-Origin', '*');
  }
  // With credentials, "*" is taken literally by browsers, so reflect the
  // headers the preflight asked for.
  h.set('Access-Control-Allow-Headers', req.headers.get('access-control-request-headers') || '*');
  h.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

function json(status, body, headers) {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function createHandler({
  resolve,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_USER_AGENT,
  rateLimitPerMinute = 0,
  maxBodyBytes = 0,
  replayBufferBytes = REPLAY_BUFFER_BYTES,
  publicUrl = '',
  functionName = FUNCTION_NAME,
  now = Date.now,
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  const validate = createTargetValidator(resolve, { now });
  const rateLimit = createRateLimiter(rateLimitPerMinute, { now });

  // Follows redirects by hand so every hop goes through the SSRF check.
  async function fetchFollowing(target, init, signal) {
    let url = target;
    let { method, body, replayable } = init;
    const headers = init.headers;

    for (let hop = 0; ; hop++) {
      const opts = { method, headers, body, redirect: 'manual', signal };
      if (body instanceof ReadableStream) opts.duplex = 'half';
      const res = await fetchImpl(url.href, opts);
      const location = res.headers.get('location');
      if (!REDIRECT_STATUSES.has(res.status) || !location) return res;

      const dropsBody = res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST');
      // A streamed body has already been sent and cannot be resent, so hand
      // the redirect back to the caller instead of following it.
      if (body && !dropsBody && !replayable) return res;

      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) {
        throw new ProxyError(502, 'TOO_MANY_REDIRECTS', 'Upstream redirected too many times');
      }

      let next;
      try {
        next = await validate(new URL(location, url));
      } catch (err) {
        const reason = err instanceof ProxyError ? err.message : 'Invalid redirect location';
        throw new ProxyError(502, 'BAD_REDIRECT', `Upstream redirect rejected: ${reason}`);
      }

      if (dropsBody) {
        if (method !== 'HEAD') method = 'GET';
        body = null;
        replayable = true;
        headers.delete('content-type');
        headers.delete('content-length');
      }
      // Same rule as browsers and undici: credentials do not cross origins.
      if (next.origin !== url.origin) {
        headers.delete('authorization');
        headers.delete('proxy-authorization');
        headers.delete('cookie');
      }
      url = next;
    }
  }

  return async function handle(req) {
    const requestId = crypto.randomUUID();
    const start = now();
    const cors = corsHeaders(req);
    let target;
    let status = 500;

    try {
      if (req.method === 'OPTIONS') {
        status = 204;
        return new Response(null, { status, headers: cors });
      }

      const raw = extractTarget(req.url, functionName);
      if (!raw) {
        status = 200;
        const base = publicUrl || `/${functionName}`;
        return json(status, {
          status: 'ok',
          message: `CorsNova CORS proxy. Use: ${base}?url=https://example.com`,
        }, cors);
      }

      const limited = rateLimit(clientIp(req.headers));
      if (!limited.ok) {
        status = 429;
        cors.set('Retry-After', String(limited.retryAfter));
        return json(status, { status: 'error', message: 'Rate limit exceeded' }, cors);
      }

      // Validate first so a rejected target never makes us read the body.
      target = await validate(parseTarget(raw));
      const { body, replayable } = await prepareBody(req, {
        replayLimit: replayBufferBytes,
        maxBytes: maxBodyBytes,
      });

      const headers = buildUpstreamHeaders(req.headers, userAgent);
      const contentType = req.headers.get('content-type');
      if (body && contentType) headers.set('content-type', contentType);
      const contentLength = req.headers.get('content-length');
      if (body && !replayable && contentLength) headers.set('content-length', contentLength);

      // The timeout covers the wait for response headers. The body then
      // streams for as long as the platform allows.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('Upstream timed out', 'TimeoutError')), timeoutMs);
      const signal = req.signal ? AbortSignal.any([controller.signal, req.signal]) : controller.signal;

      let upstream;
      try {
        upstream = await fetchFollowing(target, { method: req.method, headers, body, replayable }, signal);
      } finally {
        clearTimeout(timer);
      }

      const out = cors;
      const exposed = new Set(['Forward-Request-Id']);
      for (const [key, value] of upstream.headers) {
        const name = `Forward-${key}`;
        out.append(name, value);
        exposed.add(name);
      }
      const upstreamType = upstream.headers.get('content-type');
      if (upstreamType) out.set('Content-Type', upstreamType);
      out.set('Forward-Request-Id', requestId);
      // "*" is literal for credentialed requests, so list the names explicitly.
      out.set('Access-Control-Expose-Headers', [...exposed].join(', '));

      status = upstream.status;
      const passBody = req.method !== 'HEAD' && !NULL_BODY_STATUSES.has(status);
      if (!passBody) await upstream.body?.cancel().catch(() => {});
      return new Response(passBody ? upstream.body : null, {
        status,
        statusText: upstream.statusText,
        headers: out,
      });
    } catch (err) {
      if (req.signal?.aborted) {
        status = 499;
        return new Response(null, { status });
      }
      if (err instanceof ProxyError) {
        status = err.status;
        return json(status, { status: 'error', message: err.message, requestId }, cors);
      }
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      status = isTimeout ? 504 : 502;
      console.error(JSON.stringify({ requestId, error: err?.message }));
      return json(status, {
        status: 'error',
        message: isTimeout ? 'Upstream request timed out' : 'Upstream request failed',
        requestId,
      }, cors);
    } finally {
      log({
        ts: new Date(start).toISOString(),
        requestId,
        method: req.method,
        target: target?.hostname,
        status,
        durMs: now() - start,
      });
    }
  };
}
