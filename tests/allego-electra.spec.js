// @ts-check
// Allego and Electra used to share one network entry (T-10). They have
// different prices, and only Electra belongs to the Electra+ Alliance.
import { test, expect } from '@playwright/test';
import { mockServices, planToLyon, RENNES } from './helpers/app.js';

test.describe.configure({ timeout: 120_000 });

test('Allego and Electra are two networks, and old preferences carry over', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: RENNES[1], longitude: RENNES[0], accuracy: 5 },
  });
  // A user who starred the merged network before the split.
  await context.addInitScript(() => {
    localStorage.setItem('irve-preferred-networks', JSON.stringify(['Allego / Electra', 'IONITY']));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await mockServices(page);
  await page.goto('/');
  await page.waitForFunction(() => _markersReady && geoState.available, null, { timeout: 90_000 });

  const state = await page.evaluate(() => ({
    preferred: [...preferredNetworks].sort(),
    networks: [...new Set(markers.map(m => m._op.name))],
    prices: Object.fromEntries(['Electra', 'Allego'].map(n => [n, OPERATORS.find(o => o.name === n)?.price?.range])),
    alliance: [...ALLIANCE_NAMES],
  }));
  expect(state.preferred).toEqual(['Allego', 'Electra', 'IONITY']);
  expect(state.networks).toContain('Electra');
  expect(state.networks).toContain('Allego');
  expect(state.networks).not.toContain('Allego / Electra');
  expect(state.prices.Electra).toBeTruthy();
  expect(state.prices.Allego).toBeTruthy();
  expect(state.prices.Electra).not.toBe(state.prices.Allego);
  expect(state.alliance).toContain('Electra');
  expect(state.alliance).not.toContain('Allego');

  await expect(page.locator('#pref-list input[value="Electra"]')).toBeChecked();
  await expect(page.locator('#pref-list input[value="Allego"]')).toBeChecked();

  // The subscription advice never sells Allego stations as Alliance coverage.
  await planToLyon(page);
  const recs = await page.evaluate(() => computeNetworkRecommendation(currentRouteKm).map(r => r.op.name));
  expect(recs.length).toBeGreaterThan(0);
  for (const name of recs) expect(name.startsWith('Alliance') && name.includes('Allego')).toBe(false);

  expect(errors).toEqual([]);
  await context.close();
});
