'use strict';

/**
 * Nearest distance from point (lon, lat) to a polyline stored as a flat
 * Float64Array [lon0,lat0, lon1,lat1, …]. Returns distance in km.
 * Uses equirectangular approximation — accurate to ~0.1 % within France.
 */
function nearestDist(lon, lat, flat, len) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const K = 111.32; // km per degree
  let minD2 = Infinity;
  for (let i = 0; i < len - 2; i += 2) {
    const ax = flat[i],     ay = flat[i + 1];
    const bx = flat[i + 2], by = flat[i + 3];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0
      ? Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / len2))
      : 0;
    const ex = (ax + t * dx - lon) * cosLat * K;
    const ey = (ay + t * dy - lat) * K;
    const d2 = ex * ex + ey * ey;
    if (d2 < minD2) minD2 = d2;
  }
  return Math.sqrt(minD2);
}

/**
 * Stride-based decimation of a flat coord array down to at most maxPts points.
 * O(n), always includes the last coordinate.
 */
function decimateFlat(flat, maxPts) {
  const n = flat.length >>> 1;
  if (n <= maxPts) return flat;
  const stride = Math.ceil(n / maxPts);
  const out = new Float64Array((Math.ceil(n / stride) + 1) * 2);
  let ri = 0;
  for (let i = 0; i < n; i += stride) {
    out[ri++] = flat[i * 2];
    out[ri++] = flat[i * 2 + 1];
  }
  // Always include last point
  out[ri++] = flat[flat.length - 2];
  out[ri++] = flat[flat.length - 1];
  return out.subarray(0, ri);
}

self.onmessage = function ({ data }) {
  const { routeFlat, stationsFlat, bufferKm } = data;
  const stationCount = stationsFlat.length >>> 1;

  // Decimate the route to at most 1 000 points for a fast pre-filter pass.
  // At 1 000 samples the inter-sample distance is ≤ ~2 km for any French
  // route, so we add a 1.2 km margin to the candidate threshold to avoid
  // false negatives at the corridor boundary.
  const DEC_TARGET   = 1000;
  const DEC_ERROR_KM = 1.2;
  const decFlat      = decimateFlat(routeFlat, DEC_TARGET);
  const prefilterBuffer = bufferKm + DEC_ERROR_KM;

  const results    = new Float32Array(stationCount);
  const candidates = []; // indices of stations that need the precise pass

  // ── Pass 1 : fast sweep against decimated route ───────────────────────
  for (let i = 0; i < stationCount; i++) {
    const lon = stationsFlat[i * 2], lat = stationsFlat[i * 2 + 1];
    const d   = nearestDist(lon, lat, decFlat, decFlat.length);
    if (d <= prefilterBuffer) {
      candidates.push(i);
    } else {
      results[i] = d;
    }
    if ((i & 511) === 511) {
      self.postMessage({ type: 'progress', done: Math.round(i * 0.85), total: stationCount });
    }
  }

  // ── Pass 2 : precise check on candidate set against full-res route ────
  for (let k = 0; k < candidates.length; k++) {
    const i   = candidates[k];
    results[i] = nearestDist(stationsFlat[i * 2], stationsFlat[i * 2 + 1], routeFlat, routeFlat.length);
  }

  self.postMessage({ type: 'progress', done: stationCount, total: stationCount });
  // Transfer results buffer (zero-copy)
  self.postMessage({ type: 'done', results: results.buffer }, [results.buffer]);
};
