// @ts-check
// When OSRM or Photon fails, the trip planner must tell the user in plain
// French, never surface a raw "Failed to fetch" or a JSON SyntaxError, and
// never throw an uncaught error.
import { test, expect } from '@playwright/test';
import { openApp, mockServices, RENNES } from './helpers/app.js';

const OSRM = '**/route/v1/driving/**';
const RAW = /Unexpected token|is not valid JSON|Failed to fetch|NetworkError|TypeError|SyntaxError/;

/** @param {import('@playwright/test').Page} page */
async function pickLyon(page) {
  await page.locator('#dest-input').fill('Lyon');
  await page.locator('#dest-list [role="option"]').first().click();
}

test.describe('service failures', () => {
  test.setTimeout(60_000);

  /** @type {[string, (r: import('@playwright/test').Route) => Promise<void>, RegExp][]} */
  const cases = [
    ['OSRM answers 503 with a non-JSON body', r => r.fulfill({ status: 503, body: 'down' }),
      /Le calcul d'itinéraire est indisponible/],
    ['OSRM is unreachable', r => r.abort('internetdisconnected'),
      /Le calcul d'itinéraire est indisponible/],
    ['OSRM cannot route the trip', r => r.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ code: 'NoRoute', message: 'Impossible route between points' }) }),
      /Itinéraire introuvable/],
  ];
  for (const [name, handler, expected] of cases) {
    test(`${name}: plain message, no uncaught error`, async ({ browser }) => {
      const { context, page, errors } = await openApp(browser);
      await page.route(OSRM, handler); // registered last, so it wins over the mock
      await pickLyon(page);
      const msg = page.locator('#plan-msg');
      await expect(msg).toHaveText(expected);
      await expect(msg).not.toHaveText(RAW);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test('Photon down on a shared link: plain message, no uncaught error', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: RENNES[1], longitude: RENNES[0], accuracy: 5 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await mockServices(page);
    await page.route('**/photon.komoot.io/**', r => r.abort('internetdisconnected'));
    // A link with a destination name but no coordinates has to be geocoded.
    await page.goto('/?to=Lyon');
    const msg = page.locator('#plan-msg');
    await expect(msg).toHaveText(/La recherche d'adresse est indisponible/, { timeout: 45_000 });
    await expect(msg).not.toHaveText(RAW);
    expect(errors).toEqual([]);
    await context.close();
  });
});
