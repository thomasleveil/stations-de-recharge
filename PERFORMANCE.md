# Étude de performance — UI post-route

> Analyse des goulots d'étranglement et idées d'optimisation pour fluidifier
> l'expérience utilisateur après calcul d'un itinéraire.
> Ancré dans le code réel (`app.js` + `filter-worker.js`).

---

## Goulots identifiés dans le code

### 1.1 `updateVisibility()` — O(N) sur tous les markers

```js
// ACTUEL : itère TOUS les markers à chaque appel
markers.forEach(m => {
  m.setStyle({ opacity: visible ? 1 : 0, fillOpacity: … });
  m.getElement()?.style.pointerEvents = …;  // ← lookup DOM à chaque fois
});
```

`setStyle()` sur un `circleMarker` canvas déclenche un re-render Leaflet pour chaque
marker appelé. Avec ~800 markers, ça fait 800 re-renders individuels au lieu d'un seul batch.

### 1.2 `getElement()` dans la boucle chaude

```js
const el = m.getElement();  // ← DOM lookup, jamais caché
if (el) el.style.pointerEvents = visible ? '' : 'none';
```

Pour les `divIcon` markers (cheapMarkers), `getElement()` traverse le DOM à chaque
appel. Cacher `m._el = m.getElement()` une fois lors du `buildCheapMarkers()`.

### 1.3 Distances `cheapMarkers` bloquent le main thread

```js
// app.js ~l.938 — MAIN THREAD, synchrone, après le worker
for (const m of cheapMarkers) {
  m._distFromRoute = nearestDistMain(m._lon, m._lat, cheapRouteFlat);
}
```

La fonction `nearestDistMain` est identique à celle du worker. Si `cheapMarkers`
dépasse 200 stations, cette boucle peut bloquer le main thread plusieurs dizaines de ms.

### 1.4 `updateLegend()` — reconstruction DOM complète à chaque appel

```js
legendEl.innerHTML = '';  // ← efface tout
// puis N appendChild(...)
```

Appelé à chaque `updateVisibility()`. Pas de diff, pas de cache.

### 1.5 Double `updateVisibility()` consécutif

Dans `calculateRoute()`, `applyRouteFilter` appelle `updateVisibility()` en fin de
worker, puis la boucle cheapMarkers appelle `updateVisibility()` à nouveau.
Deux passes complètes sur tous les markers.

---

## Optimisations haute priorité

### 2.1 Cheap markers dans le worker

Envoyer les deux tableaux au même `worker.postMessage()` :
- `routeFlat`
- `stationsFlat` (markers principaux)
- `cheapStationsFlat` (cheap markers)

Le worker renvoie deux `Float32Array`. **Résultat :** zéro blocage main thread,
un seul `updateVisibility()` à la fin.

### 2.2 Delta-updates dans `updateVisibility()`

```js
// Avant le changement
const prevVisible = new Set(markers.filter(isVisible));

// Après calcul des distances
const nextVisible = new Set(markers.filter(isVisible));

// Appliquer seulement les deltas
for (const m of nextVisible) if (!prevVisible.has(m)) m.setStyle({ opacity:1, fillOpacity:0.9 });
for (const m of prevVisible) if (!nextVisible.has(m)) m.setStyle({ opacity:0, fillOpacity:0 });
```

Passe de O(N_total) à O(N_changed). Surtout utile lors d'un **recalcul de route**
(les deltas seront petits).

### 2.3 Lazy popup HTML

```js
// ACTUEL : HTML généré pour tous les markers au build time
circle.bindPopup(L.popup({ maxWidth: 300 }).setContent(buildPopup(p, op)));

// OPTIMISÉ : généré à la demande
circle.bindPopup(() => buildPopup(p, op));
```

Leaflet supporte une fonction factory dans `bindPopup()`. Économise la création
de ~800 strings HTML au démarrage et réduit l'empreinte mémoire initiale.

### 2.4 Cacher `_el` lors du build

```js
// Dans buildCheapMarkers(), après circle.addTo(map)
circle._el = circle.getElement();
```

Puis dans `updateVisibility()` : `if (m._el) m._el.style.pointerEvents = …`
— pas de lookup DOM dans la boucle chaude.

