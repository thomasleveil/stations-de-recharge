// ── Constants ─────────────────────────────────────────────────────────────

const PARQUET_URL = 'https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet';
const CACHE_DB    = 'irve-v1';
const CACHE_TTL   = 24 * 60 * 60 * 1000; // 24 hours in ms
const CHEAP_CORRIDOR_KM = 5;             // Fixed 5-km corridor for budget networks

// TomTom API key for real-time charging availability (free tier: 2500 req/day).
// Get yours at https://developer.tomtom.com — restrict it to your domain in the console.
const TOMTOM_API_KEY = '';

// ── Operator definitions ──────────────────────────────────────────────────

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
  { match: ['iecharge', 'ie charge', 'ie-charge'], name: 'IECharge',    color: '#06B6D4' },
  { match: ['izivia'],                             name: 'IZIVIA Fast', color: '#F59E0B' },
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

const map = L.map('map', {
  center: [_savedLat, _savedLon],
  zoom: _savedZoom,
  zoomControl: false,
  preferCanvas: true,
});
L.control.zoom({ position: 'topright' }).addTo(map);

// Shared canvas renderer with padding so markers near viewport edges stay visible during panning.
const canvasRenderer = L.canvas({ padding: 0.5 });

let _saveMapTimer = null;
map.on('moveend zoomend', () => {
  clearTimeout(_saveMapTimer);
  _saveMapTimer = setTimeout(() => {
    const c = map.getCenter();
    localStorage.setItem('irve-map-lat',  c.lat.toFixed(6));
    localStorage.setItem('irve-map-lon',  c.lng.toFixed(6));
    localStorage.setItem('irve-map-zoom', map.getZoom());
  }, 500);
});

const cartoTile = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
      '© <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }
).addTo(map);

const AERIAL_SOURCES = {
  esri: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP',
  },
  ign: {
    url: 'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0' +
         '&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}' +
         '&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    attribution: 'IGN-F/Géoportail',
  },
};

let aerialTile = null;

function setAerialSource(src) {
  const wasShowing = aerialTile && map.hasLayer(aerialTile);
  if (aerialTile) map.removeLayer(aerialTile);
  const s = AERIAL_SOURCES[src] || AERIAL_SOURCES.esri;
  aerialTile = L.tileLayer(s.url, { attribution: s.attribution, maxZoom: 19 });
  if (wasShowing) aerialTile.addTo(map);
  localStorage.setItem('irve-aerial-source', src);
}

setAerialSource(localStorage.getItem('irve-aerial-source') || 'esri');

map.on('zoomend', () => {
  const z = map.getZoom();
  if (z >= 18) {
    if (map.hasLayer(cartoTile)) { map.removeLayer(cartoTile); aerialTile.addTo(map); }
  } else {
    if (map.hasLayer(aerialTile)) { map.removeLayer(aerialTile); cartoTile.addTo(map); }
  }
});


// ── Route state (declared early — used by isVisible) ──────────────────────

let ROUTE_BUFFER_KM = 0.2;
let routeActive = false;
let routeLayer  = null;

// ── Draw markers (populated asynchronously by initApp) ────────────────────

const markers = [];
const cheapMarkers = [];

// ── Visibility + legend (reactive) ───────────────────────────────────────

const subEl    = document.querySelector('.panel-sub');
const legendEl = document.getElementById('legend-items');

function isVisible(m) {
  return !routeActive || (m._distFromRoute !== undefined && m._distFromRoute <= ROUTE_BUFFER_KM);
}

function isCheapVisible(m) {
  return routeActive && m._distFromRoute !== undefined && m._distFromRoute <= CHEAP_CORRIDOR_KM;
}

