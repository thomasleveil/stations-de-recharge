// ── Operator definitions ──────────────────────────────────────

const OPERATORS = [
  { match: ['totalenergies'],      name: 'TotalEnergies',    color: '#F97316' },
  { match: ['ionity'],             name: 'IONITY',           color: '#1D4ED8' },
  { match: ['allego', 'electra'],  name: 'Allego / Electra', color: '#16A34A' },
  { match: ['fastned'],            name: 'Fastned',          color: '#DC2626' },
  { match: ['engie', 'vianeo'],    name: 'ENGIE Vianeo',     color: '#7C3AED' },
  { match: ['tesla'],              name: 'Tesla',            color: '#B91C1C' },
  { match: ['zunder'],             name: 'Zunder',           color: '#0891B2' },
  { match: ['e-vadea', 'vadea'],   name: 'e-Vadea',          color: '#2563EB' },
  { match: ['atlante'],            name: 'Atlante',          color: '#D97706' },
  { match: ['plenitude'],          name: 'Plenitude',        color: '#059669' },
  { match: ['bp pulse', 'bp '],    name: 'bp pulse',         color: '#10B981' },
];

// Try enseigne first, fall back to operateur field
function getOperator(props) {
  const candidates = [props.enseigne || '', props.operateur || ''];
  for (const text of candidates) {
    const t = text.toLowerCase();
    for (const op of OPERATORS) {
      if (op.match.some(m => t.includes(m))) return op;
    }
  }
  return { name: props.enseigne || props.operateur || 'Autre', color: '#6B7280' };
}


// ── Marker sizing (radius in px) ──────────────────────────────

function countRadius(n) {
  // Log2 scale: 1 PDC → 8px, 4 → 10px, 8 → 12px, 16+ → 14px
  return 6 + Math.log2((n || 1) + 1) * 2;
}

// ── Map initialisation ────────────────────────────────────────

const map = L.map('map', {
  center: [45.1, 4.8],
  zoom: 7,
  zoomControl: true,
});

L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '© <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }
).addTo(map);


// ── Route state (declared early — used by isVisible) ─────────

const ROUTE_BUFFER_KM = 0.2;
let routeActive = false;
let routeLayer  = null;

// ── Draw markers ──────────────────────────────────────────────

const markers = [];

STATIONS_DATA.features.forEach(feature => {
  const p = feature.properties;
  const op = getOperator(p);
  const [lon, lat] = feature.geometry.coordinates;

  const displayCount = p.nbre_ccs_fast > 0 ? p.nbre_ccs_fast : (parseInt(p.nbre_pdc) || 1);
  const circle = L.circleMarker([lat, lon], {
    radius:      countRadius(displayCount),
    fillColor:   op.color,
    color:       '#ffffff',
    weight:      2,
    opacity:     1,
    fillOpacity: 0.9,
    interactive: true,
  });

  circle.bindPopup(L.popup({ maxWidth: 300 }).setContent(buildPopup(p, op)));
  circle.bindTooltip(p.nom_station, {
    direction: 'top',
    offset: [0, -8],
  });

  circle._op   = op;
  circle._type = p.station_type || 'dedicee';
  circle._lon  = lon;
  circle._lat  = lat;
  circle.addTo(map);
  markers.push(circle);
});

// ── Visibility + legend (reactive) ───────────────────────────

const subEl    = document.querySelector('.panel-sub');
const legendEl = document.getElementById('legend-items');

function isVisible(m) {
  const includeParking = document.getElementById('check-parking').checked;
  const typeOk  = m._type === 'dedicee' || includeParking;
  const routeOk = !routeActive || (m._distFromRoute !== undefined && m._distFromRoute <= ROUTE_BUFFER_KM);
  return typeOk && routeOk;
}

function updateVisibility() {
  let count = 0;
  markers.forEach(m => {
    const visible = isVisible(m);
    if (visible) count++;
    m.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? 0.9 : 0 });
    const el = m.getElement();
    if (el) el.style.pointerEvents = visible ? '' : 'none';
  });

  if (routeActive) {
    subEl.textContent = `${count} station${count !== 1 ? 's' : ''} sur le trajet`;
  } else {
    subEl.textContent = `${count} station${count !== 1 ? 's' : ''} · CCS ≥ 150 kW`;
  }

  updateLegend();
}

