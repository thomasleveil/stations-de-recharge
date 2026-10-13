// @ts-check
// U-11 — unit tests of the shared navigation link builder (no browser needed).
import { test, expect } from '@playwright/test';
import NavLinks from '../nav-links.js';

const UA = {
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipadOs:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  mac:     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  tesla:   'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Tesla/2025.20',
};

const STATION = { lat: 47.0810123456, lon: 2.3988 };

test.describe('U-11 — NavLinks.detectPlatform', () => {
  test('iPhone → ios', () => {
    expect(NavLinks.detectPlatform({ userAgent: UA.iphone, maxTouchPoints: 5 })).toBe('ios');
  });
  test('iPadOS (desktop-class Safari, multi-touch) → ios', () => {
    expect(NavLinks.detectPlatform({ userAgent: UA.ipadOs, maxTouchPoints: 5 })).toBe('ios');
  });
  test('Mac without touch → desktop', () => {
    expect(NavLinks.detectPlatform({ userAgent: UA.mac, maxTouchPoints: 0 })).toBe('desktop');
  });
  test('Android → android', () => {
    expect(NavLinks.detectPlatform({ userAgent: UA.android, maxTouchPoints: 5 })).toBe('android');
  });
  test('Tesla browser (Linux) → desktop', () => {
    expect(NavLinks.detectPlatform({ userAgent: UA.tesla, maxTouchPoints: 10 })).toBe('desktop');
  });
});

test.describe('U-11 — NavLinks.resolveProvider', () => {
  test('auto: Apple Maps on iOS, Google Maps elsewhere', () => {
    expect(NavLinks.resolveProvider('auto', 'ios')).toBe('apple');
    expect(NavLinks.resolveProvider('auto', 'android')).toBe('google');
    expect(NavLinks.resolveProvider('auto', 'desktop')).toBe('google');
  });
  test('an explicit choice wins over the platform', () => {
    expect(NavLinks.resolveProvider('google', 'ios')).toBe('google');
    expect(NavLinks.resolveProvider('waze', 'ios')).toBe('waze');
    expect(NavLinks.resolveProvider('apple', 'android')).toBe('apple');
  });
  test('unknown or missing choice falls back to auto', () => {
    expect(NavLinks.resolveProvider('bogus', 'ios')).toBe('apple');
    expect(NavLinks.resolveProvider(null, 'desktop')).toBe('google');
    expect(NavLinks.resolveProvider('__proto__', 'desktop')).toBe('google');
  });
});

test.describe('U-11 — NavLinks.navUrl', () => {
  test('Apple Maps: unified /directions, driving, raw comma', () => {
    expect(NavLinks.navUrl(STATION, 'apple'))
      .toBe('https://maps.apple.com/directions?destination=47.081012,2.3988&mode=driving');
  });
  test('Google Maps: dir api=1, driving, turn-by-turn, encoded comma, no origin', () => {
    const url = NavLinks.navUrl(STATION, 'google');
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=47.081012%2C2.3988'
      + '&travelmode=driving&dir_action=navigate');
    // No origin: Google defaults to the device location, which is what makes
    // dir_action=navigate start turn-by-turn instead of a route preview.
    expect(new URL(url).searchParams.has('origin')).toBe(false);
  });
  test('Waze: ul, ll + navigate=yes', () => {
    expect(NavLinks.navUrl(STATION, 'waze'))
      .toBe('https://waze.com/ul?ll=47.081012%2C2.3988&navigate=yes');
  });
  test('negative longitude (Brittany) survives every format', () => {
    const rennes = { lat: 48.1173, lon: -1.6778 };
    expect(new URL(NavLinks.navUrl(rennes, 'apple')).searchParams.get('destination')).toBe('48.1173,-1.6778');
    expect(new URL(NavLinks.navUrl(rennes, 'google')).searchParams.get('destination')).toBe('48.1173,-1.6778');
    expect(new URL(NavLinks.navUrl(rennes, 'waze')).searchParams.get('ll')).toBe('48.1173,-1.6778');
  });
  test('every URL is https, never geo:', () => {
    for (const p of ['apple', 'google', 'waze']) {
      expect(NavLinks.navUrl(STATION, p)).toMatch(/^https:\/\//);
    }
  });
});
