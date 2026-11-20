import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { checkPwaUpdate, activatePwaUpdate, waitForPwaRegistration } from '../src/pwa.js';

test('startup checks wait for registration readiness and reject a mismatched deployment scope', async () => {
  const scope = 'https://example.com/web-tja-studio/';
  const registration = { scope, active: {} };
  let ready, queried = false;
  const container = {
    ready: new Promise(resolve => { ready = resolve; }),
    getRegistration: async requested => { queried = true; assert.equal(requested, scope); return registration; }
  };
  const waiting = waitForPwaRegistration(container, scope);
  await Promise.resolve(); assert.equal(queried, false);
  ready(registration); assert.equal(await waiting, registration);
  registration.scope = 'https://example.com/';
  await assert.rejects(waitForPwaRegistration(container, scope), /尚未完成离线注册/);
});

test('startup readiness is bounded even when no worker finishes registering', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const waiting = waitForPwaRegistration({ ready: new Promise(() => {}) }, 'https://example.com/');
  const rejected = assert.rejects(waiting, /更新超时/);
  context.mock.timers.tick(20000);
  await rejected;
});

test('update checks distinguish unchanged, waiting, installing and failed releases', async () => {
  const registration = { waiting: null, installing: null, update: async () => {} };
  assert.equal(await checkPwaUpdate(registration), null);
  const worker = new EventTarget(); worker.state = 'installing';
  registration.waiting = worker;
  registration.update = () => { assert.fail('An already downloaded release needs no network'); };
  assert.equal(await checkPwaUpdate(registration), worker);
  registration.waiting = null;
  registration.update = async () => {
    registration.installing = worker;
    setImmediate(() => {
      registration.waiting = worker; worker.state = 'installed'; worker.dispatchEvent(new Event('statechange'));
    });
  };
  assert.equal(await checkPwaUpdate(registration), worker);
  registration.waiting = null; worker.state = 'installing';
  registration.update = async () => { setImmediate(() => { worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange')); }); };
  await assert.rejects(checkPwaUpdate(registration), /更新安装失败/);
  registration.update = async () => { throw new Error('Offline'); };
  await assert.rejects(checkPwaUpdate(registration), /Offline/);
});

test('update checks time out instead of reporting a stalled request as current', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const checked = checkPwaUpdate({ waiting: null, update: () => new Promise(() => {}) });
  const rejected = assert.rejects(checked, /更新超时/);
  context.mock.timers.tick(20000);
  await rejected;
});

test('manual activation waits for the new worker and surfaces messaging failures', async () => {
  const worker = new EventTarget(); worker.state = 'installed';
  worker.postMessage = value => {
    assert.deepEqual(value, { type: 'SKIP_WAITING' });
    setImmediate(() => { worker.state = 'activated'; worker.dispatchEvent(new Event('statechange')); });
  };
  await activatePwaUpdate(worker);
  worker.state = 'installed'; worker.postMessage = () => { throw new Error('Cannot message worker'); };
  await assert.rejects(activatePwaUpdate(worker), /Cannot message worker/);
});

test('production PWA assets are installable and precached at root and subdirectory URLs', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'web-tja-studio-pwa-'));
  try {
    await build({
      root: fileURLToPath(new URL('../', import.meta.url)),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true }
    });
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    const manifest = JSON.parse(await readFile(join(outDir, 'manifest.webmanifest'), 'utf8'));
    const worker = await readFile(join(outDir, 'sw.js'), 'utf8');
    const registration = await readFile(join(outDir, 'registerSW.js'), 'utf8');
    const assets = await readdir(join(outDir, 'assets'));
    const urls = [
      ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]),
      ...manifest.icons.map(icon => icon.src)
    ];

    for (const base of ['https://example.com/', 'https://example.com/web-tja-studio/']) {
      const manifestURL = new URL('manifest.webmanifest', base);
      assert.equal(new URL(manifest.start_url, manifestURL).href, base);
      assert.equal(new URL(manifest.scope, manifestURL).href, base);
      assert.equal(new URL(manifest.id, manifestURL).href, base);
      for (const url of urls) {
        const resolved = new URL(url, base);
        assert.equal(resolved.origin, new URL(base).origin);
        assert.ok(resolved.pathname.startsWith(new URL(base).pathname), url);
        await readFile(join(outDir, resolved.pathname.slice(new URL(base).pathname.length)));
      }
    }

    assert.equal(manifest.display, 'standalone');
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
      assert.ok(icon, `missing ${size}px installation icon`);
      const png = await readFile(join(outDir, icon.src));
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
    assert.match(html, /rel="manifest"/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /src="\.\/registerSW\.js"/);
    assert.match(registration, /register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
    for (const url of ['index.html', 'manifest.webmanifest', ...assets.map(name => `assets/${name}`), ...manifest.icons.map(icon => icon.src)]) {
      assert.ok(worker.includes(url), `${url} must be available offline`);
    }
    assert.match(worker, /createHandlerBoundToURL\("index\.html"\)/);
    assert.doesNotMatch(worker, /clientsClaim\(\)|\.tja|\.mp3|\.wav|\.ogg|\.test\.js/);
    let skippedWaiting = false;
    runInNewContext(worker, {
      self: {
        define() {},
        addEventListener() {},
        skipWaiting() { skippedWaiting = true; }
      },
      define(_dependencies, factory) {
        factory({
          precacheAndRoute() {},
          cleanupOutdatedCaches() {},
          registerRoute() {},
          createHandlerBoundToURL() {},
          NavigationRoute: class {}
        });
      }
    });
    assert.equal(skippedWaiting, false, 'updates must wait for open editing windows to close');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
