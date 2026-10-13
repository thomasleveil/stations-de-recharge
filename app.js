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

// ── Marker sizing (radius in px) ──────────────────────────────────────────

function countRadius(n) {
  // Log2 scale: 1 PDC → 8px, 4 → 10px, 8 → 12px, 16+ → 14px
  return 6 + Math.log2((n || 1) + 1) * 2;
}

// ── Map initialisation ────────────────────────────────────────────────────

const _savedLat  = parseFloat(localStorage.getItem('irve-map-lat'))  || 45.1;
const _savedLon  = parseFloat(localStorage.getItem('irve-map-lon'))  || 4.8;
const _savedZoom = parseInt(localStorage.getItem('irve-map-zoom'), 10) || 7;

// OpenFreeMap vector basemaps: free, no API key (CARTO raster tiles now
// require one — B-6). Positron and Dark share the same sources, sprite and
// glyphs, so the dark layers are added next to the light ones and the theme
// toggle only flips visibility. map.setStyle() would drop our own layers.
const BASEMAP_LIGHT_URL = 'https://tiles.openfreemap.org/styles/positron';
const BASEMAP_DARK_URL  = 'https://tiles.openfreemap.org/styles/dark';
let _basemapLightIds = [];
let _basemapDarkIds  = [];

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAP_LIGHT_URL,
  center: [_savedLon, _savedLat],  // MapLibre uses [lng, lat]
  zoom: _savedZoom,
  attributionControl: { compact: true },
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
// ── Visibility + legend (reactive) ───────────────────────────────────────


// Piste 2.2 — delta-updates state: Sets of currently visible markers.
// null = uninitialised (first call applies to all; subsequent calls diff).
let _prevVisMain  = null;
function isVisible(m) {
  if (m._cheap) {
    // Cheap markers: no power filter, wider corridor when route active
    if (emergencyModeActive && _emergencyMarkers.has(m)) return true;
    return !routeActive || (m._distFromRoute !== undefined && m._distFromRoute <= CHEAP_CORRIDOR_KM);
  }
  // F-3 — minimum power filter
  if (m._maxPowerKw !== undefined && m._maxPowerKw < MIN_POWER_KW) return false;
  if (emergencyModeActive && _emergencyMarkers.has(m)) return true;
  return !routeActive || (m._distFromRoute !== undefined && m._distFromRoute <= ROUTE_BUFFER_KM);
}

function updateVisibility() {
  // Compute visible set (unified: both main and cheap markers)
  const nextVisMain  = new Set();
  let countMain = 0;
  for (const m of markers) {
    if (isVisible(m)) {
      nextVisMain.add(m);
      if (!m._cheap) countMain++;
    }
  }

  const _hasPref = preferredNetworks.size > 0 && routeActive;

  // Build GeoJSON features for all visible markers (main + cheap)
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

  _prevVisMain = nextVisMain;

  // The legend is gone: network names are written in every list row instead.
  window.UI?.onVisibility?.(countMain);
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
    let op = getOperator(p);
    const cheap = Boolean(p.cheap);
    // Override operator names for cheap network brands
    if (cheap) {
      if (op.name === 'ENGIE Vianeo') op = { ...op, name: 'ENGIE Vianeo - B&B HOTELS' };
      if (op.name === 'IZIVIA Fast')  op = { ...op, name: "IZIVIA Fast - McDonald's" };
    }
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
      _cheap:      cheap,           // budget-network marker (wider corridor, € Abordable popup)
    };
    markers.push(m);
  }
  // GeoJSON source is populated by updateVisibility()
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

// Status line of the sheet while data loads (was the panel subtitle).
function _setStatus(text) { window.UI?.onStatus?.(text); }

