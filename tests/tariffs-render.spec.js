// @ts-check
// The wiring between tariffs.js and the station sheet. Covered once here so
// that tariff PRs only need the browser-free tests/tariffs.spec.js.
import { test, expect } from '@playwright/test';
import { openApp } from './helpers/app.js';

test.describe.configure({ timeout: 120_000 });

test('the station sheet shows the price from tariffs.js', async ({ browser }) => {
  const { context, page, errors } = await openApp(browser);
  const range = await page.evaluate(() => {
    const m = markers.find(x => TARIFFS[x._op.name]);
    window.UI.onStationClick(m);
    return TARIFFS[m._op.name].range;
  });
  await expect(page.locator('.price-tier').first()).toBeVisible();
  await expect(page.locator('#sheet')).toContainText(range);
  expect(errors).toEqual([]);
  await context.close();
});

test('a broken tariffs.js drops the prices, not the app', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route('**/tariffs.js', route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: 'const TARIFFS = { oops',
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => _markersReady, null, { timeout: 90_000 });
  const priced = await page.evaluate(() => {
    window.UI.onStationClick(markers[0]);
    return OPERATORS.filter(o => o.price).length;
  });
  expect(priced).toBe(0);
  await expect(page.locator('#sheet .stop-actions')).toBeVisible();
  expect(errors.every(e => /SyntaxError/.test(e)), errors.join('\n')).toBe(true);
  await context.close();
});
