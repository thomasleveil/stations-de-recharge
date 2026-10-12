// @ts-check
// Every local file the page loads must be copied into dist/ by the deploy
// workflows, otherwise it 404s on GitHub Pages while local tests (which serve
// the repo root) still pass. nav-links.js nearly shipped that way (U-11).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const WORKFLOWS = ['.github/workflows/deploy.yml', '.github/workflows/pr-preview.yml'];

const isLocal = ref => !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);

/** Local scripts and stylesheets referenced by index.html, plus app.js workers. */
function localAssets() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const refs = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map(m => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="stylesheet"/g)].map(m => m[1]),
  ];
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  refs.push(...[...app.matchAll(/new Worker\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]));
  return [...new Set(refs.filter(isLocal).map(r => r.replace(/^\.\//, '').split(/[?#]/)[0]))];
}

/** Files named on the workflow's `cp … dist/` line(s). */
function copiedFiles(workflow) {
  const yml = readFileSync(join(ROOT, workflow), 'utf8');
  const lines = [...yml.matchAll(/^\s*cp\s+(.+?)\s+dist\/?\s*$/gm)];
  return lines.flatMap(m => m[1].split(/\s+/).filter(a => !a.startsWith('-')));
}

test('index.html references the expected local assets', () => {
  const assets = localAssets();
  for (const f of ['app.js', 'style.css', 'nav-links.js', 'filter-worker.js']) {
    expect(assets).toContain(f);
  }
});

for (const workflow of WORKFLOWS) {
  test(`${workflow} copies every local asset into dist/`, () => {
    const copied = copiedFiles(workflow);
    expect(copied, 'no `cp … dist/` step found').toContain('index.html');
    const missing = localAssets().filter(f => !copied.includes(f));
    expect(missing, `add to the cp step of ${workflow}`).toEqual([]);
  });
}
