#!/usr/bin/env python3
"""
Filters the national IRVE CSV to keep only EV charging stations on the target
motorways that are accessible without exiting (no péage required) and provide
≥ 150 kW fast charging.

Usage:
    wget -O irve_raw.csv "<IRVE_CSV_URL>"
    python3 filter_stations.py [--input irve_raw.csv] [--output stations_autoroutes.geojson]

Also writes data.js (embedded JS constant) so the map works without a local server.
"""
import csv
import re
import json
import sys
import argparse
import collections
import pathlib

TARGET_MOTORWAYS = ['A11', 'A57', 'A71', 'A72', 'A85', 'A89', 'A7', 'A8']
MIN_POWER_KW = 150
COORD_GRID_DECIMALS = 3  # ~111m, removes duplicate registrations

# Geographic bounding boxes per motorway (lon_min, lon_max, lat_min, lat_max).
# Rejects stations whose GPS coordinates fall outside the motorway's corridor,
# even if the station name/address mentions the motorway (IRVE coordinate errors).
MOTORWAY_BOUNDS = {
    'A7':  (4.3,  5.5,  43.1, 45.9),   # Lyon → Marseille (Rhône valley)
    'A8':  (5.2,  7.6,  43.2, 43.95),  # Aix-en-Provence → Menton
    'A11': (-2.0, 2.0,  47.0, 48.7),   # Paris → Nantes (L'Océane)
    'A57': (5.8,  6.6,  43.1, 43.5),   # Toulon → Le Muy (jonction A8)
    'A71': (1.8,  3.2,  45.7, 48.0),   # Orléans → Clermont-Ferrand (L'Arverne)
    'A72': (3.3,  4.6,  45.3, 46.0),   # Saint-Étienne → Clermont-Ferrand
    'A85': (-0.6, 1.9,  47.0, 47.8),   # Tours → Angers
    'A89': (-0.5, 4.4,  44.6, 46.2),   # Bordeaux → Lyon via Clermont
}

_MOTORWAY_PAT = re.compile(r'\b(' + '|'.join(TARGET_MOTORWAYS) + r')\b', re.IGNORECASE)
_EXIT_PATTERNS = [
    re.compile(r'\bsortie\b', re.IGNORECASE),
    re.compile(r'\bZAC\b', re.IGNORECASE),
]
_COMMERCIAL_NAMES = ['bricomar', 'campanile', 'hotel', 'hôtel', 'carrefour', 'leclerc']


def parse_power(val: str) -> float:
    try:
        return float(str(val).replace(',', '.'))
    except (ValueError, AttributeError):
        return 0.0


def detect_motorway(row: dict) -> str | None:
    text = ' '.join([row.get('nom_station', ''), row.get('adresse_station', ''), row.get('observations', '')])
    for m in TARGET_MOTORWAYS:
        if re.search(r'\b' + m + r'\b', text, re.IGNORECASE):
            return m
    return None


def is_exit_required(row: dict) -> bool:
    """Return True if the station is only reachable by exiting the motorway."""
    addr = row.get('adresse_station', '')
    name = row.get('nom_station', '')
    combined = (addr + ' ' + name).lower()

    for pat in _EXIT_PATTERNS:
        if pat.search(addr):
            return True
    for brand in _COMMERCIAL_NAMES:
        if brand in combined:
            return True
    # City street pattern without motorway/aire context
    if re.search(r'\broute de\b', addr, re.IGNORECASE) and \
       not re.search(r'\baire\b|\bautoroute\b', addr, re.IGNORECASE):
        return True
    return False


def within_motorway_bounds(motorway: str, lat: float, lon: float) -> bool:
    """Return True if (lat, lon) falls within the expected corridor for motorway."""
    bounds = MOTORWAY_BOUNDS.get(motorway)
    if bounds is None:
        return True  # unknown motorway — don't filter
    lon_min, lon_max, lat_min, lat_max = bounds
    return lon_min <= lon <= lon_max and lat_min <= lat <= lat_max


