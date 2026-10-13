// @ts-check
// Démarrer tapped before the corridor filter resolves, GPS fixed and never
// updated again: the drive card must show a loading state, then the next
// station once the filter is done — never « Plus de borne devant ».
import { test, expect } from '@playwright/test';
import { openApp } from './helpers/app.js';

test('drive started before the route filter resolves shows the next station without a GPS update', async ({ browser }) => {
  test.setTimeout(150_000);
  const { context, page, errors } = await openApp(browser, 'mobile');

  // Hold the worker script so the filter is still pending when Démarrer is tapped.
  /** @type {() => void} */ let release = () => {};
  const held = new Promise(r => { release = () => r(undefined); });
  await page.route('**/filter-worker.js', async route => { await held; await route.continue(); });

  await page.locator('#dest-input').fill('Lyon');
  await page.locator('#dest-list [role="option"]').first().waitFor();
  await page.locator('#dest-input').press('Enter');
  await expect(page.locator('#trip-summary')).toContainText(/\d+ km · \d/);
  expect(await page.evaluate(() => _driveAheadList(3).length)).toBe(0); // filter still pending

  await page.click('#drive-btn');
  await expect(page.locator('#drive')).toBeVisible();
  await expect(page.locator('#drive-title')).not.toHaveText(/Plus de borne devant/);
  await expect(page.locator('#drive-name')).not.toHaveText(/Destination proche/);
  await expect(page.locator('#drive-nav')).toHaveAttribute('aria-disabled', 'true');

  release();
  await page.waitForFunction(() => _driveAheadList(3).length > 0, null, { timeout: 30_000 });
  // No GPS update from here on: the card must refresh on its own.
  await expect(page.locator('#drive-title')).toHaveText('Prochaine borne');
  const first = await page.evaluate(() => _driveAheadList(1)[0].m._idx);
  expect(await page.evaluate(() => UI.state.driveSel?._idx)).toBe(first);
  await expect(page.locator('#drive-nav')).not.toHaveAttribute('aria-disabled', 'true');
  expect(errors).toEqual([]);
  await context.close();
});
