// ── Constants ─────────────────────────────────────────────────────────────

const PARQUET_URL      = 'https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet';
const CACHE_DB         = 'irve-v1';
const CACHE_TTL        = 24 * 60 * 60 * 1000; // 24 hours in ms
const PARQUET_ETAG_KEY = 'irve-parquet-etag';  // T-3 — localStorage key for ETag/Last-Modified

// U-10 — CHEAP corridor (km on each side of route). Persisted in localStorage.
let CHEAP_CORRIDOR_KM = Math.max(1, Math.min(50,
  parseFloat(localStorage.getItem('irve-cheap-corridor-km')) || 10));

// F-3 — Minimum power filter (kW). Persisted in localStorage.
let MIN_POWER_KW = parseInt(localStorage.getItem('irve-min-power-kw'), 10) || 150;

// TomTom API key for real-time charging availability (free tier: 2500 req/day).
// Set via the ⚙ settings menu — persisted in localStorage.
let TOMTOM_API_KEY = localStorage.getItem('irve-tomtom-key') || '';

// ── Operator definitions ──────────────────────────────────────────────────

const OPERATORS = [
  { match: ['totalenergies'],      name: 'TotalEnergies',    color: '#F97316', price: { tier: 2, range: '0.39–0.59 €/kWh', note: '' }, alerts: [{ icon: '⚠️', text: 'Frais de stationnement après 45 min' }] },
  { match: ['ionity'],             name: 'IONITY',           color: '#1D4ED8', price: { tier: 3, range: '0.69–0.79 €/kWh', note: '0.39 avec Passport' }, alerts: [{ icon: '💸', text: 'Tarif élevé sans abonnement Passport' }] },
  { match: ['allego', 'electra'],  name: 'Allego / Electra', color: '#16A34A', price: { tier: 2, range: '0.29–0.49 €/kWh', note: '0.29 avec abo Electra+' } },
  { match: ['fastned'],            name: 'Fastned',          color: '#DC2626', price: { tier: 3, range: '0.59–0.69 €/kWh', note: '0.45 avec Gold' } },
  { match: ['engie', 'vianeo'],    name: 'ENGIE Vianeo',     color: '#7C3AED', price: { tier: 2, range: '0.40–0.50 €/kWh', note: '' } },
  { match: ['tesla'],              name: 'Tesla',            color: '#B91C1C', price: { tier: 3, range: '0.36–0.67 €/kWh', note: 'Prix dynamique' }, alerts: [{ icon: '📈', text: 'Prix dynamique variable' }] },
  { match: ['zunder'],             name: 'Zunder',           color: '#0891B2', price: { tier: 1, range: '0.29–0.39 €/kWh', note: '' } },
  { match: ['e-vadea', 'vadea'],   name: 'e-Vadea',          color: '#2563EB', price: { tier: 2, range: '0.40–0.50 €/kWh', note: '' } },
  { match: ['atlante'],            name: 'Atlante',          color: '#D97706', price: { tier: 2, range: '0.35–0.50 €/kWh', note: '' } },
  { match: ['plenitude'],          name: 'Plenitude',        color: '#059669', price: { tier: 2, range: '0.39–0.49 €/kWh', note: '' } },
  { match: ['bp pulse', 'bp '],    name: 'bp pulse',         color: '#10B981', price: { tier: 2, range: '0.39–0.49 €/kWh', note: '' } },
  { match: ['iecharge', 'ie charge', 'ie-charge'], name: 'IECharge',    color: '#06B6D4', price: { tier: 2, range: '0.39–0.49 €/kWh', note: '' } },
  { match: ['izivia'],                             name: 'IZIVIA Fast', color: '#F59E0B', price: { tier: 2, range: '0.40–0.50 €/kWh', note: '' } },
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

// P1 — Navigation URL: native geo: on touch devices, Google Maps elsewhere
function navUrl(lat, lon) {
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    return `geo:${lat},${lon}?q=${lat},${lon}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}


// ── Marker sizing (radius in px) ──────────────────────────────────────────

function countRadius(n) {
  // Log2 scale: 1 PDC → 8px, 4 → 10px, 8 → 12px, 16+ → 14px
  return 6 + Math.log2((n || 1) + 1) * 2;
}

// ── Map initialisation ────────────────────────────────────────────────────

const _savedLat  = parseFloat(localStorage.getItem('irve-map-lat'))  || 45.1;
const _savedLon  = parseFloat(localStorage.getItem('irve-map-lon'))  || 4.8;
const _savedZoom = parseInt(localStorage.getItem('irve-map-zoom'), 10) || 7;

const CARTO_STYLE = {
  version: 8,
  sources: {
    'carto-light': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
        '© <a href="https://carto.com/attributions">CARTO</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'carto-light', type: 'raster', source: 'carto-light' }],
};

const map = new maplibregl.Map({
  container: 'map',
  style: CARTO_STYLE,
  center: [_savedLon, _savedLat],  // MapLibre uses [lng, lat]
  zoom: _savedZoom,
});
window._map = map;  // exposed for Playwright tests
map.addControl(new maplibregl.NavigationControl(), 'top-right');

let _saveMapTimer = null;
function _saveMapPosition() {
  clearTimeout(_saveMapTimer);
  _saveMapTimer = setTimeout(() => {
    const c = map.getCenter();
    localStorage.setItem('irve-map-lat',  c.lat.toFixed(6));
    localStorage.setItem('irve-map-lon',  c.lng.toFixed(6));
    localStorage.setItem('irve-map-zoom', map.getZoom());
  }, 500);
}
map.on('moveend', _saveMapPosition);
map.on('zoomend', _saveMapPosition);

// ── Route state (declared early — used by isVisible) ──────────────────────

let ROUTE_BUFFER_KM = 0.2;
let routeActive = false;
let _markersReady    = false; // set true after initApp() resolves
let _autoCalcOnReady = false; // set true when URL params want auto-calc but markers not yet ready
let _hoverPopup    = null;    // tooltip popup on stations-layer hover
let _currentPopup  = null;    // last opened station popup (auto-close on new click)

// ── Draw markers (populated asynchronously by initApp) ────────────────────

const markers = [];
const cheapMarkers = [];

// ── Visibility + legend (reactive) ───────────────────────────────────────

const subEl    = document.querySelector('.panel-sub');
const legendEl = document.getElementById('legend-items');

// Piste 2.2 — delta-updates state: Sets of currently visible markers.
// null = uninitialised (first call applies to all; subsequent calls diff).
let _prevVisMain  = null;
let _prevVisCheap = null;

function isVisible(m) {
  // F-3 — minimum power filter
  if (m._maxPowerKw !== undefined && m._maxPowerKw < MIN_POWER_KW) return false;
  if (emergencyModeActive && _emergencyMarkers.has(m)) return true;
  return !routeActive || (m._distFromRoute !== undefined && m._distFromRoute <= ROUTE_BUFFER_KM);
}

function isCheapVisible(m) {
  return !routeActive || (m._distFromRoute !== undefined && m._distFromRoute <= CHEAP_CORRIDOR_KM);
}

function updateVisibility() {
  // Compute visible sets
  const nextVisMain  = new Set();
  const nextVisCheap = new Set();
  let count = 0;
  for (const m of markers)      { if (isVisible(m))      { nextVisMain.add(m);  count++; } }
  for (const m of cheapMarkers) { if (isCheapVisible(m)) { nextVisCheap.add(m); } }

  const _hasPref = preferredNetworks.size > 0 && routeActive;

  // Build GeoJSON features for visible main markers
  const features = [];
  for (const m of nextVisMain) {
    const pref = _hasPref && preferredNetworks.has(m._op.name);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m._lon, m._lat] },
      properties: {
        idx:         m._idx,
        radius:      m._radius,
        color:       m._op.color,
        strokeColor: pref ? '#F59E0B' : '#ffffff',
        strokeWidth: pref ? 3 : 2,
      },
    });
  }
  const src = map.getSource('stations');
  if (src) src.setData({ type: 'FeatureCollection', features });

  // Cheap markers: show/hide via addTo/remove
  for (const m of cheapMarkers) {
    const vis    = nextVisCheap.has(m);
    const wasVis = _prevVisCheap !== null && _prevVisCheap.has(m);
    if (vis && !wasVis) m.addTo(map);
    else if (!vis && wasVis) m.remove();
  }

  _prevVisMain  = nextVisMain;
  _prevVisCheap = nextVisCheap;

  if (routeActive) {
    subEl.textContent = `${count} station${count !== 1 ? 's' : ''} sur le trajet`;
  } else {
    subEl.textContent = `${count} station${count !== 1 ? 's' : ''} · CCS ≥ ${MIN_POWER_KW} kW`;
  }

  updateLegend(_prevVisMain, _prevVisCheap);
}

// Piste 3.2 — legend hash cache: avoid DOM rebuild when nothing changed.
let _lastLegendKey = '';

function updateLegend(visMain, visCheap) {
  // Count visible stations per operator (main CCS markers)
  // When called with pre-computed sets from updateVisibility(), use them directly
  // instead of re-iterating all markers with isVisible().
  const opCounts = new Map();
  let autreCount = 0;
  const mainSource = visMain || markers;
  for (const m of mainSource) {
    if (!visMain && !isVisible(m)) continue;
    const isKnown = OPERATORS.some(op => op.name === m._op.name);
    if (isKnown) {
      const key = m._op.name;
      if (!opCounts.has(key)) opCounts.set(key, { op: m._op, count: 0 });
      opCounts.get(key).count++;
    } else {
      autreCount++;
    }
  }

  // Build cheap counts (always, even when not route active — needed for fingerprint)
  const cheapOpCounts = new Map();
  if (routeActive) {
    const cheapSource = visCheap || cheapMarkers;
    for (const m of cheapSource) {
      if (!visCheap && !isCheapVisible(m)) continue;
      const key = m._op.name;
      if (!cheapOpCounts.has(key)) cheapOpCounts.set(key, { op: m._op, count: 0 });
      cheapOpCounts.get(key).count++;
    }
  }

  // Fingerprint: routeActive flag + sorted operator:count pairs (main + cheap)
  const mainPart  = [...opCounts.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1)
    .map(([k,v]) => `${k}:${v.count}`).join(',');
  const cheapPart = [...cheapOpCounts.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1)
    .map(([k,v]) => `${k}:${v.count}`).join(',');
  const key = `${routeActive ? 1 : 0}|${autreCount}|${mainPart}|${cheapPart}`;

  if (key === _lastLegendKey) return;
  _lastLegendKey = key;

  // DOM rebuild (only when fingerprint changed)
  legendEl.innerHTML = '';

  [...opCounts.values()]
    .sort((a, b) => b.count - a.count)
    .forEach(({ op, count }) => appendLegendItem(op.name, op.color, count, false));

  if (autreCount > 0) appendLegendItem('Autre', '#6B7280', autreCount, false);

  if (routeActive && cheapOpCounts.size > 0) {
    const hr = document.createElement('hr');
    hr.style.cssText = 'border:none;border-top:1px solid #e2e8f0;margin:6px 0';
    legendEl.appendChild(hr);
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#9ca3af;margin-bottom:4px;font-style:italic';
    label.textContent = `€ Abordables (±${CHEAP_CORRIDOR_KM} km)`;
    legendEl.appendChild(label);
    [...cheapOpCounts.values()]
      .sort((a, b) => b.count - a.count)
      .forEach(({ op, count }) => appendLegendItem(op.name, op.color, count, true));
  }

}

function appendLegendItem(name, color, count, cheap) {
  const div = document.createElement('div');
  div.className = 'legend-item';
  const brandHtml = cheap && BRAND_MARKER_HTML[name];
  const dotHtml = brandHtml
    ? `<div style="width:14px;height:14px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center"><div style="transform:scale(0.78);transform-origin:center">${brandHtml}</div></div>`
    : `<div class="${cheap ? 'legend-dot legend-dot-cheap' : 'legend-dot'}" style="${cheap ? `border-color:${color}` : `background:${color}`}"></div>`;
  div.innerHTML =
    dotHtml +
    `<span class="legend-name">${name}</span>` +
    `<span class="legend-count">${count}</span>`;
  legendEl.appendChild(div);
}

// ── IndexedDB cache helpers ───────────────────────────────────────────────

function openCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('data');
    req.onsuccess       = e => resolve(e.target.result);
    req.onerror         = e => reject(e.target.error);
  });
}

async function cacheGet(key) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const req = db.transaction('data', 'readonly').objectStore('data').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function cachePut(key, value) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const req = db.transaction('data', 'readwrite').objectStore('data').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── DuckDB WASM filter SQL ────────────────────────────────────────────────
// Unified query — returns all relevant stations in a single pass.
// cheap = FALSE → CCS2 fast station (≥ 150 kW, 24/7, no Tesla)
// cheap = TRUE  → budget-network station (B&B Hotel, IECharge, IZIVIA/McDonald's, Tesla)
// When a station qualifies for BOTH, cheap = FALSE wins (fast takes priority, no duplicate).

const UNIFIED_SQL = `
WITH lat_lon AS (
    SELECT *,
        TRY_CAST(consolidated_latitude  AS DOUBLE) AS lat,
        TRY_CAST(consolidated_longitude AS DOUBLE) AS lon,
        TRY_CAST(
            REPLACE(COALESCE(CAST(puissance_nominale AS VARCHAR), '0'), ',', '.')
            AS DOUBLE
        ) AS power_kw
    FROM read_parquet('irve_raw.parquet')
    WHERE condition_acces = 'Accès libre'
),
-- CCS2 fast qualifiers (>= 150 kW, 24/7, CCS, not Tesla)
ccs_qualifying AS (
    SELECT * FROM lat_lon
    WHERE power_kw >= 150
      AND prise_type_combo_ccs = TRUE
      AND TRIM(COALESCE(horaires, '')) = '24/7'
      AND id_station_itinerance NOT LIKE 'FRTSL%'
),
fast_sids AS (
    SELECT DISTINCT id_station_itinerance FROM ccs_qualifying
),
-- Budget-network operators (AFIREV prefix — more reliable than text fields)
--   FRVIA* + nom_station ILIKE '%B&B HOTEL%' → ENGIE Vianeo at B&B Hotels only
--   FRIEN* → IECharge       (operator code IEN)
--   FRIZF* → IZIVIA Fast    (operator code IZF — McDonald's only)
--   FRTSL* → Tesla          (Superchargers open to all EVs)
cheap_network_sids AS (
    SELECT DISTINCT id_station_itinerance FROM lat_lon
    WHERE (id_station_itinerance LIKE 'FRVIA%' AND nom_station ILIKE '%B&B HOTEL%')
       OR id_station_itinerance LIKE 'FRIEN%'
       OR id_station_itinerance LIKE 'FRIZF%'
       OR id_station_itinerance LIKE 'FRTSL%'
),
-- Merge: BOOL_AND returns FALSE if any entry is FALSE → fast wins over cheap
all_relevant AS (
    SELECT id_station_itinerance, BOOL_AND(cheap) AS cheap
    FROM (
        SELECT id_station_itinerance, FALSE AS cheap FROM fast_sids
        UNION ALL
        SELECT id_station_itinerance, TRUE  AS cheap FROM cheap_network_sids
    )
    GROUP BY id_station_itinerance
),
station_first AS (
    SELECT ll.* FROM lat_lon ll
    JOIN all_relevant ar ON ll.id_station_itinerance = ar.id_station_itinerance
    QUALIFY ROW_NUMBER() OVER (PARTITION BY ll.id_station_itinerance ORDER BY ll.id_pdc_itinerance) = 1
),
station_power AS (
    SELECT id_station_itinerance, MAX(power_kw) AS max_power_kw
    FROM lat_lon
    WHERE id_station_itinerance IN (SELECT id_station_itinerance FROM all_relevant)
    GROUP BY id_station_itinerance
),
station_ccs_fast AS (
    SELECT id_station_itinerance,
           COUNT(DISTINCT id_pdc_itinerance) AS nbre_ccs_fast
    FROM ccs_qualifying
    GROUP BY id_station_itinerance
),
truck_sids AS (
    SELECT DISTINCT id_station_itinerance FROM lat_lon
    WHERE lower(COALESCE(restriction_gabarit, '')) LIKE '%poids lourd%'
       OR lower(COALESCE(nom_station, ''))         LIKE '%truck%'
       OR lower(COALESCE(nom_station, ''))         LIKE '%camion%'
       OR lower(COALESCE(nom_station, ''))         LIKE '%poids lourd%'
)
SELECT
    sf.lon, sf.lat,
    sf.id_station_itinerance                                   AS id,
    COALESCE(sf.nom_station,    '')                            AS nom_station,
    COALESCE(sf.adresse_station,'')                            AS adresse,
    COALESCE(sf.nom_operateur,  '')                            AS operateur,
    COALESCE(NULLIF(sf.nom_enseigne,''), sf.nom_operateur, '') AS enseigne,
    COALESCE(CAST(sf.nbre_pdc AS VARCHAR), '')                 AS nbre_pdc,
    sp.max_power_kw,
    COALESCE(cf.nbre_ccs_fast, 0)                              AS nbre_ccs_fast,
    COALESCE(sf.horaires, '')                                  AS horaires,
    ar.cheap,
    CASE WHEN sf.implantation_station = 'Station dédiée à la recharge rapide'
         THEN 'dedicee' ELSE 'parking'
    END AS station_type
FROM station_first sf
JOIN all_relevant      ar ON sf.id_station_itinerance = ar.id_station_itinerance
JOIN station_power     sp ON sf.id_station_itinerance = sp.id_station_itinerance
LEFT JOIN station_ccs_fast cf ON sf.id_station_itinerance = cf.id_station_itinerance
LEFT JOIN truck_sids       ts ON sf.id_station_itinerance = ts.id_station_itinerance
WHERE sf.lat IS NOT NULL AND sf.lat != 0
  AND sf.lon IS NOT NULL AND sf.lon != 0
  AND ts.id_station_itinerance IS NULL
ORDER BY sf.id_station_itinerance
`;

// ── Marker builder (shared between cache hit and fresh fetch paths) ───────

function buildMarkers(rows) {
  _prevVisMain = null; // reset delta-update state on marker rebuild
  // D-3 — Deduplicate: some operators (e.g. Allego) register each PDC as a
  // separate id_station_itinerance. Collapse to one entry per (operator, ~coords),
  // keeping the row with the highest max_power_kw.
  const _locSeen = new Map();
  for (const r of rows) {
    const key = `${r.operateur}|${Math.round(r.lat * 1e4)}|${Math.round(r.lon * 1e4)}`;
    const ex = _locSeen.get(key);
    if (!ex || r.max_power_kw > ex.max_power_kw) _locSeen.set(key, r);
  }
  for (const p of _locSeen.values()) {
    const op = getOperator(p);
    const displayCount = p.nbre_ccs_fast > 0 ? p.nbre_ccs_fast : (parseInt(p.nbre_pdc) || 1);
    const m = {
      _p:          p,           // raw row data (for popup building)
      _op:         op,
      _lon:        p.lon,
      _lat:        p.lat,
      _name:       p.nom_station,
      _maxPowerKw: p.max_power_kw,  // F-3 — used by isVisible() for power filtering
      _nbrePdc:    parseInt(p.nbre_pdc) || 0,
      _radius:     countRadius(displayCount),
      _idx:        markers.length,  // stable index for GeoJSON feature lookup
    };
    markers.push(m);
  }
  // GeoJSON source is populated by updateVisibility()
}

// ── Budget network marker builder ─────────────────────────────────────────

// Unified brand icon HTML (18×18px) — used for both map markers and legend.
// McDonald's + Tesla: official SVG paths from Simple Icons (simpleicons.org, viewBox 0 0 24 24).
// IECharge + B&B Hotels: not in major icon libraries — custom icons using confirmed brand colors.
const BRAND_MARKER_HTML = {
  "IZIVIA Fast - McDonald's":
    "<div style='width:11px;height:11px;background:#DA291C;border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;opacity:0.75'><svg width='8' height='8' viewBox='0 0 24 24' fill='#FFC72C'><path d='M17.243 3.006c2.066 0 3.742 8.714 3.742 19.478H24c0-11.588-3.042-20.968-6.766-20.968-2.127 0-4.007 2.81-5.248 7.227-1.241-4.416-3.121-7.227-5.231-7.227C3.031 1.516 0 10.888 0 22.476h3.014c0-10.763 1.658-19.47 3.724-19.47 2.066 0 3.741 8.05 3.741 17.98h2.997c0-9.93 1.684-17.98 3.75-17.98Z'/></svg></div>",
  'Tesla':
    "<div style='width:18px;height:18px;background:#CC0000;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><svg width='13' height='13' viewBox='0 0 24 24' fill='#fff'><path d='M12 5.362l2.475-3.026s4.245.09 8.471 2.054c-1.082 1.636-3.231 2.438-3.231 2.438-.146-1.439-1.154-1.79-4.354-1.79L12 24 8.619 5.034c-3.18 0-4.188.354-4.335 1.792 0 0-2.146-.795-3.229-2.43C5.28 2.431 9.525 2.34 9.525 2.34L12 5.362l-.004.002H12v-.002zm0-3.899c3.415-.03 7.326.528 11.328 2.28.535-.968.672-1.395.672-1.395C19.625.612 15.528.015 12 0 8.472.015 4.375.61 0 2.349c0 0 .195.525.672 1.396C4.674 1.989 8.585 1.435 12 1.46v.003z'/></svg></div>",
  'IECharge':
    "<div style='width:18px;height:18px;background:#004D26;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><svg width='11' height='11' viewBox='0 0 100 100'><path d='M60 5 L25 50 L55 50 L40 95 L75 50 L45 50 Z' fill='#00D084'/></svg></div>",
  'ENGIE Vianeo - B&B HOTELS':
    "<div style='width:18px;height:18px;background:#081C19;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><span style='color:#B1D600;font-weight:900;font-size:11px;font-family:Arial,sans-serif;line-height:1'>B</span></div>",
};

function buildCheapMarkers(rows) {
  _prevVisCheap = null; // reset delta-update state on marker rebuild
  cheapMarkers.forEach(m => m.remove());
  cheapMarkers.length = 0;
  // D-3 — same dedup as buildMarkers
  const _locSeen = new Map();
  for (const r of rows) {
    const key = `${r.operateur}|${Math.round(r.lat * 1e4)}|${Math.round(r.lon * 1e4)}`;
    const ex = _locSeen.get(key);
    if (!ex || r.max_power_kw > ex.max_power_kw) _locSeen.set(key, r);
  }
  for (const p of _locSeen.values()) {
    let op = getOperator(p);
    if (op.name === 'ENGIE Vianeo') op = { ...op, name: 'ENGIE Vianeo - B&B HOTELS' };
    if (op.name === 'IZIVIA Fast')  op = { ...op, name: "IZIVIA Fast - McDonald's" };

    const brandHtml = BRAND_MARKER_HTML[op.name];
    const el = document.createElement('div');
    if (brandHtml) {
      el.innerHTML = brandHtml;
      el.className = 'cheap-brand-marker';
    } else {
      // Dashed circle SVG (replaces L.circleMarker with dashArray)
      el.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18">` +
        `<circle cx="9" cy="9" r="6" fill="${op.color}" fill-opacity="0.75" ` +
        `stroke="#ffffff" stroke-width="2" stroke-dasharray="3,3"/></svg>`;
      el.className = 'cheap-brand-marker';
    }
    el.style.cursor = 'pointer';

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([p.lon, p.lat]);

    marker._p    = p;
    marker._op   = op;
    marker._lon  = p.lon;
    marker._lat  = p.lat;
    marker._name = p.nom_station;

    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (_currentPopup) { _currentPopup.remove(); _currentPopup = null; }
      const popup = new maplibregl.Popup({ maxWidth: '300px', offset: 10 })
        .setLngLat([p.lon, p.lat]).setHTML(buildCheapPopup(p, op));
      popup.on('close', () => { if (_currentPopup === popup) _currentPopup = null; });
      popup.on('open', () => {
        const popupEl = popup.getElement();
        const avail      = popupEl?.querySelector('.popup-avail');
        const refreshBtn = popupEl?.querySelector('.popup-avail-refresh');
        fetchAvailability(marker).then(html => { if (avail) avail.innerHTML = html; });
        if (refreshBtn) {
          refreshBtn.onclick = () => {
            delete marker._availCache;
            if (avail) avail.innerHTML = AVAIL_SPINNER;
            fetchAvailability(marker).then(html => { if (avail) avail.innerHTML = html; });
          };
        }
      });
      popup.addTo(map);
      _currentPopup = popup;
    });

    // Do NOT addTo(map) here — visibility managed by updateVisibility()
    cheapMarkers.push(marker);
  }
}

