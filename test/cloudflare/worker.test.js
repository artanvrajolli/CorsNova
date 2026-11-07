import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDohResolver, createWorker } from '../../cloudflare/worker.js';

function dohResponse(answers) {
  return new Response(JSON.stringify({ Status: 0, Answer: answers }), {
    headers: { 'content-type': 'application/dns-json' },
  });
}

describe('createDohResolver', () => {
  it('returns A and AAAA records, skips CNAME, and sends the right URL and accept header', async () => {
    const calls = [];
    const resolve = createDohResolver(async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('type=A')) {
        return dohResponse([
          { name: 'www.example.com', type: 5, data: 'example.com.' },
          { name: 'example.com', type: 1, data: '93.184.215.14' },
        ]);
      }
      return dohResponse([{ name: 'example.com', type: 28, data: '2606:2800:21f:cb07:6820:80da:af6b:8b2c' }]);
    });

    const addresses = await resolve('www.example.com');

    assert.deepEqual(addresses, ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c']);
    assert.deepEqual(calls.map((c) => c.url).sort(), [
      'https://cloudflare-dns.com/dns-query?name=www.example.com&type=A',
      'https://cloudflare-dns.com/dns-query?name=www.example.com&type=AAAA',
    ]);
    for (const call of calls) {
      assert.equal(call.init.headers.accept, 'application/dns-json');
    }
  });

  it('still resolves when one record type fails', async () => {
    const resolve = createDohResolver(async (url) => {
      if (url.endsWith('type=AAAA')) throw new Error('network down');
      return dohResponse([{ type: 1, data: '93.184.215.14' }]);
    });
    assert.deepEqual(await resolve('example.com'), ['93.184.215.14']);
  });

  it('throws when no records come back', async () => {
    const empty = createDohResolver(async () => dohResponse(undefined));
    await assert.rejects(empty('nothing.test'), /No A\/AAAA records for nothing\.test/);

    const failing = createDohResolver(async () => {
      throw new Error('network down');
    });
    await assert.rejects(failing('example.com'), /network down/);
  });
});

const ORIGIN = 'https://corsnova.example.workers.dev';

function makeWorker(addresses = ['93.184.215.14']) {
  const calls = [];
  const worker = createWorker({
    resolve: async () => addresses,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response('upstream-body', { status: 200, headers: { 'content-type': 'text/plain' } });
    },
  });
  return { worker, calls };
}

describe('createWorker', () => {
  it('proxies the ?url= form from the root and keeps the target query string', async () => {
    const { worker, calls } = makeWorker();
    const res = await worker.fetch(new Request(`${ORIGIN}/?url=https://api.example.com/x?b=1&c=2`));

    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'upstream-body');
    assert.equal(calls[0].url, 'https://api.example.com/x?b=1&c=2');
  });

  it('proxies the path form when the target path contains "corsnova"', async () => {
    const { worker, calls } = makeWorker();
    const res = await worker.fetch(new Request(`${ORIGIN}/https://api.example.com/corsnova/data?q=1`));

    assert.equal(res.status, 200);
    assert.equal(calls[0].url, 'https://api.example.com/corsnova/data?q=1');
  });

  it('returns usage with the worker origin at the root', async () => {
    const { worker, calls } = makeWorker();
    const res = await worker.fetch(new Request(`${ORIGIN}/`));

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(body.message.includes(`${ORIGIN}/?url=https://example.com`), body.message);
    assert.equal(calls.length, 0);
  });

  it('blocks a host that resolves to a private address without calling upstream', async () => {
    const { worker, calls } = makeWorker(['10.0.0.5']);
    const res = await worker.fetch(new Request(`${ORIGIN}/?url=https://internal.example.com/`));

    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });
});
