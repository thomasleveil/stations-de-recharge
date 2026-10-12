// @ts-check
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

// MapLibre v6 is ESM-only: dist/maplibre-gl.js no longer exists, so a floating
// `@latest` URL 404s and `maplibregl` is undefined. That crash happened before
// the IRVE parquet fetch, so no stations ever loaded.

test.describe('MapLibre load', () => {
  test('index.html pins MapLibre to an exact 5.x version', async ({ request }) => {
    const html = await (await request.get(BASE)).text();
    const refs = [...html.matchAll(/maplibre-gl@([^/]+)\//g)].map(m => m[1]);
    expect(refs.length).toBe(2);
    for (const v of refs) expect(v).toMatch(/^5\.\d+\.\d+$/);
  });

  test('maplibregl is defined and stations load without page errors', async ({ page }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(BASE);
    await expect(page.locator('.panel-sub')).toHaveText(/^\d+ stations? · CCS ≥ \d+ kW$/, { timeout: 45000 });

    expect(await page.evaluate(() => typeof (/** @type {any} */ (window)).maplibregl)).toBe('object');
    const count = Number((await page.locator('.panel-sub').textContent())?.match(/^\d+/)?.[0]);
    expect(count).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });
});
