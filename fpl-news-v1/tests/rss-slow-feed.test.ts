import './setup.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { config } from '@aihot/backend/config';
import { guardedFetch } from '@aihot/backend/lib/http-fetch';
import { fetchRss } from '@aihot/backend/sources/rss';

test('a slow feed can finish after 25 seconds without removing shorter caller deadlines', async () => {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.write('<rss version="2.0"><channel><title>Slow feed</title>');
    const timer = setTimeout(() => {
      pending.delete(timer);
      res.end('<item><title>Complete item</title><link>https://example.org/slow-feed</link></item></channel></rss>');
    }, req.url === '/slow' ? 26_000 : 2_000);
    pending.add(timer);
    res.on('close', () => { clearTimeout(timer); pending.delete(timer); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const previous = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  try {
    await assert.rejects(guardedFetch(base + '/deadline', { timeoutMs: 100 }));
    const result = await fetchRss({ id: 'slow-feed', config: { feedUrl: base + '/slow' } } as never);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0]!.title, 'Complete item');
  } finally {
    config.allowPrivateNetworkFetch = previous;
    for (const timer of pending) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
