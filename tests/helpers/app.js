// @ts-check
// Shared setup for the UX flow specs: real IRVE stations, mocked Photon and
// OSRM (a Rennes → Le Mans → Bourges → Lyon polyline), simulated GPS.

export const RENNES  = [-1.6778, 48.1173];
export const LE_MANS = [0.1996, 48.0061];
export const BOURGES = [2.3988, 47.0810];
export const LYON    = [4.8357, 45.7640];

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Rennes → Lyon via Le Mans and Bourges, 150 points per leg. */
export function polyline() {
  const anchors = [RENNES, LE_MANS, BOURGES, LYON];
  const coords = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    for (let i = 0; i < 150; i++) coords.push(lerp(anchors[k], anchors[k + 1], i / 150));
  }
  coords.push(LYON);
  return coords;
}

/** @param {import('@playwright/test').Page} page */
export async function mockServices(page) {
  const coords = polyline();
  await page.route('**/photon.komoot.io/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: LYON },
      properties: { name: 'Lyon', state: 'Auvergne-Rhône-Alpes', type: 'city' },
    }] }),
  }));
  await page.route('**/route/v1/driving/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: coords },
        legs: [{ steps: [], summary: '', duration: 21000, distance: 560000 }],
        duration: 21000, distance: 560000,
      }],
      waypoints: [{ location: coords[0] }, { location: coords[coords.length - 1] }],
    }),
  }));
  return coords;
}

export const VIEWPORTS = {
  desktop:   { viewport: { width: 1440, height: 900 } },
  mobile:    { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  landscape: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

/**
 * Loaded app page with geolocation granted.
 * @param {import('@playwright/test').Browser} browser
 */
export async function openApp(browser, vp = 'desktop', geo = RENNES) {
  const context = await browser.newContext({
    ...VIEWPORTS[vp],
    colorScheme: 'light',
    permissions: ['geolocation'],
    geolocation: { latitude: geo[1], longitude: geo[0], accuracy: 5 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await mockServices(page);
  await page.goto('/');
  await page.waitForFunction(() => _markersReady && geoState.available, null, { timeout: 90_000 });
  return { context, page, errors };
}

/**
 * Plan flow: type the destination, pick the first suggestion. Returns taps used.
 * @param {import('@playwright/test').Page} page
 */
export async function planToLyon(page, how = 'tap') {
  await page.locator('#dest-input').fill('Lyon');
  const first = page.locator('#dest-list [role="option"]').first();
  await first.waitFor();
  if (how === 'enter') await page.locator('#dest-input').press('Enter');
  else await first.click();
  await page.waitForFunction(
    () => routeActive && currentRouteKm > 0 && document.querySelectorAll('#stop-list .stop').length > 0,
    null, { timeout: 30_000 });
  return 1;
}

/** Elements positioned over #map that are neither MapLibre's own nor inside #map. */
export function overMap(page) {
  return page.evaluate(() => {
    const map = document.getElementById('map');
    const mr = map.getBoundingClientRect();
    const bad = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (map.contains(el) || el.contains(map)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const ix = Math.min(r.right, mr.right) - Math.max(r.left, mr.left);
      const iy = Math.min(r.bottom, mr.bottom) - Math.max(r.top, mr.top);
      if (ix > 1 && iy > 1) bad.push(el.id ? `#${el.id}` : `${el.tagName}.${el.className}`);
    }
    return bad;
  });
}

/** Are both route ends on screen and not covered (MapLibre controls count as covering)? */
export function endpointsUncovered(page, coords) {
  return page.evaluate(([a, b]) => {
    const m = /** @type {any} */ (window)._map;
    const map = document.getElementById('map');
    const mr = map.getBoundingClientRect();
    return [a, b].map(ll => {
      const p = m.project(ll);
      const x = mr.left + p.x, y = mr.top + p.y;
      if (x < mr.left || y < mr.top || x > mr.right || y > mr.bottom) return false;
      const el = document.elementFromPoint(x, y);
      return !!el && map.contains(el) && !el.closest('.maplibregl-ctrl');
    });
  }, [coords[0], coords[coords.length - 1]]);
}

/** Wait until the map stopped moving. */
export function mapIdle(page) {
  return page.evaluate(() => new Promise(res => {
    const m = /** @type {any} */ (window)._map;
    const done = () => setTimeout(res, 200);
    if (!m.isMoving()) done(); else m.once('moveend', done);
  }));
}