// Equirectangular nearest-distance (km) from point to polyline flat array.
// Mirror of nearestDist in filter-worker.js — used in main thread for cheap markers.
function nearestDistMain(lon, lat, flat) {
  const cosLat = Math.cos(lat * Math.PI / 180);
  const K = 111.32;
  let minD2 = Infinity;
  const len = flat.length;
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

function updateVisibility() {
  let count = 0;
  markers.forEach(m => {
    const visible = isVisible(m);
    if (visible) count++;
    m.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? 0.9 : 0 });
    const el = m.getElement();
    if (el) el.style.pointerEvents = visible ? '' : 'none';
  });

  cheapMarkers.forEach(m => {
    const visible = isCheapVisible(m);
    m.setStyle({ opacity: visible ? 1 : 0, fillOpacity: visible ? 0.75 : 0 });
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

  // Count visible stations per operator (main CCS markers)
  const opCounts = new Map();
  let autreCount = 0;
  markers.forEach(m => {
    if (!isVisible(m)) return;
    const isKnown = OPERATORS.some(op => op.name === m._op.name);
    if (isKnown) {
      const key = m._op.name;
      if (!opCounts.has(key)) opCounts.set(key, { op: m._op, count: 0 });
      opCounts.get(key).count++;
    } else {
      autreCount++;
    }
  });

  [...opCounts.values()]
    .sort((a, b) => b.count - a.count)
    .forEach(({ op, count }) => appendLegendItem(op.name, op.color, count, false));

  if (autreCount > 0) appendLegendItem('Autre', '#6B7280', autreCount, false);

  // Budget networks section (only when route is active)
  if (routeActive) {
    const cheapOpCounts = new Map();
    cheapMarkers.forEach(m => {
      if (!isCheapVisible(m)) return;
      const key = m._op.name;
      if (!cheapOpCounts.has(key)) cheapOpCounts.set(key, { op: m._op, count: 0 });
      cheapOpCounts.get(key).count++;
    });
    if (cheapOpCounts.size > 0) {
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
// Replicates filter_stations.py logic entirely.
// Reads irve_raw.parquet (registered in DuckDB virtual FS) and returns
// one row per station with the same columns as the old stations.parquet.

const FILTER_SQL = `
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
      AND prise_type_combo_ccs = TRUE
      AND TRIM(COALESCE(horaires, '')) = '24/7'
),
qualifying AS (
    SELECT * FROM lat_lon WHERE power_kw >= 150
),
station_first AS (
    SELECT * FROM qualifying
    QUALIFY ROW_NUMBER() OVER (PARTITION BY id_station_itinerance ORDER BY id_pdc_itinerance) = 1
),
station_power AS (
    SELECT id_station_itinerance, MAX(power_kw) AS max_power_kw
    FROM qualifying
    GROUP BY id_station_itinerance
),
station_ccs_fast AS (
    SELECT id_station_itinerance,
           COUNT(DISTINCT id_pdc_itinerance) AS nbre_ccs_fast
    FROM qualifying
    GROUP BY id_station_itinerance
),
truck_sids AS (
    SELECT DISTINCT id_station_itinerance FROM qualifying
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
    cf.nbre_ccs_fast,
    COALESCE(sf.horaires, '')                                  AS horaires,
    CASE WHEN sf.implantation_station = 'Station dédiée à la recharge rapide'
         THEN 'dedicee' ELSE 'parking'
    END AS station_type
FROM station_first sf
JOIN station_power    sp ON sf.id_station_itinerance = sp.id_station_itinerance
JOIN station_ccs_fast cf ON sf.id_station_itinerance = cf.id_station_itinerance
LEFT JOIN truck_sids  ts ON sf.id_station_itinerance = ts.id_station_itinerance
WHERE sf.lat IS NOT NULL AND sf.lat != 0
  AND sf.lon IS NOT NULL AND sf.lon != 0
  AND ts.id_station_itinerance IS NULL
  AND sf.id_station_itinerance NOT LIKE 'FRTSL%'
ORDER BY sf.id_station_itinerance
`;

// ── Budget networks SQL (ENGIE Vianeo + IECharge, no power/CCS constraint) ───

const CHEAP_FILTER_SQL = `
WITH lat_lon AS (
    SELECT *,
        TRY_CAST(consolidated_latitude  AS DOUBLE) AS lat,
        TRY_CAST(consolidated_longitude AS DOUBLE) AS lon,
        TRY_CAST(
            REPLACE(COALESCE(CAST(puissance_nominale AS VARCHAR), '0'), ',', '.')
            AS DOUBLE
        ) AS power_kw
    FROM read_parquet('irve_raw.parquet')
),
station_first AS (
    SELECT * FROM lat_lon
    QUALIFY ROW_NUMBER() OVER (PARTITION BY id_station_itinerance ORDER BY id_pdc_itinerance) = 1
),
station_power AS (
    SELECT id_station_itinerance, MAX(power_kw) AS max_power_kw
    FROM lat_lon
    GROUP BY id_station_itinerance
),
cheap_sids AS (
    -- Use id_station_itinerance AFIREV prefix — more reliable than text fields.
    -- nom_enseigne is optional in practice (IECharge puts commune names there),
    -- nom_operateur is optional per schema. The AFIREV code is immutable.
    --   FRVIA* + nom_station ILIKE '%B&B HOTEL%' → ENGIE Vianeo chez B&B Hotels uniquement
    --   FRIEN* → IECharge       (operator code IEN)
    --   FRIZF* → IZIVIA Fast    (operator code IZF — McDonald's only)
    --   FRTSL* → Tesla          (Superchargers open to all EVs)
    SELECT DISTINCT id_station_itinerance FROM lat_lon
    WHERE (id_station_itinerance LIKE 'FRVIA%' AND nom_station ILIKE '%B&B HOTEL%')
       OR id_station_itinerance LIKE 'FRIEN%'
       OR id_station_itinerance LIKE 'FRIZF%'
       OR id_station_itinerance LIKE 'FRTSL%'
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
    COALESCE(sf.horaires, '')                                  AS horaires
FROM station_first sf
JOIN station_power  sp ON sf.id_station_itinerance = sp.id_station_itinerance
JOIN cheap_sids     cs ON sf.id_station_itinerance = cs.id_station_itinerance
LEFT JOIN truck_sids ts ON sf.id_station_itinerance = ts.id_station_itinerance
WHERE sf.lat IS NOT NULL AND sf.lat != 0
  AND sf.lon IS NOT NULL AND sf.lon != 0
  AND ts.id_station_itinerance IS NULL
  AND sf.condition_acces = 'Accès libre'
ORDER BY sf.id_station_itinerance
`;

// ── Marker builder (shared between cache hit and fresh fetch paths) ───────

function buildMarkers(rows) {
  for (const p of rows) {
    const op = getOperator(p);
    const displayCount = p.nbre_ccs_fast > 0 ? p.nbre_ccs_fast : (parseInt(p.nbre_pdc) || 1);
    const circle = L.circleMarker([p.lat, p.lon], {
      renderer:    canvasRenderer,
      radius:      countRadius(displayCount),
      fillColor:   op.color,
      color:       '#ffffff',
      weight:      2,
      opacity:     1,
      fillOpacity: 0.9,
      interactive: true,
    });

    circle.bindPopup(L.popup({ maxWidth: 300 }).setContent(buildPopup(p, op)));
    circle.bindTooltip(p.nom_station, { direction: 'top', offset: [0, -8] });

    circle._op  = op;
    circle._lon = p.lon;
    circle._lat  = p.lat;

    circle.on('popupopen', () => {
      fetchAvailability(circle).then(html => {
        const el = circle.getPopup()?.getElement()?.querySelector('.popup-avail');
        if (el) el.innerHTML = html;
      });
    });

    circle.addTo(map);
    markers.push(circle);
  }
}

// ── Budget network marker builder ─────────────────────────────────────────

// Unified brand icon HTML (18×18px) — used for both map markers and legend.
// McDonald's + Tesla: official SVG paths from Simple Icons (simpleicons.org, viewBox 0 0 24 24).
// IECharge + B&B Hotels: not in major icon libraries — custom icons using confirmed brand colors.
const BRAND_MARKER_HTML = {
  "IZIVIA Fast - McDonald's":
    "<div style='width:18px;height:18px;background:#DA291C;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><svg width='13' height='13' viewBox='0 0 24 24' fill='#FFC72C'><path d='M17.243 3.006c2.066 0 3.742 8.714 3.742 19.478H24c0-11.588-3.042-20.968-6.766-20.968-2.127 0-4.007 2.81-5.248 7.227-1.241-4.416-3.121-7.227-5.231-7.227C3.031 1.516 0 10.888 0 22.476h3.014c0-10.763 1.658-19.47 3.724-19.47 2.066 0 3.741 8.05 3.741 17.98h2.997c0-9.93 1.684-17.98 3.75-17.98Z'/></svg></div>",
  'Tesla':
    "<div style='width:18px;height:18px;background:#CC0000;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><svg width='13' height='13' viewBox='0 0 24 24' fill='#fff'><path d='M12 5.362l2.475-3.026s4.245.09 8.471 2.054c-1.082 1.636-3.231 2.438-3.231 2.438-.146-1.439-1.154-1.79-4.354-1.79L12 24 8.619 5.034c-3.18 0-4.188.354-4.335 1.792 0 0-2.146-.795-3.229-2.43C5.28 2.431 9.525 2.34 9.525 2.34L12 5.362l-.004.002H12v-.002zm0-3.899c3.415-.03 7.326.528 11.328 2.28.535-.968.672-1.395.672-1.395C19.625.612 15.528.015 12 0 8.472.015 4.375.61 0 2.349c0 0 .195.525.672 1.396C4.674 1.989 8.585 1.435 12 1.46v.003z'/></svg></div>",
  'IECharge':
    "<div style='width:18px;height:18px;background:#004D26;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><svg width='11' height='11' viewBox='0 0 100 100'><path d='M60 5 L25 50 L55 50 L40 95 L75 50 L45 50 Z' fill='#00D084'/></svg></div>",
  'ENGIE Vianeo - B&B HOTELS':
    "<div style='width:18px;height:18px;background:#081C19;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center'><span style='color:#B1D600;font-weight:900;font-size:11px;font-family:Arial,sans-serif;line-height:1'>B</span></div>",
};

function makeBrandDivIcon(opName) {
  const html = BRAND_MARKER_HTML[opName];
  if (!html) return null;
  return L.divIcon({ html, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -11], className: 'cheap-brand-marker' });
}

function buildCheapMarkers(rows) {
  for (const p of rows) {
    let op = getOperator(p);
    if (op.name === 'ENGIE Vianeo') op = { ...op, name: 'ENGIE Vianeo - B&B HOTELS' };
    if (op.name === 'IZIVIA Fast')  op = { ...op, name: "IZIVIA Fast - McDonald's" };

    const brandIcon = makeBrandDivIcon(op.name);
    let circle;
    if (brandIcon) {
      circle = L.marker([p.lat, p.lon], { icon: brandIcon, opacity: 0 });
      // Polyfill setStyle for compatibility with updateVisibility (L.marker has no setStyle)
      circle.setStyle = (opts) => circle.setOpacity(opts.opacity ?? 1);
    } else {
      circle = L.circleMarker([p.lat, p.lon], {
        renderer:    canvasRenderer,
        radius:      7,
        fillColor:   op.color,
        color:       '#ffffff',
        dashArray:   '3,3',
        weight:      2,
        opacity:     0,
        fillOpacity: 0,
        interactive: true,
      });
    }
    circle.bindPopup(L.popup({ maxWidth: 300 }).setContent(buildCheapPopup(p, op)));
    circle.bindTooltip(`${p.nom_station} €`, { direction: 'top', offset: [0, -8] });
    circle._op  = op;
    circle._lon = p.lon;
    circle._lat = p.lat;
    circle.addTo(map);
    cheapMarkers.push(circle);
  }
}

function buildCheapPopup(p, op) {
  const fmt = (v, fallback = '—') => (v && String(v).trim()) ? v : fallback;
  const addr = fmt(p.adresse);
  const shortAddr = addr.length > 60 ? addr.slice(0, 60) + '…' : addr;
  return `
    <div>
      <div class="popup-station">${fmt(p.nom_station)}</div>
      <span class="popup-operator-badge" style="background:${op.color}">${op.name}</span>
      <span class="popup-cheap-badge">€ Abordable</span>
      <div class="popup-grid">
        <span class="popup-label">Puissance max</span>
        <span class="popup-power">${p.max_power_kw ? p.max_power_kw + ' kW' : '—'}</span>

        <span class="popup-label">Nb. de bornes</span>
        <span>${fmt(p.nbre_pdc)}</span>

        <span class="popup-label">Horaires</span>
        <span>${fmt(p.horaires).length > 50 ? fmt(p.horaires).slice(0, 50) + '…' : fmt(p.horaires)}</span>

        <span class="popup-label">Adresse</span>
        <span>${shortAddr}</span>
      </div>
    </div>`;
}

// ── Main init — cache-first, then live fetch + DuckDB filter ─────────────

async function initApp() {
  subEl.textContent = 'Chargement…';

  // 1. Try IndexedDB cache for both datasets (both must be valid to skip fetch)
  const [cached, cachedCheap] = await Promise.all([
    cacheGet('stations').catch(() => null),
    cacheGet('stations-cheap').catch(() => null),
  ]);
  if (cached && cachedCheap &&
      Date.now() - cached.ts < CACHE_TTL &&
      Date.now() - cachedCheap.ts < CACHE_TTL) {
    buildMarkers(cached.rows);
    buildCheapMarkers(cachedCheap.rows);
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

  const conn       = await db.connect();
  const table      = await conn.query(FILTER_SQL);
  const cheapTable = await conn.query(CHEAP_FILTER_SQL);
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
      station_type:  String(row.station_type  ?? 'dedicee'),
    });
  }

  // Convert cheap Arrow rows to plain JS objects
  const cheapRows = [];
  for (const row of cheapTable) {
    cheapRows.push({
      lon:          Number(row.lon),
      lat:          Number(row.lat),
      id:           String(row.id           ?? ''),
      nom_station:  String(row.nom_station  ?? ''),
      adresse:      String(row.adresse      ?? ''),
      operateur:    String(row.operateur    ?? ''),
      enseigne:     String(row.enseigne     ?? ''),
      nbre_pdc:     String(row.nbre_pdc     ?? ''),
      max_power_kw: Number(row.max_power_kw ?? 0),
      horaires:     String(row.horaires     ?? ''),
    });
  }

  // 6. Persist both datasets to IndexedDB (best-effort — never blocks rendering)
  cachePut('stations',       { ts: Date.now(), rows }).catch(() => {});
  cachePut('stations-cheap', { ts: Date.now(), rows: cheapRows }).catch(() => {});

  // 7. Build markers and refresh map
  buildMarkers(rows);
  buildCheapMarkers(cheapRows);
  updateVisibility();
}

initApp().catch(err => {
  console.error('initApp:', err);
  subEl.textContent = '⚠ Erreur de chargement';
});

// ── Popup builder ─────────────────────────────────────────────────────────

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

        <span class="popup-label">Disponibilité CCS2</span>
        <span class="popup-avail">⟳</span>
      </div>
    </div>`;
}

// ── Real-time availability (TomTom) ───────────────────────────────────────

const AVAIL_TTL = 3 * 60 * 1000; // 3 minutes — matches TomTom refresh cadence
const BISON_FUTE_URL = 'https://www.bison-fute.gouv.fr/recharge-electrique.html';

async function fetchAvailability(circle) {
  // Return cached result if still fresh.
  const now = Date.now();
  if (circle._availCache && now - circle._availCache.ts < AVAIL_TTL) {
    return circle._availCache.html;
  }

  // No key configured — show external link immediately.
  if (!TOMTOM_API_KEY) {
    const html = `<a href="${BISON_FUTE_URL}" target="_blank" rel="noopener">Voir sur Bison Futé ↗</a>`;
    circle._availCache = { ts: now, html };
    return html;
  }

  try {
    // Step 1: find the TomTom place ID by proximity (cached across sessions).
    if (!circle._tomtomId) {
      const url = `https://api.tomtom.com/search/2/nearbySearch/.json` +
        `?key=${TOMTOM_API_KEY}&lat=${circle._lat}&lon=${circle._lon}` +
        `&radius=100&categorySet=7309&limit=5`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`nearbySearch ${res.status}`);
      const data = await res.json();
      const result = data.results?.[0];
      if (!result) {
        const html = `<a href="${BISON_FUTE_URL}" target="_blank" rel="noopener">Voir sur Bison Futé ↗</a>`;
        circle._availCache = { ts: now, html };
        return html;
      }
      circle._tomtomId = result.id;
    }

    // Step 2: query real-time availability.
    const url2 = `https://api.tomtom.com/search/2/chargingAvailability.json` +
      `?key=${TOMTOM_API_KEY}&chargingAvailability=${encodeURIComponent(circle._tomtomId)}`;
    const res2 = await fetch(url2);
    if (!res2.ok) throw new Error(`chargingAvailability ${res2.status}`);
    const data2 = await res2.json();

    // Filter CCS2 (IEC_62196_T2_COMBO) connectors rated ≥ 150 kW.
    const ccs2 = (data2.connectorAvailabilities ?? [])
      .filter(c => c.type === 'IEC_62196_T2_COMBO' && (c.ratedPowerKW ?? 0) >= 150);

    let html;
    if (ccs2.length === 0) {
      html = `<a href="${BISON_FUTE_URL}" target="_blank" rel="noopener">Voir sur Bison Futé ↗</a>`;
    } else {
      const available = ccs2.reduce((s, c) => s + (c.availability?.available ?? 0), 0);
      const total     = ccs2.reduce((s, c) => s + (c.availability?.total     ?? 0), 0);
      const cls = available > 0 ? 'popup-avail-ok' : 'popup-avail-none';
      html = `<span class="${cls}">${available} / ${total} disponible${available > 1 ? 's' : ''}</span>`;
    }

    circle._availCache = { ts: now, html };
    return html;
  } catch (e) {
    console.warn('TomTom availability:', e.message);
    const html = `<a href="${BISON_FUTE_URL}" target="_blank" rel="noopener">Voir sur Bison Futé ↗</a>`;
    circle._availCache = { ts: now, html };
    return html;
  }
}

