// @ts-check
// GPS signal lost while driving (tunnel, underground car park): the browser
// reports a TIMEOUT or POSITION_UNAVAILABLE error, but the last known position
// is still the best one we have. The drive card and the nearby list must stay
// usable, say that the signal is lost, and recover on the next fix. Only a
// refused permission makes the position unavailable.
import { test, expect } from '@playwright/test';
import { openApp, planToLyon, BOURGES } from './helpers/app.js';

test('a lost GPS signal keeps the drive card and nearby list on the last known position', async ({ browser }) => {
  test.setTimeout(150_000);
  const { context, page, errors } = await openApp(browser, 'mobile', BOURGES);
  await planToLyon(page);
  await page.click('#drive-btn');
  await expect(page.locator('#drive-title')).toHaveText('Prochaine borne');
  const km = await page.locator('#drive-km').innerText();
  const name = await page.locator('#drive-name').innerText();

  // What the browser calls when the fix times out, then when the signal is gone.
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w._onGeoError({ code: 3, message: 'Timeout expired' });
    w._onGeoError({ code: 2, message: 'Position unavailable' });
  });
  await expect(page.locator('#drive-title')).toHaveText(/Prochaine borne.*signal GPS perdu/);
  await expect(page.locator('#drive-km')).toHaveText(km);
  await expect(page.locator('#drive-name')).toHaveText(name);
  await expect(page.locator('#drive-nav')).not.toHaveAttribute('aria-disabled', 'true');

  await page.click('#drive-next');
  await expect(page.locator('#drive-title')).toHaveText(/Borne suivante \(2 sur \d+\).*signal GPS perdu/);
  await expect(page.locator('#drive-nav')).not.toHaveAttribute('aria-disabled', 'true');

  await page.click('#drive-nearby');
  await expect(page.locator('#nearby-list li').first()).toBeVisible();
  await expect(page.locator('#nearby-summary')).not.toHaveText(/Position indisponible/);
  await page.click('#back-btn');

  // Signal back: the hint goes away without any tap.
  await context.setGeolocation({ latitude: BOURGES[1], longitude: BOURGES[0] + 0.01, accuracy: 5 });
  await expect(page.locator('#drive-title')).not.toHaveText(/signal GPS perdu/);
  await expect(page.locator('#drive-title')).toHaveText(/Prochaine borne|Borne suivante/);

  // A refused permission is not a lost signal.
  await page.evaluate(() => /** @type {any} */ (window)._onGeoError({ code: 1, message: 'User denied Geolocation' }));
  await expect(page.locator('#drive-title')).toHaveText('Position GPS indisponible');
  await expect(page.locator('#drive-nav')).toHaveAttribute('aria-disabled', 'true');

  expect(errors).toEqual([]);
  await context.close();
});
