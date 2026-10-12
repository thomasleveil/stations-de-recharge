// @ts-check
// C5 — fixed zones: nothing is positioned over the map except MapLibre's own
// controls (inside #map), in every state, on desktop and on a phone.
import { test, expect } from '@playwright/test';
import { openApp, planToLyon, overMap } from './helpers/app.js';

for (const vp of ['desktop', 'mobile', 'landscape']) {
  test(`C5 — no element over the map (${vp})`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await openApp(browser, vp);
    expect(await overMap(page), 'home').toEqual([]);
    await page.click('#settings-btn');
    expect(await overMap(page), 'settings').toEqual([]);
    await page.click('#back-btn');
    await planToLyon(page);
    expect(await overMap(page), 'trip').toEqual([]);
    if (vp === 'mobile') {
      await page.click('#sheet-handle');
      expect(await overMap(page), 'trip expanded').toEqual([]);
    }
    await page.locator('#stop-list .stop-main').first().click();
    expect(await overMap(page), 'trip, row selected').toEqual([]);
    await page.click('#drive-btn');
    expect(await overMap(page), 'drive').toEqual([]);
    await page.click('#drive-nearby');
    expect(await overMap(page), 'nearby').toEqual([]);
    // No legacy floating UI left in the page.
    for (const sel of ['#legend', '#panel', '#settings-menu', '#network-recommendation', '.maplibregl-popup:not(.station-tooltip)']) {
      await expect(page.locator(sel)).toHaveCount(0);
    }
    await context.close();
  });
}