// ── Route planning ─────────────────────────────────────────────────────────

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

// Singleton Web Worker for off-thread route filtering.
let _filterWorker = null;
function getFilterWorker() {
  if (!_filterWorker) _filterWorker = new Worker('filter-worker.js');
  return _filterWorker;
}

async function applyRouteFilter(routeLine, onProgress) {
  const coords = routeLine.geometry.coordinates;

  // Pack coordinates into transferable Float64Arrays (zero-copy to worker).
  const routeFlat = new Float64Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    routeFlat[i * 2]     = coords[i][0];
    routeFlat[i * 2 + 1] = coords[i][1];
  }
  const stationsFlat = new Float64Array(markers.length * 2);
  for (let i = 0; i < markers.length; i++) {
    stationsFlat[i * 2]     = markers[i]._lon;
    stationsFlat[i * 2 + 1] = markers[i]._lat;
  }

  return new Promise(resolve => {
    const worker = getFilterWorker();
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        if (onProgress) onProgress(data.done, data.total);
      } else {
        // data.type === 'done'
        const results = new Float32Array(data.results);
        for (let i = 0; i < markers.length; i++) {
          markers[i]._distFromRoute  = results[i];
          markers[i]._distAlongRoute = 0;
        }
        updateVisibility();
        resolve();
      }
    };
    worker.postMessage(
      { routeFlat, stationsFlat, bufferKm: ROUTE_BUFFER_KM },
      [routeFlat.buffer, stationsFlat.buffer],
    );
  });
}