---

## Optimisations moyennes priorité

### 3.1 Throttle de `updateVisibility()` sur les events map

Throttler à 16ms (1 frame) avec `requestAnimationFrame` pour les futurs
appels fréquents (ex. live corridor resize via slider).

### 3.2 `updateLegend()` avec cache de hash

```js
let _lastLegendKey = '';
function updateLegend() {
  const key = [...visibleOps].join(',');  // fingerprint rapide
  if (key === _lastLegendKey) return;
  _lastLegendKey = key;
  // ... reconstruire
}
```

Si la légende n'a pas changé (même jeu de stations visibles), ne rien faire.

### 3.3 `requestAnimationFrame`-batching des style mutations

Regrouper toutes les mutations de style dans un seul rAF :

```js
requestAnimationFrame(() => {
  markers.forEach(m => { /* setStyle */ });
  cheapMarkers.forEach(m => { /* setStyle */ });
  updateLegend();
  subEl.textContent = …;
});
```

### 3.4 Spatial bbox pre-filter

Avant de construire `stationsFlat`, calculer la bounding box route + corridor :

```js
const bbox = routeLayer.getBounds().pad(0.2); // ~20 km en degrés
const nearbyMarkers = markers.filter(m => bbox.contains([m._lat, m._lon]));
```

Réduit la taille de `stationsFlat` de moitié ou plus sur des itinéraires régionaux.

### 3.5 `map.fitBounds` — attendre la fin de l'animation

`fitBounds` déclenche une animation qui fait re-render tiles + canvas. Lancer
`applyRouteFilter` concurremment crée deux opérations lourdes en parallèle.
**Solution :** attendre `map.once('moveend', ...)` avant de lancer le worker.

---

## UX premium

### 4.1 Transition CSS sur les divIcon cheapMarkers

Les `L.marker` (divIcon) supportent les transitions CSS (pas le canvas) :

```css
.cheap-brand-marker {
  transition: opacity 200ms ease-out;
}
```

Les stations cheap apparaissent en fondu. Coût : 0 en JS.

### 4.2 Apparition progressive des markers (staggered fade-in)

```js
stations
  .sort((a, b) => a._distAlongRoute - b._distAlongRoute)
  .forEach((m, i) => {
    setTimeout(() => m.setStyle({ opacity: 1 }), i * 15);
  });
```

Effet "scan de l'itinéraire" — les stations apparaissent dans l'ordre du trajet.
Très satisfaisant visuellement, coût JS marginal.

### 4.3 `fitBounds` avec padding adaptatif au panel

```js
const panelW = document.getElementById('panel').offsetWidth;
const padding = window.innerWidth > 600
  ? [40, panelW + 20, 40, 40]
  : [40, 40, document.getElementById('panel').offsetHeight + 20, 40];
```

Les stations ne se retrouvent plus cachées derrière le panel après calcul.

### 4.4 Highlight animé de la polyline (dash animation)

```css
.leaflet-interactive {
  stroke-dasharray: 5000;
  stroke-dashoffset: 5000;
  animation: drawRoute 0.8s ease-out forwards;
}
@keyframes drawRoute {
  to { stroke-dashoffset: 0; }
}
```

Effet "dessin de tracé" premium à l'apparition de la ligne.

---

## Idées architecturales (effort élevé)

### 5.1 Cluster à bas zoom + décluster à zoom ≥ 10

À zoom 6–8 (vue nationale), ~800 cercles individuels. Leaflet.MarkerCluster
ou une implémentation custom regrouperait par aire d'autoroute.
**Bénéfice :** rendu initial bien plus rapide, carte lisible.

### 5.2 OffscreenCanvas

Déléguer le rendu canvas à un worker via `OffscreenCanvas`. Leaflet ne le
supporte pas nativement, mais un canvas overlay custom le pourrait.

### 5.3 Viewport culling (`IntersectionObserver`)

Pour les longs itinéraires (Paris→Hendaye), filtrer visuellement les markers
hors du viewport. Seules les stations visibles participent au rendu canvas.

### 5.4 Cache pré-calculé par grand axe

Précalculer et cacher les corridors pour les axes majeurs (A6, A7, A10…).
Résultat instantané depuis IndexedDB pour les trajets fréquents.

