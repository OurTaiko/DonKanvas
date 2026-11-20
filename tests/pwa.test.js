import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';

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