function clearRoute() {
  routeActive = false;
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  markers.forEach(m => { delete m._distFromRoute; delete m._distAlongRoute; });
  cheapMarkers.forEach(m => { delete m._distFromRoute; });
  updateVisibility();
  document.getElementById('route-info').textContent = '';
  document.getElementById('route-clear').style.display = 'none';
  const btn = document.getElementById('route-go');
  btn.style.display = '';
  btn.disabled = false;
  btn.textContent = 'Calculer →';

  // Mobile: restore full panel
  document.getElementById('panel').classList.remove('route-calculated', 'panel-expanded');
}

let currentRouteKm = 0;

async function calculateRoute() {
  const startInput = document.getElementById('route-start');
  const endInput   = document.getElementById('route-end');
  const startVal   = startInput.value.trim();
  const endVal     = endInput.value.trim();
  if (!endVal || (!startVal && !geoState.available)) return;

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
    const useGeoStart = !startVal && geoState.available;
    await step(useGeoStart ? '📍 Position GPS du départ…' : '📍 Géocodage du départ…');
    const t1 = performance.now();
    const from = useGeoStart ? [geoState.lng, geoState.lat] : (startInput._coords || await geocode(startVal));
    await step('📍 Géocodage de l\'arrivée…');
    const to = endInput._coords || await geocode(endVal);
    console.log(`geocode: ${Math.round(performance.now() - t1)} ms`);

    await step('🗺 Calcul d\'itinéraire…');
    const t2 = performance.now();
    const route = await fetchRoute(from, to);
    console.log(`osrm: ${Math.round(performance.now() - t2)} ms`);

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(route.geometry, {
      style: { color: '#1D4ED8', weight: 4, opacity: 0.75 },
      renderer: canvasRenderer,
    }).addTo(map);
    routeLayer.bringToBack();
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

    // Compute distances for budget network markers in main thread (20-km corridor)
    if (cheapMarkers.length > 0) {
      const coords = route.geometry.coordinates;
      const cheapRouteFlat = new Float64Array(coords.length * 2);
      for (let i = 0; i < coords.length; i++) {
        cheapRouteFlat[i * 2]     = coords[i][0];
        cheapRouteFlat[i * 2 + 1] = coords[i][1];
      }
      for (const m of cheapMarkers) {
        m._distFromRoute = nearestDistMain(m._lon, m._lat, cheapRouteFlat);
      }
      updateVisibility();
    }

    console.log(`total: ${Math.round(performance.now() - t0)} ms`);

    currentRouteKm = Math.round(route.legs.reduce((s, l) => s + l.distance, 0) / 1000);
    info.className = 'route-stat';
    info.textContent = `${currentRouteKm} km · corridor ±${ROUTE_BUFFER_KM * 1000} m`;

    document.getElementById('route-clear').style.display = '';
    btn.style.display = 'none';

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
}

