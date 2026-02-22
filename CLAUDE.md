# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Interactive map of EV charging stations at highway rest areas along all major French motorways (A1, A2, A4, A6, A7, A8, A9, A10, A11, A13, A20, A26, A28, A31, A35, A36, A40, A41, A42, A43, A51, A54, A57, A61, A62, A63, A64, A71, A72, A75, A85, A89). Helps plan electric vehicle road trips by filtering stations along any calculated route using OSRM.

## Data Source

**Base nationale des IRVE** (Infrastructures de Recharge pour Véhicules Électriques)
Source: [data.gouv.fr](https://www.data.gouv.fr/datasets/base-nationale-des-irve-infrastructures-de-recharge-pour-vehicules-electriques)
Updated: daily. Parquet file is ~6 MB (188k rows, one row per connector/PDC).

**Pre-filtered data** is already in `stations_autoroutes.geojson` (one feature per station ≥150 kW). Do not commit the raw Parquet — it is gitignored.

To regenerate the GeoJSON from a fresh Parquet download:
```bash
wget -O irve_raw.parquet "https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet"
python3 filter_stations.py
```

`filter_stations.py` applies filters in order:
1. **Dedicated fast-charging station** — `implantation_station = 'Station dédiée à la recharge rapide'` pre-filters to standalone fast-charging stations (excludes retail / street parking)
2. **Rest-area identification** — requires "Aire de" / "Aire d'" in the station name or address *across all connectors*, OR address starts with a motorway reference (e.g. `A6 - LYON PARIS`). Catches TotalEnergies "RELAIS" stations and unnamed Zunder stations on motorways.
3. **Power ≥ 150 kW** — at least one connector per station meets the threshold
4. **Geographic motorway assignment** — closest normalised bounding-box centre assigns the motorway label; stations outside all target corridors are dropped
5. **Coordinate deduplication** — same physical station registered multiple times is collapsed to one record (highest power kept)
6. **Geographic bounding box** — rejects stations whose GPS coordinates fall outside the assigned motorway's expected corridor (catches IRVE coordinate errors)

### Key Operators on Target Motorways (after filtering)

357 stations total from the Parquet run.

| Operator | Top motorways |
|----------|--------------|
| TotalEnergies | A26 (18), A6 (11), A7 (8), A10 (8) … total 97 |
| IONITY | A10 (12), A6 (8), A7 (8), A11 (7) … total 89 |
| ENGIE Vianeo | A26 (13), A6 (10), A4 (6) … total 67 |
| Fastned | A26 (9), A4 (6), A40 (3) … total 33 |
| Allego / Electra | A9, A10, A7, A11 … total 18 |
| Zunder | A63 (4), A71, A10 … total 9 |
| bp pulse | A10 (6) … total 7 |
| e-Vadea | A36 |

### GeoJSON Schema

Each feature in `stations_autoroutes.geojson`:
```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [lon, lat] },
  "properties": {
    "id": "string",
    "nom_station": "string",
    "adresse": "string",
    "operateur": "string",
    "enseigne": "string (brand name)",
    "nbre_pdc": "number of charging points",
    "max_power_kw": 350,
    "autoroute": "A7",
    "horaires": "string (e.g. 24/7)"
  }
}
```

## Architecture

Static frontend — no backend, no build step. Four files:

| File | Role |
|------|------|
| `index.html` | Shell — loads Leaflet CDN, `data.js`, `app.js`, `style.css` |
| `app.js` | Map init (CartoDB Positron tiles), markers, filters, popups, legend |
| `style.css` | Panel, legend, popup, marker styles |
| `data.js` | Embedded GeoJSON constant (`STATIONS_DATA`) — enables `file://` use |

**Stack:** Leaflet 1.9.4 (CDN) + CartoDB Positron tiles (no API key)

## Development

```bash
# Open the map locally
python3 -m http.server 8765
# then open http://localhost:8765

# Or open directly (works because data is embedded in data.js)
open index.html
```

## Updating the data

```bash
wget -O irve_raw.parquet "https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet"
python3 filter_stations.py
# Regenerates both stations_autoroutes.geojson and data.js
```
