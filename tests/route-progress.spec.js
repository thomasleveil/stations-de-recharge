// @ts-check
// B-7 / B-8 — km along the route and drive-mode "ahead" list, asserted on
// engine state (m._progressOnRoute, currentRouteKm, _driveAheadList()); the
// UI is only checked to show those same numbers.
//
// The mocked OSRM polyline is deliberately uneven: a first leg split into
// thousands of tiny segments, then two legs of a single long segment each.
// Progress computed from the segment index (instead of cumulative distance)
// puts the end of the first leg near the end of the route, so every km shown
// is checked against the true along-route distance computed here.
import { test, expect } from '@playwright/test';

// Anchor points; the polyline goes through the nearest station to each one.
const ANCHORS = [
  [-1.68, 48.11], // Rennes
  [0.20, 48.00],  // Le Mans
  [2.40, 47.08],  // Bourges
  [4.84, 45.76],  // Lyon
];
const DENSE_POINTS = 3000; // first leg only

// ── Ground truth (independent of app.js) ─────────────────────────────────

function havKm(a, b) {
  const R = 6371.0088, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Returns p => km along `coords` of the nearest projection of p. */
function alongRoute(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + havKm(coords[i - 1], coords[i]));
  const along = ([lon, lat]) => {
    const k = Math.cos(lat * Math.PI / 180);
    let best = Infinity, km = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
      const dx = (bx - ax) * k, dy = by - ay, px = (lon - ax) * k, py = lat - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      const d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d2 < best) { best = d2; km = cum[i] + t * (cum[i + 1] - cum[i]); }
    }
    return km;
  };
  along.totalKm = cum[cum.length - 1];
  return along;
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ── Setup: real stations, mocked Photon + OSRM, simulated GPS ────────────

async function setupRoute(browser) {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: ANCHORS[0][1], longitude: ANCHORS[0][0], accuracy: 5 },
  });
  const page = await context.newPage();

  await page.route('**/photon.komoot.io/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: ANCHORS[3] },
      properties: { name: 'Lyon', type: 'city' },
    }] }),
  }));

  await page.goto('/');
  await page.waitForFunction(() => _markersReady, null, { timeout: 90_000 });

  // Snap each anchor to the nearest fast (non-cheap) station so the polyline
  // runs through real stations of the current dataset.
  const stations = await page.evaluate(anchors => anchors.map(([lon, lat]) => {
    let best = null, bestD = Infinity;
    for (const m of markers) {
      if (m._cheap || !isVisible(m)) continue;
      const d = (m._lon - lon) ** 2 + (m._lat - lat) ** 2;
      if (d < bestD) { bestD = d; best = m; }
    }
    return [best._lon, best._lat];
  }), ANCHORS);

  const [A, B, C, D] = stations;
  const coords = [];
  for (let i = 0; i < DENSE_POINTS; i++) coords.push(lerp(A, B, i / DENSE_POINTS));
  coords.push(B, C, D);
  const along = alongRoute(coords);

  await page.route('**/route/v1/driving/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      code: 'Ok',
      routes: [{
        geometry: { type: 'LineString', coordinates: coords },
        legs: [{ steps: [], summary: '', duration: 20000, distance: along.totalKm * 1000 }],
        duration: 20000, distance: along.totalKm * 1000,
      }],
      waypoints: [{ location: A }, { location: D }],
    }),
  }));

  // Plan through the UI: one field, Enter picks the first suggestion.
  await page.fill('#dest-input', 'Lyon');
  await page.locator('#dest-list [role="option"]').first().waitFor();
  await page.press('#dest-input', 'Enter');
  await page.waitForFunction(
    () => routeActive && currentRouteKm > 0 && document.querySelectorAll('#stop-list .stop').length > 0,
    null, { timeout: 30_000 },
  );
  return { context, page, stations, coords, along };
}

