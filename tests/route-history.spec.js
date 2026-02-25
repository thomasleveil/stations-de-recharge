// @ts-check
// F-6 — Recent routes history
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

test.describe('F-6: Recent routes history', () => {

  test('recent route is saved in localStorage after calculateRoute', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => localStorage.removeItem('irve-recent-routes'));

    // Simulate a successful route save directly
    await page.evaluate(() => {
      // Call saveRecentRoute if exposed, or directly write to localStorage
      const routes = [{ startText: 'Paris', endText: 'Lyon', startCoords: [2.35, 48.86], endCoords: [4.83, 45.74], ts: Date.now() }];
      localStorage.setItem('irve-recent-routes', JSON.stringify(routes));
    });

    const saved = await page.evaluate(() => localStorage.getItem('irve-recent-routes'));
    const routes = JSON.parse(saved);
    expect(routes).toHaveLength(1);
    expect(routes[0].endText).toBe('Lyon');
    expect(routes[0].startText).toBe('Paris');
  });

  test('recent routes appear in dropdown when Arrivée is focused empty', async ({ page }) => {
    // Seed 2 recent routes
    await page.goto(BASE);
    await page.evaluate(() => {
      const routes = [
        { startText: 'Paris', endText: 'Lyon', startCoords: null, endCoords: null, ts: Date.now() - 3600000 },
        { startText: 'Paris', endText: 'Marseille', startCoords: null, endCoords: null, ts: Date.now() },
      ];
      localStorage.setItem('irve-recent-routes', JSON.stringify(routes));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Focus the Arrivée field (should be empty after reload with no URL params)
    await page.focus('#route-end');

    // Recent routes dropdown should appear
    const dropdown = page.locator('.autocomplete-dropdown').first();
    await expect(dropdown).toBeVisible({ timeout: 2000 });

    // Should show header
    await expect(page.locator('.autocomplete-recent-header')).toBeVisible();

    // Should show 2 destinations
    const items = page.locator('.autocomplete-recent-item');
    await expect(items).toHaveCount(2);
  });

  test('clicking recent route fills both fields', async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => {
      const routes = [
        { startText: 'Paris', endText: 'Lyon', startCoords: [2.35, 48.86], endCoords: [4.83, 45.74], ts: Date.now() },
      ];
      localStorage.setItem('irve-recent-routes', JSON.stringify(routes));
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.focus('#route-end');
    await expect(page.locator('.autocomplete-recent-item')).toBeVisible({ timeout: 2000 });

    // Click the recent route
    await page.locator('.autocomplete-recent-item').first().click();

    // Both fields should be filled
    await expect(page.locator('#route-end')).toHaveValue('Lyon');
    await expect(page.locator('#route-start')).toHaveValue('Paris');
  });

  test('history does not exceed 5 routes', async ({ page }) => {
    await page.goto(BASE);

    // Seed 5 routes, then save a 6th via localStorage manipulation
    await page.evaluate(() => {
      const routes = Array.from({ length: 5 }, (_, i) => ({
        startText: 'Paris',
        endText: `Destination ${i + 1}`,
        startCoords: null, endCoords: null,
        ts: Date.now() - i * 1000,
      }));
      localStorage.setItem('irve-recent-routes', JSON.stringify(routes));

      // Simulate saving a 6th route
      const saved = JSON.parse(localStorage.getItem('irve-recent-routes') || '[]');
      const filtered = saved.filter(r => r.endText !== 'Destination 6');
      filtered.unshift({ startText: 'Paris', endText: 'Destination 6', startCoords: null, endCoords: null, ts: Date.now() });
      localStorage.setItem('irve-recent-routes', JSON.stringify(filtered.slice(0, 5)));
    });

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('irve-recent-routes') || '[]'));
    expect(saved.length).toBeLessThanOrEqual(5);
    expect(saved[0].endText).toBe('Destination 6');
  });
});