document.getElementById('route-go').addEventListener('click', calculateRoute);

document.getElementById('route-clear').addEventListener('click', clearRoute);

// Keyboard Enter on route inputs is handled inside setupAutocomplete below.

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

// ── Corridor slider ────────────────────────────────────────────────────────

document.getElementById('corridor-label').addEventListener('click', () => {
  const slider = document.getElementById('corridor-slider');
  slider.style.display = slider.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('corridor-slider').addEventListener('input', () => {
  const v = parseInt(document.getElementById('corridor-slider').value, 10);
  ROUTE_BUFFER_KM = v / 10;
  document.getElementById('corridor-value').textContent = (v * 100) + ' m';
  if (routeActive) {
    const info = document.getElementById('route-info');
    info.className = 'route-stat';
    info.textContent = `${currentRouteKm} km · corridor ±${ROUTE_BUFFER_KM * 1000} m`;
    updateVisibility();
  }
});

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
      if (selectActive()) {
        e.stopImmediatePropagation();
      } else {
        calculateRoute();
      }
    } else if (e.key === 'Escape') {
      dropdown.innerHTML = '';
      activeIdx = -1;
    }
  });

  input.addEventListener('input', () => {
    input._coords = null;
    activeIdx = -1;
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    dropdown.innerHTML = '';
    localStorage.setItem('irve-' + input.id, JSON.stringify({ text: q }));
    if (q.length < 3) return;
    debounceTimer = setTimeout(() => fetchAutocompleteSuggestions(q, dropdown, input), 300);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.innerHTML = ''; activeIdx = -1; }, 200);
  });
}