test.describe('B-7 / B-8 — distances along the route', () => {
  test.setTimeout(150_000);

  test('km along the route is proportional to distance, not segment index', async ({ browser }) => {
    const { context, page, stations, along } = await setupRoute(browser);

    // Engine: every corridor station, in route order, with its km from the start.
    const items = await page.evaluate(() => markers.filter(m => isVisible(m))
      .sort((a, b) => (a._progressOnRoute ?? 0) - (b._progressOnRoute ?? 0))
      .map(m => ({
        idx: m._idx, name: m._name || m._op.name, lon: m._lon, lat: m._lat,
        km: Math.round(currentRouteKm * m._progressOnRoute),
      })));
    expect(items.length).toBeGreaterThan(3);

    const bad = items
      .map(it => ({ name: it.name, km: it.km, expectedKm: Math.round(along([it.lon, it.lat])) }))
      .filter(it => !(Math.abs(it.km - it.expectedKm) <= 2));
    expect(bad.slice(0, 5), `${bad.length}/${items.length} stations with a wrong km`).toEqual([]);

    // End of the dense leg: about 150 km along a ~560 km route.
    const [, B] = stations;
    const itemB = items.find(it => it.lon === B[0] && it.lat === B[1]);
    expect(itemB).toBeTruthy();
    expect(Math.abs(/** @type {any} */ (itemB).km - along(B))).toBeLessThanOrEqual(2);

    // The list shows the same stations, in the same order, with the same km.
    const rows = await page.evaluate(() => [...document.querySelectorAll('#stop-list .stop')].map(li => ({
      idx: Number(/** @type {HTMLElement} */ (li).dataset.idx),
      km: parseInt(li.querySelector('.stop-km')?.textContent ?? '', 10),
    })));
    expect(rows).toEqual(items.map(({ idx, km }) => ({ idx, km })));

    await context.close();
  });

  test('drive mode lists only stations ahead, with along-route distance', async ({ browser }) => {
    const { context, page, stations, along } = await setupRoute(browser);
    const [, B, C] = stations;

    async function checkAt(t) {
      // GPS in the middle of the single long segment B→C.
      const [lon, lat] = lerp(B, C, t);
      await context.setGeolocation({ latitude: lat, longitude: lon, accuracy: 5 });
      await page.waitForFunction(
        ([lo, la]) => Math.abs(geoState.lat - la) < 1e-6 && Math.abs(geoState.lng - lo) < 1e-6,
        [lon, lat],
      );
      await page.evaluate(() => { if (!driveModeActive) UI.enterDrive(); });

      const userKm = along([lon, lat]);
      const ahead = await page.evaluate(() => _driveAheadList().map(({ m, dist }) => ({
        name: m._name || m._op.name, lon: m._lon, lat: m._lat, dist,
      })));
      expect(ahead.length).toBeGreaterThan(0);
      const rows = ahead.map(c => {
        const aheadKm = along([c.lon, c.lat]) - userKm;
        return { name: c.name, aheadKm: Math.round(aheadKm * 10) / 10, dist: Math.round(c.dist * 10) / 10 };
      });
      const behind = rows.filter(r => r.aheadKm <= 0);
      expect(behind, `user at km ${userKm.toFixed(1)}: stations listed behind`).toEqual([]);
      const wrongDist = rows.filter(r => !(Math.abs(r.dist - r.aheadKm) <= 2));
      expect(wrongDist, 'drive distance must be measured along the route').toEqual([]);
      const dists = rows.map(r => r.dist);
      expect(dists).toEqual([...dists].sort((a, b) => a - b));

      // The drive card shows the nearest one ahead.
      await page.evaluate(() => { UI.state.driveSel = null; });
      await page.evaluate(() => UI.enterDrive());
      const shown = parseFloat((await page.textContent('#drive-km') ?? '').replace(',', '.'));
      expect(Math.abs(shown - rows[0].dist)).toBeLessThanOrEqual(1);
    }

    await checkAt(0.5);
    await checkAt(0.8); // moving on: the list and its distances follow the user

    await context.close();
  });
});
