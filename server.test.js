import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mediaMiddleware } from './server.js';

test('local media middleware lists charts, serves media and rejects unrelated paths', async () => {
  const middleware = mediaMiddleware();
  const server = http.createServer((request, response) => middleware(request, response, () => { response.writeHead(418); response.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const files = await (await fetch(`${origin}/api/files`)).json();
    assert.ok(files.some(file => file.endsWith('.tja')));
    assert.ok(files.every(file => /\.(tja|mp3|wav|ogg)$/i.test(file)));
    const chart = files.find(file => file.endsWith('.tja'));
    const result = await fetch(`${origin}/media/${encodeURIComponent(chart)}`);
    assert.equal(result.status, 200);
    assert.ok((await result.arrayBuffer()).byteLength > 0);
    const head = await fetch(`${origin}/media/${encodeURIComponent(chart)}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(`${origin}/media/tja-studio%2Fpackage.json`)).status, 403);
    assert.equal((await fetch(`${origin}/media/..%2Fsecret.tja`)).status, 403);
    assert.equal((await fetch(`${origin}/media/missing.tja`)).status, 404);
    assert.equal((await fetch(`${origin}/api/files`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${origin}/unhandled`)).status, 418);
  } finally { await new Promise(resolve => server.close(resolve)); }
});