function updateLegend() {
  legendEl.innerHTML = '';

  // Count visible stations per operator
  const opCounts = new Map();
  let autreCount = 0;
  markers.forEach(m => {
    if (!isVisible(m)) return;
    // Known operator?
    const isKnown = OPERATORS.some(op => op.name === m._op.name);
    if (isKnown) {
      const key = m._op.name;
      if (!opCounts.has(key)) opCounts.set(key, { op: m._op, count: 0 });
      opCounts.get(key).count++;
    } else {
      autreCount++;
    }
  });

  // Render in predefined order
  OPERATORS.forEach(op => {
    const entry = opCounts.get(op.name);
    if (!entry) return;
    appendLegendItem(op.name, op.color, entry.count);
  });

  // Catch-all "Autre"
  if (autreCount > 0) appendLegendItem('Autre', '#6B7280', autreCount);
}

function appendLegendItem(name, color, count) {
  const div = document.createElement('div');
  div.className = 'legend-item';
  div.innerHTML =
    `<div class="legend-dot" style="background:${color}"></div>` +
    `<span class="legend-name">${name}</span>` +
    `<span class="legend-count">${count}</span>`;
  legendEl.appendChild(div);
}

// Initial render
updateVisibility();

// ── Popup builder ─────────────────────────────────────────────

function buildPopup(p, op) {
  const fmt = (v, fallback = '—') => (v && String(v).trim()) ? v : fallback;
  const hours = fmt(p.horaires);
  const shortHours = hours.length > 50 ? hours.slice(0, 50) + '…' : hours;
  const addr = fmt(p.adresse);
  const shortAddr = addr.length > 60 ? addr.slice(0, 60) + '…' : addr;
  const typeLabel = p.station_type === 'parking' ? 'Parking privé' : 'Aire dédiée';

  return `
    <div>
      <div class="popup-station">${fmt(p.nom_station)}</div>
      <span class="popup-operator-badge" style="background:${op.color}">${op.name}</span>
      <div class="popup-grid">
        <span class="popup-label">Type</span>
        <span>${typeLabel}</span>

        <span class="popup-label">Puissance max</span>
        <span class="popup-power">${p.max_power_kw} kW</span>

        <span class="popup-label">Bornes CCS ≥ 150 kW</span>
        <span>${p.nbre_ccs_fast > 0 ? p.nbre_ccs_fast : '—'}</span>

        <span class="popup-label">Nb. de bornes total</span>
        <span>${fmt(p.nbre_pdc)}</span>

        <span class="popup-label">Horaires</span>
        <span>${shortHours}</span>

        <span class="popup-label">Adresse</span>
        <span>${shortAddr}</span>
      </div>
    </div>`;
}

// ── Route planning ────────────────────────────────────────────