async function fetchAutocompleteSuggestions(q, dropdown, input) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=fr,be,ch,lu`;
    const data = await fetch(url, { headers: { 'Accept-Language': 'fr' } }).then(r => r.json());
    dropdown.innerHTML = '';
    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      // Show a short label: first two comma-separated parts of display_name
      const parts  = item.display_name.split(',');
      div.textContent = parts.slice(0, 2).join(',').trim();
      div.title = item.display_name;
      div.addEventListener('mousedown', () => {
        const text = parts.slice(0, 2).join(',').trim();
        const coords = [parseFloat(item.lon), parseFloat(item.lat)];
        input.value   = text;
        input._coords = coords;
        dropdown.innerHTML = '';
        localStorage.setItem('irve-' + input.id, JSON.stringify({ text, coords }));
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

// ── Settings menu ──────────────────────────────────────────────────────────

(function setupSettings() {
  const btn  = document.getElementById('settings-btn');
  const menu = document.getElementById('settings-menu');
  const bustBtn = document.getElementById('cache-bust-btn');

  // Sync radio to current aerial source
  const savedSrc = localStorage.getItem('irve-aerial-source') || 'esri';
  const radio = menu.querySelector(`input[name="aerial-src"][value="${savedSrc}"]`);
  if (radio) radio.checked = true;

  menu.querySelectorAll('input[name="aerial-src"]').forEach(r => {
    r.addEventListener('change', () => setAerialSource(r.value));
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });

  menu.addEventListener('click', e => e.stopPropagation());

  bustBtn.addEventListener('click', () => {
    const req = indexedDB.deleteDatabase('irve-v1');
    req.onsuccess = () => window.location.reload();
    req.onerror   = () => window.location.reload();
    req.onblocked = () => window.location.reload();
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

const geoState = { available: false, lat: null, lng: null, heading: 0 };
const _geoHistory = [];   // rolling buffer of last positions for bearing
let _geoMarker    = null;
let _geoLocateBtn = null;
let _geoWatchId   = null;

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

function _makeArrowIcon(heading) {
  return L.divIcon({
    className: 'geoloc-marker-outer',
    html: `<div class="geoloc-marker" style="transform:rotate(${Math.round(heading)}deg)">` +
          `<svg width="24" height="24" viewBox="0 0 24 24">` +
          `<path d="M12 2 L20 20 L12 16 L4 20 Z" fill="#EF4444" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>` +
          `</svg></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
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
  geoState.lat = lat;
  geoState.lng = lng;
  geoState.heading = heading;

  const icon = _makeArrowIcon(heading);
  if (!_geoMarker) {
    _geoMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
  } else {
    _geoMarker.setLatLng([lat, lng]);
    _geoMarker.setIcon(icon);
  }

  if (_geoLocateBtn) {
    _geoLocateBtn.disabled = false;
    _geoLocateBtn.title = 'Centrer sur ma position';
    _geoLocateBtn.classList.remove('geoloc-retry');
  }

  const startInput = document.getElementById('route-start');
  if (startInput && !startInput.value) startInput.placeholder = 'Ma position (GPS)';
}