function buildCheapPopup(p, op) {
  const hours = p.horaires || '—';
  const addr = p.adresse || '—';
  const shortAddr = addr.length > 60 ? addr.slice(0, 60) + '…' : addr;
  return `
    <div>
      <div class="popup-station">${p.nom_station || '—'}</div>
      <span class="popup-operator-badge" style="background:${op.color}">${op.name}</span>
      <span class="popup-cheap-badge">€ Abordable</span>
      ${op.price ? `<span class="popup-price"><span class="price-tier price-tier-${op.price.tier}">${'€'.repeat(op.price.tier)}</span> <small>${op.price.range}</small>${op.price.note ? ` <small class="price-note">(${op.price.note})</small>` : ''}</span>` : ''}
      <div class="popup-grid">
        <span class="popup-label">Puissance max</span>
        <span class="popup-power">${p.max_power_kw ? p.max_power_kw + ' kW' : '—'}</span>

        <span class="popup-label">Nb. de bornes</span>
        <span>${p.nbre_pdc || '—'}</span>

        <span class="popup-label">Horaires</span>
        <span>${hours.length > 50 ? hours.slice(0, 50) + '…' : hours}</span>

        <span class="popup-label">Adresse</span>
        <span>${shortAddr}</span>

        <span class="popup-label">Disponibilité CCS2</span>
        <span class="popup-avail-cell">
          <span class="popup-avail">${AVAIL_SPINNER}</span>
          <button class="popup-avail-refresh" title="Rafraîchir">↺</button>
        </span>
      </div>
      ${op.alerts ? op.alerts.map(a => `<span class="alert-badge">${a.icon} ${a.text}</span>`).join('') : ''}
      <a href="${navUrl(p.lat, p.lon)}" class="nav-btn" target="_blank" rel="noopener">Y aller</a>
    </div>`;
}

