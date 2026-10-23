'use strict';

/**
 * Nearest distance (km) from point (lon, lat) to a polyline stored as a flat
 * Float64Array [lon0,lat0, lon1,lat1, …].
 * Uses equirectangular approximation — accurate to ~0.1 % within France.
 */
function nearestDist(lon, lat, flat, len) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const K = 111.32; // km per degree
  let minD2 = Infinity;
  for (let i = 0; i < len - 2; i += 2) {
    const ax = flat[i],     ay = flat[i + 1];
    const bx = flat[i + 2], by = flat[i + 3];
    // Project in a local metric frame (lon scaled by cos(lat)), not raw degrees
    const dx = (bx - ax) * cosLat, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0
      ? Math.max(0, Math.min(1, ((lon - ax) * cosLat * dx + (lat - ay) * dy) / len2))
      : 0;
    const ex = (ax + t * (bx - ax) - lon) * cosLat * K;
    const ey = (ay + t * dy - lat) * K;
    const d2 = ex * ex + ey * ey;
    if (d2 < minD2) minD2 = d2;
  }
  return Math.sqrt(minD2);
}

/**
 * Cumulative length (km) of a flat polyline at each vertex: cum[k] is the
 * distance from the first point to point k. Same equirectangular approximation.
 * app.js (_routeCumKm) mirrors this formula to project the GPS position.
 */
function cumulativeKm(flat, len) {
  const K = 111.32;
  const n = len >>> 1;
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const ax = flat[2 * k - 2], ay = flat[2 * k - 1];
    const bx = flat[2 * k],     by = flat[2 * k + 1];
    const ex = (bx - ax) * Math.cos((ay + by) * Math.PI / 360) * K;
    const ey = (by - ay) * K;
    cum[k] = cum[k - 1] + Math.sqrt(ex * ex + ey * ey);
  }
  return cum;
}

/**
 * Same as nearestDist but also returns the progress (0–1) of the nearest
 * projection along the polyline, proportional to distance travelled
 * (cumKm from cumulativeKm). OSRM segments vary a lot in length, so the
 * segment index is not a usable proxy (B-7).
 */
function nearestDistAndProgress(lon, lat, flat, len, cumKm) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const K = 111.32;
  let minD2 = Infinity;
  let bestI = 0, bestT = 0;
  for (let i = 0; i < len - 2; i += 2) {
    const ax = flat[i],     ay = flat[i + 1];
    const bx = flat[i + 2], by = flat[i + 3];
    const dx = (bx - ax) * cosLat, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0
      ? Math.max(0, Math.min(1, ((lon - ax) * cosLat * dx + (lat - ay) * dy) / len2))
      : 0;
    const ex = (ax + t * (bx - ax) - lon) * cosLat * K;
    const ey = (ay + t * dy - lat) * K;
    const d2 = ex * ex + ey * ey;
    if (d2 < minD2) { minD2 = d2; bestI = i >>> 1; bestT = t; }
  }
  const totalKm = cumKm[cumKm.length - 1];
  const progress = totalKm > 0
    ? (cumKm[bestI] + bestT * (cumKm[bestI + 1] - cumKm[bestI])) / totalKm
    : 0;
  return { dist: Math.sqrt(minD2), progress };
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
  const DEC_TARGET   = 1000;
  const DEC_ERROR_KM = 1.2;
  const decFlat      = decimateFlat(routeFlat, DEC_TARGET);
  const prefilterBuffer = bufferKm + DEC_ERROR_KM;

  const results      = new Float32Array(stationCount);
  const progressFlat = new Float32Array(stationCount); // 0–1 progress along route
  const candidates   = []; // indices needing precise pass

  // ── Pass 1 : fast sweep ──────────────────────────────────────────────
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

  // ── Pass 2 : precise check on candidates ─────────────────────────────
  const cumKm = cumulativeKm(routeFlat, routeFlat.length);
  for (let k = 0; k < candidates.length; k++) {
    const i   = candidates[k];
    const lon = stationsFlat[i * 2], lat = stationsFlat[i * 2 + 1];
    const { dist, progress } = nearestDistAndProgress(lon, lat, routeFlat, routeFlat.length, cumKm);
    results[i]      = dist;
    progressFlat[i] = progress;
  }

  self.postMessage({ type: 'progress', done: stationCount, total: stationCount });

  // Transfer result buffers (zero-copy)
  self.postMessage(
    { type: 'done', results: results.buffer, progressFlat: progressFlat.buffer },
    [results.buffer, progressFlat.buffer]
  );
};