def coord_key(row: dict):
    try:
        lat = round(float(row.get('consolidated_latitude') or 0), COORD_GRID_DECIMALS)
        lon = round(float(row.get('consolidated_longitude') or 0), COORD_GRID_DECIMALS)
        return (lat, lon) if lat != 0 else None
    except (ValueError, TypeError):
        return None


def build_geojson(input_path: str, output_path: str):
    # --- Pass 1: collect all connectors per station ID, filtered by motorway ---
    stations: dict[str, list[dict]] = collections.defaultdict(list)
    with open(input_path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            text = ' '.join([row.get('nom_station', ''), row.get('adresse_station', ''), row.get('observations', '')])
            if _MOTORWAY_PAT.search(text):
                stations[row['id_station_itinerance']].append(row)

    # --- Pass 2: apply exit and power filters ---
    accepted: dict[str, tuple[dict, float]] = {}
    for sid, connectors in stations.items():
        first = connectors[0]
        if is_exit_required(first):
            continue
        max_power = max(parse_power(c['puissance_nominale']) for c in connectors)
        if max_power < MIN_POWER_KW:
            continue
        accepted[sid] = (first, max_power)

    # --- Pass 3: deduplicate by coordinates (multiple registrations per physical station) ---
    seen_coords: dict = {}
    final: dict[str, tuple[dict, float]] = {}
    for sid, (row, power) in accepted.items():
        key = coord_key(row)
        if key is None:
            final[sid] = (row, power)
            continue
        if key in seen_coords:
            prev_sid = seen_coords[key]
            if power > final[prev_sid][1]:
                del final[prev_sid]
                seen_coords[key] = sid
                final[sid] = (row, power)
        else:
            seen_coords[key] = sid
            final[sid] = (row, power)

    # --- Build GeoJSON ---
    features = []
    skipped_bounds = []
    for sid, (row, max_power) in final.items():
        try:
            lat = float(row['consolidated_latitude'])
            lon = float(row['consolidated_longitude'])
        except (ValueError, TypeError, KeyError):
            continue

        motorway = detect_motorway(row)
        if not within_motorway_bounds(motorway, lat, lon):
            skipped_bounds.append((row['nom_station'], motorway, lon, lat))
            continue

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id": sid,
                "nom_station": row['nom_station'],
                "adresse": row['adresse_station'],
                "operateur": row['nom_operateur'],
                "enseigne": row.get('nom_enseigne') or row.get('nom_operateur', ''),
                "nbre_pdc": row.get('nbre_pdc', ''),
                "max_power_kw": max_power,
                "autoroute": detect_motorway(row),
                "horaires": row.get('horaires', ''),
            }
        })

    geojson = {"type": "FeatureCollection", "features": features}
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    if skipped_bounds:
        print(f"Skipped {len(skipped_bounds)} stations outside motorway bounds:")
        for name, mw, lon, lat in skipped_bounds:
            print(f"  [{mw}] {name} (lon={lon:.4f}, lat={lat:.4f})")

    print(f"Written {len(features)} stations to {output_path}")
    by_mw = collections.Counter(f['properties']['autoroute'] for f in features)
    for m in TARGET_MOTORWAYS:
        print(f"  {m}: {by_mw.get(m, 0)} stations")

    # Also write data.js for use without a local server (file:// protocol)
    js_path = output_path.replace('.geojson', '').rstrip('/') + '_datajs'
    js_path = str(pathlib.Path(output_path).parent / 'data.js')
    js_content = 'const STATIONS_DATA = ' + json.dumps(geojson, ensure_ascii=False, separators=(',', ':')) + ';'
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"Written {js_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', default='irve_raw.csv')
    parser.add_argument('--output', default='stations_autoroutes.geojson')
    args = parser.parse_args()
    build_geojson(args.input, args.output)
