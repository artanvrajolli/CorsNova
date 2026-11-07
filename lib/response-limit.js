import { Transform } from 'node:stream';

// Every byte a Vercel function returns counts as Fast Origin Transfer, so
// large responses are refused instead of streamed.
export const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Unset or empty -> default. 0, negative or invalid -> 0 (cap off).
export function getMaxResponseBytes() {
  const raw = process.env.MAX_RESPONSE_BYTES;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_RESPONSE_BYTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${trim(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${trim(n / 1024)} KB`;
  return `${n} bytes`;
}

function trim(value) {
  return String(Number(value.toFixed(1)));
}

export function responseTooLargeError(max) {
  const err = new Error(`Upstream response is larger than the ${formatBytes(max)} limit`);
  err.code = 'RESPONSE_TOO_LARGE';
  return err;
}

// `headers` is a fetch Headers object.
export function exceedsDeclaredLength(headers, max) {
  if (!max) return false;
  const declared = Number(headers.get('content-length'));
  return Number.isFinite(declared) && declared > max;
}

// Passes chunks through and fails once the running total crosses `max`.
// Catches chunked responses that declare no content-length.
export function limitBytes(max) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > max) {
        callback(responseTooLargeError(max));
        return;
      }
      callback(null, chunk);
    },
  });
}
