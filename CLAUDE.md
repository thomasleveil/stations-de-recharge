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

Static frontend — no backend, no build step. Three files:

| File | Role |
|------|------|
| `index.html` | Shell — loads MapLibre GL JS CDN, turf.js, `app.js`, `style.css` |
| `app.js` | Map init, DuckDB WASM filter, IndexedDB cache, markers, route filtering |
| `style.css` | Panel, legend, popup, marker styles |
| `filter-worker.js` | Web Worker for off-thread route corridor filtering |

**Stack:** MapLibre GL JS (CDN) + CartoDB Positron raster tiles + DuckDB WASM (CDN) + turf.js

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

## Development

```bash
python3 -m http.server 8765
# then open http://localhost:8765
```

The app requires a HTTP server (not `file://`) because DuckDB WASM uses Web Workers
which are blocked on the `file://` protocol.