async function geocode(query) {
  const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const opts = { headers: { 'Accept-Language': 'fr' } };
  // Nominatim occasionally fails on first cold-connection attempt (rate-limit
  // or missing CORS header on error response).  Retry once after a short pause.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r    = await fetch(url, opts);
      const data = await r.json();
      if (!data.length) throw new Error(`"${query}" introuvable`);
      return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
    } catch (e) {
      if (attempt === 1 || e.message.includes('introuvable')) throw e;
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

async function fetchRoute(from, to) {
  const r = await fetch(
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`
  );
  const data = await r.json();
  if (data.code !== 'Ok') throw new Error('Itinéraire introuvable');
  return data.routes[0];
}

async function applyRouteFilter(routeLine, onProgress) {
  // Pass 1 — fast pre-filter using a simplified route geometry.
  // turf.nearestPointOnLine is O(route_segments) per station; OSRM's full-
  // resolution geometry can have 10 000–50 000 points for a long route.
  // Simplifying to ~500 representative points cuts the work by ~50–100×.
  // tolerance 0.001° ≈ 111 m, so we widen the candidate threshold by that
  // amount to avoid false negatives at the corridor boundary.
  const SIMPLIFICATION_ERROR_KM = 0.15; // generous margin for 0.001° tolerance
  const simplified = turf.simplify(routeLine, { tolerance: 0.001, highQuality: false });

  const candidates = [];
  const CHUNK = 500;
  for (let i = 0; i < markers.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, markers.length);
    for (let j = i; j < end; j++) {
      const m = markers[j];
      const snap = turf.nearestPointOnLine(simplified, turf.point([m._lon, m._lat]), { units: 'kilometers' });
      if (snap.properties.dist <= ROUTE_BUFFER_KM + SIMPLIFICATION_ERROR_KM) {
        candidates.push(m);
      } else {
        m._distFromRoute  = snap.properties.dist; // definitely outside — store for completeness
        m._distAlongRoute = snap.properties.location;
      }
    }
    if (onProgress) onProgress(Math.round(end * 0.8), markers.length);
    await new Promise(r => requestAnimationFrame(r));
  }

  // Pass 2 — precise check on the small candidate set only.
  // Typically ≤ 100 stations for a 200 m corridor, so this is fast even with
  // the full-resolution route geometry.
  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    const snap = turf.nearestPointOnLine(routeLine, turf.point([m._lon, m._lat]), { units: 'kilometers' });
    m._distFromRoute  = snap.properties.dist;
    m._distAlongRoute = snap.properties.location;
  }
  if (onProgress) onProgress(markers.length, markers.length);

  updateVisibility();
}

function clearRoute() {
  routeActive = false;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  markers.forEach(m => { delete m._distFromRoute; delete m._distAlongRoute; });
  updateVisibility();
  document.getElementById('route-info').textContent = '';
  document.getElementById('route-clear').style.display = 'none';
  const btn = document.getElementById('route-go');
  btn.style.display = '';
  btn.disabled = false;
  btn.textContent = 'Calculer →';
}

document.getElementById('route-go').addEventListener('click', async () => {
  const startVal = document.getElementById('route-start').value.trim();
  const endVal   = document.getElementById('route-end').value.trim();
  if (!startVal || !endVal) return;

  const btn  = document.getElementById('route-go');
  const info = document.getElementById('route-info');
  btn.disabled = true;
  btn.textContent = '…';
  info.className = 'route-progress';

  // Yield to browser so each step label actually renders before the next await
  const step = msg => new Promise(r => {
    info.textContent = msg;
    requestAnimationFrame(() => requestAnimationFrame(r));
  });

  const t0 = performance.now();

  try {
    await step('📍 Géocodage du départ…');
    const t1 = performance.now();
    const from = await geocode(startVal);
    await step('📍 Géocodage de l\'arrivée…');
    const to = await geocode(endVal);
    console.log(`geocode: ${Math.round(performance.now() - t1)} ms`);

    await step('🗺 Calcul d\'itinéraire…');
    const t2 = performance.now();
    const route = await fetchRoute(from, to);
    console.log(`osrm: ${Math.round(performance.now() - t2)} ms`);

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(route.geometry, {
      style: { color: '#1D4ED8', weight: 4, opacity: 0.75 },
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });

    info.className = 'route-progress';
    info.textContent = `⚡ Filtrage 0/${markers.length}…`;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t3 = performance.now();
    routeActive = true;
    await applyRouteFilter(
      turf.lineString(route.geometry.coordinates),
      (done, total) => { info.textContent = `⚡ Filtrage ${done}/${total}…`; }
    );
    console.log(`applyRouteFilter: ${Math.round(performance.now() - t3)} ms`);

    console.log(`total: ${Math.round(performance.now() - t0)} ms`);

    const km = Math.round(route.legs.reduce((s, l) => s + l.distance, 0) / 1000);
    info.className = 'route-stat';
    info.textContent = `${km} km · corridor ±${ROUTE_BUFFER_KM * 1000} m`;

    document.getElementById('route-clear').style.display = '';
    btn.style.display = 'none';
  } catch (e) {
    info.className = 'route-error';
    info.textContent = '⚠ ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Calculer →';
  }
});

document.getElementById('route-clear').addEventListener('click', clearRoute);

document.getElementById('check-parking').addEventListener('change', updateVisibility);

['route-start', 'route-end'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('route-go').click();
  })
);

// Warm up the connection to Nominatim on first input focus so the TCP+TLS
// handshake is already done by the time the user clicks "Calculer".
let nominatimWarmedUp = false;
['route-start', 'route-end'].forEach(id =>
  document.getElementById(id).addEventListener('focus', () => {
    if (nominatimWarmedUp) return;
    nominatimWarmedUp = true;
    fetch('https://nominatim.openstreetmap.org/status.php', { method: 'HEAD' }).catch(() => {});
  }, { once: false })
);