function _onGeoError(err) {
  geoState.available = false;
  if (err.code !== 1) console.warn('Géolocalisation :', err.message);
  // Permission refusée : activer le bouton pour permettre une nouvelle tentative
  if (err.code === 1 && _geoLocateBtn) {
    _geoLocateBtn.disabled = false;
    _geoLocateBtn.title = 'Activer la géolocalisation';
    _geoLocateBtn.classList.add('geoloc-retry');
  }
}

// Locate button — custom Leaflet control positioned below zoom buttons
(function () {
  const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const btn = L.DomUtil.create('button', 'leaflet-control-locate', container);
      btn.type = 'button';
      btn.title = 'Géolocalisation indisponible';
      btn.disabled = true;
      btn.innerHTML =
        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">` +
        `<circle cx="12" cy="12" r="4"/>` +
        `<line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/>` +
        `<line x1="2" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="22" y2="12"/>` +
        `</svg>`;
      L.DomEvent.on(btn, 'click', L.DomEvent.stopPropagation);
      L.DomEvent.on(btn, 'click', () => {
        if (geoState.available) {
          map.setView([geoState.lat, geoState.lng], 14);
        } else if (navigator.geolocation) {
          // Re-demander la permission (déclenche le dialog navigateur si pas encore refus permanent)
          navigator.geolocation.getCurrentPosition(
            pos => { _onGeoSuccess(pos); _startWatch(); },
            _onGeoError,
            { enableHighAccuracy: true, timeout: 10000 },
          );
        }
      });
      _geoLocateBtn = btn;
      return container;
    },
  });
  new LocateControl().addTo(map);
}());

function _startWatch() {
  if (_geoWatchId !== null) navigator.geolocation.clearWatch(_geoWatchId);
  _geoWatchId = navigator.geolocation.watchPosition(_onGeoSuccess, _onGeoError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 30000,
  });
}

// Start watching — triggers the browser's permission prompt at page load
if (navigator.geolocation) _startWatch();