// ── Main init — cache-first, then live fetch + DuckDB filter ─────────────

// D-2 — Format a cache timestamp as a human-readable freshness string.
function formatDataFreshness(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diffH = Math.round((now - d) / 3600000);
  if (diffH < 1)  return 'Données fraîches (< 1 h)';
  if (diffH < 24) return `Données de ce matin (${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`;
  return `Données du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

// D-2 — Update the data-freshness indicator element in the panel.
function showDataFreshness(ts) {
  const el = document.getElementById('data-freshness');
  if (el) el.textContent = formatDataFreshness(ts);
}

async function initApp() {
  subEl.textContent = 'Chargement…';

  // T-3 — HEAD request to detect if the Parquet has been updated server-side.
  // Compares ETag or Last-Modified with the value stored at last fetch.
  // Network errors are silently ignored — TTL-based invalidation remains the fallback.
  // HEAD fetch and IndexedDB cache read run in parallel for faster startup.
  const [serverEtag, cached] = await Promise.all([
    fetch(PARQUET_URL, { method: 'HEAD' })
      .then(r => r.headers.get('ETag') || r.headers.get('Last-Modified'))
      .catch(() => null),
    cacheGet('stations-v2').catch(() => null),
  ]);

  const storedEtag = localStorage.getItem(PARQUET_ETAG_KEY);
  const etagChanged = serverEtag && storedEtag && serverEtag !== storedEtag;
  if (cached && Date.now() - cached.ts < CACHE_TTL && !etagChanged) {
    showDataFreshness(cached.ts);
    markers.length = 0;
    const src = map.getSource('stations');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    buildMarkers(cached.rows.filter(r => !r.cheap));
    buildCheapMarkers(cached.rows.filter(r => r.cheap));
    updateVisibility();
    return;
  }

  // 2. Initialize DuckDB WASM
  subEl.textContent = 'Chargement DuckDB…';
  const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/+esm');
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
  );
  const db = new duckdb.AsyncDuckDB(
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    new Worker(workerUrl),
  );
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker ?? null);
  URL.revokeObjectURL(workerUrl);

  // 3. Fetch raw IRVE parquet from data.gouv.fr with progress indication
  subEl.textContent = 'Téléchargement des données IRVE…';
  const response = await fetch(PARQUET_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength, 10) : null;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) {
      subEl.textContent = `Téléchargement IRVE… ${Math.round(received / total * 100)} %`;
    }
  }

  // Reassemble chunks into a single Uint8Array
  const buf = new Uint8Array(received);
  let pos = 0;
  for (const chunk of chunks) { buf.set(chunk, pos); pos += chunk.length; }

  // 4. Register parquet in DuckDB virtual FS and run the filter query
  subEl.textContent = 'Filtrage des stations…';
  await db.registerFileBuffer('irve_raw.parquet', buf);

  const conn  = await db.connect();
  const table = await conn.query(UNIFIED_SQL);
  await conn.close();

  // 5. Convert Arrow rows to plain JS objects (required for JSON serialisation)
  const rows = [];
  for (const row of table) {
    rows.push({
      lon:           Number(row.lon),
      lat:           Number(row.lat),
      id:            String(row.id            ?? ''),
      nom_station:   String(row.nom_station   ?? ''),
      adresse:       String(row.adresse       ?? ''),
      operateur:     String(row.operateur     ?? ''),
      enseigne:      String(row.enseigne      ?? ''),
      nbre_pdc:      String(row.nbre_pdc      ?? ''),
      max_power_kw:  Number(row.max_power_kw  ?? 0),
      nbre_ccs_fast: Number(row.nbre_ccs_fast ?? 0),
      horaires:      String(row.horaires      ?? ''),
      station_type:  String(row.station_type  ?? 'parking'),
      cheap:         Boolean(row.cheap),
    });
  }

  // 6. Persist unified dataset to IndexedDB and save ETag for future T-3 checks
  const nowTs = Date.now();
  cachePut('stations-v2', { ts: nowTs, rows }).catch(() => {});
  if (serverEtag) localStorage.setItem(PARQUET_ETAG_KEY, serverEtag);
  showDataFreshness(nowTs);

  // Release DuckDB resources — frees ~60-80 MB on constrained devices
  try {
    await db.dropFile('irve_raw.parquet');
    await db.terminate();
  } catch (_) {}

  // 7. Build markers and refresh map
  markers.length = 0;
  const src = map.getSource('stations');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
  buildMarkers(rows.filter(r => !r.cheap));
  buildCheapMarkers(rows.filter(r => r.cheap));
  updateVisibility();
}

// ── Initialisation après chargement de la carte ──────────────────────────

map.on('load', () => {
  // ── GeoJSON sources ──────────────────────────────────────────────────────
  map.addSource('route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource('stations', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // ── Route line layer (below station dots) ────────────────────────────────
  map.addLayer({
    id:     'route-layer',
    type:   'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint:  { 'line-color': '#1D4ED8', 'line-width': 4, 'line-opacity': 0.75 },
  });

  // ── Stations circle layer (WebGL) ─────────────────────────────────────────
  map.addLayer({
    id:     'stations-layer',
    type:   'circle',
    source: 'stations',
    paint: {
      'circle-radius':         ['get', 'radius'],
      'circle-color':          ['get', 'color'],
      'circle-stroke-color':   ['get', 'strokeColor'],
      'circle-stroke-width':   ['get', 'strokeWidth'],
      'circle-opacity':        0.9,
      'circle-stroke-opacity': 1,
    },
  });

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  map.on('mouseenter', 'stations-layer', e => {
    map.getCanvas().style.cursor = 'pointer';
    const idx = e.features[0].properties.idx;
    const m = markers[idx];
    if (!m) return;
    _hoverPopup = new maplibregl.Popup({ closeButton: false, offset: 8, className: 'station-tooltip' })
      .setLngLat(e.lngLat)
      .setHTML(m._name || '')
      .addTo(map);
  });
  map.on('mouseleave', 'stations-layer', () => {
    map.getCanvas().style.cursor = '';
    if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }
  });

  // ── Click → popup ─────────────────────────────────────────────────────────
  map.on('click', 'stations-layer', e => {
    if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }
    if (_currentPopup) { _currentPopup.remove(); _currentPopup = null; }
    const idx = e.features[0].properties.idx;
    const m = markers[idx];
    if (!m) return;
    const popup = new maplibregl.Popup({ maxWidth: '300px', offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(buildPopup(m._p, m._op));
    popup.on('close', () => { if (_currentPopup === popup) _currentPopup = null; });
    popup.on('open', () => {
      const popupEl = popup.getElement();
      const avail = popupEl.querySelector('.popup-avail');
      const refreshBtn = popupEl.querySelector('.popup-avail-refresh');
      fetchAvailability(m).then(html => { if (avail) avail.innerHTML = html; });
      if (refreshBtn) refreshBtn.onclick = () => {
        delete m._availCache;
        avail.innerHTML = AVAIL_SPINNER;
        fetchAvailability(m).then(html => { if (avail) avail.innerHTML = html; });
      };
    });
    popup.addTo(map);
    _currentPopup = popup;
  });

  // ── Lancer l'app ─────────────────────────────────────────────────────────
  initApp().then(() => {
    _markersReady = true;
    if (_autoCalcOnReady) { _autoCalcOnReady = false; calculateRoute(); }
  }).catch(err => {
    console.error('initApp:', err);
    subEl.textContent = '⚠ Erreur de chargement';
  });
});

// ── Popup builder ─────────────────────────────────────────────────────────

function buildPopup(p, op) {
  const hours = p.horaires || '—';
  const shortHours = hours.length > 50 ? hours.slice(0, 50) + '…' : hours;
  const addr = p.adresse || '—';
  const shortAddr = addr.length > 60 ? addr.slice(0, 60) + '…' : addr;
  const typeLabel = p.station_type === 'parking' ? 'Parking privé' : 'Aire dédiée';

  return `
    <div>
      <div class="popup-station">${p.nom_station || '—'}</div>
      <span class="popup-operator-badge" style="background:${op.color}">${op.name}</span>
      ${op.price ? `<span class="popup-price"><span class="price-tier price-tier-${op.price.tier}">${'€'.repeat(op.price.tier)}</span> <small>${op.price.range}</small>${op.price.note ? ` <small class="price-note">(${op.price.note})</small>` : ''}</span>` : ''}
      <div class="popup-grid">
        <span class="popup-label">Type</span>
        <span>${typeLabel}</span>

        <span class="popup-label">Puissance max</span>
        <span class="popup-power">${p.max_power_kw} kW</span>

        <span class="popup-label">Bornes CCS ≥ 150 kW</span>
        <span>${p.nbre_ccs_fast > 0 ? p.nbre_ccs_fast : '—'}</span>

        <span class="popup-label">Nb. de bornes total</span>
        <span>${p.nbre_pdc || '—'}</span>

        <span class="popup-label">Horaires</span>
        <span>${shortHours}</span>

        <span class="popup-label">Adresse</span>
        <span>${shortAddr}</span>

        <span class="popup-label">Disponibilité CCS2</span>
        <span class="popup-avail-cell">
          <span class="popup-avail">${AVAIL_SPINNER}</span>
          <button class="popup-avail-refresh" title="Rafraîchir">↺</button>
        </span>
      </div>
      ${op.alerts ? op.alerts.map(a => `<span class="alert-badge">${a.icon} ${a.text}</span>`).join('') : ''}
      <a href="${navUrl(p.lat, p.lon)}" class="nav-btn" target="_blank" rel="noopener">Y aller</a>
    </div>`;
}

// ── Real-time availability (TomTom) ───────────────────────────────────────

const AVAIL_TTL     = 3 * 60 * 1000; // 3 minutes — matches TomTom refresh cadence
const AVAIL_SPINNER = '<span class="popup-avail-spinner">⟳</span>';

// Fetch with 403 classification:
//   - Auth errors (Forbidden, Not authorized, Account inactive) → throw immediately, no retry.
//   - Rate-limit errors (over QPS, over rate limit) → wait 3 s and retry once.
// The TomTom detailedError body determines the category.
async function fetchWithRetry(url) {
  const res = await fetch(url);
  if (res.status !== 403) return res;

  let body = null;
  try { body = await res.json(); } catch (_) {}
  const detail = body?.detailedError ?? {};
  const combined = `${detail.message ?? ''} ${detail.code ?? ''}`;
  const isRateLimit = /rate|limit|quota|capacity|queries per second/i.test(combined);

  console.warn(`[TomTom 403 — ${isRateLimit ? 'rate-limit, retry in 3s' : 'auth error, no retry'}]`, JSON.stringify(body));

  if (!isRateLimit) {
    const err = new Error(`403auth: ${detail.message ?? 'Forbidden'}`);
    err.tomtomErrorType = 'auth';
    throw err;
  }

  await new Promise(r => setTimeout(r, 3000));
  return fetch(url);
}

async function fetchAvailability(circle) {
  // Return cached result if still fresh.
  const now = Date.now();
  if (circle._availCache && now - circle._availCache.ts < AVAIL_TTL) {
    return circle._availCache.html;
  }

  // No key configured — don't cache so a freshly-entered key takes effect immediately.
  if (!TOMTOM_API_KEY) {
    return '—';
  }

  try {
    // Step 1: find the TomTom place ID by proximity (cached across sessions).
    if (!circle._tomtomId) {
      const url = `https://api.tomtom.com/search/2/nearbySearch/.json` +
        `?key=${TOMTOM_API_KEY}&lat=${circle._lat}&lon=${circle._lon}` +
        `&radius=100&categorySet=7309&limit=5`;
      const res = await fetchWithRetry(url);
      if (!res.ok) throw new Error(`nearbySearch ${res.status}`);
      const data = await res.json();
      const result = data.results?.[0];
      if (!result) {
        circle._availCache = { ts: now, html: '—' };
        return '—';
      }
      circle._tomtomId = result.id;
    }

    // Step 2: query real-time availability — filtered server-side to CCS2 ≥ 150 kW.
    const url2 = `https://api.tomtom.com/search/2/chargingAvailability.json` +
      `?key=${TOMTOM_API_KEY}&chargingAvailability=${encodeURIComponent(circle._tomtomId)}` +
      `&connectorSet=IEC62196Type2CCS&minPowerKW=150`;
    const res2 = await fetchWithRetry(url2);
    if (!res2.ok) throw new Error(`chargingAvailability ${res2.status}`);
    const data2 = await res2.json();

    // TomTom already filtered to CCS2 ≥ 150 kW; keep the client-side type check as a safeguard.
    const ccs2 = (data2.connectors ?? [])
      .filter(c => c.type === 'IEC62196Type2CCS');

    let html;
    if (ccs2.length === 0) {
      html = '—';
    } else {
      const available = ccs2.reduce((s, c) => s + (c.availability?.current?.available    ?? 0), 0);
      const unknown   = ccs2.reduce((s, c) => s + (c.availability?.current?.unknown      ?? 0), 0);
      const total     = ccs2.reduce((s, c) => s + (c.total ?? 0), 0);
      if (available === 0 && unknown === total) {
        // All connectors report "unknown" status — cannot determine actual availability.
        html = `<span class="popup-avail">? / ${total}</span>`;
      } else {
        const cls = available > 0 ? 'popup-avail-ok' : 'popup-avail-none';
        html = `<span class="${cls}">${available} / ${total} disponible${available > 1 ? 's' : ''}</span>`;
      }
    }

    circle._availCache = { ts: now, html };
    return html;
  } catch (e) {
    console.warn('TomTom availability:', e.message);
    // Auth errors: key doesn't have the EV API product enabled. Don't cache — user may fix key.
    if (e.tomtomErrorType === 'auth') {
      return '<span class="popup-avail-err" title="Activer \'EV Charging Stations Availability\' dans la console TomTom developer">⚠ Clé non autorisée</span>';
    }
    // Rate-limit 403 that survived the retry, or other HTTP errors.
    if (e.message.includes('403')) {
      return '<span class="popup-avail-err" title="Quota TomTom dépassé — réessaye dans quelques secondes">⚠ Quota dépassé</span>';
    }
    const html = '—';
    circle._availCache = { ts: now, html };
    return html;
  }
}

