// tests/preferred-networks.spec.js
// Tests for F-9b — Preferred network highlighting
const { test, expect } = require('@playwright/test');

test.describe('F-9b — Preferred network settings', () => {
  test('Preferred networks section exists in settings menu', async ({ page }) => {
    await page.goto('/');

    // Open settings menu
    await page.click('#settings-btn');
    await expect(page.locator('#settings-menu')).toBeVisible();

    // Check preferred networks section
    const prefList = page.locator('#preferred-networks-list');
    await expect(prefList).toBeVisible();
  });

  test('Settings contain checkboxes for OPERATORS', async ({ page }) => {
    await page.goto('/');
    await page.click('#settings-btn');

    const checkboxes = page.locator('#preferred-networks-list input[type="checkbox"]');
    const count = await checkboxes.count();
    // OPERATORS array has 13 entries
    expect(count).toBeGreaterThanOrEqual(10);
  });

  test('Checking a network persists to localStorage', async ({ page }) => {
    await page.goto('/');
    await page.click('#settings-btn');

    // Check the first checkbox
    const firstCb = page.locator('#preferred-networks-list input[type="checkbox"]').first();
    await firstCb.check();

    const stored = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('irve-preferred-networks') || '[]');
    });
    expect(stored.length).toBeGreaterThan(0);
  });

  test('Unchecking a network removes it from localStorage', async ({ page }) => {
    await page.goto('/');

    // Pre-set a preference
    await page.evaluate(() => {
      localStorage.setItem('irve-preferred-networks', JSON.stringify(['IONITY']));
    });
    await page.reload();
    await page.click('#settings-btn');

    // Find and uncheck IONITY
    const cbs = page.locator('#preferred-networks-list input[type="checkbox"]');
    const count = await cbs.count();
    for (let i = 0; i < count; i++) {
      const cb = cbs.nth(i);
      const val = await cb.evaluate(el => el.value);
      if (val === 'IONITY') {
        await cb.uncheck();
        break;
      }
    }

    const stored = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('irve-preferred-networks') || '[]');
    });
    expect(stored).not.toContain('IONITY');
  });

  test('Saved preferences are restored on page reload', async ({ page }) => {
    await page.goto('/');

    // Set IONITY as preferred
    await page.evaluate(() => {
      localStorage.setItem('irve-preferred-networks', JSON.stringify(['IONITY', 'Fastned']));
    });
    await page.reload();
    await page.click('#settings-btn');

    // Check that IONITY and Fastned checkboxes are checked
    const cbs = page.locator('#preferred-networks-list input[type="checkbox"]');
    const count = await cbs.count();
    const checkedNames = [];
    for (let i = 0; i < count; i++) {
      const cb = cbs.nth(i);
      const checked = await cb.isChecked();
      if (checked) {
        const val = await cb.evaluate(el => el.value);
        checkedNames.push(val);
      }
    }
    expect(checkedNames).toContain('IONITY');
    expect(checkedNames).toContain('Fastned');
  });

  test('Each operator checkbox has a color dot', async ({ page }) => {
    await page.goto('/');
    await page.click('#settings-btn');

    const dots = page.locator('#preferred-networks-list .settings-net-dot');
    const count = await dots.count();
    expect(count).toBeGreaterThanOrEqual(10);

    // First dot should have a background color set
    const style = await dots.first().evaluate(el => el.style.background);
    expect(style).toBeTruthy();
    expect(style).not.toBe('');
  });
});
