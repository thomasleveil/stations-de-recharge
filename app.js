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

// ── Motorway colors ───────────────────────────────────────────

const MOTORWAYS = {
  A7:  { color: '#EF4444', bg: '#FEE2E2' },
  A8:  { color: '#0EA5E9', bg: '#E0F2FE' },
  A47: { color: '#10B981', bg: '#D1FAE5' },
  A72: { color: '#F59E0B', bg: '#FEF3C7' },
  A85: { color: '#3B82F6', bg: '#DBEAFE' },
  A89: { color: '#8B5CF6', bg: '#EDE9FE' },
};

// ── Marker sizing (radius in px) ──────────────────────────────

function powerRadius(kw) {
  // 150 kW → 7 px, 400 kW → 13 px
  return 7 + Math.min((kw - 150) / 250, 1) * 6;
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

// ── Motorway filter buttons ───────────────────────────────────

const activeMw = new Set(Object.keys(MOTORWAYS));
const filtersEl = document.getElementById('mw-filters');

Object.entries(MOTORWAYS).forEach(([mw, { color, bg }]) => {
  const btn = document.createElement('button');
  btn.className = 'mw-btn';
  btn.textContent = mw;
  btn.style.color = color;
  btn.style.borderColor = color;
  btn.style.background = bg;
  btn.dataset.mw = mw;

  btn.addEventListener('click', () => {
    if (activeMw.has(mw)) {
      activeMw.delete(mw);
      btn.classList.add('off');
    } else {
      activeMw.add(mw);
      btn.classList.remove('off');
    }
    updateVisibility();
  });

  filtersEl.appendChild(btn);
});

// ── Draw markers ──────────────────────────────────────────────

const markers = [];

STATIONS_DATA.features.forEach(feature => {
  const p = feature.properties;
  const op = getOperator(p);
  const [lon, lat] = feature.geometry.coordinates;

  const circle = L.circleMarker([lat, lon], {
    radius:      powerRadius(p.max_power_kw),
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

  circle._motorway = p.autoroute;
  circle.addTo(map);
  markers.push(circle);
});

function updateVisibility() {
  markers.forEach(m => {
    const visible = activeMw.has(m._motorway);
    m.setStyle({
      opacity:     visible ? 1 : 0,
      fillOpacity: visible ? 0.9 : 0,
    });
    // Disable pointer events on hidden markers
    const el = m.getElement();
    if (el) el.style.pointerEvents = visible ? '' : 'none';
  });
}

// ── Popup builder ─────────────────────────────────────────────

function buildPopup(p, op) {
  const fmt = (v, fallback = '—') => (v && String(v).trim()) ? v : fallback;
  const hours = fmt(p.horaires);
  const shortHours = hours.length > 50 ? hours.slice(0, 50) + '…' : hours;
  const addr = fmt(p.adresse);
  const shortAddr = addr.length > 60 ? addr.slice(0, 60) + '…' : addr;

  return `
    <div>
      <div class="popup-station">${fmt(p.nom_station)}</div>
      <span class="popup-operator-badge" style="background:${op.color}">${op.name}</span>
      <div class="popup-grid">
        <span class="popup-label">Autoroute</span>
        <strong>${fmt(p.autoroute)}</strong>

        <span class="popup-label">Puissance max</span>
        <span class="popup-power">${p.max_power_kw} kW</span>

        <span class="popup-label">Nb. de bornes</span>
        <span>${fmt(p.nbre_pdc)}</span>

        <span class="popup-label">Horaires</span>
        <span>${shortHours}</span>

        <span class="popup-label">Adresse</span>
        <span>${shortAddr}</span>
      </div>
    </div>`;
}

// ── Legend ────────────────────────────────────────────────────

const legendEl = document.getElementById('legend-items');

// Determine which operators actually appear in the data
const presentOps = new Map();
STATIONS_DATA.features.forEach(f => {
  const op = getOperator(f.properties);
  if (!presentOps.has(op.name)) presentOps.set(op.name, op.color);
});

// Render in the predefined order, then catch-all "Autre"
const renderedNames = new Set();
OPERATORS.forEach(op => {
  if (!presentOps.has(op.name)) return;
  appendLegendItem(op.name, op.color);
  renderedNames.add(op.name);
});

presentOps.forEach((color, name) => {
  if (!renderedNames.has(name)) appendLegendItem(name, color);
});

function appendLegendItem(name, color) {
  const div = document.createElement('div');
  div.className = 'legend-item';
  div.innerHTML =
    `<div class="legend-dot" style="background:${color}"></div><span>${name}</span>`;
  legendEl.appendChild(div);
}

// ── Station count display ─────────────────────────────────────

const subEl = document.querySelector('.panel-sub');
subEl.textContent =
  `${STATIONS_DATA.features.length} stations · sans sortie de péage`;