// ── Route planning ─────────────────────────────────────────────────────────

// U-6 — Photon (Komoot) geocoder — free, no key, richer POI coverage than Nominatim
const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Format a Photon feature's properties into a short display label. */
function photonLabel(props) {
  const parts = [];
  if (props.name)      parts.push(props.name);
  if (props.street && !parts.includes(props.street))  parts.push(props.street);
  const city = props.city || props.town || props.village || props.county;
  if (city   && city !== props.name) parts.push(city);
  const region = props.state;
  if (region && region !== city) parts.push(region);
  return parts.slice(0, 3).join(', ');
}

async function geocode(query) {
  // Photon: bias toward France/neighbors using a rough bbox
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=1&lang=fr`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r    = await fetch(url);
      const data = await r.json();
      if (!data.features?.length) throw new Error(`"${query}" introuvable`);
      const [lon, lat] = data.features[0].geometry.coordinates;
      return [lon, lat];
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

// Singleton Web Worker for off-thread route filtering.
let _filterWorker = null;
function getFilterWorker() {
  if (!_filterWorker) _filterWorker = new Worker('filter-worker.js');
  return _filterWorker;
}

async function applyRouteFilter(routeLine, onProgress) {
  const coords = routeLine.geometry.coordinates;

  // Pack route into transferable Float64Array (zero-copy to worker).
  const routeFlat = new Float64Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    routeFlat[i * 2]     = coords[i][0];
    routeFlat[i * 2 + 1] = coords[i][1];
  }

  // ── Piste 3.4 : spatial bbox pre-filter ──────────────────────────────────
  // Compute bounding box of route + generous corridor (~15 km ≈ 0.15°).
  // Only markers within the bbox are sent to the worker.
  const BBOX_PAD = 0.15; // degrees (~15 km — well beyond the cheap corridor of 10 km)
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < coords.length; i++) {
    const lon = coords[i][0], lat = coords[i][1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  minLon -= BBOX_PAD; maxLon += BBOX_PAD;
  minLat -= BBOX_PAD; maxLat += BBOX_PAD;

  // Reset distances on ALL markers first (markers outside bbox must not keep stale values)
  for (let i = 0; i < markers.length; i++) {
    markers[i]._distFromRoute   = Infinity;
    markers[i]._progressOnRoute = 0;
  }
  for (let i = 0; i < cheapMarkers.length; i++) {
    cheapMarkers[i]._distFromRoute = Infinity;
  }

  // Filter to bbox — typical Paris→Lyon keeps ~400/5535 main + ~150/925 cheap
  const nearbyMarkers = markers.filter(
    m => m._lon >= minLon && m._lon <= maxLon && m._lat >= minLat && m._lat <= maxLat
  );
  const nearbyCheap = cheapMarkers.filter(
    m => m._lon >= minLon && m._lon <= maxLon && m._lat >= minLat && m._lat <= maxLat
  );
  // Pack only bbox-filtered markers into transferable arrays
  const stationsFlat = new Float64Array(nearbyMarkers.length * 2);
  for (let i = 0; i < nearbyMarkers.length; i++) {
    stationsFlat[i * 2]     = nearbyMarkers[i]._lon;
    stationsFlat[i * 2 + 1] = nearbyMarkers[i]._lat;
  }
  const cheapStationsFlat = new Float64Array(nearbyCheap.length * 2);
  for (let i = 0; i < nearbyCheap.length; i++) {
    cheapStationsFlat[i * 2]     = nearbyCheap[i]._lon;
    cheapStationsFlat[i * 2 + 1] = nearbyCheap[i]._lat;
  }

  return new Promise(resolve => {
    const worker = getFilterWorker();
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        if (onProgress) onProgress(data.done, data.total);
      } else {
        // data.type === 'done'
        const results      = new Float32Array(data.results);
        const progressFlat = new Float32Array(data.progressFlat);

        // Map results back to the bbox-filtered subset (not the full markers array)
        for (let i = 0; i < nearbyMarkers.length; i++) {
          nearbyMarkers[i]._distFromRoute   = results[i];
          nearbyMarkers[i]._progressOnRoute = progressFlat[i]; // 0–1 along route
        }

        // Apply cheap distances + progress — also mapped to filtered subset
        if (data.cheapResults) {
          const cheapResults      = new Float32Array(data.cheapResults);
          const cheapProgressFlat = data.cheapProgressFlat
            ? new Float32Array(data.cheapProgressFlat) : null;
          for (let i = 0; i < nearbyCheap.length; i++) {
            nearbyCheap[i]._distFromRoute   = cheapResults[i];
            if (cheapProgressFlat) nearbyCheap[i]._progressOnRoute = cheapProgressFlat[i];
          }
        }

        updateVisibility();
        staggeredFadeIn();   // piste 4.2
        resolve();
      }
    };
    const transfers = [routeFlat.buffer, stationsFlat.buffer, cheapStationsFlat.buffer];
    worker.postMessage(
      { routeFlat, stationsFlat, cheapStationsFlat, bufferKm: ROUTE_BUFFER_KM },
      transfers,
    );
  });
}

// ── Staggered fade-in (piste 4.2) ─────────────────────────────────────────
// Animates visible route-corridor stations appearing from route-start to route-end.
// Relies on _progressOnRoute (0–1) set by the worker in applyRouteFilter().
function staggeredFadeIn() {
  if (!routeActive) return;

  const visible = [
    ...markers.filter(m => isVisible(m)).map(m => ({ m, isMain: true })),
    ...cheapMarkers.filter(m => isCheapVisible(m)).map(m => ({ m, isMain: false })),
  ].sort((a, b) => (a.m._progressOnRoute ?? 0) - (b.m._progressOnRoute ?? 0));

  if (visible.length === 0) return;

  // Invalidate delta-update state: next updateVisibility() must do a full pass.
  _prevVisMain  = null;
  _prevVisCheap = null;

  // Hide everything at the start — rebuild progressively via setData
  const srcSta = map.getSource('stations');
  if (srcSta) srcSta.setData({ type: 'FeatureCollection', features: [] });
  cheapMarkers.forEach(m => m.remove());

  const _hasPref = preferredNetworks.size > 0 && routeActive;
  const STEP_MS = 22;
  const startTime = performance.now();
  let lastShownIdx = -1;

  (function frame(now) {
    const showUpTo = Math.min(
      Math.floor((now - startTime) / STEP_MS),
      visible.length - 1
    );
    if (showUpTo <= lastShownIdx) { requestAnimationFrame(frame); return; }

    // Rebuild GeoJSON features for all main markers shown so far
    const feats = [];
    for (let i = 0; i <= showUpTo; i++) {
      const { m, isMain } = visible[i];
      if (isMain) {
        const pref = _hasPref && preferredNetworks.has(m._op.name);
        feats.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [m._lon, m._lat] },
          properties: {
            idx:         m._idx,
            radius:      m._radius,
            color:       m._op.color,
            strokeColor: pref ? '#F59E0B' : '#ffffff',
            strokeWidth: pref ? 3 : 2,
          },
        });
      } else if (i > lastShownIdx) {
        m.addTo(map);
      }
    }
    const srcSta2 = map.getSource('stations');
    if (srcSta2) srcSta2.setData({ type: 'FeatureCollection', features: feats });
    lastShownIdx = showUpTo;
    if (showUpTo < visible.length - 1) requestAnimationFrame(frame);
    else updateVisibility(); // finalize with complete state
  })(performance.now());
}

// ── F-9a — Network recommendation algorithm ───────────────────────────────

// Alliance = four networks often covered by a single subscription
const ALLIANCE_NAMES = new Set(['Allego / Electra', 'IONITY', 'Fastned', 'Atlante']);

/**
 * Returns top-2 network recommendations for the current route.
 * Returns [] if fewer than 2 segments can be analysed (short route).
 *
 * Algorithm (per backlog spec):
 *  1. zone utile starts at min(150 km, routeKm×40%) — skip the initial
 *     battery range where no fast-charge is needed.
 *  2. divide zone utile into 80-km segments.
 *  3. for each single network and the virtual "Alliance" group, count
 *     how many segments contain ≥1 visible corridor station.
 *  4. score = covered_segments / total_segments.
 *  5. return top-2 by score (ties broken by station count).
 */
function computeNetworkRecommendation(routeKm) {
  const zoneStart = Math.min(150, routeKm * 0.4);
  const zoneLen   = routeKm - zoneStart;
  const nSegs     = Math.ceil(zoneLen / 80);
  if (nSegs < 1) return [];

  // Group visible corridor markers by operator; compute km along route
  const segSets = new Map(); // networkName → Set of segment indices

  for (const m of markers) {
    if (!isVisible(m)) continue;
    const km = (m._progressOnRoute ?? 0) * routeKm;
    if (km < zoneStart) continue;
    const seg = Math.min(Math.floor((km - zoneStart) / 80), nSegs - 1);
    const name = m._op.name;

    // Individual network
    if (!segSets.has(name)) segSets.set(name, new Set());
    segSets.get(name).add(seg);

    // Alliance virtual network
    if (ALLIANCE_NAMES.has(name)) {
      if (!segSets.has('Alliance')) segSets.set('Alliance', new Set());
      segSets.get('Alliance').add(seg);
    }
  }

  // Tesla is classified as a cheap network (FRTSL*) but is relevant for route planning.
  // Its cheap markers have _progressOnRoute set by the worker — include them here.
  for (const m of cheapMarkers) {
    if (m._op.name !== 'Tesla' || !isCheapVisible(m)) continue;
    const km = (m._progressOnRoute ?? 0) * routeKm;
    if (km < zoneStart) continue;
    const seg = Math.min(Math.floor((km - zoneStart) / 80), nSegs - 1);
    if (!segSets.has('Tesla')) segSets.set('Tesla', new Set());
    segSets.get('Tesla').add(seg);
  }

  // Build scored entries
  const entries = [];
  for (const [name, segs] of segSets) {
    const score = segs.size / nSegs;
    if (score === 0) continue;
    const allianceMemberLabel = n => n === 'Allego / Electra' ? 'Electra' : n;
    const allianceMembers = [...ALLIANCE_NAMES]
      .sort((a, b) => (segSets.get(b)?.size || 0) - (segSets.get(a)?.size || 0))
      .map(allianceMemberLabel).join(' · ');
    const op = (name === 'Alliance')
      ? { name: `Alliance (${allianceMembers})`, color: '#7C3AED' }
      : (OPERATORS.find(o => o.name === name) || { name, color: '#6B7280' });
    entries.push({ name, op, score, segs: segs.size, nSegs });
  }
  entries.sort((a, b) => b.score - a.score || b.segs - a.segs);

  // Return top-2, but never Alliance AND one of its members in the same top-2
  const top = [];
  for (const e of entries) {
    if (top.length >= 2) break;
    const isAllianceMember = ALLIANCE_NAMES.has(e.name);
    const allianceInTop = top.some(t => t.name === 'Alliance');
    // If Alliance is already in top, skip individual Alliance members
    if (isAllianceMember && allianceInTop) continue;
    // If an Alliance member is in top, skip Alliance (prefer concrete networks)
    if (e.name === 'Alliance' && top.some(t => ALLIANCE_NAMES.has(t.name))) continue;
    top.push(e);
  }
  return top;
}

/** Render the network recommendation into #network-recommendation. */
function showNetworkRecommendation(routeKm) {
  const el = document.getElementById('network-recommendation');
  const recs = computeNetworkRecommendation(routeKm);
  if (!recs.length) { el.style.display = 'none'; return; }

  const pct = r => Math.round(r.score * 100);
  let html = `<div class="net-rec-title">Réseau${recs.length > 1 ? 'x' : ''} recommandé${recs.length > 1 ? 's' : ''} :</div>`;
  for (const r of recs) {
    html += `<div class="net-rec-item">
      <span class="net-rec-dot" style="background:${r.op.color}"></span>
      <span>${r.op.name}</span>
      <span class="net-rec-score">${r.segs}/${r.nSegs} tronçon${r.nSegs > 1 ? 's' : ''} (${pct(r)}%)</span>
    </div>`;
  }
  el.innerHTML = html;
  el.style.display = '';
}

// ── U-2 — Route results panel ─────────────────────────────────────────────

function showRouteResults() {
  const wrapper = document.getElementById('route-results');
  const list    = document.getElementById('route-results-list');
  const title   = document.getElementById('route-results-title');
  const visible = markers
    .filter(m => isVisible(m))
    .sort((a, b) => (a._progressOnRoute ?? 0) - (b._progressOnRoute ?? 0));
  if (!visible.length) { wrapper.style.display = 'none'; return; }
  title.textContent = `${visible.length} station${visible.length > 1 ? 's' : ''}`;
  let html = '';
  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    const km    = currentRouteKm > 0 ? Math.round(currentRouteKm * (m._progressOnRoute ?? 0)) : null;
    const power = m._maxPowerKw ? `${Math.round(m._maxPowerKw)} kW` : '';
    const meta  = [km !== null ? `${km} km` : '', power].filter(Boolean).join(' · ');
    const navLink = navUrl(m._lat, m._lon);
    html += `<div class="route-result-item">
      <span class="route-result-dot" style="background:${m._op.color}"></span>
      <span class="route-result-name">${m._name || m._op.name}</span>
      ${meta ? `<span class="route-result-meta">${meta}</span>` : ''}
      ${m._op.price ? `<span class="price-tier price-tier-${m._op.price.tier}">${'€'.repeat(m._op.price.tier)}</span>` : ''}
      <a href="${navLink}" class="nav-btn nav-btn-sm" target="_blank" rel="noopener">Y aller</a>
    </div>`;
    // P2 — gap + next station info
    if (currentRouteKm > 0 && i < visible.length - 1) {
      const next = visible[i + 1];
      const gapKm = Math.round(currentRouteKm * ((next._progressOnRoute ?? 0) - (m._progressOnRoute ?? 0)));
      const nextName = next._name || next._op.name;
      if (gapKm > 80) {
        html += `<div class="route-gap-warning">&#x26A0;&#xFE0F; Zone blanche &mdash; ${gapKm} km sans borne rapide</div>`;
      }
      html += `<div class="route-gap-next">&rarr; Suivante : ${nextName}, +${gapKm} km</div>`;
    }
  }
  html += '<p class="price-disclaimer">Prix indicatifs — fév. 2026</p>';
  list.innerHTML = html;
  wrapper.style.display = '';
}

