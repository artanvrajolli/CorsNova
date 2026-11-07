// CorsNova as a Cloudflare Worker. Deploy from this folder:
//
//   npx wrangler login
//   npx wrangler deploy
//
// All proxy logic lives in the shared web-standard handler used by the
// Supabase Edge Function. Workers have no DNS API, so the SSRF check resolves
// hostnames over DNS-over-HTTPS.

import { createHandler, DEFAULT_TIMEOUT_MS } from '../supabase/functions/corsnova/handler.js';

const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const RECORD_A = 1;
const RECORD_AAAA = 28;

export function createDohResolver(fetchImpl = fetch) {
  async function query(hostname, type) {
    const url = `${DOH_URL}?name=${encodeURIComponent(hostname)}&type=${type}`;
    const res = await fetchImpl(url, { headers: { accept: 'application/dns-json' } });
    if (!res.ok) throw new Error(`DNS query for ${hostname} failed with status ${res.status}`);
    const data = await res.json();
    return (data.Answer ?? [])
      .filter((record) => record.type === RECORD_A || record.type === RECORD_AAAA)
      .map((record) => record.data);
  }

  return async function resolve(hostname) {
    const results = await Promise.allSettled([query(hostname, 'A'), query(hostname, 'AAAA')]);
    const addresses = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    if (addresses.length === 0) {
      const failure = results.find((r) => r.status === 'rejected');
      if (failure) throw failure.reason;
      throw new Error(`No A/AAAA records for ${hostname}`);
    }
    return addresses;
  };
}

function numberSetting(env, name, fallback) {
  return Number(env[name] ?? fallback);
}

export function createWorker({ resolve = createDohResolver(), fetchImpl } = {}) {
  let handler;
  return {
    fetch(request, env = {}) {
      // Env vars are only available per request, so build the handler lazily.
      if (!handler) {
        handler = createHandler({
          resolve,
          ...(fetchImpl ? { fetchImpl } : {}),
          timeoutMs: numberSetting(env, 'CORSNOVA_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
          rateLimitPerMinute: numberSetting(env, 'CORSNOVA_RATE_LIMIT_PER_MINUTE', 0),
          maxBodyBytes: numberSetting(env, 'CORSNOVA_MAX_BODY_BYTES', 0),
          // The worker serves from the root, not from /corsnova.
          functionName: '',
          publicUrl: `${new URL(request.url).origin}/`,
        });
      }
      return handler(request);
    },
  };
}

export default createWorker();
