import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHandler,
  extractTarget,
  parseTarget,
  isBlockedAddress,
  createTargetValidator,
  buildUpstreamHeaders,
  MAX_REDIRECTS,
} from '../../supabase/functions/corsnova/handler.js';

async function readAll(body) {
  if (body instanceof Uint8Array) return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

const BASE = 'https://ref.supabase.co/functions/v1/corsnova';

// Default resolver: every hostname is public unless listed.
function resolver(map = {}) {
  return async (host) => {
    if (host in map) {
      const v = map[host];
      if (v instanceof Error) throw v;
      return v;
    }
    return ['93.184.215.14'];
  };
}

function makeHandler({ fetchImpl, resolve = resolver(), ...rest } = {}) {
  const calls = [];
  const impl = fetchImpl ?? (async (url, init) => {
    calls.push({ url, init });
    return new Response('upstream-body', { status: 200, headers: { 'content-type': 'text/plain' } });
  });
  const handler = createHandler({
    resolve,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return impl(url, init);
    },
    log: () => {},
    ...rest,
  });
  return { handler, calls };
}

describe('extractTarget', () => {
  it('reads the ?url= form verbatim, keeping the target query string', () => {
    assert.equal(
      extractTarget('http://host/corsnova?url=https://a.com/x?b=1&c=2'),
      'https://a.com/x?b=1&c=2',
    );
  });

  it('handles the full /functions/v1 prefix', () => {
    assert.equal(extractTarget(`${BASE}?url=https://a.com`), 'https://a.com');
    assert.equal(extractTarget(`${BASE}/?url=https://a.com`), 'https://a.com');
  });

  it('reads the path form', () => {
    assert.equal(extractTarget(`${BASE}/https://a.com/p?q=1`), 'https://a.com/p?q=1');
  });

  it('returns empty for the bare function URL or another query', () => {
    assert.equal(extractTarget(BASE), '');
    assert.equal(extractTarget(`${BASE}/`), '');
    assert.equal(extractTarget(`${BASE}?foo=1`), '');
  });

  it('does not treat a longer function name as a match', () => {
    assert.equal(extractTarget('http://host/corsnova2/https://a.com'), 'corsnova2/https://a.com');
  });
});

describe('parseTarget', () => {
  it('decodes a fully encoded target once', () => {
    const url = parseTarget(encodeURIComponent('https://a.com/x?q=a&b=c%26d'));
    assert.equal(url.href, 'https://a.com/x?q=a&b=c%26d');
  });

  it('keeps %xx in an unencoded target', () => {
    assert.equal(parseTarget('https://a.com/x?b=c%26d').search, '?b=c%26d');
  });

  it('repairs a collapsed scheme slash', () => {
    assert.equal(parseTarget('https:/a.com/x').href, 'https://a.com/x');
  });

  it('rejects empty and malformed input', () => {
    assert.throws(() => parseTarget(''), { code: 'MISSING_URL' });
    assert.throws(() => parseTarget('not a url'), { code: 'INVALID_URL' });
  });
});