document.getElementById('route-results-toggle').addEventListener('click', () => {
  document.getElementById('route-results').classList.toggle('open');
});

// ── U-7 — Drive mode ──────────────────────────────────────────────────────

let driveModeActive    = false;
let emergencyModeActive = false;
let _emergencyMarkers   = new Set();
let _emergencyAhead     = [];   // sorted array {m, dist} for availability fetch
let _emergencyFetchInProgress = false;
let _lastEmergencyFp    = '';   // fingerprint cache — skip DOM rebuild if unchanged

function _syncDriveModeBtn() {
  const btn = document.getElementById('drive-mode-btn');
  if (!btn) return;
  btn.style.display = (routeActive && geoState.available) ? '' : 'none';
}

function _syncEmergencyBtn() {
  const btn = document.getElementById('emergency-btn');
  if (!btn) return;
  btn.style.display = geoState.available ? '' : 'none';
}

function enterEmergencyMode() {
  if (!geoState.available || !markers.length) return;
  if (driveModeActive) exitDriveMode();
  emergencyModeActive = true;
  // Precompute markers within 15 km — bbox pre-filter then haversine
  // 15 km ≈ 0.135° lat, 0.18° lon at France latitudes
  const LAT_DELTA = 0.135, LON_DELTA = 0.18;
  const latMin = geoState.lat - LAT_DELTA, latMax = geoState.lat + LAT_DELTA;
  const lonMin = geoState.lng - LON_DELTA, lonMax = geoState.lng + LON_DELTA;
  _emergencyMarkers = new Set();
  for (const m of markers) {
    if (m._lat < latMin || m._lat > latMax || m._lon < lonMin || m._lon > lonMax) continue;
    if (_geoHaversineM(geoState.lat, geoState.lng, m._lat, m._lon) <= 15_000) {
      _emergencyMarkers.add(m);
    }
  }
  document.getElementById('drive-panel').style.display = 'flex';
  document.body.classList.add('drive-mode-active');
  const titleEl = document.querySelector('#drive-panel .dm-title');
  if (titleEl) titleEl.textContent = 'Bornes proches — 15 km';
  refreshEmergencyPanel();
  updateVisibility();
  // Center map on GPS + fit all nearby markers
  if (_emergencyMarkers.size > 0) {
    const lngs = [geoState.lng, ...[..._emergencyMarkers].map(m => m._lon)];
    const lats = [geoState.lat, ...[..._emergencyMarkers].map(m => m._lat)];
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 60, right: 40, bottom: 60, left: 40 }, maxZoom: 13 },
    );
  } else {
    map.jumpTo({ center: [geoState.lng, geoState.lat], zoom: 12 });
  }
  map.resize();
}

function exitEmergencyMode() {
  emergencyModeActive = false;
  _emergencyMarkers   = new Set();
  _emergencyAhead     = [];
  _lastEmergencyFp    = '';
  document.getElementById('drive-panel').style.display = 'none';
  document.body.classList.remove('drive-mode-active');
  const titleEl = document.querySelector('#drive-panel .dm-title');
  if (titleEl) titleEl.textContent = 'Mode conduite';
  updateVisibility();
  map.resize();
}

