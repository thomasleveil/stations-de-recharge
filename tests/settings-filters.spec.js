// @ts-check
// F-3 + U-10 — Settings menu: minimum power filter and CHEAP corridor
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8765';

test.describe('F-3: Minimum power filter', () => {

  test('settings menu contains 3 power radio buttons', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    // Open settings menu
    await page.click('#settings-btn');
    const menu = page.locator('#settings-menu');
    await expect(menu).toBeVisible();

    // Verify 3 power options
    const radios = menu.locator('input[name="min-power"]');
    await expect(radios).toHaveCount(3);

    const values = await radios.evaluateAll(els => els.map(e => e.value));
    expect(values).toContain('150');
    expect(values).toContain('250');
    expect(values).toContain('350');
  });

  test('150 kW option is selected by default', async ({ page }) => {
    // Clear any saved preference
    await page.goto(BASE);
    await page.evaluate(() => localStorage.removeItem('irve-min-power-kw'));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.click('#settings-btn');
    const radio150 = page.locator('input[name="min-power"][value="150"]');
    await expect(radio150).toBeChecked();
  });

  test('power selection persists across reload', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    // Select 250 kW
    await page.click('#settings-btn');
    await page.click('input[name="min-power"][value="250"]');

    // Verify localStorage
    const saved = await page.evaluate(() => localStorage.getItem('irve-min-power-kw'));
    expect(saved).toBe('250');

    // Reload and verify selection
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.click('#settings-btn');
    const radio250 = page.locator('input[name="min-power"][value="250"]');
    await expect(radio250).toBeChecked();
  });
});

test.describe('U-10: CHEAP corridor setting', () => {

  test('cheap-corridor-input is present in settings menu', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    await page.click('#settings-btn');
    const input = page.locator('#cheap-corridor-input');
    await expect(input).toBeVisible();
  });

  test('default value is 10 km', async ({ page }) => {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.removeItem('irve-cheap-corridor-km'));
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.click('#settings-btn');
    const input = page.locator('#cheap-corridor-input');
    await expect(input).toHaveValue('10');
  });

  test('changed value persists across reload', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('domcontentloaded');

    await page.click('#settings-btn');
    const input = page.locator('#cheap-corridor-input');
    await input.fill('20');
    await input.dispatchEvent('change');

    const saved = await page.evaluate(() => localStorage.getItem('irve-cheap-corridor-km'));
    expect(saved).toBe('20');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.click('#settings-btn');
    await expect(page.locator('#cheap-corridor-input')).toHaveValue('20');
  });
});
