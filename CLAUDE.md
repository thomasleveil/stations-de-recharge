# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Interactive map of fast EV charging stations (≥ 150 kW, CCS Combo) across metropolitan France and Corsica. Helps plan electric vehicle road trips by filtering stations along any calculated route using OSRM.

## Data Source

**Base nationale des IRVE** (Infrastructures de Recharge pour Véhicules Électriques)
Source: [data.gouv.fr](https://www.data.gouv.fr/datasets/base-nationale-des-irve-infrastructures-de-recharge-pour-vehicules-electriques)
Updated: daily. Parquet file is ~6 MB (188k rows, one row per connector/PDC).

The app fetches the raw Parquet **directly from data.gouv.fr at runtime**:
```
https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet
```

No pre-processing step is required. The filter logic runs in DuckDB WASM in the browser.

## Architecture

Static frontend — no backend, no build step:

| File | Role |
|------|------|
| `index.html` | Shell — map + sheet (+ drive card); loads MapLibre GL JS CDN, turf.js, SunCalc, `nav-links.js`, `app.js`, `ui.js`, `style.css` |
| `app.js` | Engine — map init, DuckDB WASM filter, IndexedDB cache, markers, route filtering, TomTom, geolocation, theme. Reports to the UI only through `window.UI.on…` hooks |
| `ui.js` | Interface — the sheet views (home, trip, station, nearby, settings) and the drive screen |
| `nav-links.js` | Builds the « Naviguer » URL (Apple Plans / Google Maps / Waze) |
| `style.css` | Layout (fixed zones: sheet column or bottom sheet + map, never overlays), sheet, rows, drive card |
| `filter-worker.js` | Web Worker for off-thread route corridor filtering |

Every local file loaded by `index.html` or `new Worker()` must be on both `cp … dist/` lines of `.github/workflows/deploy.yml` and `pr-preview.yml` (`tests/deploy-files.spec.js` enforces it).

**Stack:** MapLibre GL JS (CDN) + OpenFreeMap vector tiles (Positron / Dark styles, no API key) + DuckDB WASM (CDN) + turf.js

**Basemap theming:** the map starts on the Positron style; on `load`, `_addDarkBasemap()` fetches the Dark style and adds its layers hidden, prefixed `dark:`, below our own layers. `applyTheme()` only flips visibility between the two groups. Never use `map.setStyle()` for the theme: it would drop the `stations` / `route` sources and our layers. Custom symbol layers must use a font OpenFreeMap serves (`Noto Sans Regular`; `Open Sans` 404s).

**MapLibre is pinned to an exact 5.x version** in `index.html`. Never use `@latest`: v6 is ESM-only and ships no `dist/maplibre-gl.js`, so a floating URL 404s and the whole app dies before loading data (B-5).

### Data Flow

1. **Cache hit** (< 24h): reads filtered rows from IndexedDB, builds markers immediately — no network call to data.gouv.fr.
2. **Cache miss**: initialises DuckDB WASM, downloads raw parquet (~6 MB) from data.gouv.fr with progress display, runs `FILTER_SQL` (CTE chain in `app.js`), stores result in IndexedDB, builds markers.

### Filter Logic (`FILTER_SQL` in `app.js`)

1. **Power computation** — parses `puissance_nominale` (handles French decimal comma)
2. **Station deduplication** — one representative connector per `id_station_itinerance`
3. **Max power per station** — across all connectors
4. **CCS Combo detection** — any connector with `prise_type_combo_ccs = TRUE`
5. **CCS fast count** — connectors with CCS and power ≥ 150 kW, capped by `nbre_pdc`
6. **Truck exclusion** — `restriction_gabarit LIKE '%poids lourd%'` or name keywords
7. **Final filter**: implantation IN (dedicated / private parking), max_power ≥ 150 kW, nbre_pdc ≥ 4, valid GPS, not truck

### Cache

- **Storage**: IndexedDB database `irve-v1`, object store `data`, key `stations`
- **Entry**: `{ ts: Date.now(), rows: [...] }` — plain JS objects
- **TTL**: 24 hours

## Documentation

- **`README.md`** — orienté **utilisateurs** : présentation des fonctionnalités, cas d'usage, configuration TomTom. Ne pas y mettre de détails techniques d'implémentation.
- **`CLAUDE.md`** (ce fichier) — orienté **développeurs et IA** : architecture, stack, patterns de code, backlog.

## Backlog

`BACKLOG.md` recense toutes les idées, améliorations et bugs connus, classés par thème (Performance, Fonctionnalités, Qualité des données, UX/Interface, Technique).

**À maintenir à jour systématiquement.** Chaque item porte un statut :

| Symbole | Signification |
|---------|--------------|
| 💡 | **Idée** — concept brut, pas encore évalué |
| 🔍 | **À mûrir** — réflexion fonctionnelle nécessaire avant d'implémenter |
| 📋 | **À faire** — spécifié, prêt à implémenter |
| ✅ | **Fait** — implémenté (conserver pour l'historique avec référence commit) |

Quand une feature est implémentée, marquer l'item ✅ avec la référence du commit.
Quand une nouvelle idée émerge pendant un chantier, l'ajouter immédiatement au backlog.

## Git Workflow

**Ne jamais committer directement sur `main`.** Toujours créer une branche feature :
1. `git checkout -b feat/description` ou `fix/description`
2. Commits sur la branche feature
3. Push + PR

Après le merge d'une PR, si du travail continue, créer immédiatement une nouvelle branche.

## Development

```bash
python3 -m http.server 8765
# then open http://localhost:8765
```

The app requires a HTTP server (not `file://`) because DuckDB WASM uses Web Workers
which are blocked on the `file://` protocol.

