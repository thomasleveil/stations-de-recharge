// @ts-check
import { test, expect } from '@playwright/test';

const BASE   = 'http://localhost:8765';
const ORIGIN = { lat: 48.8566, lon: 2.3522 };
const STEP   = 0.01; // ~1,1 km >> seuil 10 m de l'app

// Position initiale injectée dans beforeEach = 1er point de l'historique app.
// Le bearing DOM est calculé FROM ce point TO la cible — pas depuis ORIGIN.
const START = { lat: ORIGIN.lat - STEP * 0.5, lon: ORIGIN.lon - STEP * 0.5 };

// ── Helpers ────────────────────────────────────────────────────────────────

/** Bearing théorique [0, 360) — même formule que app.js */
function expectedBearing(lat1, lon1, lat2, lon2) {
  const toRad = x => x * Math.PI / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
          - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Lire la rotation CSS de .geoloc-marker */
async function getArrowRotation(page) {
  return page.locator('.geoloc-marker').evaluate(el => {
    const m = el.style.transform.match(/rotate\((-?\d+)deg\)/);
    return m ? parseInt(m[1], 10) : null;
  });
}

/** Déplace la géoloc et attend que le DOM change d'angle */
async function moveTo(context, page, lat, lon, prevAngle) {
  await context.setGeolocation({ latitude: lat, longitude: lon, accuracy: 5 });
  await page.waitForFunction(
    prev => {
      const el = document.querySelector('.geoloc-marker');
      if (!el) return false;
      const m = el.style.transform.match(/rotate\((-?\d+)deg\)/);
      const cur = m ? parseInt(m[1], 10) : null;
      return cur !== null && cur !== prev;
    },
    prevAngle,
    { timeout: 5000 },
  );
}

// ── Suite ──────────────────────────────────────────────────────────────────

test.describe('Geolocalisation — marqueur fleche', () => {

  let context;
  let page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: {
        latitude:  START.lat,
        longitude: START.lon,
        accuracy:  5,
      },
    });
    page = await context.newPage();
    await page.goto(BASE);
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
  });

  test.afterEach(async () => {
    await context.close();
  });

  // ── Orientation ────────────────────────────────────────────────────────

  test('Deplacement vers le nord — fleche orientee nord', async () => {
    const lat2 = ORIGIN.lat + STEP;
    const exp  = expectedBearing(START.lat, START.lon, lat2, ORIGIN.lon);
    console.log(`  Nord  : bearing theorique START->cible = ${exp.toFixed(1)}`);

    const prev = await getArrowRotation(page);
    await moveTo(context, page, lat2, ORIGIN.lon, prev);

    const rot = await getArrowRotation(page);
    console.log(`          DOM rotate                     = ${rot}`);
    expect(rot).toBeCloseTo(exp, 0);
  });

  test('Deplacement vers l est — fleche orientee est', async () => {
    const lon2 = ORIGIN.lon + STEP;
    const exp  = expectedBearing(START.lat, START.lon, ORIGIN.lat, lon2);
    console.log(`  Est   : bearing theorique START->cible = ${exp.toFixed(1)}`);

    const prev = await getArrowRotation(page);
    await moveTo(context, page, ORIGIN.lat, lon2, prev);

    const rot = await getArrowRotation(page);
    console.log(`          DOM rotate                     = ${rot}`);
    expect(rot).toBeCloseTo(exp, 0);
  });

  test('Deplacement vers le sud — fleche orientee sud', async () => {
    const lat2 = ORIGIN.lat - STEP;
    const exp  = expectedBearing(START.lat, START.lon, lat2, ORIGIN.lon);
    console.log(`  Sud   : bearing theorique START->cible = ${exp.toFixed(1)}`);

    const prev = await getArrowRotation(page);
    await moveTo(context, page, lat2, ORIGIN.lon, prev);

    const rot = await getArrowRotation(page);
    console.log(`          DOM rotate                     = ${rot}`);
    expect(rot).toBeCloseTo(exp, 0);
  });

  test('Deplacement vers l ouest — fleche orientee ouest', async () => {
    const lon2 = ORIGIN.lon - STEP;
    const exp  = expectedBearing(START.lat, START.lon, ORIGIN.lat, lon2);
    console.log(`  Ouest : bearing theorique START->cible = ${exp.toFixed(1)}`);

    const prev = await getArrowRotation(page);
    await moveTo(context, page, ORIGIN.lat, lon2, prev);

    const rot = await getArrowRotation(page);
    console.log(`          DOM rotate                     = ${rot}`);
    expect(rot).toBeCloseTo(exp, 0);
  });

  // ── Bouton locate ──────────────────────────────────────────────────────

  test('Bouton locate active et recentre la carte sur la position GPS', async () => {
    const lat2 = ORIGIN.lat + STEP;
    const prev = await getArrowRotation(page);
    await moveTo(context, page, lat2, ORIGIN.lon, prev);

    const btn = page.locator('.leaflet-control-locate');
    await expect(btn).toBeEnabled();

    // Verifier que le marqueur N'est PAS au centre avant le clic
    const viewport   = page.viewportSize();
    const cx         = viewport.width  / 2;
    const cy         = viewport.height / 2;
    const boxBefore  = await page.locator('.geoloc-marker-outer').boundingBox();
    const distBefore = Math.hypot(
      boxBefore.x + boxBefore.width  / 2 - cx,
      boxBefore.y + boxBefore.height / 2 - cy,
    );

    await btn.click();
    // Attendre que l'animation setView soit terminee
    await page.waitForTimeout(400);

    // Apres le clic, le marqueur doit etre proche du centre du viewport
    const boxAfter = await page.locator('.geoloc-marker-outer').boundingBox();
    const distAfter = Math.hypot(
      boxAfter.x + boxAfter.width  / 2 - cx,
      boxAfter.y + boxAfter.height / 2 - cy,
    );

    console.log(`  Locate : dist avant = ${distBefore.toFixed(0)}px, dist apres = ${distAfter.toFixed(0)}px`);
    // Le marqueur est maintenant bien plus pres du centre qu'avant
    expect(distAfter).toBeLessThan(20);           // moins de 20 px du centre
    expect(distAfter).toBeLessThan(distBefore);   // et plus pres qu'avant
  });

  // ── Permission refusee ─────────────────────────────────────────────────

  test('Bouton locate en mode retry (jaune) si permission refusee', async ({ browser }) => {
    const ctx2  = await browser.newContext({ permissions: [] });
    const page2 = await ctx2.newPage();
    await page2.goto(BASE);
    await page2.waitForLoadState('domcontentloaded');
    await page2.waitForTimeout(1500);

    const btn = page2.locator('.leaflet-control-locate');
    // Bouton ACTIVE (pas disabled) mais avec classe retry
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveClass(/geoloc-retry/);
    // Pas de marqueur fleche visible
    await expect(page2.locator('.geoloc-marker')).not.toBeVisible();

    await ctx2.close();
  });
});
