// U-11 — Navigation handoff: builds the https link that opens turn-by-turn
// navigation to a station in the driver's maps app. Shared by every « Y aller »
// entry point (popup, route results, drive mode, emergency mode).
//
// Formats, checked against each provider's documentation:
//   Apple Maps  https://maps.apple.com/directions?destination=LAT,LON&mode=driving
//               developer.apple.com/documentation/mapkit/unified-map-urls (iOS 18.4+)
//   Google Maps https://www.google.com/maps/dir/?api=1&destination=LAT%2CLON&travelmode=driving&dir_action=navigate
//               developers.google.com/maps/documentation/urls/get-started
//   Waze        https://waze.com/ul?ll=LAT%2CLON&navigate=yes
//               developers.google.com/waze/deeplinks
//
// Each URL copies the encoding of its provider's own examples: Apple keeps the
// raw comma, Google asks for %2C, Waze's sample uses %2C.
//
// Classic script (no build step): defines the global `NavLinks` for app.js and
// exports it under CommonJS for the unit tests.

const NavLinks = (function () {
  const STORAGE_KEY = 'irve-nav-provider';

  const PROVIDERS = {
    apple:  { name: 'Plans',       label: 'Plans (Apple)' },
    google: { name: 'Google Maps', label: 'Google Maps' },
    waze:   { name: 'Waze',        label: 'Waze' },
  };

  /** 'ios' | 'android' | 'desktop', from a navigator-like object. */
  function detectPlatform(nav) {
    const ua = (nav && nav.userAgent) || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
    // iPadOS 13+ Safari presents itself as a Mac; multi-touch gives it away.
    if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  /** User choice ('auto' or a provider key) → provider key for this platform. */
  function resolveProvider(choice, platform) {
    if (Object.prototype.hasOwnProperty.call(PROVIDERS, choice)) return choice;
    return platform === 'ios' ? 'apple' : 'google';
  }

  // 6 decimals ≈ 0.1 m; drops the float noise of the IRVE coordinates.
  function coord(lat, lon) {
    return `${+Number(lat).toFixed(6)},${+Number(lon).toFixed(6)}`;
  }

  /** Turn-by-turn navigation URL from the current position to `dest` ({ lat, lon }). */
  function navUrl(dest, provider) {
    const d = coord(dest.lat, dest.lon);
    switch (provider) {
      case 'apple':
        return `https://maps.apple.com/directions?destination=${d}&mode=driving`;
      case 'waze':
        return `https://waze.com/ul?ll=${encodeURIComponent(d)}&navigate=yes`;
      default:
        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(d)}`
          + '&travelmode=driving&dir_action=navigate';
    }
  }

  function providerName(provider) {
    return (PROVIDERS[provider] || PROVIDERS.google).name;
  }

  return { STORAGE_KEY, PROVIDERS, detectPlatform, resolveProvider, navUrl, providerName };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = NavLinks;
