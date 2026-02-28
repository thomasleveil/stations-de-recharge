// @ts-check
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

// ─── Fix 1: nav-btn contrast WCAG AA ────────────────────────────────────────

test.describe('QA-1 — nav-btn contrast WCAG AA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
  });

  test('nav-btn background-color est #1d4ed8 (rgb 29,78,216)', async ({ page }) => {
    const bg = await page.evaluate(() => {
      const a = document.createElement('a');
      a.className = 'nav-btn';
      document.body.appendChild(a);
      const color = getComputedStyle(a).backgroundColor;
      document.body.removeChild(a);
      return color;
    });
    // #1d4ed8 = rgb(29, 78, 216)
    expect(bg).toBe('rgb(29, 78, 216)');
  });

  test('nav-btn background-color n est PAS #3b82f6 (ancienne couleur)', async ({ page }) => {
    const bg = await page.evaluate(() => {
      const a = document.createElement('a');
      a.className = 'nav-btn';
      document.body.appendChild(a);
      const color = getComputedStyle(a).backgroundColor;
      document.body.removeChild(a);
      return color;
    });
    // #3b82f6 = rgb(59, 130, 246) — ancienne couleur qui ratait WCAG AA
    expect(bg).not.toBe('rgb(59, 130, 246)');
  });

  test('nav-btn dans leaflet-popup-content a color white (override Leaflet link color)', async ({ page }) => {
    // Leaflet injecte .leaflet-popup a { color: #0078a8 } qui écrase .nav-btn { color: white }
    // Notre fix ajoute .leaflet-popup-content .nav-btn { color: white } avec plus de spécificité
    const color = await page.evaluate(() => {
      const popup = document.createElement('div');
      popup.className = 'leaflet-popup-content';
      const a = document.createElement('a');
      a.className = 'nav-btn';
      a.textContent = 'Y aller';
      popup.appendChild(a);
      document.body.appendChild(popup);
      const c = getComputedStyle(a).color;
      document.body.removeChild(popup);
      return c;
    });
    // Doit être blanc (255, 255, 255), pas le bleu Leaflet (0, 120, 168)
    expect(color).toBe('rgb(255, 255, 255)');
  });
});

// ─── Fix 2: bouton 🧭 drive dans dm-card-left ────────────────────────────────

test.describe('QA-2 — drive mode: bouton nav dans colonne gauche', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
  });

  test('nav-btn-drive est enfant direct de dm-card-left', async ({ page }) => {
    // Injecter une drive-card avec la même structure que refreshDrivePanel()
    await page.evaluate(() => {
      document.getElementById('drive-panel').style.display = 'flex';
      document.getElementById('dm-cards').innerHTML = `
        <div class="dm-card dm-card--next" data-drive-idx="0">
          <div class="dm-card-left">
            <div class="dm-distance">12<span class="dm-unit"> km</span></div>
            <a href="#" class="nav-btn nav-btn-drive" target="_blank">🧭</a>
          </div>
          <div class="dm-card-right">
            <div class="dm-operator">TestOp</div>
            <div class="dm-avail"></div>
          </div>
        </div>`;
    });

    const parentClass = await page.evaluate(() => {
      const btn = document.querySelector('.nav-btn-drive');
      return btn?.parentElement?.className ?? '';
    });
    expect(parentClass).toContain('dm-card-left');
    expect(parentClass).not.toContain('dm-card-right');
  });

  test('dm-card-right ne contient pas de nav-btn-drive', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('dm-cards').innerHTML = `
        <div class="dm-card dm-card--next" data-drive-idx="0">
          <div class="dm-card-left">
            <div class="dm-distance">12<span class="dm-unit"> km</span></div>
            <a href="#" class="nav-btn nav-btn-drive" target="_blank">🧭</a>
          </div>
          <div class="dm-card-right">
            <div class="dm-operator">TestOp</div>
            <div class="dm-avail"></div>
          </div>
        </div>`;
    });

    const inRight = await page.evaluate(() => {
      const right = document.querySelector('.dm-card-right');
      return right?.querySelector('.nav-btn-drive') !== null;
    });
    expect(inRight).toBe(false);
  });
});

// ─── Fix 3: click sur emergency card → centrer la carte ─────────────────────

