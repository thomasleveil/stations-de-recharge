// @ts-check
// C4 — « Bornes proches » in one tap from home, trip and drive; sorted by
// distance, each row with Naviguer.
import { test, expect } from '@playwright/test';
import { openApp, planToLyon } from './helpers/app.js';

async function checkNearby(page) {
  await expect(page.locator('body')).toHaveAttribute('data-view', 'nearby');
  const rows = page.locator('#nearby-list .stop');
  await expect(rows.first()).toBeVisible();
  const d = await page.locator('#nearby-list .stop-km').allTextContents();
  const km = d.map(t => parseFloat(t.replace(',', '.')));
  expect(km).toEqual([...km].sort((a, b) => a - b));
  expect(await rows.count()).toBe(await page.locator('#nearby-list .stop a', { hasText: 'Naviguer' }).count());
  const first = await page.evaluate(() => _nearbyList(geoState.lat, geoState.lng, 15, 20)[0]?.m._idx);
  await expect(rows.first()).toHaveAttribute('data-idx', String(first));
}

for (const vp of ['desktop', 'mobile']) {
  test(`C4 — nearby in one tap from home, trip and drive (${vp})`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page, errors } = await openApp(browser, vp);

    await page.click('#nearby-btn');                       // from home
    await checkNearby(page);
    await page.click('#back-btn');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'home');

    await planToLyon(page);
    await page.click('#nearby-btn');                       // from trip
    await checkNearby(page);
    await page.click('#back-btn');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'trip');

    await page.click('#drive-btn');
    await page.click('#drive-nearby');                     // from drive
    await checkNearby(page);
    await page.click('#back-btn');
    await expect(page.locator('#drive')).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
}
