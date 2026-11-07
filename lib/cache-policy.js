// Lets Vercel's CDN cache anonymous GET/HEAD responses. A CDN hit is served
// without invoking the function, so it adds no Fast Origin Transfer.
export const DEFAULT_CACHE_TTL_SECONDS = 600;

// Request headers that change what the upstream returns. Each one becomes part
// of the cache key, so differing values never share an entry.
export const CACHE_VARY = 'Origin, X-Authorization, X-Api-Key, X-Cookie, X-User-Agent';

const PLATFORM_HEADER = /^x-(vercel-|forwarded-|real-ip$|invocation-id$|matched-path$)/;
const CACHEABLE_STATUSES = new Set([200, 404, 410]);

// Unset -> 600. 0 or invalid -> 0 (caching off).
export function getCacheTtlSeconds() {
  const raw = process.env.CACHE_TTL_SECONDS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_CACHE_TTL_SECONDS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

// `req` is an Express/Node request (lower-cased header keys).
export function isRequestCacheable(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const headers = req.headers;
  if (headers.cookie || headers.authorization || headers.range) return false;
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-') && !PLATFORM_HEADER.test(lower)) return false;
  }
  return true;
}

const S_MAXAGE = /(?:^|,)\s*s-maxage\s*=\s*"?(-?\d+)"?/;
const MAX_AGE = /(?:^|,)\s*max-age\s*=\s*"?(-?\d+)"?/;

function directiveSeconds(cacheControl, pattern) {
  const match = cacheControl.match(pattern);
  return match ? Number(match[1]) : undefined;
}

// `upstream` is a fetch Response. Returns the CDN TTL in seconds, 0 = no cache.
export function cacheTtlFor(upstream, maxTtl) {
  if (!maxTtl) return 0;
  if (!CACHEABLE_STATUSES.has(upstream.status)) return 0;
  const headers = upstream.headers;
  if (headers.has('set-cookie')) return 0;
  if ((headers.get('vary') || '').includes('*')) return 0;

  const cacheControl = (headers.get('cache-control') || '').toLowerCase();
  if (/(?:^|,)\s*(no-store|no-cache|private)\b/.test(cacheControl)) return 0;

  const upstreamTtl = directiveSeconds(cacheControl, S_MAXAGE) ?? directiveSeconds(cacheControl, MAX_AGE);
  if (upstreamTtl !== undefined) {
    return Math.max(0, Math.min(upstreamTtl, maxTtl));
  }
  return maxTtl;
}
