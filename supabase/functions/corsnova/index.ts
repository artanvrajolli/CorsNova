// Supabase Edge Function entry point. Deploy with JWT verification off so the
// proxy is callable without a Supabase key:
//
//   supabase functions deploy corsnova --no-verify-jwt --project-ref <ref>
//
// All proxy logic lives in handler.js (web-standard APIs, tested under Node).

import { createHandler, DEFAULT_TIMEOUT_MS, FUNCTION_NAME } from './handler.js';

async function resolve(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);
  const addresses = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (addresses.length === 0) {
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw failure?.reason ?? new Error(`No A/AAAA records for ${hostname}`);
  }
  return addresses;
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

Deno.serve(
  createHandler({
    resolve,
    // Defaults: 145 s timeout, no rate limit, no body size cap (0 = off).
    timeoutMs: Number(Deno.env.get('CORSNOVA_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS),
    rateLimitPerMinute: Number(Deno.env.get('CORSNOVA_RATE_LIMIT_PER_MINUTE') ?? 0),
    maxBodyBytes: Number(Deno.env.get('CORSNOVA_MAX_BODY_BYTES') ?? 0),
    publicUrl: supabaseUrl ? `${supabaseUrl}/functions/v1/${FUNCTION_NAME}` : '',
  }),
);