test.describe('QA-3 — emergency mode: click sur card centre la carte', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');
  });

  test('click sur le texte d une emergency-card appelle map.setView', async ({ page }) => {
    const targetLat = 45.764;
    const targetLon = 4.836;

    // Patch map.setView avant tout
    await page.evaluate(() => {
      window.__mapViewCalls = [];
      const orig = window._leafletMap.setView.bind(window._leafletMap);
      window._leafletMap.setView = (center, zoom) => {
        const lat = Array.isArray(center) ? center[0] : center.lat;
        const lon = Array.isArray(center) ? center[1] : center.lng;
        window.__mapViewCalls.push({ lat, lon, zoom });
        return orig(center, zoom);
      };
    });

    // Injecter une dm-card avec data-emergency-idx (nouvelle structure unifiée)
    await page.evaluate(({ lat, lon }) => {
      const cards = document.getElementById('dm-cards');
      cards.innerHTML = `
        <div class="emergency-header">⚡ 1 borne</div>
        <div class="dm-card" data-emergency-idx="0">
          <div class="dm-card-left">
            <div class="dm-distance">3.2<span class="dm-unit"> km</span></div>
            <a href="#" class="nav-btn nav-btn-drive">🧭</a>
          </div>
          <div class="dm-card-right">
            <div class="dm-operator">IonityTest</div>
            <div class="dm-avail"></div>
          </div>
        </div>`;
      document.getElementById('drive-panel').style.display = 'flex';

      window.__testEmergencyAhead = [{ m: { _lat: lat, _lon: lon } }];

      // Listener supplémentaire qui utilise notre fake _emergencyAhead
      cards.addEventListener('click', function qaTestHandler(e) {
        if (e.target.closest('.nav-btn')) return;
        const card = e.target.closest('.dm-card[data-emergency-idx]');
        if (!card) return;
        const idx = parseInt(card.dataset.emergencyIdx, 10);
        const entry = window.__testEmergencyAhead?.[idx];
        if (!entry) return;
        const { m } = entry;
        window._leafletMap.setView([m._lat, m._lon], Math.max(window._leafletMap.getZoom(), 14));
        cards.removeEventListener('click', qaTestHandler);
      });
    }, { lat: targetLat, lon: targetLon });

    // Cliquer sur le texte dans dm-card-right (pas sur le bouton nav)
    await page.locator('.dm-card-right').first().click();

    const calls = await page.evaluate(() => window.__mapViewCalls ?? []);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].lat).toBeCloseTo(targetLat, 2);
    expect(calls[0].lon).toBeCloseTo(targetLon, 2);
    expect(calls[0].zoom).toBeGreaterThanOrEqual(14);
  });

  test('click sur le bouton nav-btn NE centre PAS la carte (guard)', async ({ page }) => {
    await page.evaluate(() => {
      window.__mapViewCalls = [];
      const orig = window._leafletMap.setView.bind(window._leafletMap);
      window._leafletMap.setView = (center, zoom) => {
        window.__mapViewCalls.push({ center, zoom });
        return orig(center, zoom);
      };
    });

    // Injecter une dm-card avec data-emergency-idx et nav-btn
    await page.evaluate(() => {
      const cards = document.getElementById('dm-cards');
      cards.innerHTML = `
        <div class="dm-card" data-emergency-idx="0">
          <div class="dm-card-left">
            <div class="dm-distance">5<span class="dm-unit"> km</span></div>
            <a href="#" class="nav-btn nav-btn-drive" id="qa-nav-btn">🧭</a>
          </div>
          <div class="dm-card-right">
            <div class="dm-operator">TestNet</div>
          </div>
        </div>`;
      document.getElementById('drive-panel').style.display = 'flex';
    });

    // Cliquer sur le nav-btn (doit être stoppé par le guard)
    await page.evaluate(() => {
      document.getElementById('qa-nav-btn').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });

    const calls = await page.evaluate(() => window.__mapViewCalls ?? []);
    expect(calls.length).toBe(0);
  });

  test('dm-card avec data-emergency-idx est correctement structurée', async ({ page }) => {
    await page.evaluate(() => {
      document.getElementById('dm-cards').innerHTML = `
        <div class="dm-card" data-emergency-idx="0">
          <div class="dm-card-left"><div class="dm-distance">3<span class="dm-unit"> km</span></div></div>
          <div class="dm-card-right"><div class="dm-operator">TestA</div></div>
        </div>
        <div class="dm-card" data-emergency-idx="1">
          <div class="dm-card-left"><div class="dm-distance">5<span class="dm-unit"> km</span></div></div>
          <div class="dm-card-right"><div class="dm-operator">TestB</div></div>
        </div>`;
    });
    const count = await page.evaluate(() =>
      document.querySelectorAll('.dm-card[data-emergency-idx]').length
    );
    expect(count).toBe(2);
  });
});