async function initApp() {
  _setStatus('Chargement…');

  // R2 — Loading overlay progress helpers
  const _loadOverlay = document.getElementById('loading-overlay');
  const _loadStep    = document.getElementById('loading-step');
  const _loadBar     = document.getElementById('loading-bar');
  function _setLoading(msg, pct) {
    if (_loadStep) _loadStep.textContent = msg;
    if (_loadBar)  _loadBar.style.width  = pct + '%';
  }
  function _hideLoading() {
    if (_loadOverlay) {
      _loadOverlay.classList.add('fade-out');
      _loadOverlay.addEventListener('transitionend', () => _loadOverlay.remove(), { once: true });
    }
  }

  _setLoading('Chargement des bornes…', 5);

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
    _setLoading('Chargement des bornes…', 80);
    showDataFreshness(cached.ts);
    markers.length = 0;
    const src = map.getSource('stations');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
    buildMarkers(cached.rows);
    updateVisibility();
    _setLoading(`${markers.length} bornes chargées`, 100);
    _hideLoading();
    return;
  }

  // 2. Initialize DuckDB WASM
  _setLoading('Chargement des bornes…', 10);
  _setStatus('Chargement des bornes…');
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
  _setLoading('Téléchargement des bornes…', 20);
  _setStatus('Téléchargement des bornes…');
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
      const dlPct = Math.round(received / total * 100);
      _setStatus(`Téléchargement des bornes… ${dlPct} %`);
      _setLoading(`Téléchargement des bornes… ${dlPct} %`, 20 + dlPct * 0.5);
    }
  }

  // Reassemble chunks into a single Uint8Array
  const buf = new Uint8Array(received);
  let pos = 0;
  for (const chunk of chunks) { buf.set(chunk, pos); pos += chunk.length; }

  // 4. Register parquet in DuckDB virtual FS and run the filter query
  _setLoading('Préparation de la carte…', 75);
  _setStatus('Préparation de la carte…');
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
  _setLoading('Préparation de la carte…', 90);
  markers.length = 0;
  const src = map.getSource('stations');
  if (src) src.setData({ type: 'FeatureCollection', features: [] });
  buildMarkers(rows);
  updateVisibility();
  _setLoading(`${markers.length} bornes chargées`, 100);
  _hideLoading();
}

// ── Initialisation après chargement de la carte ──────────────────────────