function refreshEmergencyPanel() {
  if (!emergencyModeActive) return;
  const cards = document.getElementById('dm-cards');
  const sorted = [..._emergencyMarkers]
    .map(m => ({ m, dist: _geoHaversineM(geoState.lat, geoState.lng, m._lat, m._lon) / 1000 }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 20);
  _emergencyAhead = sorted;
  if (!sorted.length) {
    cards.innerHTML = '<div class="dm-card dm-card--error">Aucune borne dans un rayon de 15 km</div>';
    _lastEmergencyFp = '';
    return;
  }
  const fp = sorted.map(({ m }) => `${m._lat},${m._lon}`).join('|');
  if (fp === _lastEmergencyFp) {
    _fetchEmergencyAvailability();
    return;
  }
  _lastEmergencyFp = fp;
  let html = `<div class="emergency-header">⚡ ${sorted.length} borne${sorted.length > 1 ? 's' : ''} dans un rayon de 15 km</div>`;
  for (let i = 0; i < sorted.length; i++) {
    const { m, dist } = sorted[i];
    const distStr = dist < 10 ? dist.toFixed(1) : String(Math.round(dist));
    const power   = m._maxPowerKw ? `${Math.round(m._maxPowerKw)} kW` : '';
    html += `<div class="dm-card" data-emergency-idx="${i}">
      <div class="dm-card-left">
        <div class="dm-distance">${distStr}<span class="dm-unit"> km</span></div>
        <a href="${navUrl(m._lat, m._lon)}" class="nav-btn nav-btn-drive" target="_blank" rel="noopener">🧭</a>
      </div>
      <div class="dm-card-right">
        <div class="dm-operator"><span class="dm-op-dot" style="background:${m._op.color}"></span>${m._op.name}</div>
        ${m._name ? `<div class="dm-name">${m._name}</div>` : ''}
        ${power ? `<div class="dm-power">${power}</div>` : ''}
        <div class="dm-avail"></div>
      </div>
    </div>`;
  }
  cards.innerHTML = html;
  _fetchEmergencyAvailability();
}

async function _fetchEmergencyAvailability() {
  if (!TOMTOM_API_KEY || !_emergencyAhead.length) return;
  if (_emergencyFetchInProgress) return;
  _emergencyFetchInProgress = true;
  try {
    for (let i = 0; i < _emergencyAhead.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      if (!emergencyModeActive) break;
      const { m } = _emergencyAhead[i];
      const cardEl  = document.querySelector(`#dm-cards .dm-card[data-emergency-idx="${i}"]`);
      const availEl = cardEl?.querySelector('.dm-avail');
      if (!availEl) continue;
      if (!m._availCache) availEl.innerHTML = AVAIL_SPINNER;
      const html = await fetchAvailability(m);
      if (availEl.isConnected) availEl.innerHTML = html;
    }
  } finally {
    _emergencyFetchInProgress = false;
  }
}

function enterDriveMode() {
  if (emergencyModeActive) exitEmergencyMode();
  driveModeActive = true;
  document.getElementById('drive-panel').style.display = 'flex';
  document.body.classList.add('drive-mode-active');
  const titleEl = document.querySelector('#drive-panel .dm-title');
  if (titleEl) titleEl.textContent = 'Mode conduite';
  refreshDrivePanel();
  map.resize();
}

function exitDriveMode() {
  driveModeActive = false;
  document.getElementById('drive-panel').style.display = 'none';
  document.body.classList.remove('drive-mode-active');
  _lastDriveFingerprint = '';
  map.resize();
}

let _driveAhead           = [];    // current cards' markers — used by click handler
let _fetchInProgress      = false; // guard against concurrent fetch loops
let _lastDriveFingerprint = '';    // fingerprint of last rendered card list — skip DOM rebuild if unchanged

function refreshDrivePanel() {
  if (!driveModeActive) return;
  const cards = document.getElementById('dm-cards');
  if (!geoState.available) {
    cards.innerHTML = '<div class="dm-card dm-card--error">Signal GPS perdu</div>';
    _driveAhead = [];
    _lastDriveFingerprint = '';
    return;
  }
  const sorted = [];
  for (const m of markers) {
    if (!isVisible(m) || m._progressOnRoute === undefined) continue;
    const dist = _geoHaversineM(geoState.lat, geoState.lng, m._lat, m._lon) / 1000;
    if (dist <= 0.5) continue;
    sorted.push({ m, dist });
  }
  sorted.sort((a, b) => a.m._progressOnRoute - b.m._progressOnRoute);
  const ahead = sorted.slice(0, 10);
  if (!ahead.length) {
    cards.innerHTML = '<div class="dm-card dm-card--done">✓ Destination proche</div>';
    _driveAhead = [];
    _lastDriveFingerprint = '';
    return;
  }
  // Skip DOM rebuild if the same stations are still shown — avoids flicker on GPS updates
  const fingerprint = ahead.map(({ m }) => `${m._lat},${m._lon}`).join('|');
  if (fingerprint === _lastDriveFingerprint) {
    _fetchDriveAvailability(false);
    return;
  }
  _lastDriveFingerprint = fingerprint;
  // Guard: preferredNetworks may not exist if F-9b is not yet merged
  const preferredSet = (typeof preferredNetworks !== 'undefined') ? preferredNetworks : null;
  let html = '';
  for (let i = 0; i < ahead.length; i++) {
    const { m, dist } = ahead[i];
    const isPref  = preferredSet && preferredSet.has(m._op.name);
    let cls = 'dm-card';
    if (i === 0)   cls += ' dm-card--next';
    else if (isPref) cls += ' dm-card--preferred';
    const distStr = dist < 10 ? dist.toFixed(1) : String(Math.round(dist));
    const power   = m._maxPowerKw ? `${Math.round(m._maxPowerKw)} kW` : '';
    const star    = isPref ? '<span class="dm-preferred-star">★</span>' : '';
    html += `<div class="${cls}" data-drive-idx="${i}">
      <div class="dm-card-left">
        <div class="dm-distance">${distStr}<span class="dm-unit"> km</span></div>
        <a href="${navUrl(m._lat, m._lon)}" class="nav-btn nav-btn-drive" target="_blank" rel="noopener">🧭</a>
      </div>
      <div class="dm-card-right">
        <div class="dm-operator"><span class="dm-op-dot" style="background:${m._op.color}"></span>${m._op.name}${star}</div>
        ${m._name ? `<div class="dm-name">${m._name}</div>` : ''}
        ${power ? `<div class="dm-power">${power}</div>` : ''}
        <div class="dm-avail"></div>
      </div>
    </div>`;
  }
  _driveAhead.length = 0;
  ahead.forEach(item => _driveAhead.push(item));
  cards.innerHTML = html;
  _fetchDriveAvailability(false); // auto-fetch on panel refresh, uses cache if fresh
}

document.getElementById('drive-mode-btn').addEventListener('click', enterDriveMode);
document.getElementById('emergency-btn').addEventListener('click', enterEmergencyMode);
document.getElementById('dm-exit').addEventListener('click', () => {
  if (emergencyModeActive) exitEmergencyMode();
  else exitDriveMode();
});
document.getElementById('dm-refresh').addEventListener('click', () => _fetchDriveAvailability(true));

// U-7b — fetch TomTom availability for all drive cards sequentially.
// Called automatically on panel refresh (uses cache) and on manual tap (force-refreshes).
async function _fetchDriveAvailability(forceRefresh) {
  if (!TOMTOM_API_KEY || !_driveAhead.length) return;
  if (_fetchInProgress && !forceRefresh) return;
  if (forceRefresh) _driveAhead.forEach(({ m }) => delete m._availCache);
  _fetchInProgress = true;
  try {
    for (let i = 0; i < _driveAhead.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      const { m } = _driveAhead[i];
      const cardEl  = document.querySelector(`#dm-cards .dm-card[data-drive-idx="${i}"]`);
      const availEl = cardEl?.querySelector('.dm-avail');
      if (!availEl) continue;
      if (!m._availCache) availEl.innerHTML = AVAIL_SPINNER;
      const html = await fetchAvailability(m);
      if (availEl.isConnected) availEl.innerHTML = html;
    }
  } finally {
    _fetchInProgress = false;
  }
}

// Tap on a card = center map on that station
document.getElementById('dm-cards').addEventListener('click', e => {
  if (e.target.closest('.nav-btn')) return;  // navigation link handles its own action

  const driveCard = e.target.closest('.dm-card[data-drive-idx]');
  if (driveCard && _driveAhead.length) {
    const idx = parseInt(driveCard.dataset.driveIdx, 10);
    if (!isNaN(idx) && _driveAhead[idx]) {
      const { m } = _driveAhead[idx];
      map.jumpTo({ center: [m._lon, m._lat], zoom: Math.max(map.getZoom(), 13) });
    }
    return;
  }

  const emergencyCard = e.target.closest('.dm-card[data-emergency-idx]');
  if (emergencyCard && _emergencyAhead.length) {
    const idx = parseInt(emergencyCard.dataset.emergencyIdx, 10);
    if (!isNaN(idx) && _emergencyAhead[idx]) {
      const { m } = _emergencyAhead[idx];
      map.jumpTo({ center: [m._lon, m._lat], zoom: Math.max(map.getZoom(), 14) });
    }
  }
});


function clearRoute() {
  if (driveModeActive) exitDriveMode();
  routeActive = false;
  map.getSource('route')?.setData({ type: 'FeatureCollection', features: [] });
  markers.forEach(m => { delete m._distFromRoute; });
  document.getElementById('network-recommendation').style.display = 'none';
  cheapMarkers.forEach(m => { delete m._distFromRoute; });
  updateVisibility();
  document.getElementById('route-info').textContent = '';
  document.getElementById('route-clear').style.display = 'none';
  document.getElementById('route-share').style.display = 'none';
  document.getElementById('route-results').style.display = 'none';
  _syncDriveModeBtn();
  history.replaceState(null, '', location.pathname);
  const btn = document.getElementById('route-go');
  btn.style.display = '';
  btn.disabled = false;
  btn.textContent = 'Calculer →';

  // Mobile: restore full panel
  document.getElementById('panel').classList.remove('route-calculated', 'panel-expanded');
}

let currentRouteKm = 0;

let _calcInProgress = false;
async function calculateRoute() {
  if (_calcInProgress) return;
  _calcInProgress = true;
  try {
  const startInput = document.getElementById('route-start');
  const endInput   = document.getElementById('route-end');
  const startVal   = startInput.value.trim();
  const endVal     = endInput.value.trim();
  const btn  = document.getElementById('route-go');
  const info = document.getElementById('route-info');

  // B-1 — validate preconditions with explicit feedback instead of silent return
  if (!endVal) {
    info.className = 'route-error';
    info.textContent = '⚠ Saisissez une destination';
    return;
  }
  if (!startVal && !geoState.available) {
    if (geoState.pending) {
      // GPS is being acquired — show progress and poll up to 8 s
      info.className = 'route-progress';
      info.textContent = '📍 Attente de la position GPS…';
      btn.disabled = true;
      const t0 = Date.now();
      (function pollGeo() {
        if (geoState.available) {
          btn.disabled = false;
          calculateRoute();
          return;
        }
        if (!geoState.pending || Date.now() - t0 > 8000) {
          btn.disabled = false;
          info.className = 'route-error';
          info.textContent = '⚠ Position GPS non disponible — saisissez un départ';
          return;
        }
        setTimeout(pollGeo, 300);
      }());
      return;
    }
    info.className = 'route-error';
    info.textContent = '⚠ Position GPS non disponible — saisissez un départ';
    return;
  }

  btn.disabled = true;
  btn.textContent = '…';
  info.className = 'route-progress';

  // Yield to browser so each step label actually renders before the next await
  const step = msg => new Promise(r => {
    info.textContent = msg;
    requestAnimationFrame(() => requestAnimationFrame(r));
  });

  try {
    const useGeoStart = !startVal && geoState.available;
    await step(useGeoStart ? '📍 Position GPS du départ…' : '📍 Géocodage du départ…');
    const from = useGeoStart ? [geoState.lng, geoState.lat] : (startInput._coords || await geocode(startVal));
    await step('📍 Géocodage de l\'arrivée…');
    const to = endInput._coords || await geocode(endVal);

    await step('🗺 Calcul d\'itinéraire…');
    const route = await fetchRoute(from, to);

    // Simplify display geometry only — corridor filtering uses full-precision route.geometry.coordinates
    const _displayLine = turf.simplify(
      turf.lineString(route.geometry.coordinates),
      { tolerance: 0.00005, highQuality: false }
    );
    map.getSource('route').setData(_displayLine);

    // 4.3 — adaptive padding: account for actual panel dimensions
    const _panel    = document.getElementById('panel');
    const _isMobile = window.matchMedia('(max-width: 640px)').matches;
    const bbox = turf.bbox(_displayLine);
    const _paddingObj = _isMobile
      ? { top: 40, right: 40, bottom: _panel.offsetHeight + 24, left: 40 }
      : { top: 40, right: 40, bottom: 40, left: _panel.offsetWidth + 20 };
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: _paddingObj });

    info.className = 'route-progress';
    info.textContent = `⚡ Filtrage 0/${markers.length}…`;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    routeActive = true;
    await applyRouteFilter(
      turf.lineString(route.geometry.coordinates),
      (done, total) => { info.textContent = `⚡ Filtrage ${done}/${total}…`; }
    );

    currentRouteKm = Math.round(route.legs.reduce((s, l) => s + l.distance, 0) / 1000);
    info.className = 'route-stat';
    info.textContent = `${currentRouteKm} km`;

    // F-9a — show network recommendation after filter is applied
    showNetworkRecommendation(currentRouteKm);
    showRouteResults();
    _syncDriveModeBtn();

    document.getElementById('route-clear').style.display = '';
    document.getElementById('route-share').style.display = '';
    btn.style.display = 'none';

    // F-6 — save to recent routes history
    saveRecentRoute(
      startInput.value.trim(),
      endInput.value.trim(),
      startInput._coords || null,
      endInput._coords || null,
    );

    // F-5 — update URL so the route is shareable via address bar or copy button
    (function pushShareUrl() {
      const url = new URL(location.href);
      url.search = '';
      const sInput = document.getElementById('route-start');
      const eInput = document.getElementById('route-end');
      if (eInput.value) {
        url.searchParams.set('to', eInput.value);
        if (eInput._coords) url.searchParams.set('tc', eInput._coords.join(','));
      }
      if (sInput.value) {
        url.searchParams.set('from', sInput.value);
        if (sInput._coords) url.searchParams.set('fc', sInput._coords.join(','));
      }
      // encode current corridor slider value
      url.searchParams.set('c', document.getElementById('corridor-slider').value);
      history.replaceState(null, '', url.toString());
    }());

    // Mobile: collapse panel to corridor + parkings only
    if (window.matchMedia('(max-width: 640px)').matches) {
      document.getElementById('panel').classList.add('route-calculated');
      document.getElementById('panel').classList.remove('panel-expanded');
    }
  } catch (e) {
    info.className = 'route-error';
    info.textContent = '⚠ ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Calculer →';
  }
  } finally {
    _calcInProgress = false;
  }
}

