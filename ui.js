// UI layer — one sheet (home, trip, station, nearby, settings) next to the map,
// plus the drive screen. Built around the three jobs: plan a trip, drive it,
// find a charger now. The engine (app.js) calls back through window.UI hooks;
// this file only reads engine state and calls engine functions.
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const body = document.body;
  const portrait = () => matchMedia('(max-width: 899px) and (orientation: portrait)').matches;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Formatting ───────────────────────────────────────────────────────────

  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtKm = km => km < 10
    ? (Math.round(km * 10) / 10).toLocaleString('fr-FR')
    : String(Math.round(km));
  function fmtDuration(s) {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  const kw = m => (m._maxPowerKw ? `${Math.round(m._maxPowerKw)} kW` : '');
  const netHtml = m => `<span class="dot" style="--c:${esc(m._op.color)}" aria-hidden="true"></span>`
    + `<span class="stop-net">${esc(m._op.name)}</span>`;
  const isPref = m => routeActive && preferredNetworks.has(m._op.name);

  // ── Navigation links (nav-links.js) ──────────────────────────────────────

  function navProvider() {
    return NavLinks.resolveProvider(localStorage.getItem(NavLinks.STORAGE_KEY) || 'auto',
      NavLinks.detectPlatform(navigator));
  }
  const stationNavUrl = m => NavLinks.navUrl({ lat: m._lat, lon: m._lon }, navProvider());
  const navLinkHtml = (m, cls = 'btn btn-primary') =>
    `<a class="${cls}" href="${esc(stationNavUrl(m))}" target="_blank" rel="noopener">`
    + `Naviguer <span class="nav-app">(${esc(NavLinks.providerName(navProvider()))})</span></a>`;

  // ── State ────────────────────────────────────────────────────────────────

  const state = {
    view: 'home',
    backTo: null,      // where « Retour » goes from station / nearby / settings
    dest: null,        // { label, coords }
    start: null,       // null = my position; else { label, coords }
    trip: null,        // { fromLabel, toLabel, from, to, durationS, coords }
    selected: null,    // marker selected in the trip list
    driveSel: null,    // marker shown on the drive card
    pins: [],          // start / end map markers
    ring: null,        // selection ring map marker
  };
  let _readyResolve;
  const ready = new Promise(r => { _readyResolve = r; });

  // ── Views and sheet ──────────────────────────────────────────────────────

  const TITLES = { home: 'Bornes rapides', trip: 'Trajet', station: 'Station', nearby: 'Bornes proches', settings: 'Réglages' };

  function resizeMap() {
    requestAnimationFrame(() => { map.resize(); });
  }

  function setSheet(s) {
    body.dataset.sheet = s;
    const open = s === 'expanded';
    $('sheet-handle').setAttribute('aria-expanded', String(open));
    syncHandleLabel();
    resizeMap();
  }

  function syncHandleLabel() {
    const n = state.view === 'trip' ? tripStops().length : 0;
    $('sheet-handle-label').textContent = body.dataset.sheet === 'expanded'
      ? 'Réduire la liste'
      : `Afficher la liste${n ? ` (${plural(n, 'borne')})` : ''}`;
  }

  function setView(view, { backTo } = {}) {
    const prev = state.view;
    if (prev === 'nearby' && view !== 'nearby') leaveNearby();
    if (['station', 'nearby', 'settings'].includes(view)) {
      if (!['station', 'nearby', 'settings'].includes(prev)) state.backTo = backTo || prev;
      else if (backTo) state.backTo = backTo;
    }
    state.view = view;
    body.dataset.view = view;
    $('sheet-title').textContent = TITLES[view];
    $('back-btn').hidden = !['station', 'nearby', 'settings'].includes(view);
    $('nearby-btn').setAttribute('aria-pressed', String(view === 'nearby'));
    $('settings-btn').setAttribute('aria-pressed', String(view === 'settings'));
    setSheet(view === 'trip' || view === 'home' ? 'collapsed' : 'expanded');
    $('sheet-scroll').scrollTop = 0;
    // Keep keyboard focus somewhere visible when the focused control disappears.
    const a = document.activeElement;
    if (!a || a === body || !a.offsetParent) $('sheet-title').focus({ preventScroll: true });
  }

  function goBack() {
    const to = state.backTo === 'drive' && routeActive ? 'drive' : (routeActive ? 'trip' : 'home');
    if (to === 'drive') { setView('trip'); enterDrive(); return; }
    setView(to);
    if (to === 'trip') { renderTrip(); fitRoute(); }
  }

  // ── Map helpers ──────────────────────────────────────────────────────────

  function pinEl(cls, text) {
    const el = document.createElement('div');
    el.className = `route-pin ${cls}`;
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function setPins(from, to) {
    state.pins.forEach(p => p.remove());
    state.pins = from ? [
      new maplibregl.Marker({ element: pinEl('route-pin-start', 'A') }).setLngLat(from).addTo(map),
      new maplibregl.Marker({ element: pinEl('route-pin-end', 'B') }).setLngLat(to).addTo(map),
    ] : [];
  }

  function setRing(m) {
    if (state.ring) { state.ring.remove(); state.ring = null; }
    if (!m) return;
    const el = document.createElement('div');
    el.className = 'selected-ring';
    el.setAttribute('aria-hidden', 'true');
    state.ring = new maplibregl.Marker({ element: el }).setLngLat([m._lon, m._lat]).addTo(map);
  }

  function flyTo(m, zoom = 12) {
    const opts = { center: [m._lon, m._lat], zoom: Math.max(map.getZoom(), zoom) };
    if (reduceMotion()) map.jumpTo(opts); else map.easeTo({ ...opts, duration: 600 });
  }

  function fitRoute() {
    if (!state.trip) return;
    requestAnimationFrame(() => {
      map.resize();
      const b = state.trip.bbox;
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]],
        { padding: portrait() ? 48 : 64, duration: reduceMotion() ? 0 : 500 });
    });
  }

  // ── Combobox (Photon suggestions, inline listbox) ────────────────────────

  async function suggest(q) {
    try {
      const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=5&lang=fr`;
      const data = await fetch(url).then(r => r.json());
      return (data.features || []).map(f => {
        const p = f.properties || {};
        const label = photonLabel(p);
        const city = p.city || p.town || p.village || p.county;
        const sub = [p.street && p.street !== p.name ? p.street : '', city !== p.name ? city : '', p.state]
          .filter(Boolean).join(', ');
        return { label, main: p.name || label, sub, coords: [f.geometry.coordinates[0], f.geometry.coordinates[1]] };
      }).filter(s => s.label);
    } catch (_) { return []; }
  }

  function setupCombo(input, list, onPick) {
    let items = [], active = -1, timer = null, seq = 0;

    function render() {
      list.innerHTML = '';
      items.forEach((it, i) => {
        const li = document.createElement('li');
        li.id = `${list.id}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.innerHTML = esc(it.main) + (it.sub ? `<span class="sugg-sub">${esc(it.sub)}</span>` : '');
        li.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the field
        li.addEventListener('click', () => pick(i));
        list.appendChild(li);
      });
      list.hidden = !items.length;
      input.setAttribute('aria-expanded', String(items.length > 0));
      if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
      else input.removeAttribute('aria-activedescendant');
    }
    function close() { items = []; active = -1; render(); }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      input.value = it.label;
      close();
      onPick(it);
    }
    async function lookup(q) {
      const my = ++seq;
      const res = await suggest(q);
      if (my !== seq) return null;
      items = res;
      active = items.length ? 0 : -1; // the first suggestion is pre-selected: Enter picks it
      render();
      return res;
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { seq++; close(); return; }
      timer = setTimeout(() => lookup(q), 250);
    });
    input.addEventListener('keydown', async e => {
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault(); active = (active + 1) % items.length; render();
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault(); active = (active - 1 + items.length) % items.length; render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0) { pick(active); return; }
        const q = input.value.trim();
        if (q.length < 2) return;
        clearTimeout(timer);
        const res = await lookup(q);
        if (res && res.length) pick(0);
        else if (res) showPlanMsg(`« ${q} » introuvable.`, true);
      } else if (e.key === 'Escape' && items.length) {
        e.preventDefault(); close();
      }
    });
    input.addEventListener('blur', () => setTimeout(close, 200));
    input.addEventListener('focus', () => {
      if (portrait()) setSheet('expanded');
      fetch(`${PHOTON_URL}?q=a&limit=1`, { method: 'HEAD' }).catch(() => {}); // warm the connection
    });
  }

  // ── Home ─────────────────────────────────────────────────────────────────

  function showPlanMsg(text, isError = false) {
    const el = $('plan-msg');
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  function syncFromLabel() {
    $('from-label').textContent = state.start ? state.start.label
      : geoState.available ? 'ma position'
        : geoState.pending ? 'ma position (localisation…)' : 'position inconnue';
  }

  function showFromField(show) {
    $('from-wrap').hidden = !show;
    $('from-edit').setAttribute('aria-expanded', String(show));
    $('from-edit').textContent = show ? 'Fermer' : 'Modifier';
  }

  function renderRecent() {
    const routes = getRecentRoutes();
    $('recent-block').hidden = !routes.length;
    const ul = $('recent-list');
    ul.innerHTML = '';
    routes.forEach(r => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'recent';
      const gps = !r.startText || r.startText === 'Ma position';
      b.innerHTML = `<span class="recent-to">${esc(r.endText)}</span>`
        + `<span class="recent-from">depuis ${esc(gps ? 'ma position' : r.startText)}</span>`;
      b.addEventListener('click', () => {
        state.dest = { label: r.endText, coords: r.endCoords || null };
        state.start = gps ? null : { label: r.startText, coords: r.startCoords || null };
        $('dest-input').value = r.endText;
        syncFromLabel();
        planTrip();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  // ── Plan a trip ──────────────────────────────────────────────────────────

  const until = (cond, ms) => new Promise(res => {
    const t0 = Date.now();
    (function poll() { if (cond() || Date.now() - t0 > ms) res(); else setTimeout(poll, 200); }());
  });

  let _planning = false;
  async function planTrip() {
    if (_planning || !state.dest) return;
    _planning = true;
    try {
      // Start: explicit field (picked or typed), else my position.
      const fromText = $('from-input').value.trim();
      if (!$('from-wrap').hidden && fromText && (!state.start || state.start.label !== fromText)) {
        state.start = { label: fromText, coords: null };
      }
      if (!state.start && !geoState.available && geoState.pending) {
        showPlanMsg('Recherche de votre position…');
        await until(() => geoState.available || !geoState.pending, 8000);
      }
      if (!state.start && !geoState.available) {
        showPlanMsg('Position indisponible : indiquez un départ.', true);
        showFromField(true);
        $('from-input').focus();
        return;
      }
      if (!_markersReady) { showPlanMsg('Chargement des bornes…'); await ready; }

      showPlanMsg('Calcul de l\'itinéraire…');
      const fromGps = !state.start;
      const from = fromGps ? [geoState.lng, geoState.lat]
        : (state.start.coords || (state.start.coords = await geocode(state.start.label)));
      const to = state.dest.coords || (state.dest.coords = await geocode(state.dest.label));
      const route = await fetchRoute(from, to);
      const coords = route.geometry.coordinates;

      // Show the route at once; the list follows when the corridor filter is done.
      if (state.view === 'trip' || routeActive) clearTrip({ keepView: true });
      const line = turf.simplify(turf.lineString(coords), { tolerance: 0.00005, highQuality: false });
      map.getSource('route').setData(line);
      setPins(coords[0], coords[coords.length - 1]);
      state.trip = {
        fromLabel: fromGps ? 'Ma position' : state.start.label,
        toLabel: state.dest.label.split(',')[0],
        from, to, fromGps,
        durationS: route.duration ?? route.legs.reduce((s, l) => s + l.duration, 0),
        bbox: turf.bbox(line),
      };
      currentRouteKm = Math.round(route.legs.reduce((s, l) => s + l.distance, 0) / 1000);
      showPlanMsg('');
      setView('trip');
      $('trip-summary').innerHTML = tripHeadHtml('Recherche des bornes sur le trajet…');
      fitRoute();

      routeActive = true;
      await applyRouteFilter(turf.lineString(coords), (done, total) => {
        $('trip-summary').querySelector('.sub').textContent =
          `Recherche des bornes sur le trajet… ${Math.round(done / total * 100)} %`;
      });
      saveRecentRoute(fromGps ? '' : state.start.label, state.dest.label,
        fromGps ? null : from, to);
      pushShareUrl();
      renderTrip();
    } catch (e) {
      console.warn('planTrip:', e);
      if (state.view !== 'home') setView('home');
      showPlanMsg(`⚠ ${e.message || 'Itinéraire introuvable'}`, true);
    } finally {
      _planning = false;
    }
  }

  function clearTrip({ keepView = false } = {}) {
    if (driveModeActive) exitDrive();
    clearRouteState();
    setPins(null);
    setRing(null);
    state.trip = null;
    state.selected = null;
    history.replaceState(null, '', location.pathname);
    if (!keepView) setView('home');
  }

  // ── Share URL (F-5 parameters: to, tc, from, fc, c) ──────────────────────

  function pushShareUrl() {
    if (!state.trip) return;
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('to', state.dest.label);
    url.searchParams.set('tc', state.trip.to.join(','));
    // A trip from « my position » is shared with its coordinates so the
    // recipient sees the same route.
    url.searchParams.set('from', state.trip.fromGps ? 'Départ' : state.start.label);
    url.searchParams.set('fc', state.trip.from.map(v => +v.toFixed(5)).join(','));
    url.searchParams.set('c', String(Math.round(ROUTE_BUFFER_KM * 10)));
    history.replaceState(null, '', url.toString());
  }

  function readShareUrl() {
    const p = new URLSearchParams(location.search);
    const pair = s => {
      const [lon, lat] = (s || '').split(',').map(Number);
      return Number.isFinite(lon) && Number.isFinite(lat) && s ? [lon, lat] : null;
    };
    const c = parseInt(p.get('c'), 10);
    if (c >= 2 && c <= 30) ROUTE_BUFFER_KM = c / 10;
    if (!p.get('to')) return false;
    state.dest = { label: p.get('to'), coords: pair(p.get('tc')) };
    state.start = p.get('from') ? { label: p.get('from'), coords: pair(p.get('fc')) } : null;
    $('dest-input').value = state.dest.label;
    return true;
  }

  async function share() {
    const btn = $('share-btn');
    const title = state.trip ? `${state.trip.fromLabel} → ${state.trip.toLabel}` : document.title;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, url: location.href }); return; } catch (_) { /* fall through */ }
    }
    let ok = true;
    try { await navigator.clipboard.writeText(location.href); } catch (_) { ok = false; }
    btn.textContent = ok ? '✓ Lien copié' : 'Copiez l\'adresse';
    setTimeout(() => { btn.textContent = 'Partager'; }, 2000);
  }

  // ── Trip list ────────────────────────────────────────────────────────────

  function tripStops() {
    if (!routeActive) return [];
    return markers.filter(m => isVisible(m))
      .sort((a, b) => (a._progressOnRoute ?? 0) - (b._progressOnRoute ?? 0));
  }

  function detourText(m) {
    const d = m._distFromRoute;
    if (d === undefined || !Number.isFinite(d)) return '';
    return d < 0.05 ? 'sur la route' : `à ${fmtKm(d)} km de la route`;
  }

  function availHtml(m) {
    return m._availCache ? m._availCache.html : '';
  }

  function detailHtml(m, { withHeader = false } = {}) {
    const p = m._p || {};
    const facts = [
      kw(m) && `<strong>${kw(m)}</strong> max`,
      p.nbre_ccs_fast > 0 && `${p.nbre_ccs_fast} prises CCS rapides`,
      p.nbre_pdc && `${p.nbre_pdc} points de charge`,
      p.horaires && `horaires : ${esc(p.horaires)}`,
    ].filter(Boolean).join(' · ');
    const op = m._op;
    const price = op.price
      ? `<p class="detail-line"><span class="price-tier">${'€'.repeat(op.price.tier)}</span> ${esc(op.price.range)}${op.price.note ? ` (${esc(op.price.note)})` : ''}</p>` : '';
    const alerts = (op.alerts || []).map(a => `<p class="alert">${esc(a.text)}</p>`).join('');
    return `${withHeader ? `<h2 class="stop-name" style="font-size:1.25rem">${esc(m._name || op.name)}</h2>
        <p class="stop-meta">${netHtml(m)}${m._cheap ? ' · réseau abordable' : ''}</p>` : ''}
      <p class="detail-line">${esc(p.adresse || '')}</p>
      <p class="detail-line">${facts}</p>
      ${price}${alerts}
      <p class="detail-line">Disponibilité : <span class="avail-slot">${TOMTOM_API_KEY ? AVAIL_SPINNER : 'clé TomTom non configurée (Réglages)'}</span>
        ${TOMTOM_API_KEY ? '<button type="button" class="btn-link avail-refresh">Actualiser</button>' : ''}</p>
      <div class="stop-actions">${navLinkHtml(m)}</div>`;
  }

  function wireAvailability(container, m) {
    const slot = container.querySelector('.avail-slot');
    if (!slot || !TOMTOM_API_KEY) return;
    const load = () => fetchAvailability(m).then(html => { if (slot.isConnected) slot.innerHTML = html; });
    load();
    const btn = container.querySelector('.avail-refresh');
    if (btn) btn.addEventListener('click', () => { delete m._availCache; slot.innerHTML = AVAIL_SPINNER; load(); });
  }

  function rowHtml(m, bigHtml, metaExtra) {
    const sel = state.selected === m && state.view === 'trip';
    return `<li class="stop${sel ? ' is-selected' : ''}" data-idx="${m._idx}">
      <button type="button" class="stop-main" aria-expanded="${sel}" aria-controls="sd-${m._idx}">
        <span class="stop-km">${bigHtml}</span>
        <span>
          <span class="stop-name">${esc(m._name || m._op.name)}</span>
          <span class="stop-meta">${netHtml(m)}${isPref(m) ? ' <span class="pref">★ préféré</span>' : ''}`
          + `${kw(m) ? ` · ${kw(m)}` : ''}${metaExtra ? ` · ${metaExtra}` : ''}`
          + `${availHtml(m) ? ` · ${availHtml(m)}` : ''}</span>
        </span>
      </button>
      <div class="stop-detail" id="sd-${m._idx}"${sel ? '' : ' hidden'}></div>
    </li>`;
  }

  function tripHeadHtml(sub) {
    const t = state.trip;
    return `<span class="route-name">${esc(t.fromLabel)} → ${esc(t.toLabel)}</span>`
      + `<span class="route-stats">${currentRouteKm} km · ${fmtDuration(t.durationS)}</span>`
      + `<span class="sub">${esc(sub)}</span>`;
  }

  function renderTrip() {
    if (!state.trip) return;
    const stops = tripStops();
    $('trip-summary').innerHTML = tripHeadHtml(`${plural(stops.length, 'borne')} sur le trajet`);
    syncFilters();

    // One list, by km from the start; white zones inline between fast stops.
    let html = '';
    let lastFastKm = null;
    for (const m of stops) {
      const km = currentRouteKm * (m._progressOnRoute ?? 0);
      if (!m._cheap) {
        if (lastFastKm !== null && km - lastFastKm > 80) {
          html += `<li class="gap-row" role="note">⚠ ${Math.round(km - lastFastKm)} km sans borne rapide</li>`;
        }
        lastFastKm = km;
      }
      html += rowHtml(m, `${Math.round(km)}<small> km</small>`,
        [m._cheap ? 'abordable' : '', detourText(m)].filter(Boolean).join(' · '));
    }
    if (!stops.length) html = '<li class="empty">Aucune borne avec ces filtres. Élargissez l\'écart à la route ou baissez la puissance.</li>';
    $('stop-list').innerHTML = html;
    if (state.selected && stops.includes(state.selected)) fillDetail($('stop-list'), state.selected);
    else { state.selected = null; setRing(null); }

    // Network subscription advice, demoted to one collapsed line.
    const recs = computeNetworkRecommendation(currentRouteKm);
    const adv = $('net-advice');
    adv.hidden = !recs.length;
    if (recs.length) {
      $('net-advice-summary').textContent = `Abonnement conseillé : ${recs[0].op.name}`;
      $('net-advice-body').innerHTML = recs.map(r =>
        `<p>${esc(r.op.name)} — couvre ${r.segs}/${r.nSegs} tronçon${r.nSegs > 1 ? 's' : ''} de 80 km (${Math.round(r.score * 100)} %)</p>`).join('');
    }
    syncHandleLabel();
  }

  function fillDetail(list, m) {
    const d = list.querySelector(`#sd-${m._idx}`);
    if (!d) return;
    d.innerHTML = detailHtml(m);
    d.hidden = false;
    wireAvailability(d, m);
  }

  function selectStop(m, { fromMap = false } = {}) {
    const list = $('stop-list');
    if (state.selected === m && !fromMap) { // second tap folds the row
      state.selected = null;
      setRing(null);
      renderTrip();
      return;
    }
    state.selected = m;
    renderTrip();
    setRing(m);
    flyTo(m, 11);
    const li = list.querySelector(`li[data-idx="${m._idx}"]`);
    if (fromMap) {
      if (portrait()) setSheet('expanded');
      li?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    }
    li?.querySelector('.stop-main')?.focus({ preventScroll: true });
  }

  $('stop-list').addEventListener('click', e => {
    const btn = e.target.closest('.stop-main');
    if (!btn) return;
    const m = markers[+btn.closest('li').dataset.idx];
    if (m) selectStop(m);
  });

  // ── Filters (power, distance to the route) ───────────────────────────────

  function syncFilters() {
    const pw = document.querySelector(`input[name="min-power"][value="${MIN_POWER_KW}"]`);
    if (pw) pw.checked = true;
    const steps = [2, 10, 30];
    const c = Math.round(ROUTE_BUFFER_KM * 10);
    const near = steps.reduce((a, b) => Math.abs(b - c) < Math.abs(a - c) ? b : a);
    const cor = document.querySelector(`input[name="corridor"][value="${near}"]`);
    if (cor) cor.checked = true;
  }

  document.querySelectorAll('input[name="min-power"]').forEach(r => r.addEventListener('change', () => {
    MIN_POWER_KW = parseInt(r.value, 10);
    localStorage.setItem('irve-min-power-kw', r.value);
    updateVisibility();
    renderTrip();
  }));
  document.querySelectorAll('input[name="corridor"]').forEach(r => r.addEventListener('change', () => {
    ROUTE_BUFFER_KM = parseInt(r.value, 10) / 10;
    updateVisibility();
    renderTrip();
    pushShareUrl();
  }));

  // ── Station card (no route) ──────────────────────────────────────────────

  function openStation(m) {
    const card = $('station-card');
    card.innerHTML = detailHtml(m, { withHeader: true });
    setView('station');
    $('sheet-title').textContent = m._name || m._op.name;
    wireAvailability(card, m);
    setRing(m);
  }

  // ── Nearby (« Bornes proches ») ──────────────────────────────────────────

  let _nearby = [];
  let _nearbyRadius = 15;

  function openNearby({ backTo } = {}) {
    if (driveModeActive) exitDrive();
    setView('nearby', { backTo });
    renderNearby(true);
  }

  function leaveNearby() {
    emergencyModeActive = false;
    _emergencyMarkers = new Set();
    _nearby = [];
    setRing(null);
    updateVisibility();
  }

  function renderNearby(fit) {
    const list = $('nearby-list');
    if (!geoState.available) {
      $('nearby-summary').textContent = geoState.pending
        ? 'Recherche de votre position…'
        : 'Position indisponible : autorisez la géolocalisation pour voir les bornes proches.';
      list.innerHTML = '';
      return;
    }
    if (!_markersReady) { $('nearby-summary').textContent = 'Chargement des bornes…'; return; }
    _nearbyRadius = 15;
    _nearby = _nearbyList(geoState.lat, geoState.lng, 15, 20);
    if (_nearby.length < 3) { _nearbyRadius = 50; _nearby = _nearbyList(geoState.lat, geoState.lng, 50, 20); }
    emergencyModeActive = true;
    _emergencyMarkers = new Set(_nearby.map(x => x.m));
    updateVisibility();
    $('nearby-summary').textContent = _nearby.length
      ? `${plural(_nearby.length, 'borne')} à moins de ${_nearbyRadius} km, la plus proche d'abord`
      : `Aucune borne à moins de ${_nearbyRadius} km.`;
    list.innerHTML = _nearby.map(({ m, dist }) =>
      `<li class="stop" data-idx="${m._idx}">
        <button type="button" class="stop-main" aria-label="${esc(`${m._name || m._op.name}, ${fmtKm(dist)} km : centrer la carte`)}">
          <span class="stop-km">${fmtKm(dist)}<small> km</small></span>
          <span>
            <span class="stop-name">${esc(m._name || m._op.name)}</span>
            <span class="stop-meta">${netHtml(m)}${kw(m) ? ` · ${kw(m)}` : ''}<span class="avail-slot">${availHtml(m) ? ` · ${availHtml(m)}` : ''}</span></span>
          </span>
        </button>
        <div class="stop-detail"><div class="stop-actions">${navLinkHtml(m)}</div></div>
      </li>`).join('');
    if (fit && _nearby.length) {
      const lngs = [geoState.lng, ..._nearby.map(x => x.m._lon)];
      const lats = [geoState.lat, ..._nearby.map(x => x.m._lat)];
      requestAnimationFrame(() => {
        map.resize();
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 48, maxZoom: 13, duration: 0 });
      });
    }
    fetchListAvailability(list, _nearby.map(x => x.m), () => state.view === 'nearby');
  }

  $('nearby-list').addEventListener('click', e => {
    const btn = e.target.closest('.stop-main');
    if (!btn) return;
    const m = markers[+btn.closest('li').dataset.idx];
    if (m) { setRing(m); flyTo(m, 13); }
  });

  // Sequential TomTom lookups (300 ms apart, as before) for a list of rows.
  let _availRun = 0;
  async function fetchListAvailability(list, ms, stillWanted) {
    if (!TOMTOM_API_KEY || !ms.length) return;
    const run = ++_availRun;
    for (let i = 0; i < ms.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      if (run !== _availRun || !stillWanted()) return;
      const html = await fetchAvailability(ms[i]);
      const slot = list.querySelector(`li[data-idx="${ms[i]._idx}"] .avail-slot`);
      if (slot) slot.innerHTML = html && html !== '—' ? ` · ${html}` : '';
    }
  }

  // ── Drive ────────────────────────────────────────────────────────────────

  function enterDrive() {
    if (!routeActive) return;
    driveModeActive = true;
    state.driveSel = null;
    body.classList.add('driving');
    $('drive').hidden = false;
    setRing(null);
    refreshDrive(true);
    resizeMap();
    $('drive-nav').focus({ preventScroll: true });
  }

  function exitDrive() {
    driveModeActive = false;
    body.classList.remove('driving');
    $('drive').hidden = true;
    setRing(null);
    resizeMap();
  }

  function refreshDrive(fit) {
    if (!driveModeActive) return;
    const nav = $('drive-nav');
    const setNav = m => {
      if (m) { nav.href = stationNavUrl(m); nav.removeAttribute('aria-disabled'); }
      else { nav.removeAttribute('href'); nav.setAttribute('aria-disabled', 'true'); }
    };
    if (!geoState.available) {
      $('drive-title').textContent = 'Position GPS indisponible';
      $('drive-km').textContent = '—';
      $('drive-name').textContent = geoState.pending ? 'Recherche du signal…' : 'Autorisez la géolocalisation.';
      $('drive-meta').textContent = '';
      $('drive-avail').textContent = '';
      setNav(null);
      return;
    }
    const list = _driveAheadList(10);
    if (!list.length) {
      $('drive-title').textContent = 'Plus de borne devant';
      $('drive-km').textContent = '✓';
      $('drive-name').textContent = 'Destination proche';
      $('drive-meta').textContent = '';
      $('drive-avail').textContent = '';
      setNav(null);
      return;
    }
    let i = list.findIndex(x => x.m === state.driveSel);
    if (i < 0) i = 0;
    const { m, dist } = list[i];
    state.driveSel = m;
    $('drive-title').textContent = i === 0 ? 'Prochaine borne' : `Borne suivante (${i + 1} sur ${list.length})`;
    $('drive-km').innerHTML = `${fmtKm(dist)}<small> km</small>`;
    $('drive-name').textContent = m._name || m._op.name;
    $('drive-meta').innerHTML = `${netHtml(m)}${kw(m) ? ` · ${kw(m)}` : ''}`
      + `${preferredNetworks.has(m._op.name) ? ' · <span class="pref">★ préféré</span>' : ''}`;
    $('drive-avail').innerHTML = availHtml(m);
    if (TOMTOM_API_KEY) fetchAvailability(m).then(html => { if (state.driveSel === m) $('drive-avail').innerHTML = html === '—' ? '' : html; });
    setNav(m);
    $('drive-next').disabled = list.length < 2;
    setRing(m);
    // Follow the GPS: keep my position and the shown station in view.
    const b = [[Math.min(geoState.lng, m._lon), Math.min(geoState.lat, m._lat)],
               [Math.max(geoState.lng, m._lon), Math.max(geoState.lat, m._lat)]];
    requestAnimationFrame(() => {
      if (fit) map.resize();
      map.fitBounds(b, { padding: 56, maxZoom: 13, duration: reduceMotion() || fit ? 0 : 800 });
    });
  }

  $('drive-btn').addEventListener('click', enterDrive);
  $('drive-end').addEventListener('click', () => { exitDrive(); setView('trip'); renderTrip(); fitRoute(); });
  $('drive-next').addEventListener('click', () => {
    const list = _driveAheadList(10);
    if (list.length < 2) return;
    const i = list.findIndex(x => x.m === state.driveSel);
    state.driveSel = list[(i + 1) % list.length].m;
    refreshDrive(false);
  });
  $('drive-nearby').addEventListener('click', () => openNearby({ backTo: 'drive' }));

  // ── Settings ─────────────────────────────────────────────────────────────

  function setThemeChoice(v) {
    if (v === 'auto') {
      _themeManualThisSession = false;
      _lastSunCalcCheck = 0;
      applyTheme(_prefersDark.matches ? 'dark' : 'light');
      _checkSunCalcTheme();
    } else {
      _themeManualThisSession = true;
      applyTheme(v);
    }
  }
  document.querySelectorAll('input[name="theme"]').forEach(r =>
    r.addEventListener('change', () => setThemeChoice(r.value)));
  $('th-auto').checked = true;

  (function setupNavApps() {
    const box = $('nav-app-list');
    const current = localStorage.getItem(NavLinks.STORAGE_KEY) || 'auto';
    const opts = [['auto', 'Automatique (Plans sur iPhone, Google Maps ailleurs)'],
      ...Object.entries(NavLinks.PROVIDERS).map(([k, p]) => [k, p.label])];
    box.innerHTML = opts.map(([k, label]) =>
      `<label><input type="radio" name="nav-app" value="${k}"${k === current ? ' checked' : ''} /> ${esc(label)}</label>`).join('');
    box.addEventListener('change', e => {
      localStorage.setItem(NavLinks.STORAGE_KEY, e.target.value);
    });
  }());

  (function setupPreferred() {
    const box = $('pref-list');
    OPERATORS.forEach((op, i) => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" id="pref-${i}" value="${esc(op.name)}"${preferredNetworks.has(op.name) ? ' checked' : ''} />`
        + `<span class="dot" style="--c:${esc(op.color)}" aria-hidden="true"></span>${esc(op.name)}`;
      box.appendChild(label);
    });
    box.addEventListener('change', e => {
      const cb = e.target;
      if (cb.checked) preferredNetworks.add(cb.value); else preferredNetworks.delete(cb.value);
      localStorage.setItem(PREFERRED_NETWORKS_KEY, JSON.stringify([...preferredNetworks]));
      applyPreferredStyling();
    });
  }());

  const keyInput = $('tomtom-key-input');
  keyInput.value = TOMTOM_API_KEY;
  keyInput.addEventListener('input', () => {
    TOMTOM_API_KEY = keyInput.value.trim();
    localStorage.setItem('irve-tomtom-key', TOMTOM_API_KEY);
  });

  const cheapInput = $('cheap-corridor-input');
  cheapInput.value = CHEAP_CORRIDOR_KM;
  cheapInput.addEventListener('change', () => {
    const v = Math.max(1, Math.min(50, parseFloat(cheapInput.value) || 10));
    cheapInput.value = v;
    CHEAP_CORRIDOR_KM = v;
    localStorage.setItem('irve-cheap-corridor-km', v);
    updateVisibility();
  });

  $('cache-bust-btn').addEventListener('click', () => {
    const req = indexedDB.deleteDatabase('irve-v1');
    req.onsuccess = req.onerror = req.onblocked = () => window.location.reload();
  });

  // ── Header, handle, keyboard ─────────────────────────────────────────────

  $('nearby-btn').addEventListener('click', () => {
    if (state.view === 'nearby') goBack(); else openNearby();
  });
  $('settings-btn').addEventListener('click', () => {
    if (state.view === 'settings') goBack(); else setView('settings');
  });
  $('back-btn').addEventListener('click', goBack);
  $('sheet-handle').addEventListener('click', () => {
    setSheet(body.dataset.sheet === 'expanded' ? 'collapsed' : 'expanded');
    if (body.dataset.sheet === 'collapsed' && !state.selected) fitRoute();
  });
  $('edit-btn').addEventListener('click', () => {
    clearTrip();
    const input = $('dest-input');
    input.focus();
    input.select();
  });
  $('share-btn').addEventListener('click', share);
  $('from-edit').addEventListener('click', () => {
    const show = $('from-wrap').hidden;
    showFromField(show);
    if (show) $('from-input').focus();
  });
  $('from-gps').addEventListener('click', () => {
    state.start = null;
    $('from-input').value = '';
    showFromField(false);
    syncFromLabel();
    if (state.dest?.coords) planTrip();
  });
  $('trip-form').addEventListener('submit', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented && ['station', 'nearby', 'settings'].includes(state.view)) goBack();
  });

  setupCombo($('dest-input'), $('dest-list'), it => {
    state.dest = { label: it.label, coords: it.coords };
    planTrip();
  });
  setupCombo($('from-input'), $('from-list'), it => {
    state.start = { label: it.label, coords: it.coords };
    syncFromLabel();
    if (state.dest?.coords && $('dest-input').value.trim()) planTrip();
    else $('dest-input').focus();
  });

  // ── Engine hooks ─────────────────────────────────────────────────────────

  window.UI = {
    state,
    planTrip,
    clearTrip,
    selectStop,
    openNearby,
    enterDrive,
    exitDrive,
    setThemeChoice,
    stationNavUrl,

    onVisibility(count) {
      if (!routeActive) $('station-count').textContent = `${count} bornes rapides (≥ ${MIN_POWER_KW} kW) ·`;
    },
    onStatus(text) {
      if (text.startsWith('⚠')) showPlanMsg(text, true);
    },
    onReady() {
      const ov = $('loading-overlay');
      if (ov) setTimeout(() => ov.remove(), 400);
      _readyResolve();
      if (state.view === 'nearby') renderNearby(true);
    },
    onStationClick(m) {
      if (driveModeActive) return;
      if (routeActive && state.view === 'trip' && tripStops().includes(m)) selectStop(m, { fromMap: true });
      else if (state.view !== 'nearby') openStation(m);
      else { setRing(m); }
    },
    onGeo() {
      syncFromLabel();
    },
    onGeoMove() {
      if (driveModeActive) refreshDrive(false);
      if (state.view === 'nearby' && !_nearby.length) renderNearby(true);
    },
    onTheme(theme) {
      if (_themeManualThisSession) $(theme === 'dark' ? 'th-dark' : 'th-light').checked = true;
    },
  };

  // ── Start ────────────────────────────────────────────────────────────────

  // Compact attribution starts unfolded; fold it so it does not cover the route.
  map.once('load', () => {
    document.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')
      ?.classList.remove('maplibregl-compact-show');
  });

  if (typeof _markersReady !== 'undefined' && _markersReady) _readyResolve();
  syncFilters();
  syncFromLabel();
  renderRecent();
  if (readShareUrl()) {
    syncFilters();
    syncFromLabel();
    planTrip();
  } else if (!matchMedia('(pointer: coarse)').matches) {
    $('dest-input').focus(); // desktop: type straight away (the keyboard would hide the map on phones)
  }
}());
