# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Interactive map of EV charging stations at highway rest areas along French motorways **A7, A8, A11, A57, A71, A72, A85, and A89**. Helps plan electric vehicle road trips by showing which charging network operators are present at each rest area, so users can choose subscriptions wisely.

## Data Source

**Base nationale des IRVE** (Infrastructures de Recharge pour Véhicules Électriques)
Source: [transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques)
Updated: daily. Raw CSV is ~122MB, 188k rows (one row per connector/PDC).

**Pre-filtered data** is already in `stations_autoroutes.geojson` (84 stations ≥150 kW, no motorway exit required, one feature per station). Do not commit the raw CSV — it is gitignored.

To regenerate the GeoJSON from a fresh CSV download:
```bash
wget -O irve_raw.csv "https://www.data.gouv.fr/api/1/datasets/r/eb76d20a-8501-400e-b336-d85724de5435"
python3 filter_stations.py
```

`filter_stations.py` applies filters in order:
1. **Motorway match** — station address/name mentions one of the 8 target motorways
2. **No exit required** — excludes stations with "sortie", "ZAC", commercial brands (Bricomarché etc.), or city-street address patterns
3. **Power ≥ 150 kW** — at least one connector per station meets the threshold
4. **Coordinate deduplication** — same physical station registered multiple times is collapsed to one record (highest power kept)
5. **Geographic bounding box** — rejects stations whose GPS coordinates fall outside the motorway's expected corridor (catches IRVE coordinate errors)

Note: `implantation_station` is inconsistently assigned in the IRVE data (genuine rest-area chargers appear as "Voirie" or "Parking privé") — do not use it as a filter.

### Key Operators on Target Motorways (after filtering)

| Operator | Motorways |
|----------|-----------|
| TotalEnergies | A7 (8), A8 (7), A89 (2), A85 (1), A47 (1) |
| IONITY | A7 (7), A8 (3), A85 (2), A89 (1) |
| Allego / Electra | A7 |
| Fastned | A72, A89 |
| ENGIE Vianeo | A8, A89 |
| Zunder, e-Vadea, Tesla | scattered |

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
wget -O irve_raw.csv "<URL from transport.data.gouv.fr>"
python3 filter_stations.py
# Regenerates both stations_autoroutes.geojson and data.js
```