document.getElementById('route-go').addEventListener('click', calculateRoute);

document.getElementById('route-clear').addEventListener('click', clearRoute);

// Keyboard Enter on route inputs is handled inside setupAutocomplete below.

// U-6 — Warm up the connection to Photon on first input focus so the TCP+TLS
// handshake is already done by the time the user types.
let photonWarmedUp = false;
['route-start', 'route-end'].forEach(id =>
  document.getElementById(id).addEventListener('focus', () => {
    if (photonWarmedUp) return;
    photonWarmedUp = true;
    fetch(`${PHOTON_URL}?q=a&limit=1`, { method: 'HEAD' }).catch(() => {});
  }, { once: false })
);

// ── Corridor slider ────────────────────────────────────────────────────────

document.getElementById('corridor-label').addEventListener('click', () => {
  const slider = document.getElementById('corridor-slider');
  slider.style.display = slider.style.display === 'none' ? 'block' : 'none';
});

// U-1 — tooltip above slider thumb, created once and reused
const _sliderTooltip = document.createElement('div');
_sliderTooltip.id = 'corridor-slider-tooltip';
document.getElementById('corridor-row').appendChild(_sliderTooltip);

let _sliderRaf = null;
document.getElementById('corridor-slider').addEventListener('input', () => {
  const slider = document.getElementById('corridor-slider');
  const v = parseInt(slider.value, 10);
  ROUTE_BUFFER_KM = v / 10;
  const km = v / 10;
  const label = km >= 1 ? km.toFixed(1) + ' km' : (v * 100) + ' m';
  document.getElementById('corridor-value').textContent = label;

  // U-1 — position and show tooltip
  const min = parseInt(slider.min, 10), max = parseInt(slider.max, 10);
  const pct = (v - min) / (max - min);
  const thumbHalf = 8; // approximate half-width of native range thumb (px)
  const thumbX = slider.offsetLeft + pct * (slider.offsetWidth - thumbHalf * 2) + thumbHalf;
  _sliderTooltip.style.left = thumbX + 'px';
  _sliderTooltip.textContent = label;
  _sliderTooltip.style.display = 'block';

  if (routeActive) {
    if (_sliderRaf) cancelAnimationFrame(_sliderRaf);
    _sliderRaf = requestAnimationFrame(() => {
      _sliderRaf = null;
      const info = document.getElementById('route-info');
      info.className = 'route-stat';
      info.textContent = `${currentRouteKm} km`;
      updateVisibility();
      showNetworkRecommendation(currentRouteKm);
      showRouteResults();
    });
  }
});

['mouseup', 'touchend', 'mouseleave'].forEach(evt =>
  document.getElementById('corridor-slider').addEventListener(evt, e => {
    // mouseleave: hide only when button is released
    if (evt === 'mouseleave' && e.buttons !== 0) return;
    _sliderTooltip.style.display = 'none';
  })
);

// ── Autocomplete ───────────────────────────────────────────────────────────

function setupAutocomplete(inputId) {
  const input    = document.getElementById(inputId);
  const dropdown = document.createElement('div');
  dropdown.className = 'autocomplete-dropdown';
  input.parentNode.appendChild(dropdown);

  let debounceTimer = null;
  let activeIdx = -1;

  function items() { return dropdown.querySelectorAll('.autocomplete-item'); }

  function setActive(idx) {
    const els = items();
    els.forEach(el => el.classList.remove('autocomplete-item-active'));
    activeIdx = Math.max(-1, Math.min(idx, els.length - 1));
    if (activeIdx >= 0) els[activeIdx].classList.add('autocomplete-item-active');
  }

  function selectActive() {
    const els = items();
    if (activeIdx >= 0 && els[activeIdx]) {
      els[activeIdx].dispatchEvent(new MouseEvent('mousedown'));
      return true;
    }
    return false;
  }

  input.addEventListener('keydown', e => {
    const els = items();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIdx <= 0 ? -1 : activeIdx - 1);
    } else if (e.key === 'Enter') {
      const selected = selectActive();
      dropdown.innerHTML = '';
      activeIdx = -1;
      if (!selected) {
        calculateRoute();
      }
    } else if (e.key === 'Escape') {
      dropdown.innerHTML = '';
      activeIdx = -1;
    }
  });

  input.addEventListener('input', () => {
    input._coords = null;
    // F-8 — if user edits the start field, reset the GPS auto-fill block so
    // the next manual clear + GPS fix CAN auto-fill once more. But if user
    // types (non-empty), just keep the block to avoid re-filling mid-type.
    if (inputId === 'route-start' && !input.value) {
      // User cleared the field: re-allow GPS auto-fill on next fix
      input._geoAutoFillBlocked = false;
    }
    activeIdx = -1;
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    dropdown.innerHTML = '';
    localStorage.setItem('irve-' + input.id, JSON.stringify({ text: q }));
    if (q.length < 3) return;
    debounceTimer = setTimeout(() => fetchAutocompleteSuggestions(q, dropdown, input), 300);
  });

  input.addEventListener('focus', () => {
    // F-6 — show recent routes when Arrivée is focused and empty
    if (inputId === 'route-end' && !input.value.trim()) {
      showRecentRoutesDropdown(dropdown);
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.innerHTML = ''; activeIdx = -1; }, 200);
  });
}

