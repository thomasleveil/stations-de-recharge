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
 * Same as nearestDist but also returns the progress (0–1) of the nearest
 * projection along the polyline — used for staggered fade-in ordering.
 */
function nearestDistAndProgress(lon, lat, flat, len) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const K = 111.32;
  let minD2 = Infinity;
  let bestI = 0, bestT = 0;
  const numSegments = (len >>> 1) - 1; // number of segments
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
    if (d2 < minD2) { minD2 = d2; bestI = i >>> 1; bestT = t; }
  }
  const progress = numSegments > 0 ? (bestI + bestT) / numSegments : 0;
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
  const { routeFlat, stationsFlat, cheapStationsFlat, bufferKm } = data;
  const stationCount = stationsFlat.length >>> 1;
  const cheapCount   = cheapStationsFlat ? (cheapStationsFlat.length >>> 1) : 0;

  // Decimate the route to at most 1 000 points for a fast pre-filter pass.
  const DEC_TARGET   = 1000;
  const DEC_ERROR_KM = 1.2;
  const decFlat      = decimateFlat(routeFlat, DEC_TARGET);
  const prefilterBuffer = bufferKm + DEC_ERROR_KM;

  const results      = new Float32Array(stationCount);
  const progressFlat = new Float32Array(stationCount); // 0–1 progress along route
  const candidates   = []; // indices of main stations needing precise pass

  // ── Pass 1 : fast sweep (main stations) ───────────────────────────────
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

  // ── Pass 2 : precise check on candidates (main stations) ──────────────
  for (let k = 0; k < candidates.length; k++) {
    const i   = candidates[k];
    const lon = stationsFlat[i * 2], lat = stationsFlat[i * 2 + 1];
    const { dist, progress } = nearestDistAndProgress(lon, lat, routeFlat, routeFlat.length);
    results[i]      = dist;
    progressFlat[i] = progress;
  }

  // ── Cheap stations : two-pass (same algorithm, separate corridor) ──────
  // bufferKm for cheap is the full 10-km corridor — pass it via the same
  // bufferKm field; the cheap pre-filter uses a generous 1.2 km margin too.
  const CHEAP_CORRIDOR_KM = 10;
  const cheapResults      = new Float32Array(cheapCount);
  const cheapProgressFlat = new Float32Array(cheapCount); // 0–1 progress along route
  if (cheapCount > 0) {
    const cheapPrefilter = CHEAP_CORRIDOR_KM + DEC_ERROR_KM;
    const cheapCandidates = [];
    for (let i = 0; i < cheapCount; i++) {
      const lon = cheapStationsFlat[i * 2], lat = cheapStationsFlat[i * 2 + 1];
      const d   = nearestDist(lon, lat, decFlat, decFlat.length);
      if (d <= cheapPrefilter) {
        cheapCandidates.push(i);
      } else {
        cheapResults[i] = d;
      }
    }
    for (let k = 0; k < cheapCandidates.length; k++) {
      const i = cheapCandidates[k];
      const { dist, progress } = nearestDistAndProgress(
        cheapStationsFlat[i * 2], cheapStationsFlat[i * 2 + 1],
        routeFlat, routeFlat.length
      );
      cheapResults[i]      = dist;
      cheapProgressFlat[i] = progress;
    }
  }

  self.postMessage({ type: 'progress', done: stationCount, total: stationCount });

  // Transfer all result buffers (zero-copy)
  const transfers = [results.buffer, progressFlat.buffer];
  if (cheapCount > 0) transfers.push(cheapResults.buffer, cheapProgressFlat.buffer);
  self.postMessage(
    { type: 'done', results: results.buffer, progressFlat: progressFlat.buffer,
      cheapResults:      cheapCount > 0 ? cheapResults.buffer      : null,
      cheapProgressFlat: cheapCount > 0 ? cheapProgressFlat.buffer : null },
    transfers
  );
};