map.on('load', () => {
  _basemapLightIds = map.getStyle().layers.map(l => l.id);

  // ── GeoJSON sources ──────────────────────────────────────────────────────
  map.addSource('route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource('stations', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 11,
    clusterRadius: 50,
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
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        6,  ['*', ['get', 'radius'], 0.4],
        10, ['*', ['get', 'radius'], 0.7],
        13, ['get', 'radius'],
      ],
      'circle-color':          ['get', 'color'],
      'circle-stroke-color':   ['get', 'strokeColor'],
      'circle-stroke-width':   ['get', 'strokeWidth'],
      'circle-opacity':        0.9,
      'circle-stroke-opacity': 1,
    },
  });

  // ── R5 — Cluster circle layer ─────────────────────────────────────────────
  map.addLayer({
    id:     'clusters',
    type:   'circle',
    source: 'stations',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        '#51bbd6', 10,
        '#f1f075', 30,
        '#f28cb1',
      ],
      'circle-radius': [
        'step', ['get', 'point_count'],
        15, 10, 20, 30, 25,
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  // ── R5 — Cluster count label ──────────────────────────────────────────────
  map.addLayer({
    id:     'cluster-count',
    type:   'symbol',
    source: 'stations',
    filter: ['has', 'point_count'],
    layout: {
      'text-field':  '{point_count_abbreviated}',
      'text-font':   ['Noto Sans Regular'],
      'text-size':   12,
    },
    paint: {
      'text-color': '#1e293b',
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

  // ── R5 — Cluster click: zoom into cluster ────────────────────────────────
  map.on('click', 'clusters', e => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource('stations').getClusterExpansionZoom(clusterId)
      .then(zoom => { map.easeTo({ center: features[0].geometry.coordinates, zoom }); })
      .catch(() => {});
  });
  map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

  // ── Click → station selection (the sheet shows it; no map popup) ─────────
  map.on('click', 'stations-layer', e => {
    if (_hoverPopup) { _hoverPopup.remove(); _hoverPopup = null; }
    const m = markers[e.features[0].properties.idx];
    if (m) window.UI?.onStationClick?.(m);
  });

  _addDarkBasemap();

  // ── R4 — Re-apply theme after style fully loaded ────────────────────────
  const savedTheme = localStorage.getItem('irve-theme');
  if (savedTheme === 'dark') applyTheme('dark');

  // ── Lancer l'app ─────────────────────────────────────────────────────────
  initApp().then(() => {
    _markersReady = true;
    window.UI?.onReady?.();
  }).catch(err => {
    console.error('initApp:', err);
    _setStatus('⚠ Erreur de chargement des données');
    const _ov = document.getElementById('loading-overlay');
    if (_ov) { _ov.classList.add('fade-out'); setTimeout(() => _ov.remove(), 600); }
  });
});

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

// B-8 — main-thread copy of the route, kept to project the GPS position in
// drive mode (routeFlat itself is transferred to the worker). Set by
// applyRouteFilter(), cleared by clearRoute().
let _routeGeom = null; // { flat: Float64Array, cumKm: Float64Array }

/** Cumulative km at each vertex — same formula as cumulativeKm() in filter-worker.js. */
function _routeCumKm(flat) {
  const K = 111.32;
  const n = flat.length >>> 1;
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
 * Progress (0–1, by distance) of the nearest projection of (lon, lat) on the
 * current route — same scale as m._progressOnRoute, so
 * (m._progressOnRoute − _routeProgressAt(…)) × currentRouteKm is the distance
 * along the route. Mirrors nearestDistAndProgress() in filter-worker.js.
 */
function _routeProgressAt(lon, lat) {
  if (!_routeGeom) return 0;
  const { flat, cumKm } = _routeGeom;
  const cosLat = Math.cos(lat * Math.PI / 180);
  let minD2 = Infinity, bestI = 0, bestT = 0;
  for (let i = 0; i < flat.length - 2; i += 2) {
    const ax = flat[i],     ay = flat[i + 1];
    const dx = (flat[i + 2] - ax) * cosLat, dy = flat[i + 3] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0
      ? Math.max(0, Math.min(1, ((lon - ax) * cosLat * dx + (lat - ay) * dy) / len2))
      : 0;
    const ex = (ax - lon) * cosLat + t * dx, ey = ay - lat + t * dy;
    const d2 = ex * ex + ey * ey;
    if (d2 < minD2) { minD2 = d2; bestI = i >>> 1; bestT = t; }
  }
  const totalKm = cumKm[cumKm.length - 1];
  return totalKm > 0
    ? (cumKm[bestI] + bestT * (cumKm[bestI + 1] - cumKm[bestI])) / totalKm
    : 0;
}

async function applyRouteFilter(routeLine, onProgress) {
  const coords = routeLine.geometry.coordinates;

  // Pack route into transferable Float64Array (zero-copy to worker).
  const routeFlat = new Float64Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    routeFlat[i * 2]     = coords[i][0];
    routeFlat[i * 2 + 1] = coords[i][1];
  }
  _routeGeom = { flat: routeFlat.slice(), cumKm: _routeCumKm(routeFlat) };

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

  // Filter to bbox — typical Paris→Lyon keeps ~400-600 markers
  const nearbyMarkers = markers.filter(
    m => m._lon >= minLon && m._lon <= maxLon && m._lat >= minLat && m._lat <= maxLat
  );
  // Pack only bbox-filtered markers into transferable arrays
  const stationsFlat = new Float64Array(nearbyMarkers.length * 2);
  for (let i = 0; i < nearbyMarkers.length; i++) {
    stationsFlat[i * 2]     = nearbyMarkers[i]._lon;
    stationsFlat[i * 2 + 1] = nearbyMarkers[i]._lat;
  }

  // Use the wider corridor (cheap markers need CHEAP_CORRIDOR_KM) for worker prefilter
  const workerBuffer = Math.max(ROUTE_BUFFER_KM, CHEAP_CORRIDOR_KM);

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

        updateVisibility();
        staggeredFadeIn();   // piste 4.2
        resolve();
      }
    };
    const transfers = [routeFlat.buffer, stationsFlat.buffer];
    worker.postMessage(
      { routeFlat, stationsFlat, bufferKm: workerBuffer },
      transfers,
    );
  });
}