describe('isBlockedAddress', () => {
  for (const ip of [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fd00::1', 'fc00::',
    'fe80::1', 'ff02::1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '::10.0.0.1',
    'garbage',
  ]) {
    it(`blocks ${ip}`, () => assert.equal(isBlockedAddress(ip), true));
  }

  for (const ip of ['8.8.8.8', '93.184.215.14', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    it(`allows ${ip}`, () => assert.equal(isBlockedAddress(ip), false));
  }
});

describe('createTargetValidator', () => {
  const validate = createTargetValidator(resolver({
    'internal.example': ['10.0.0.5'],
    'mixed.example': ['8.8.8.8', '::1'],
    'nxdomain.example': new Error('NXDOMAIN'),
  }));
  const check = (s) => validate(new URL(s));

  it('allows public hostnames', async () => {
    assert.equal((await check('https://example.com/a')).hostname, 'example.com');
  });

  it('blocks hostnames that resolve to private addresses (any record)', async () => {
    await assert.rejects(check('http://internal.example/'), { code: 'PRIVATE_TARGET' });
    await assert.rejects(check('http://mixed.example/'), { code: 'PRIVATE_TARGET' });
  });

  it('blocks IP literals, including shorthand and bracketed IPv6', async () => {
    await assert.rejects(check('http://127.0.0.1/'), { code: 'PRIVATE_TARGET' });
    await assert.rejects(check('http://2130706433/'), { code: 'PRIVATE_TARGET' });
    await assert.rejects(check('http://[::ffff:127.0.0.1]/'), { code: 'PRIVATE_TARGET' });
    await assert.rejects(check('http://[fd00::1]:8080/'), { code: 'PRIVATE_TARGET' });
  });

  it('blocks localhost names without a DNS lookup', async () => {
    await assert.rejects(check('http://localhost:3000/'), { code: 'PRIVATE_TARGET' });
    await assert.rejects(check('http://api.localhost/'), { code: 'PRIVATE_TARGET' });
  });

  it('rejects other protocols, credentials and DNS failures', async () => {
    await assert.rejects(check('ftp://example.com/'), { code: 'INVALID_PROTOCOL' });
    await assert.rejects(check('https://u:p@example.com/'), { code: 'EMBEDDED_CREDENTIALS' });
    await assert.rejects(check('https://nxdomain.example/'), { code: 'DNS_ERROR' });
  });

  it('caches verdicts per hostname', async () => {
    let lookups = 0;
    const v = createTargetValidator(async () => { lookups++; return ['8.8.8.8']; });
    await Promise.all([v(new URL('https://a.com/1')), v(new URL('https://a.com/2'))]);
    await v(new URL('https://a.com/3'));
    assert.equal(lookups, 1);
  });
});

describe('buildUpstreamHeaders', () => {
  it('strips the x- prefix and drops gateway headers', () => {
    const h = buildUpstreamHeaders(new Headers({
      'x-authorization': 'Bearer t',
      'x-api-key': 'k',
      'x-forwarded-for': '1.2.3.4',
      'x-real-ip': '1.2.3.4',
      'x-sb-edge-region': 'eu',
      'x-region': 'eu',
      'x-deno-subhost': 'abc',
      'x-amzn-trace-id': 'Root=1',
      authorization: 'Bearer supabase-key',
      apikey: 'supabase-key',
      cookie: 'a=1',
    }));
    assert.equal(h.get('authorization'), 'Bearer t');
    assert.equal(h.get('api-key'), 'k');
    assert.equal(h.get('cookie'), 'a=1');
    assert.equal(h.get('apikey'), null);
    assert.equal(h.get('forwarded-for'), null);
    assert.equal(h.get('real-ip'), null);
    assert.equal(h.get('sb-edge-region'), null);
    assert.equal(h.get('region'), null);
    assert.equal(h.get('deno-subhost'), null);
    assert.equal(h.get('amzn-trace-id'), null);
  });

  it('picks the user agent: x-user-agent, then user-agent, then default', () => {
    assert.equal(buildUpstreamHeaders(new Headers({ 'x-user-agent': 'A', 'user-agent': 'B' })).get('user-agent'), 'A');
    assert.equal(buildUpstreamHeaders(new Headers({ 'user-agent': 'B' })).get('user-agent'), 'B');
    assert.equal(buildUpstreamHeaders(new Headers(), 'D').get('user-agent'), 'D');
  });
});

describe('handler', () => {
  it('answers preflight with reflected origin and requested headers', async () => {
    const { handler, calls } = makeHandler();
    const res = await handler(new Request(`${BASE}?url=https://a.com`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.test', 'access-control-request-headers': 'x-authorization' },
    }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.test');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(res.headers.get('access-control-allow-headers'), 'x-authorization');
    assert.equal(calls.length, 0);
  });

  it('returns usage JSON without a target', async () => {
    const { handler } = makeHandler({ publicUrl: BASE });
    const res = await handler(new Request(BASE));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.message, /functions\/v1\/corsnova\?url=/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('proxies a GET, prefixing response headers and exposing them', async () => {
    const { handler, calls } = makeHandler({
      fetchImpl: async () => {
        const headers = new Headers({ 'content-type': 'application/json', etag: '"1"' });
        headers.append('set-cookie', 'a=1');
        headers.append('set-cookie', 'b=2');
        return new Response('{"ok":true}', { status: 201, headers });
      },
    });
    const res = await handler(new Request(`${BASE}?url=https://a.com/x?y=1&z=2`, {
      headers: { origin: 'https://app.test', 'x-authorization': 'Bearer t', 'x-forwarded-for': '9.9.9.9' },
    }));

    assert.equal(calls[0].url, 'https://a.com/x?y=1&z=2');
    assert.equal(calls[0].init.headers.get('authorization'), 'Bearer t');
    assert.equal(calls[0].init.headers.get('forwarded-for'), null);
    assert.equal(calls[0].init.redirect, 'manual');

    assert.equal(res.status, 201);
    assert.equal(await res.text(), '{"ok":true}');
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('forward-etag'), '"1"');
    assert.deepEqual(res.headers.get('forward-set-cookie'), 'a=1, b=2');
    const exposed = res.headers.get('access-control-expose-headers');
    assert.match(exposed, /Forward-etag/);
    assert.match(exposed, /Forward-Request-Id/);
    assert.ok(res.headers.get('forward-request-id'));
  });

  it('forwards a POST body byte-for-byte with its content type', async () => {
    const { handler, calls } = makeHandler();
    const payload = new Uint8Array([0, 1, 2, 250, 255]);
    await handler(new Request(`${BASE}?url=https://a.com/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload,
    }));
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual([...calls[0].init.body], [...payload]);
    assert.equal(calls[0].init.headers.get('content-type'), 'application/octet-stream');
  });

  it('rejects bodies over an explicit maxBodyBytes with 413', async () => {
    const { handler, calls } = makeHandler({ maxBodyBytes: 10 });
    const res = await handler(new Request(`${BASE}?url=https://a.com`, {
      method: 'POST',
      body: new Uint8Array(11),
    }));
    assert.equal(res.status, 413);
    assert.equal(calls.length, 0);
  });

  it('streams bodies larger than the replay buffer, with no size cap by default', async () => {
    let received;
    const { handler, calls } = makeHandler({
      replayBufferBytes: 1024,
      fetchImpl: async (_url, init) => {
        received = await readAll(init.body);
        return new Response('ok');
      },
    });
    const payload = new Uint8Array(200_000).map((_, i) => i % 251);
    const res = await handler(new Request(`${BASE}?url=https://a.com/up`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: payload,
    }));
    assert.equal(res.status, 200);
    assert.ok(calls[0].init.body instanceof ReadableStream);
    assert.equal(calls[0].init.duplex, 'half');
    assert.deepEqual(received, payload);
  });

  it('hands a 307 back to the caller when the streamed body cannot be resent', async () => {
    const { handler, calls } = makeHandler({
      replayBufferBytes: 4,
      fetchImpl: async (_url, init) => {
        await readAll(init.body);
        return new Response(null, { status: 307, headers: { location: 'https://a.com/other' } });
      },
    });
    const res = await handler(new Request(`${BASE}?url=https://a.com/up`, {
      method: 'PUT',
      body: 'more than four bytes',
    }));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get('forward-location'), 'https://a.com/other');
    assert.equal(calls.length, 1);
  });

  it('still follows a 303 after a streamed upload, switching to GET', async () => {
    const { handler, calls } = makeHandler({
      replayBufferBytes: 4,
      fetchImpl: async (url, init) => {
        if (init.body) await readAll(init.body);
        return url === 'https://a.com/up'
          ? new Response(null, { status: 303, headers: { location: '/done' } })
          : new Response('done');
      },
    });
    const res = await handler(new Request(`${BASE}?url=https://a.com/up`, {
      method: 'POST',
      body: 'more than four bytes',
    }));
    assert.equal(await res.text(), 'done');
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.body, null);
  });

  it('returns 400 for private targets without calling upstream', async () => {
    const { handler, calls } = makeHandler();
    const res = await handler(new Request(`${BASE}?url=http://169.254.169.254/latest/meta-data`));
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /Private or internal/);
    assert.equal(calls.length, 0);
  });

  it('follows redirects, switching 303 to GET and dropping credentials across origins', async () => {
    const { handler, calls } = makeHandler({
      fetchImpl: async (url) => (url === 'https://a.com/start'
        ? new Response(null, { status: 303, headers: { location: 'https://b.com/done' } })
        : new Response('done')),
    });
    const res = await handler(new Request(`${BASE}?url=https://a.com/start`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-authorization': 'secret', cookie: 'c=1' },
      body: 'hi',
    }));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'done');
    assert.equal(calls[1].url, 'https://b.com/done');
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.body, null);
    assert.equal(calls[1].init.headers.get('authorization'), null);
    assert.equal(calls[1].init.headers.get('cookie'), null);
  });

  it('keeps method and body on 307 within the same origin', async () => {
    const { handler, calls } = makeHandler({
      fetchImpl: async (url) => (url === 'https://a.com/1'
        ? new Response(null, { status: 307, headers: { location: '/2' } })
        : new Response('ok')),
    });
    await handler(new Request(`${BASE}?url=https://a.com/1`, {
      method: 'PUT',
      headers: { 'x-authorization': 'secret' },
      body: 'payload',
    }));
    assert.equal(calls[1].url, 'https://a.com/2');
    assert.equal(calls[1].init.method, 'PUT');
    assert.equal(new TextDecoder().decode(calls[1].init.body), 'payload');
    assert.equal(calls[1].init.headers.get('authorization'), 'secret');
  });

  it('refuses a redirect to a private address', async () => {
    const { handler, calls } = makeHandler({
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/' } }),
    });
    const res = await handler(new Request(`${BASE}?url=https://a.com/`));
    assert.equal(res.status, 502);
    assert.match((await res.json()).message, /redirect rejected/);
    assert.equal(calls.length, 1);
  });

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    let n = 0;
    const { handler, calls } = makeHandler({
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: `/r${++n}` } }),
    });
    const res = await handler(new Request(`${BASE}?url=https://a.com/`));
    assert.equal(res.status, 502);
    assert.match((await res.json()).message, /too many/);
    assert.equal(calls.length, MAX_REDIRECTS + 1);
  });

  it('maps upstream failures to 502 and timeouts to 504', async () => {
    const failing = makeHandler({ fetchImpl: async () => { throw new TypeError('connect refused'); } });
    assert.equal((await failing.handler(new Request(`${BASE}?url=https://a.com`))).status, 502);

    const slow = makeHandler({
      timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
    });
    const res = await slow.handler(new Request(`${BASE}?url=https://a.com`));
    assert.equal(res.status, 504);
  });

  it('sends no body for HEAD', async () => {
    const { handler } = makeHandler();
    const res = await handler(new Request(`${BASE}?url=https://a.com`, { method: 'HEAD' }));
    assert.equal(res.status, 200);
    assert.equal(res.body, null);
  });

  it('does not rate limit by default', async () => {
    const { handler } = makeHandler();
    const req = () => new Request(`${BASE}?url=https://a.com`, { headers: { 'cf-connecting-ip': '3.3.3.3' } });
    for (let i = 0; i < 300; i++) {
      assert.equal((await handler(req())).status, 200);
    }
  });

  it('rate limits per client IP when a limit is set', async () => {
    const { handler } = makeHandler({ rateLimitPerMinute: 2 });
    const req = (ip) => new Request(`${BASE}?url=https://a.com`, { headers: { 'x-forwarded-for': ip } });
    assert.equal((await handler(req('1.1.1.1'))).status, 200);
    assert.equal((await handler(req('1.1.1.1'))).status, 200);
    const limited = await handler(req('1.1.1.1'));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await handler(req('2.2.2.2'))).status, 200);
  });

  it('keys the rate limit on the gateway IP, ignoring a spoofed X-Forwarded-For', async () => {
    const { handler } = makeHandler({ rateLimitPerMinute: 1 });
    const req = (spoof) => new Request(`${BASE}?url=https://a.com`, {
      headers: { 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': spoof },
    });
    assert.equal((await handler(req('1.0.0.1'))).status, 200);
    assert.equal((await handler(req('1.0.0.2'))).status, 429);
  });
});
