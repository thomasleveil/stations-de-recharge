// @ts-check
// tariffs.js is edited by data-only PRs. This spec is what lets such a PR merge
// without a full manual test pass: it parses the file the way the browser does
// and checks every entry against the shape ui.js renders. No browser needed.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(__dirname, '..');

/** Evaluates tariffs.js as a classic script and returns its TARIFFS global. */
function loadTariffs() {
  const src = readFileSync(join(ROOT, 'tariffs.js'), 'utf8');
  return vm.runInNewContext(`${src}\n;TARIFFS`, {}, { filename: 'tariffs.js' });
}

/** Network names declared in the OPERATORS array of app.js. */
function operatorNames() {
  const app = readFileSync(join(ROOT, 'app.js'), 'utf8');
  const block = app.slice(app.indexOf('const OPERATORS = ['), app.indexOf('];', app.indexOf('const OPERATORS = [')));
  return [...block.matchAll(/name:\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"));
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

test('tariffs.js parses and defines TARIFFS', () => {
  const tariffs = loadTariffs();
  expect(tariffs && typeof tariffs).toBe('object');
});

test('every tariff key matches a network of OPERATORS, and back', () => {
  const keys = Object.keys(loadTariffs());
  const names = operatorNames();
  expect(names.length, 'OPERATORS not found in app.js').toBeGreaterThan(0);
  expect(keys.filter(k => !names.includes(k)), 'unknown network (typo?) in tariffs.js').toEqual([]);
  expect(names.filter(n => !keys.includes(n)), 'network without a tariff').toEqual([]);
});

for (const [name, t] of Object.entries(loadTariffs())) {
  test(`tariff « ${name} » is well-formed`, () => {
    expect([1, 2, 3], 'tier is 1, 2 or 3').toContain(t.tier);
    expect(typeof t.range, 'range is text').toBe('string');
    expect(t.range, 'range shows a € price').toMatch(/\d.*€/);
    expect(['string', 'undefined'], 'note is text').toContain(typeof t.note);
    if (t.alerts !== undefined) {
      expect(Array.isArray(t.alerts), 'alerts is a list').toBe(true);
      for (const a of t.alerts) {
        expect(typeof a.icon).toBe('string');
        expect(typeof a.text).toBe('string');
        expect(a.text.length).toBeGreaterThan(0);
      }
    }
    // Both null (provenance unknown, pre-dates this file) or both filled.
    expect(t.source === null, 'source and updated go together').toBe(t.updated === null);
    if (t.source !== null) {
      expect(t.source, 'source is an http(s) URL').toMatch(/^https?:\/\/\S+$/);
      expect(isDate(t.updated), 'updated is YYYY-MM-DD').toBe(true);
      // One day of slack: a date typed in Paris after midnight is still tomorrow in UTC CI.
      expect(Date.parse(t.updated), 'updated is not in the future').toBeLessThanOrEqual(Date.now() + 86_400_000);
    }
  });
}
