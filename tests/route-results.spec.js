// @ts-check
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

test.describe('U-2 — Route results panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
  });

  test('route-results masqué au chargement', async ({ page }) => {
    await expect(page.locator('#route-results')).toBeHidden();
  });

  test('route-results-toggle et route-results-list existent dans le DOM', async ({ page }) => {
    await expect(page.locator('#route-results-toggle')).toBeAttached();
    await expect(page.locator('#route-results-list')).toBeAttached();
    await expect(page.locator('#route-results-title')).toBeAttached();
  });

  test('clic sur le toggle ajoute/retire la classe open', async ({ page }) => {
    // Make the panel visible without JS state
    await page.evaluate(() => {
      document.getElementById('route-results').style.display = '';
    });
    const panel = page.locator('#route-results');
    await expect(panel).toBeVisible();

    // No open class before click
    await expect(panel).not.toHaveClass(/open/);

    // Click header — adds class "open"
    await page.locator('#route-results-toggle').click();
    await expect(panel).toHaveClass(/open/);

    // Second click — removes open class
    await page.locator('#route-results-toggle').click();
    await expect(panel).not.toHaveClass(/open/);
  });

  test('clearRoute masque le panneau de résultats', async ({ page }) => {
    // Make panel visible directly
    await page.evaluate(() => {
      document.getElementById('route-results').style.display = '';
    });
    await expect(page.locator('#route-results')).toBeVisible();

    // clearRoute is a function declaration, accessible via window
    await page.evaluate(() => window.clearRoute());
    await expect(page.locator('#route-results')).toBeHidden();
  });
});

test.describe('U-7 — Drive mode panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
  });

  test('drive-panel masqué au chargement', async ({ page }) => {
    await expect(page.locator('#drive-panel')).toBeHidden();
  });

  test('drive-mode-btn masqué au chargement', async ({ page }) => {
    await expect(page.locator('#drive-mode-btn')).toBeHidden();
  });

  test('dm-exit et dm-cards existent dans le DOM', async ({ page }) => {
    await expect(page.locator('#dm-exit')).toBeAttached();
    await expect(page.locator('#dm-cards')).toBeAttached();
    await expect(page.locator('.dm-title')).toBeAttached();
  });

  test('enterDriveMode affiche le panneau et décale le panel principal', async ({ page }) => {
    // enterDriveMode is a function declaration, accessible via window
    await page.evaluate(() => window.enterDriveMode());
    await expect(page.locator('#drive-panel')).toBeVisible();
    await expect(page.locator('#panel')).toBeVisible();
    // dm-cards has content (at least GPS-lost card since no GPS in test)
    const cards = page.locator('#dm-cards');
    const text = await cards.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('exitDriveMode masque le panneau et restaure le panel principal', async ({ page }) => {
    await page.evaluate(() => window.enterDriveMode());
    await expect(page.locator('#drive-panel')).toBeVisible();

    await page.evaluate(() => window.exitDriveMode());
    await expect(page.locator('#drive-panel')).toBeHidden();
    await expect(page.locator('#panel')).toBeVisible();
  });

  test('dm-exit button appelle exitDriveMode et ferme le panneau', async ({ page }) => {
    await page.evaluate(() => window.enterDriveMode());
    await expect(page.locator('#drive-panel')).toBeVisible();

    await page.locator('#dm-exit').click();
    await expect(page.locator('#drive-panel')).toBeHidden();
    await expect(page.locator('#panel')).toBeVisible();
  });

  test('sans GPS, drive panel affiche la carte Signal GPS perdu', async ({ page }) => {
    // enterDriveMode() sets driveModeActive=true internally and calls refreshDrivePanel()
    // geoState.available is false by default (no GPS in test context)
    await page.evaluate(() => window.enterDriveMode());
    // dm-cards should contain GPS-lost card
    await expect(page.locator('#dm-cards')).toContainText('GPS');
  });
});
