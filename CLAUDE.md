# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Interactive map of EV charging stations at highway rest areas along all major French motorways (A1, A2, A4, A6, A7, A8, A9, A10, A11, A13, A20, A26, A28, A31, A35, A36, A40, A41, A42, A43, A51, A54, A57, A61, A62, A63, A64, A71, A72, A75, A85, A89). Helps plan electric vehicle road trips by filtering stations along any calculated route using OSRM.

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
| `index.html` | Shell — loads Leaflet CDN, turf.js, `app.js`, `style.css` |
| `app.js` | Map init, DuckDB WASM filter, IndexedDB cache, markers, route filtering |
| `style.css` | Panel, legend, popup, marker styles |
| `filter-worker.js` | Web Worker for off-thread route corridor filtering |

**Stack:** Leaflet 1.9.4 + CartoDB Positron tiles + DuckDB WASM (CDN) + turf.js

### Data Flow

1. **Cache hit** (< 24h): reads filtered rows from IndexedDB, builds markers immediately — no network call to data.gouv.fr.
2. **Cache miss**: initialises DuckDB WASM, downloads raw parquet (~6 MB) from data.gouv.fr with progress display, runs `FILTER_SQL` (CTE chain in `app.js`), stores result in IndexedDB, builds markers.

### Filter Logic (`FILTER_SQL` in `app.js`)

Replicates the former `filter_stations.py` exactly:
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

## Development

```bash
python3 -m http.server 8765
# then open http://localhost:8765
```

The app requires a HTTP server (not `file://`) because DuckDB WASM uses Web Workers
which are blocked on the `file://` protocol.

## Legacy

`filter_stations.py` is kept for reference — it documents the business logic that
is now ported to `FILTER_SQL` in `app.js`. It is no longer needed to run the app.
