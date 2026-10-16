const WINDOW_MS = 60_000;
const MAX_BUCKETS = 50_000;

const buckets = new Map();

function getLimit() {
  return Number(process.env.RATE_LIMIT_PER_MINUTE || 100);
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Drop expired buckets so long-running instances don't keep every IP forever.
export function sweepBuckets(now = Date.now()) {
  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(ip);
    }
  }
}

export function _resetBuckets() {
  buckets.clear();
}

export function _bucketCount() {
  return buckets.size;
}

setInterval(sweepBuckets, WINDOW_MS).unref();

export function rateLimit(req, res, next) {
  const ip = getClientIP(req);
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    // Re-inserting keeps the Map ordered by window start, oldest first.
    buckets.delete(ip);
    if (buckets.size >= MAX_BUCKETS) {
      buckets.delete(buckets.keys().next().value);
    }
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > getLimit()) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ status: 'error', message: 'Rate limit exceeded' });
  }

  next();
}
