// @ts-check
// C3 — drive flow: one tap to the drive screen, one more to « Naviguer »;
// every control ≥ 64 px and within thumb reach.
import { test, expect } from '@playwright/test';
import { openApp, planToLyon, BOURGES } from './helpers/app.js';

for (const vp of ['mobile', 'landscape']) {
  test(`C3 — drive screen in one tap, Naviguer in two (${vp})`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page, errors } = await openApp(browser, vp, BOURGES);
    // GPS is mid-route (Bourges): plan from an explicit start (the Photon mock
    // only knows Lyon, so the start is set as if picked from the suggestions).
    await page.evaluate(() => { UI.state.start = { label: 'Rennes', coords: [-1.6778, 48.1173] }; });
    await planToLyon(page, 'tap');

    await page.click('#drive-btn');                       // tap 1
    await expect(page.locator('#drive')).toBeVisible();
    await expect(page.locator('#sheet')).toBeHidden();
    const ahead = await page.evaluate(() => _driveAheadList().map(({ m, dist }) => ({ idx: m._idx, dist })));
    expect(ahead.length).toBeGreaterThan(1);
    expect(await page.evaluate(() => UI.state.driveSel?._idx)).toBe(ahead[0].idx);
    const shownKm = parseFloat((await page.textContent('#drive-km') || '').replace(',', '.'));
    expect(Math.abs(shownKm - ahead[0].dist)).toBeLessThanOrEqual(1);

    const nav = page.locator('#drive-nav');               // tap 2
    await expect(nav).toBeVisible();
    const href = await page.evaluate(() => UI.stationNavUrl(UI.state.driveSel));
    await expect(nav).toHaveAttribute('href', href);

    const vpSize = page.viewportSize();
    const mapBox = await page.locator('#map').boundingBox();
    for (const b of await page.locator('#drive .btn-drive').all()) {
      const box = await b.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(64);
      if (vp === 'mobile') expect(box.y).toBeGreaterThanOrEqual(vpSize.height * 0.55);
      else expect(box.x + box.width).toBeLessThanOrEqual(mapBox.x + 1);
    }

    await page.click('#drive-next');
    expect(await page.evaluate(() => UI.state.driveSel?._idx)).toBe(ahead[1].idx);
    await page.click('#drive-end');
    await expect(page.locator('#drive')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'trip');
    expect(errors).toEqual([]);
    await context.close();
  });
}
