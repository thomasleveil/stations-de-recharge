// @ts-check
// R4 — SunCalc auto dark mode + theme toggle button
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';
const PARIS = { latitude: 48.8566, longitude: 2.3522, accuracy: 5 };

// June 15 in Paris: dawn ~05:25 CEST, dusk ~22:39 CEST (per SunCalc)
const DAYTIME     = '2026-06-15T14:00:00+02:00';
const NIGHTTIME   = '2026-06-15T23:30:00+02:00';
const BEFORE_DUSK = '2026-06-15T20:00:00+02:00';
const AFTER_DUSK  = '2026-06-15T23:00:00+02:00';

test.describe('R4: SunCalc auto dark mode', () => {

  test('Daytime + GPS → light mode with sun icon', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: PARIS,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(DAYTIME));
    await page.goto(BASE);
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('#theme-toggle-btn')).toHaveText('☀');
    await context.close();
  });

  test('Nighttime + GPS → dark mode with moon icon', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: PARIS,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NIGHTTIME));
    await page.goto(BASE);
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#theme-toggle-btn')).toHaveText('☽');
    await context.close();
  });

  test('Auto transition day → night when time passes dusk', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: PARIS,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(BEFORE_DUSK));
    await page.goto(BASE);
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Advance past dusk and trigger SunCalc recheck
    await page.clock.setFixedTime(new Date(AFTER_DUSK));
    await page.evaluate(() => _checkSunCalcTheme());

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#theme-toggle-btn')).toHaveText('☽');
    await context.close();
  });

  test('Manual toggle blocks SunCalc auto-switch', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: PARIS,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NIGHTTIME));
    await page.goto(BASE);
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Override: toggle to light during nighttime
    await page.click('#theme-toggle-btn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Advance time and trigger geo update — should stay light (manual override)
    await page.clock.setFixedTime(new Date('2026-06-15T23:30:00+02:00'));
    await context.setGeolocation({ latitude: 48.86, longitude: 2.36, accuracy: 5 });
    await page.waitForTimeout(500);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await context.close();
  });

  test('Reload resets manual override (safety)', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: PARIS,
      colorScheme: 'light',
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(NIGHTTIME));
    await page.goto(BASE);
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Override to light
    await page.click('#theme-toggle-btn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Reload — manual override resets, auto mode resumes → dark (still nighttime)
    await page.reload();
    await expect(page.locator('.geoloc-marker')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });

  test('Theme toggle button switches light ↔ dark', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#theme-toggle-btn');
    await expect(btn).toBeVisible();

    const initial = await page.locator('html').getAttribute('data-theme');

    await btn.click();
    const toggled = await page.locator('html').getAttribute('data-theme');
    expect(toggled).not.toBe(initial);

    await btn.click();
    const restored = await page.locator('html').getAttribute('data-theme');
    expect(restored).toBe(initial);
  });

  test('Settings menu has no dark mode checkbox', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    await page.click('#settings-btn');
    const menu = page.locator('#settings-menu');
    await expect(menu).toBeVisible();

    await expect(menu.locator('text=Mode sombre')).toHaveCount(0);
    await expect(menu.locator('#dark-mode-toggle')).toHaveCount(0);
    await expect(menu.locator('text=Apparence')).toHaveCount(0);
  });
});