async function fetchAutocompleteSuggestions(q, dropdown, input) {
  try {
    // U-6 — Photon API: GeoJSON FeatureCollection, no key required
    const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=5&lang=fr`;
    const data = await fetch(url).then(r => r.json());
    dropdown.innerHTML = '';
    (data.features || []).forEach(feat => {
      const props  = feat.properties || {};
      const coords = [feat.geometry.coordinates[0], feat.geometry.coordinates[1]];
      const label  = photonLabel(props);
      if (!label) return;
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.textContent = label;
      div.title = [props.name, props.street, props.city || props.town, props.country]
        .filter(Boolean).join(', ');
      div.addEventListener('mousedown', () => {
        input.value   = label;
        input._coords = coords;
        dropdown.innerHTML = '';
        localStorage.setItem('irve-' + input.id, JSON.stringify({ text: label, coords }));
      });
      dropdown.appendChild(div);
    });
  } catch (_) { /* silent */ }
}

setupAutocomplete('route-start');
setupAutocomplete('route-end');

// Restore last departure/arrival from localStorage (text + coords, no auto-route)
['route-start', 'route-end'].forEach(id => {
  try {
    const saved = localStorage.getItem('irve-' + id);
    if (!saved) return;
    const { text, coords } = JSON.parse(saved);
    const input = document.getElementById(id);
    if (text)   input.value   = text;
    if (coords) input._coords = coords;
  } catch (_) {}
});

// ── B-1 — Reactive Calculer button state ──────────────────────────────────
// Disable when Arrivée is empty; never touches state during mid-calculation ('…').
function _syncGoBtn() {
  const btn = document.getElementById('route-go');
  if (btn.style.display === 'none' || btn.textContent === '…') return;
  btn.disabled = !document.getElementById('route-end').value.trim();
}
document.getElementById('route-end').addEventListener('input', _syncGoBtn);
_syncGoBtn(); // initial state

// ── F-6 — Recent routes history ────────────────────────────────────────────

const RECENT_ROUTES_KEY = 'irve-recent-routes';
const RECENT_ROUTES_MAX = 5;

/** Persist a successful route to the recent routes history. */
function saveRecentRoute(startText, endText, startCoords, endCoords) {
  if (!endText) return;
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_ROUTES_KEY) || '[]');
    // Deduplicate: remove any entry with same end destination
    const filtered = saved.filter(r => r.endText !== endText || r.startText !== startText);
    // Prepend new entry and cap at max
    filtered.unshift({ startText, endText, startCoords, endCoords, ts: Date.now() });
    localStorage.setItem(RECENT_ROUTES_KEY, JSON.stringify(filtered.slice(0, RECENT_ROUTES_MAX)));
  } catch (_) {}
}

/** Return recent routes array (newest first). */
function getRecentRoutes() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_ROUTES_KEY) || '[]');
  } catch (_) { return []; }
}

/** Show recent routes in a dropdown below the Arrivée input. */
function showRecentRoutesDropdown(dropdown) {
  const routes = getRecentRoutes();
  if (!routes.length) return;
  dropdown.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'autocomplete-item autocomplete-recent-header';
  header.textContent = 'Trajets récents';
  dropdown.appendChild(header);

  routes.forEach(r => {
    const div = document.createElement('div');
    div.className = 'autocomplete-item autocomplete-recent-item';
    const dest = document.createElement('span');
    dest.textContent = r.endText;
    const from = document.createElement('span');
    from.className = 'autocomplete-recent-from';
    from.textContent = r.startText ? `depuis ${r.startText}` : 'depuis Ma position';
    div.appendChild(dest);
    div.appendChild(from);
    div.addEventListener('mousedown', () => {
      const endInput   = document.getElementById('route-end');
      const startInput = document.getElementById('route-start');
      endInput.value   = r.endText;
      endInput._coords = r.endCoords || null;
      if (r.startText) {
        startInput.value   = r.startText;
        startInput._coords = r.startCoords || null;
      } else {
        startInput.value   = '';
        startInput._coords = null;
      }
      dropdown.innerHTML = '';
      calculateRoute();
    });
    dropdown.appendChild(div);
  });
}

// ── F-5 — Shareable URL (load params + share button) ──────────────────────

// Share button: copies current URL to clipboard with visual feedback.
document.getElementById('route-share').addEventListener('click', async () => {
  const shareBtn = document.getElementById('route-share');
  try {
    await navigator.clipboard.writeText(location.href);
    shareBtn.textContent = '✓';
  } catch (_) {
    // Fallback: select the URL bar via prompt
    shareBtn.textContent = '✓';
  }
  setTimeout(() => { shareBtn.textContent = '⎘'; }, 1500);
});

// On page load: read URL params, pre-fill inputs, optionally auto-calculate.
(function loadUrlParams() {
  const params = new URLSearchParams(location.search);
  const to   = params.get('to');
  const from = params.get('from');
  const tc   = params.get('tc');
  const fc   = params.get('fc');
  const c    = params.get('c');

  if (to) {
    const el = document.getElementById('route-end');
    el.value = to;
    if (tc) {
      const [lon, lat] = tc.split(',').map(Number);
      if (!isNaN(lon) && !isNaN(lat)) el._coords = [lon, lat];
    }
  }
  if (from) {
    const el = document.getElementById('route-start');
    el.value = from;
    if (fc) {
      const [lon, lat] = fc.split(',').map(Number);
      if (!isNaN(lon) && !isNaN(lat)) el._coords = [lon, lat];
    }
  }
  if (c) {
    const cv = parseInt(c, 10);
    if (cv >= 2 && cv <= 30) {
      const slider = document.getElementById('corridor-slider');
      slider.value = cv;
      ROUTE_BUFFER_KM = cv / 10;
      const km = cv / 10;
      document.getElementById('corridor-value').textContent = km >= 1 ? km.toFixed(1) + ' km' : (cv * 100) + ' m';
    }
  }

  if (to) {
    // U-8: no focus when auto-calculating
    if (_markersReady) { calculateRoute(); }
    else { _autoCalcOnReady = true; }
  } else {
    // U-8 — focus the Arrivée field for immediate keyboard input
    document.getElementById('route-end').focus();
  }
}());

// ── Settings menu ──────────────────────────────────────────────────────────

// ── F-9b — Preferred networks (user-configured price advantage) ───────────

const PREFERRED_NETWORKS_KEY = 'irve-preferred-networks';

/** Set of operator names the user has a price advantage on. */
let preferredNetworks = new Set(
  JSON.parse(localStorage.getItem(PREFERRED_NETWORKS_KEY) || '[]')
);

/**
 * Apply gold-stroke highlighting to markers of preferred networks
 * (only when route is active). Called after updateVisibility() and
 * after preferred settings change.
 */
function applyPreferredStyling() {
  // Preferred styling is now embedded in GeoJSON properties (strokeColor/strokeWidth)
  // and computed inline in updateVisibility(). Just refresh the source.
  updateVisibility();
}

(function setupSettings() {
  const btn  = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  const bustBtn = document.getElementById('cache-bust-btn');

  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });

  menu.addEventListener('click', e => e.stopPropagation());

  // TomTom API key input
  const keyInput = document.getElementById('tomtom-key-input');
  keyInput.value = TOMTOM_API_KEY;
  keyInput.addEventListener('input', () => {
    TOMTOM_API_KEY = keyInput.value.trim();
    localStorage.setItem('irve-tomtom-key', TOMTOM_API_KEY);
  });

  bustBtn.addEventListener('click', () => {
    const req = indexedDB.deleteDatabase('irve-v1');
    req.onsuccess = () => window.location.reload();
    req.onerror   = () => window.location.reload();
    req.onblocked = () => window.location.reload();
  });

  // F-3 — minimum power filter (radio buttons)
  const savedPower = localStorage.getItem('irve-min-power-kw') || '150';
  const powerRadio = menu.querySelector(`input[name="min-power"][value="${savedPower}"]`);
  if (powerRadio) powerRadio.checked = true;
  // Reflect saved preference in panel title on load
  document.getElementById('panel-title-kw').textContent = `Bornes rapides ≥ ${MIN_POWER_KW} kW`;
  menu.querySelectorAll('input[name="min-power"]').forEach(r => {
    r.addEventListener('change', () => {
      MIN_POWER_KW = parseInt(r.value, 10);
      document.getElementById('panel-title-kw').textContent = `Bornes rapides ≥ ${MIN_POWER_KW} kW`;
      localStorage.setItem('irve-min-power-kw', r.value);
      updateVisibility();
      if (routeActive) { showNetworkRecommendation(currentRouteKm); showRouteResults(); }
    });
  });

  // U-10 — CHEAP corridor width
  const cheapInput = document.getElementById('cheap-corridor-input');
  cheapInput.value = CHEAP_CORRIDOR_KM;
  cheapInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(50, parseFloat(cheapInput.value) || 10));
    cheapInput.value = v;
    CHEAP_CORRIDOR_KM = v;
    localStorage.setItem('irve-cheap-corridor-km', v);
    updateVisibility();
    updateLegend();
    if (routeActive) { showNetworkRecommendation(currentRouteKm); showRouteResults(); }
  });

  // F-9b — build preferred networks checkbox list
  const prefList = document.getElementById('preferred-networks-list');
  OPERATORS.forEach(op => {
    const label = document.createElement('label');
    label.className = 'settings-checkbox-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = op.name;
    cb.checked = preferredNetworks.has(op.name);
    cb.addEventListener('change', () => {
      if (cb.checked) preferredNetworks.add(op.name);
      else            preferredNetworks.delete(op.name);
      localStorage.setItem(PREFERRED_NETWORKS_KEY, JSON.stringify([...preferredNetworks]));
      applyPreferredStyling();
    });
    const dot = document.createElement('span');
    dot.className = 'settings-net-dot';
    dot.style.background = op.color;
    const span = document.createElement('span');
    span.textContent = op.name;
    label.append(cb, dot, span);
    prefList.appendChild(label);
  });
}());

// ── Panel title toggle (mobile, post-route-calculation) ──────────────────
(function () {
  document.getElementById('panel-title').addEventListener('click', () => {
    const panel = document.getElementById('panel');
    if (window.matchMedia('(max-width: 640px)').matches && panel.classList.contains('route-calculated')) {
      panel.classList.toggle('panel-expanded');
    }
  });
}());

// ── Legend toggle (mobile only) ───────────────────────────────────────────
(function () {
  const legend = document.getElementById('legend');
  const toggle = document.getElementById('legend-toggle');
  toggle.addEventListener('click', () => {
    if (window.matchMedia('(max-width: 640px)').matches) {
      legend.classList.toggle('open');
    }
  });
}());

// ── Geolocation ────────────────────────────────────────────────────────────

const geoState = { available: false, pending: false, lat: null, lng: null, heading: 0 };
const _geoHistory = [];   // rolling buffer of last positions for bearing
let _geoMarker    = null;
let _geoMarkerEl  = null; // inner element for heading updates without full marker rebuild
let _geoLocateBtn = null;
let _geoWatchId   = null;
let _lastDriveRefreshTime = 0;
let _lastDrivePos  = null;
let _lastHeading   = null;

function _geoComputeBearing(lat1, lon1, lat2, lon2) {
  const toRad = x => x * Math.PI / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
          - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function _geoHaversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _makeGeoMarkerEl(heading) {
  const outer = document.createElement('div');
  outer.className = 'geoloc-marker-outer';
  const inner = document.createElement('div');
  inner.className = 'geoloc-marker';
  inner.style.transform = `rotate(${Math.round(heading)}deg)`;
  inner.innerHTML =
    `<svg width="24" height="24" viewBox="0 0 24 24">` +
    `<path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#EF4444" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>` +
    `</svg>`;
  outer.appendChild(inner);
  return outer;
}

function _onGeoSuccess(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  _geoHistory.push({ lat, lng });
  if (_geoHistory.length > 5) _geoHistory.shift();

  // Prefer native heading (mobile GPS), fall back to computed from history
  let heading = (pos.coords.heading != null && !isNaN(pos.coords.heading))
    ? pos.coords.heading : null;

  if (heading === null && _geoHistory.length >= 2) {
    const last = _geoHistory[_geoHistory.length - 1];
    for (let i = _geoHistory.length - 2; i >= 0; i--) {
      const p = _geoHistory[i];
      if (_geoHaversineM(p.lat, p.lng, last.lat, last.lng) >= 10) {
        heading = _geoComputeBearing(p.lat, p.lng, last.lat, last.lng);
        break;
      }
    }
  }
  // Keep last known heading when stationary
  if (heading === null) heading = geoState.heading;

  geoState.available = true;
  geoState.pending   = false;
  geoState.lat = lat;
  geoState.lng = lng;
  geoState.heading = heading;

  // FIX 5 — skip DOM rebuild when heading changed <= 5 degrees
  const _headingChanged = _lastHeading === null || Math.abs(heading - _lastHeading) > 5;
  if (!_geoMarker) {
    // First fix: create the marker
    _lastHeading = heading;
    _geoMarkerEl = _makeGeoMarkerEl(heading);
    _geoMarker = new maplibregl.Marker({ element: _geoMarkerEl, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    // Subsequent fixes: just update position and optionally heading
    _geoMarker.setLngLat([lng, lat]);
    if (_headingChanged) {
      _lastHeading = heading;
      const inner = _geoMarkerEl.querySelector('.geoloc-marker');
      if (inner) inner.style.transform = `rotate(${Math.round(heading)}deg)`;
    }
  }

  if (_geoLocateBtn) {
    _geoLocateBtn.disabled = false;
    _geoLocateBtn.title = 'Centrer sur ma position';
    _geoLocateBtn.classList.remove('geoloc-retry');
  }

  // F-8 — auto-fill the Départ field on first GPS fix
  const startInput = document.getElementById('route-start');
  if (startInput) {
    if (!startInput.value && !startInput._geoAutoFillBlocked) {
      // First available GPS fix and field is still empty: fill it
      startInput.value   = 'Ma position';
      startInput._coords = [lng, lat];
      startInput.placeholder = 'Départ';
      startInput._geoAutoFillBlocked = true; // prevent re-fill after user clears
    } else if (startInput.value === 'Ma position') {
      // Field still shows auto-filled text: keep coords fresh as GPS updates
      startInput._coords = [lng, lat];
      startInput.placeholder = 'Départ';
    } else {
      startInput.placeholder = 'Ma position (GPS)';
    }
  }
  _syncGoBtn();
  _syncDriveModeBtn();
  _syncEmergencyBtn();

  // FIX 4 — throttle refreshDrivePanel: skip if < 3s since last refresh AND moved < 100m
  const _driveNow = Date.now();
  const dlat = lat - (_lastDrivePos?.lat || lat);
  const dlon = lng - (_lastDrivePos?.lon || lng);
  const approxKm = Math.sqrt(dlat * dlat + dlon * dlon) * 111;
  if (_driveNow - _lastDriveRefreshTime < 3000 && approxKm < 0.1) return;
  _lastDriveRefreshTime = _driveNow;
  _lastDrivePos = { lat, lon: lng };
  refreshDrivePanel();
  if (emergencyModeActive) refreshEmergencyPanel();
}

function _onGeoError(err) {
  geoState.available = false;
  geoState.pending   = false;
  if (err.code !== 1) console.warn('Géolocalisation :', err.message);
  const startInput = document.getElementById('route-start');
  if (startInput && !startInput.value) startInput.placeholder = 'Départ';
  // Permission refusée : activer le bouton pour permettre une nouvelle tentative
  if (err.code === 1 && _geoLocateBtn) {
    _geoLocateBtn.disabled = false;
    _geoLocateBtn.title = 'Activer la géolocalisation';
    _geoLocateBtn.classList.add('geoloc-retry');
  }
}

// Locate button — MapLibre IControl positioned below zoom buttons
(function () {
  const locateControl = {
    onAdd() {
      const container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const btn = document.createElement('button');
      btn.className = 'maplibregl-ctrl-locate';
      btn.type = 'button';
      btn.title = 'Géolocalisation indisponible';
      btn.disabled = true;
      btn.innerHTML =
        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">` +
        `<circle cx="12" cy="12" r="4"/>` +
        `<line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/>` +
        `<line x1="2" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="22" y2="12"/>` +
        `</svg>`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (geoState.available) {
          map.jumpTo({ center: [geoState.lng, geoState.lat], zoom: 14 });
        } else if (navigator.geolocation) {
          // Re-demander la permission (déclenche le dialog navigateur si pas encore refus permanent)
          navigator.geolocation.getCurrentPosition(
            pos => { _onGeoSuccess(pos); _startWatch(); },
            _onGeoError,
            { enableHighAccuracy: true, timeout: 10000 },
          );
        }
      });
      container.appendChild(btn);
      _geoLocateBtn = btn;
      return container;
    },
    onRemove() {},
  };
  map.addControl(locateControl, 'top-right');
}());

function _startWatch() {
  if (_geoWatchId !== null) navigator.geolocation.clearWatch(_geoWatchId);
  geoState.pending = true;
  const startInput = document.getElementById('route-start');
  if (startInput && !startInput.value) startInput.placeholder = '📍 Localisation…';
  _geoWatchId = navigator.geolocation.watchPosition(_onGeoSuccess, _onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30000,
  });
}

// Start watching — triggers the browser's permission prompt at page load
if (navigator.geolocation) _startWatch();
