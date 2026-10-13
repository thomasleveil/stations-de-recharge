// @ts-check
// C1 / C2 / C6 — plan flow: one field, one selection, then one list of stops
// by km with the whole route visible.
import { test, expect } from '@playwright/test';
import { openApp, planToLyon, endpointsUncovered, mapIdle, polyline } from './helpers/app.js';

for (const vp of ['desktop', 'mobile']) {
  test.describe(`plan flow — ${vp}`, () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(150_000);
    /** @type {import('@playwright/test').Page} */ let page;
    /** @type {import('@playwright/test').BrowserContext} */ let context;
    /** @type {string[]} */ let errors;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(150_000);
      ({ context, page, errors } = await openApp(browser, vp));
    });
    test.afterAll(async () => { await context?.close(); });

    test('C1 — home has one field; one selection computes the trip', async () => {
      await expect(page.locator('#dest-input')).toBeVisible();
      await expect(page.locator('#from-input')).toBeHidden();
      await expect(page.locator('#from-label')).toHaveText('ma position');
      await expect(page.locator('#dest-input')).toHaveAccessibleName('Où allez-vous ?');

      const taps = await planToLyon(page, vp === 'desktop' ? 'enter' : 'tap');
      expect(taps).toBe(1);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'trip');
      await expect(page.locator('#trip-summary')).toContainText('Ma position → Lyon');
      // The stops are on screen: list rows on desktop, markers on the map on phones.
      if (vp === 'desktop') await expect(page.locator('#stop-list > li.stop').first()).toBeInViewport();
      // Corridor stations are drawn on the map (after the staggered fade-in).
      await page.waitForFunction(() => /** @type {any} */ (window)._map.querySourceFeatures('stations').length > 0,
        null, { timeout: 15_000 });
      expect(errors).toEqual([]);
    });

    test('a trip shows individual stops (no clusters) and folds the first km', async () => {
      // Rendered features: stops only, no cluster bubbles.
      await expect.poll(() => page.evaluate(() => {
        const f = /** @type {any} */ (window)._map.querySourceFeatures('stations');
        return f.length > 0 && !f.some(x => x.properties.point_count);
      }), { timeout: 10_000 }).toBe(true);
      await expect(page.locator('#fold-early')).not.toHaveAttribute('open', '');
      const firstKm = await page.evaluate(() => {
        const first = document.querySelector('#stop-list > li.stop .stop-km');
        return parseInt(first?.textContent || '', 10);
      });
      expect(firstKm).toBeGreaterThanOrEqual(30);
    });

    test('C2 — both route ends lie in uncovered map area', async () => {
      if (vp === 'mobile') await expect(page.locator('body')).toHaveAttribute('data-sheet', 'collapsed');
      await page.waitForTimeout(700);
      await mapIdle(page);
      expect(await endpointsUncovered(page, polyline())).toEqual([true, true]);
    });

    test('C6 — one count, one list in route order, network names as text, inline white zones', async () => {
      if (vp === 'mobile') {
        await page.click('#sheet-handle');
        await expect(page.locator('#sheet-handle')).toHaveAttribute('aria-expanded', 'true');
      }
      await expect(page.locator('#stop-list > li.stop').first()).toBeVisible();
      const r = await page.evaluate(() => {
        const counts = [...document.querySelectorAll('#sheet *')]
          .filter(e => e.children.length === 0 && /\d+ bornes?\b/.test(e.textContent || '') && /** @type {HTMLElement} */ (e).offsetParent)
          .map(e => e.textContent);
        const lists = [...document.querySelectorAll('#sheet .stop-list')].filter(e => /** @type {HTMLElement} */ (e).offsetParent).length;
        const items = [...document.querySelectorAll('#stop-list li.stop, #stop-list li.gap-row')].map(li => li.classList.contains('gap-row')
          ? { gap: parseInt(li.textContent || '', 10) }
          : {
            km: parseInt(li.querySelector('.stop-km')?.textContent || '', 10),
            net: li.querySelector('.stop-net')?.textContent?.trim() || '',
            fast: !markers[+(/** @type {HTMLElement} */ (li).dataset.idx || -1)]._cheap,
          });
        const shown = markers.filter(m => isVisible(m)).length;
        return { counts, lists, items, shown };
      });
      expect(r.counts).toHaveLength(1);
      expect(r.counts[0]).toContain(`${r.shown} borne`);
      expect(r.lists).toBe(1);
      const rows = r.items.filter(i => !('gap' in i));
      expect(rows.length).toBe(r.shown);
      expect(rows.every(i => i.net.length > 0)).toBe(true);
      const kms = rows.map(i => i.km);
      expect(kms).toEqual([...kms].sort((a, b) => a - b));
      // A white zone sits between two fast stops more than 80 km apart, and only there.
      let lastFast = null, pendingGap = null;
      for (const it of r.items) {
        if ('gap' in it) { pendingGap = it.gap; continue; }
        if (!it.fast) continue;
        if (lastFast !== null) {
          const d = it.km - lastFast;
          if (d > 80) expect(pendingGap, `gap before km ${it.km}`).not.toBeNull();
          else expect(pendingGap, `no gap before km ${it.km}`).toBeNull();
        }
        lastFast = it.km;
        pendingGap = null;
      }
    });

    test('selecting a row flies to the station and shows Naviguer; a map selection selects the row', async () => {
      const row = page.locator('#stop-list > li.stop').nth(2);
      await row.locator('.stop-main').click();
      await expect(row).toHaveClass(/is-selected/);
      await expect(row.locator('.stop-main')).toHaveAttribute('aria-expanded', 'true');
      const nav = row.locator('a', { hasText: 'Naviguer' });
      await expect(nav).toBeVisible();
      const idx = Number(await row.getAttribute('data-idx'));
      const expected = await page.evaluate(i => UI.stationNavUrl(markers[i]), idx);
      await expect(nav).toHaveAttribute('href', expected);
      await expect.poll(() => page.evaluate(i => {
        const c = /** @type {any} */ (window)._map.getCenter();
        return Math.hypot(c.lng - markers[i]._lon, c.lat - markers[i]._lat);
      }, idx), { timeout: 5000 }).toBeLessThan(0.05);

      const other = await page.locator('#stop-list > li.stop').nth(5).getAttribute('data-idx');
      await page.evaluate(i => UI.onStationClick(markers[i]), Number(other));
      await expect(page.locator(`#stop-list .stop[data-idx="${other}"]`)).toHaveClass(/is-selected/);
      await expect(row).not.toHaveClass(/is-selected/);
    });

    test('clearing the trip brings the clusters back', async () => {
      if (vp === 'mobile') await page.click('#sheet-handle');
      await page.click('#edit-btn');
      await expect(page.locator('body')).toHaveAttribute('data-view', 'home');
      await page.evaluate(() => /** @type {any} */ (window)._map.jumpTo({ center: [2.5, 46.6], zoom: 6 }));
      await expect.poll(() => page.evaluate(() => /** @type {any} */ (window)._map.querySourceFeatures('stations')
        .some(x => x.properties.point_count)), { timeout: 10_000 }).toBe(true);
    });
  });
}
