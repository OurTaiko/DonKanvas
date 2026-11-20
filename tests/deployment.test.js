import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('locked dependency tarballs use only the public npm registry', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const packages = Object.entries(lock.packages).filter(([name]) => name);
  assert.ok(packages.length > 0);
  for (const [location, dependency] of packages) {
    const url = new URL(dependency.resolved);
    const name = location.split('node_modules/').at(-1);
    assert.equal(url.origin, 'https://registry.npmjs.org', location);
    assert.equal(url.pathname, `/${name}/-/${name.split('/').at(-1)}-${dependency.version}.tgz`, location);
    assert.ok(dependency.integrity, location);
  }
});

test('GitHub Pages automatically publishes main and retains manual deployment', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /on:\s+push:\s+branches:\s*\[main\]/);
  assert.match(workflow, /^\s+workflow_dispatch:/m);
});

test('GitHub Pages pins installation to the public registry and checks the lockfile first', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /registry-url: https:\/\/registry\.npmjs\.org\//);
  assert.match(workflow, /run: npm ci --registry=https:\/\/registry\.npmjs\.org\//);
  assert.match(workflow, /run: node --test tests\/deployment\.test\.js/);
  assert.ok(workflow.indexOf('run: node --test tests/deployment.test.js') < workflow.indexOf('run: npm ci '));
});
