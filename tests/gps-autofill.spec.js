// @ts-check
// F-8 — GPS auto-fill of the departure field
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

test.describe('F-8: GPS auto-fill of departure field', () => {

  test('start field is auto-filled with "Ma position" when GPS is available', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 48.8566, longitude: 2.3522, accuracy: 5 },
    });
    const page = await context.newPage();
    await page.goto(BASE);

    // Wait for geoloc marker to appear (GPS available)
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });

    // Start field should now have "Ma position" as value
    await page.waitForFunction(
      () => document.getElementById('route-start').value === 'Ma position',
      { timeout: 5000 },
    );
    await expect(page.locator('#route-start')).toHaveValue('Ma position');

    await context.close();
  });

  test('start field retains GPS coords after auto-fill', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 45.75, longitude: 4.85, accuracy: 5 },
    });
    const page = await context.newPage();
    await page.goto(BASE);

    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
    await page.waitForFunction(
      () => document.getElementById('route-start').value === 'Ma position',
      { timeout: 5000 },
    );

    // Verify _coords are set (GPS-based)
    const coords = await page.evaluate(() => document.getElementById('route-start')._coords);
    expect(coords).toBeTruthy();
    expect(Array.isArray(coords)).toBe(true);
    expect(coords).toHaveLength(2);
    // lon, lat order
    expect(coords[0]).toBeCloseTo(4.85, 1);
    expect(coords[1]).toBeCloseTo(45.75, 1);

    await context.close();
  });

  test('clearing the field re-enables GPS auto-fill on next GPS update', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 48.8566, longitude: 2.3522, accuracy: 5 },
    });
    const page = await context.newPage();
    await page.goto(BASE);

    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
    await page.waitForFunction(
      () => document.getElementById('route-start').value === 'Ma position',
      { timeout: 5000 },
    );

    // Clear the field manually
    const startInput = page.locator('#route-start');
    await startInput.clear();
    // After clearing, _geoAutoFillBlocked should be false (re-enabled)
    const blocked = await page.evaluate(() => document.getElementById('route-start')._geoAutoFillBlocked);
    expect(blocked).toBeFalsy();

    await context.close();
  });

  test('start field not auto-filled when GPS is denied', async ({ browser }) => {
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Without GPS permission, start field should remain empty
    const startValue = await page.locator('#route-start').inputValue();
    expect(startValue).toBe('');

    await context.close();
  });
});
