// tests/photon-geocoder.spec.js
// Tests for U-6 — Photon geocoder replaces Nominatim
const { test, expect } = require('@playwright/test');

test.describe('U-6 — Photon geocoder', () => {
  test('Autocomplete calls Photon API not Nominatim', async ({ page }) => {
    const urls = [];
    page.on('request', req => urls.push(req.url()));

    await page.goto('/');
    await page.fill('#route-end', 'Lyon');
    await page.waitForTimeout(600); // debounce

    const photonCalls = urls.filter(u => u.includes('photon.komoot.io'));
    const nominatimCalls = urls.filter(u => u.includes('nominatim.openstreetmap.org') && u.includes('search'));

    expect(photonCalls.length).toBeGreaterThan(0);
    expect(nominatimCalls.length).toBe(0);
  });

  test('Photon mock returns POI suggestions in dropdown', async ({ page }) => {
    // Mock Photon with a company result
    await page.route('**/photon.komoot.io/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [4.8357, 45.7640] },
              properties: {
                name: 'IKEA Lyon',
                city: 'Lyon',
                country: 'France',
                type: 'commercial'
              }
            },
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [2.3522, 48.8566] },
              properties: {
                name: 'Paris',
                state: 'Île-de-France',
                country: 'France',
                type: 'city'
              }
            }
          ]
        })
      });
    });

    await page.goto('/');
    await page.fill('#route-end', 'IKEA');
    await page.waitForTimeout(500);

    const items = page.locator('#route-end ~ .autocomplete-dropdown .autocomplete-item');
    await expect(items).toHaveCount(2, { timeout: 3000 });
    await expect(items.first()).toHaveText('IKEA Lyon, Lyon');
  });

  test('Selecting autocomplete item stores Photon coords', async ({ page }) => {
    await page.route('**/photon.komoot.io/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [4.8357, 45.7640] },
            properties: { name: 'Lyon', state: 'Auvergne-Rhône-Alpes', country: 'France', type: 'city' }
          }]
        })
      });
    });

    await page.goto('/');
    await page.fill('#route-end', 'Lyon');
    await page.waitForTimeout(500);

    const item = page.locator('#route-end ~ .autocomplete-dropdown .autocomplete-item').first();
    await expect(item).toBeVisible({ timeout: 3000 });
    await item.dispatchEvent('mousedown');

    // Verify coords stored
    const coords = await page.evaluate(() => {
      return document.getElementById('route-end')._coords;
    });
    expect(coords).toBeTruthy();
    expect(Math.abs(coords[0] - 4.8357)).toBeLessThan(0.01);
    expect(Math.abs(coords[1] - 45.764)).toBeLessThan(0.01);
  });

  test('geocode fallback uses Photon when no coords set', async ({ page }) => {
    const photonUrls = [];
    page.on('request', req => {
      if (req.url().includes('photon.komoot.io')) photonUrls.push(req.url());
    });

    await page.route('**/photon.komoot.io/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [4.8357, 45.764] },
            properties: { name: 'Lyon', type: 'city' }
          }]
        })
      });
    });

    await page.route('**/route/v1/driving/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'Ok',
          routes: [{
            geometry: { type: 'LineString', coordinates: [[2.35, 48.85], [4.83, 45.75]] },
            legs: [{ steps: [], summary: '', duration: 7200, distance: 460000 }],
            duration: 7200, distance: 460000
          }],
          waypoints: [{ location: [2.35, 48.85] }, { location: [4.83, 45.75] }]
        })
      });
    });

    await page.goto('/');
    // Type but DON'T select from dropdown — forces geocode() fallback
    await page.fill('#route-start', 'Paris');
    await page.fill('#route-end', 'Lyon');
    await page.keyboard.press('Escape'); // close dropdown without selecting
    await page.click('#route-go');

    // Wait a bit — geocode() will call Photon for both start and end
    await page.waitForTimeout(2000);

    // At least one Photon call should happen for geocoding
    expect(photonUrls.length).toBeGreaterThan(0);
    expect(photonUrls.some(u => u.includes('photon.komoot.io/api'))).toBe(true);
  });
});