---

## Matrice Impact / Effort

| Idée | Impact perf | Impact UX | Effort |
|---|:---:|:---:|:---:|
| 2.1 Cheap markers dans le worker | ★★★ | — | Faible |
| 2.2 Delta-updates visibility | ★★★ | — | Faible |
| 2.3 Lazy popup HTML | ★★ | — | Trivial |
| 2.4 Cache `_el` | ★ | — | Trivial |
| 3.4 Spatial bbox pre-filter | ★★ | — | Faible |
| 3.2 Legend hash cache | ★ | — | Trivial |
| 3.5 fitBounds → après moveend | ★ | ★ | Faible |
| 4.1 CSS transitions cheapMarkers | — | ★★★ | Trivial |
| 4.2 Staggered fade-in | — | ★★★ | Faible |
| 4.3 fitBounds padding adaptatif | — | ★★★ | Faible |
| 4.4 Polyline dash animation | — | ★★ | Faible |
| 5.1 Clustering bas zoom | ★★ | ★★ | Moyen |
| 5.4 Cache pré-calculé par axe | ★★★ | ★★★ | Élevé |

---

> **Quick wins recommandés :** 2.1 + 4.2 + 4.3 — performance brute + ressenti
> premium pour un effort cumulé estimé < 2h.

---

## Mesure objective des gains

### Principe : une métrique dédiée par piste

| Piste | Métrique à capturer |
|---|---|
| 2.1 Cheap markers → worker | `t_cheapDist` = durée boucle `nearestDistMain` |
| 2.2 Delta-updates | `t_visibility` (N appels) |
| 2.3 Lazy popup HTML | `t_buildMarkers` |
| 2.4 Cache `_el` | "Recalculate Style" dans DevTools Performance panel |
| 3.4 Bbox pre-filter | `stationsFlat.length` loggé avant envoi |
| 3.5 fitBounds avant filter | Long Tasks API (blocages > 50 ms) |
| 4.2 Staggered fade-in | FPS via rAF timestamps, frames > 33 ms comptées |
| 4.3 fitBounds padding | Visuel — comparaison screenshot |

### Module `PerfRecorder` (à injecter dans `app.js`)

```js
const Perf = {
  _marks: {}, _results: [],
  start(label) { this._marks[label] = performance.now(); },
  end(label) {
    const ms = +(performance.now() - (this._marks[label] ?? performance.now())).toFixed(2);
    this._results.push({ label, ms, ts: Date.now() });
    console.debug(`[Perf] ${label}: ${ms} ms`);
    return ms;
  },
  report() { console.table(this._results); return JSON.stringify(this._results, null, 2); },
  reset()  { this._marks = {}; this._results = []; }
};
```

### Long Tasks API (gels du main thread)

```js
new PerformanceObserver(list => {
  list.getEntries().forEach(e =>
    Perf._results.push({ label: 'longTask', ms: e.duration, ts: Date.now() })
  );
}).observe({ type: 'longtask', buffered: true });
```

### Protocole de test reproductible

**Scénario fixe :** Paris → Lyon (A6, ~460 km)
**Conditions :** cache IndexedDB chaud, CPU 4x throttle DevTools, 5 runs, médiane retenue.

```
1. Ouvrir http://localhost:8765
2. Attendre "N stations · CCS ≥ 150 kW"
3. Console : Perf.reset()
4. Saisir Paris → Lyon, cliquer Calculer →
5. Attendre "460 km · corridor ±200 m"
6. Console : copy(Perf.report())
```

### Template de rapport comparatif

```
## Paris → Lyon — Avant/après [PISTE X.X]

| Métrique              | Avant (ms) | Après (ms) | Gain |
|-----------------------|-----------|-----------|------|
| buildMarkers          |           |           |      |
| cheapDist_mainThread  |           |           |      |
| updateVisibility (x2) |           |           |      |
| worker roundtrip      |           |           |      |
| Total calculateRoute  |           |           |      |
| Long Tasks détectés   |     N     |     N     |      |
| Heap snapshot (MB)    |           |           |      |

Environnement : CPU 4x throttle, cache chaud, N=5, médiane.
```
