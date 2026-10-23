// @ts-check
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

// B-6 — CARTO raster tiles now need an API key and serve an "API KEY REQUIRED"
// watermark instead. The basemap is OpenFreeMap (Positron + Dark, no key), with
// the dark layers added as a hidden `dark:`-prefixed group.

const OWN_LAYERS = ['route-layer', 'stations-layer', 'stations-brand-layer', 'clusters', 'cluster-count'];

/** @param {import('@playwright/test').Page} page */
function basemapState(page) {
  return page.evaluate((own) => {
    const map = /** @type {any} */ (window)._map;
    const layers = map.getStyle().layers;
    const visible = l => (map.getLayoutProperty(l.id, 'visibility') || 'visible') === 'visible';
    const dark  = layers.filter(l => l.id.startsWith('dark:'));
    const light = layers.filter(l => !l.id.startsWith('dark:') && !own.includes(l.id));
    return {
      theme: document.documentElement.dataset.theme,
      light: light.length, lightVisible: light.filter(visible).length,
      dark: dark.length, darkVisible: dark.filter(visible).length,
      topLayers: layers.slice(-own.length).map(l => l.id),
      route: {
        color: map.getPaintProperty('route-layer', 'line-color'),
        opacity: map.getPaintProperty('route-layer', 'line-opacity'),
      },
    };
  }, OWN_LAYERS);
}

test.describe('B-6 — OpenFreeMap basemap', () => {
  test('no CARTO tile is requested and OpenFreeMap tiles load', async ({ page }) => {
    test.setTimeout(60000);
    const carto = [];
    const ofm = [];
    page.on('request', r => { if (r.url().includes('cartocdn.com')) carto.push(r.url()); });
    page.on('response', r => { if (r.url().includes('tiles.openfreemap.org')) ofm.push(r.status()); });

    await page.goto(BASE);
    await page.waitForFunction(() => /** @type {any} */ (window)._map?.loaded(), null, { timeout: 30000 });

    expect(carto).toEqual([]);
    expect(ofm.length).toBeGreaterThan(0);
    expect(ofm.every(s => s < 400)).toBe(true);
  });

  test('theme toggle swaps the whole basemap and keeps stations on top', async ({ page }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(BASE);
    await page.waitForFunction(
      () => /** @type {any} */ (window)._map?.getStyle()?.layers?.some(l => l.id.startsWith('dark:')),
      null, { timeout: 30000 },
    );

    const light = await basemapState(page);
    expect(light.theme).toBe('light');
    expect(light.lightVisible).toBe(light.light);
    expect(light.darkVisible).toBe(0);
    expect(light.topLayers).toEqual(OWN_LAYERS);
    expect(light.route).toEqual({ color: '#1D4ED8', opacity: 0.75 });

    // The manual toggle lives in the settings view of the sheet.
    await page.click('#settings-btn');
    await page.click('label[for="th-dark"]');
    const dark = await basemapState(page);
    expect(dark.theme).toBe('dark');
    expect(dark.lightVisible).toBe(0);
    expect(dark.darkVisible).toBe(dark.dark);
    expect(dark.topLayers).toEqual(OWN_LAYERS);
    // The light-theme route blue is about 2:1 on the dark basemap; the dark one
    // is opaque and clears 3:1 even over the grey motorway casing.
    expect(dark.route).toEqual({ color: '#4A7FD6', opacity: 1 });

    await page.click('label[for="th-light"]');
    expect((await basemapState(page)).route).toEqual({ color: '#1D4ED8', opacity: 0.75 });
  });

  test('dark theme falls back to the light basemap when the dark style is unreachable', async ({ page }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ colorScheme: 'dark' });
    let darkStyleRequested = false;
    await page.route('**/tiles.openfreemap.org/styles/dark', r => { darkStyleRequested = true; r.abort(); });
    await page.goto(BASE);
    await page.waitForFunction(() => /** @type {any} */ (window)._map?.loaded(), null, { timeout: 30000 });
    await expect.poll(() => darkStyleRequested).toBe(true);
    await page.waitForTimeout(500);

    const s = await basemapState(page);
    expect(s.theme).toBe('dark');
    expect(s.dark).toBe(0);
    expect(s.lightVisible).toBe(s.light);
    expect(s.route).toEqual({ color: '#1D4ED8', opacity: 0.75 });
  });
});