// ── Staggered fade-in (piste 4.2) ─────────────────────────────────────────
// Animates visible route-corridor stations appearing from route-start to route-end.
// Relies on _progressOnRoute (0–1) set by the worker in applyRouteFilter().
function staggeredFadeIn() {
  if (!routeActive) return;

  const visible = markers.filter(m => isVisible(m))
    .sort((a, b) => (a._progressOnRoute ?? 0) - (b._progressOnRoute ?? 0));

  if (visible.length === 0) return;

  // Invalidate delta-update state: next updateVisibility() must do a full pass.
  _prevVisMain = null;

  // Hide everything at the start — rebuild progressively via setData
  const srcSta = map.getSource('stations');
  if (srcSta) srcSta.setData({ type: 'FeatureCollection', features: [] });

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

    // Rebuild GeoJSON features for all markers shown so far
    const feats = [];
    for (let i = 0; i <= showUpTo; i++) {
      const m = visible[i];
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
  // Its markers (now unified with _cheap flag) have _progressOnRoute set by the worker.
  for (const m of markers) {
    if (!m._cheap || m._op.name !== 'Tesla' || !isVisible(m)) continue;
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

// ── Drive / nearby state (UI lives in ui.js) ─────────────────────────────

let driveModeActive     = false;
let emergencyModeActive = false;   // « Bornes proches »: isVisible() also shows _emergencyMarkers
let _emergencyMarkers   = new Set();

/**
 * Stations within `radiusKm` of (lat, lng), nearest first: [{ m, dist }] with
 * dist in km (straight line). Bbox pre-filter then haversine, as before.
 */
function _nearbyList(lat, lng, radiusKm = 15, max = 20) {
  const LAT_DELTA = radiusKm / 111, LON_DELTA = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const out = [];
  for (const m of markers) {
    if (Math.abs(m._lat - lat) > LAT_DELTA || Math.abs(m._lon - lng) > LON_DELTA) continue;
    if (!m._cheap && m._maxPowerKw !== undefined && m._maxPowerKw < MIN_POWER_KW) continue;
    const dist = _geoHaversineM(lat, lng, m._lat, m._lon) / 1000;
    if (dist <= radiusKm) out.push({ m, dist });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, max);
}

/**
 * B-8 — stations AHEAD of the GPS position on the active route, nearest first:
 * [{ m, dist }] with dist = km measured along the route.
 */
function _driveAheadList(max = 10) {
  if (!routeActive || !geoState.available) return [];
  const userProgress = _routeProgressAt(geoState.lng, geoState.lat);
  const sorted = [];
  for (const m of markers) {
    if (!isVisible(m) || m._progressOnRoute === undefined) continue;
    const dist = (m._progressOnRoute - userProgress) * currentRouteKm;
    if (dist <= 0.5) continue;
    sorted.push({ m, dist });
  }
  sorted.sort((a, b) => a.dist - b.dist);
  return sorted.slice(0, max);
}

/** Engine half of « Effacer »: drop the route and every per-route marker field. */
function clearRouteState() {
  routeActive = false;
  _routeGeom = null;
  currentRouteKm = 0;
  map.getSource('route')?.setData({ type: 'FeatureCollection', features: [] });
  markers.forEach(m => { delete m._distFromRoute; });
  updateVisibility();
}

let currentRouteKm = 0;

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

  window.UI?.onGeo?.();
  _checkSunCalcTheme();

  // FIX 4 — throttle refreshDrivePanel: skip if < 3s since last refresh AND moved < 100m
  const _driveNow = Date.now();
  const dlat = lat - (_lastDrivePos?.lat || lat);
  const dlon = lng - (_lastDrivePos?.lon || lng);
  const approxKm = Math.sqrt(dlat * dlat + dlon * dlon) * 111;
  if (_driveNow - _lastDriveRefreshTime < 3000 && approxKm < 0.1) return;
  _lastDriveRefreshTime = _driveNow;
  _lastDrivePos = { lat, lon: lng };
  window.UI?.onGeoMove?.();
}

function _onGeoError(err) {
  geoState.available = false;
  geoState.pending   = false;
  if (err.code !== 1) console.warn('Géolocalisation :', err.message);
  window.UI?.onGeo?.();
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
  _geoWatchId = navigator.geolocation.watchPosition(_onGeoSuccess, _onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30000,
  });
}

// Start watching — triggers the browser's permission prompt at page load
if (navigator.geolocation) _startWatch();

// ── R4 — Dark mode (SunCalc auto + manual toggle) ──────────────────────────

let _themeManualThisSession = false; // session-only: reset on each page load
let _lastSunCalcCheck = 0;
const _SUNCALC_INTERVAL = 5 * 60 * 1000; // 5 minutes

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('irve-theme', theme);
  window.UI?.onTheme?.(theme);
  const darkReady = _basemapDarkIds.length > 0;
  const show = (ids, on) => ids.forEach(id => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  try {
    show(_basemapLightIds, theme !== 'dark' || !darkReady);  // light stays up until dark is loaded
    show(_basemapDarkIds, theme === 'dark');
  } catch (_) {
    // Style not loaded yet — will be applied in map.on('load')
  }
}

// Dark basemap layers, added hidden below our own layers once the light style
// has loaded. If the fetch fails the map simply stays on the light basemap.
async function _addDarkBasemap() {
  try {
    const style = await (await fetch(BASEMAP_DARK_URL)).json();
    for (const [id, src] of Object.entries(style.sources)) {
      if (!map.getSource(id)) map.addSource(id, src);
    }
    for (const layer of style.layers) {
      const id = 'dark:' + layer.id;
      map.addLayer({ ...layer, id, layout: { ...layer.layout, visibility: 'none' } }, 'route-layer');
      _basemapDarkIds.push(id);
    }
  } catch (e) {
    console.warn('Dark basemap unavailable, keeping the light one:', e);
    _basemapDarkIds.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    _basemapDarkIds = [];
    return;
  }
  applyTheme(document.documentElement.dataset.theme || 'light');
}

function _checkSunCalcTheme() {
  if (_themeManualThisSession) return;
  if (!geoState.available) return;
  if (typeof SunCalc === 'undefined') return;
  const now = Date.now();
  if (now - _lastSunCalcCheck < _SUNCALC_INTERVAL) return;
  _lastSunCalcCheck = now;
  const times = SunCalc.getTimes(new Date(), geoState.lat, geoState.lng);
  const isDark = now < times.dawn.getTime() || now > times.dusk.getTime();
  applyTheme(isDark ? 'dark' : 'light');
}

// The manual toggle lives in the settings view (ui.js: setThemeChoice).

// prefers-color-scheme fallback (before GPS is available)
const _prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
_prefersDark.addEventListener('change', () => {
  if (_themeManualThisSession) return;
  if (geoState.available) return; // SunCalc handles it
  applyTheme(_prefersDark.matches ? 'dark' : 'light');
});

// Initial theme: system preference until SunCalc takes over
(function initTheme() {
  localStorage.removeItem('irve-theme-manual'); // clean up old key
  applyTheme(_prefersDark.matches ? 'dark' : 'light');
})();

// Periodic SunCalc check (covers cases where GPS updates stop)
setInterval(_checkSunCalcTheme, _SUNCALC_INTERVAL);
