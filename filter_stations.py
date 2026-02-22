#!/usr/bin/env python3
"""
Filters the national IRVE Parquet file to keep only EV charging stations on
the target motorways that are accessible without exiting (no péage required)
and provide ≥ 150 kW fast charging.

Uses DuckDB with the spatial extension for fast in-process SQL + geometry ops.
Station selection relies on the IRVE field:
    implantation_station = 'Station dédiée à la recharge rapide'
which identifies dedicated fast-charging stations (rest-area/motorway chargers).
Motorway assignment is geographic: closest normalised bounding-box centre.

Usage:
    wget -O irve_raw.parquet "https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet"
    python3 filter_stations.py [--input irve_raw.parquet] [--output stations_autoroutes.geojson]

Also writes data.js (embedded JS constant) so the map works without a local server.
"""
import json
import argparse
import collections
import pathlib
import duckdb

TARGET_MOTORWAYS = [
    'A1', 'A2', 'A4', 'A6', 'A7', 'A8', 'A9',
    'A10', 'A11', 'A13', 'A20', 'A26', 'A28', 'A31',
    'A35', 'A36', 'A40', 'A41', 'A42', 'A43',
    'A51', 'A54', 'A57', 'A61', 'A62', 'A63', 'A64',
    'A71', 'A72', 'A75', 'A85', 'A89',
    # Voies express gratuites — Bretagne et Normandie
    'N12', 'N24', 'N164', 'N165',
]
MIN_POWER_KW = 150
COORD_GRID_DECIMALS = 3  # ~111m, removes duplicate registrations

# Geographic bounding boxes per motorway (lon_min, lon_max, lat_min, lat_max).
# Rejects stations whose GPS coordinates fall outside the motorway's corridor,
# even if implantation_station is correct (IRVE coordinate errors).
MOTORWAY_BOUNDS = {
    # ── Existing ──────────────────────────────────────────────────────
    'A7':  (4.3,  5.5,  43.1, 45.9),   # Lyon → Marseille (Rhône valley)
    'A8':  (5.2,  7.6,  43.2, 43.95),  # Aix-en-Provence → Menton
    'A11': (-2.0, 2.0,  47.0, 48.7),   # Paris → Nantes (L'Océane)
    'A57': (5.8,  6.6,  43.1, 43.5),   # Toulon → Le Muy (jonction A8)
    'A71': (1.8,  3.2,  45.7, 48.0),   # Orléans → Clermont-Ferrand (L'Arverne)
    'A72': (3.3,  4.6,  45.3, 46.0),   # Saint-Étienne → Clermont-Ferrand
    'A85': (-0.6, 1.9,  47.0, 47.8),   # Tours → Angers
    'A89': (-0.5, 4.4,  44.6, 46.2),   # Bordeaux → Lyon via Clermont
    # ── North / Northeast ─────────────────────────────────────────────
    'A1':  (2.1,  3.2,  48.8, 50.6),   # Paris → Lille → Belgian border
    'A2':  (3.0,  4.0,  50.0, 50.5),   # Valenciennes → Belgian border
    'A4':  (1.9,  7.9,  48.3, 49.5),   # Paris → Strasbourg (via Reims, Metz)
    'A26': (1.5,  4.3,  48.0, 51.0),   # Calais → Troyes (Les Anglaises)
    'A31': (4.5,  6.4,  47.1, 49.6),   # Dijon → Nancy → Luxembourg border
    'A35': (7.0,  7.9,  47.6, 48.7),   # Strasbourg → Mulhouse (Alsace)
    'A36': (4.7,  7.5,  47.0, 47.9),   # Mulhouse → Beaune (La Comtoise)
    # ── West / Northwest ──────────────────────────────────────────────
    'A10': (-0.8, 2.5,  44.8, 48.9),   # Paris → Orléans → Bordeaux (L'Aquitaine)
    'A13': (-0.5, 2.4,  48.5, 49.7),   # Paris → Rouen → Caen (Normandie)
    'A28': (-0.1, 1.6,  47.3, 50.6),   # Rouen → Abbeville → Saint-Omer + Le Mans → Tours
    # ── Paris → Lyon (Bourgogne) ──────────────────────────────────────
    'A6':  (2.2,  5.2,  45.4, 48.9),   # Paris → Beaune → Lyon (du Soleil)
    # ── Center / Massif Central ───────────────────────────────────────
    'A20': (1.1,  2.6,  44.8, 47.4),   # Vierzon → Limoges → Brive (L'Occitane)
    'A75': (2.8,  3.6,  43.3, 45.8),   # Clermont → Millau → Montpellier
    # ── Southeast / Alps ──────────────────────────────────────────────
    'A40': (4.2,  6.6,  45.5, 46.5),   # Lyon → Mâcon → Bourg → Geneva
    'A41': (5.7,  6.4,  45.1, 46.2),   # Grenoble → Annecy → Geneva
    'A42': (4.9,  5.5,  45.7, 46.1),   # Lyon → Bourg-en-Bresse
    'A43': (4.7,  6.8,  45.1, 45.8),   # Lyon → Chambéry → Fréjus tunnel
    'A51': (5.1,  6.3,  43.3, 45.3),   # Marseille/Aix → Grenoble → Sisteron → Gap
    'A54': (4.3,  5.0,  43.4, 43.9),   # Nîmes → Arles → Salon (Camargue)
    # ── South / Mediterranean ─────────────────────────────────────────
    'A9':  (0.5,  4.9,  42.4, 44.3),   # Orange → Montpellier → Perpignan
    # ── Southwest ─────────────────────────────────────────────────────
    'A61': (1.3,  3.3,  43.0, 43.7),   # Toulouse → Carcassonne → Narbonne
    'A62': (-0.8, 1.6,  43.5, 44.9),   # Bordeaux → Agen → Toulouse
    'A63': (-2.1, -0.4, 43.3, 44.9),   # Bordeaux → Bayonne → Spanish border
    'A64': (-1.9, 1.7,  43.1, 43.8),   # Bayonne → Tarbes → Toulouse
    # ── Voies express gratuites — Bretagne ────────────────────────────
    'N12':  (-4.6, 1.8,  47.8, 49.0), # Paris → Alençon → Rennes → Brest
    'N24':  (-3.5, -1.6, 47.7, 48.2), # Rennes → Ploërmel → Lorient
    'N164': (-4.1, -2.0, 48.0, 48.5), # Rennes → Loudéac → Carhaix → Châteaulin
    'N165': (-4.6, -1.4, 47.2, 48.0), # Nantes → Vannes → Lorient → Quimper → Brest
}

IMPLANTATION_FILTER = 'Station dédiée à la recharge rapide'


def build_geojson(input_path: str, output_path: str):
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")

    # ── 1. Load Parquet — add lat / lon / power_kw / geom columns ────────────
    print("Loading Parquet…")
    con.execute("""
        CREATE TABLE irve AS
        WITH raw AS (
            SELECT *,
                TRY_CAST(consolidated_latitude  AS DOUBLE) AS lat,
                TRY_CAST(consolidated_longitude AS DOUBLE) AS lon,
                TRY_CAST(
                    REPLACE(COALESCE(CAST(puissance_nominale AS VARCHAR), '0'), ',', '.')
                    AS DOUBLE
                ) AS power_kw
            FROM read_parquet(?)
        )
        SELECT *,
            CASE WHEN lat IS NOT NULL AND lat != 0
                      AND lon IS NOT NULL AND lon != 0
                 THEN ST_Point(lon, lat)
                 ELSE NULL
            END AS geom
        FROM raw
    """, [input_path])

    # ── 2. Motorway bounding boxes as spatial envelopes ──────────────────────
    con.execute("""
        CREATE TABLE mw_bounds (
            motorway VARCHAR,
            lon_min  DOUBLE, lon_max DOUBLE,
            lat_min  DOUBLE, lat_max DOUBLE,
            envelope GEOMETRY
        )
    """)
    # ST_MakeEnvelope(xmin=lon_min, ymin=lat_min, xmax=lon_max, ymax=lat_max)
    con.executemany(
        "INSERT INTO mw_bounds VALUES (?, ?, ?, ?, ?, ST_MakeEnvelope(?, ?, ?, ?))",
        [(mw, lo, hi, la, ha, lo, la, hi, ha)
         for mw, (lo, hi, la, ha) in MOTORWAY_BOUNDS.items()],
    )

    # ── 3. First connector per station (representative row) ──────────────────
    con.execute("""
        CREATE TABLE station_first AS
        WITH rn AS (
            SELECT *,
                ROW_NUMBER() OVER (PARTITION BY id_station_itinerance ORDER BY rowid) AS _rn
            FROM irve
        )
        SELECT * FROM rn WHERE _rn = 1
    """)

    # ── 4. Max power per station (all connectors) ────────────────────────────
    con.execute("""
        CREATE TABLE station_power AS
        SELECT id_station_itinerance, MAX(power_kw) AS max_power_kw
        FROM irve
        GROUP BY id_station_itinerance
    """)

    # ── 4.5. Rest-area identification (all connectors) ───────────────────────
    # Scans ALL connectors (not just station_first) to handle stations where
    # only a secondary connector carries "Aire de" in its name/address.
    # Also matches TotalEnergies "RELAIS" stations and Zunder stations whose
    # address begins with a motorway reference (e.g. "A6 - LYON PARIS").
    con.execute(r"""
        CREATE TABLE aire_sids AS
        SELECT DISTINCT id_station_itinerance FROM irve
        WHERE lower(COALESCE(nom_station, ''))     LIKE '%aire de%'
           OR lower(COALESCE(nom_station, ''))     LIKE '%aire d''%'
           OR lower(COALESCE(adresse_station, '')) LIKE '%aire de%'
           OR lower(COALESCE(adresse_station, '')) LIKE '%aire d''%'
           OR regexp_matches(COALESCE(adresse_station, ''), '^\s*[ANan][0-9]')
    """)

    # ── 5. Geographic motorway assignment (closest normalised bbox centre) ───
    # Uses ST_Within for initial candidate filtering, then picks the motorway
    # whose normalised centre is nearest — resolves overlapping corridors
    # (e.g. A4 / A31 near Verdun, A6 / A71 in the Allier).
    con.execute("""
        CREATE TABLE geo_motorway AS
        WITH candidates AS (
            SELECT sf.id_station_itinerance, b.motorway,
                SQRT(
                    POWER((sf.lon - b.lon_min) / (b.lon_max - b.lon_min) - 0.5, 2) +
                    POWER((sf.lat - b.lat_min) / (b.lat_max - b.lat_min) - 0.5, 2)
                ) AS centre_dist
            FROM station_first sf
            JOIN mw_bounds b ON ST_Within(sf.geom, b.envelope)
            WHERE sf.geom IS NOT NULL
        ),
        ranked AS (
            SELECT *,
                ROW_NUMBER() OVER (PARTITION BY id_station_itinerance ORDER BY centre_dist) AS rn
            FROM candidates
        )
        SELECT id_station_itinerance, motorway AS geo_motorway
        FROM ranked WHERE rn = 1
    """)

    # ── 6. Apply filters: dedicated fast-charging + rest-area + power ≥ 150 kW
    # implantation_station = 'Station dédiée à la recharge rapide' narrows to
    # dedicated fast-charging stations (excludes retail / street parking).
    # JOIN on aire_sids further restricts to rest-area stations ("Aire de" in
    # any connector, or address starts with a motorway reference).
    # JOIN on geo_motorway assigns to a specific motorway corridor.
    con.execute(f"""
        CREATE TABLE pre_bounds AS
        SELECT sf.*,
               sp.max_power_kw,
               gm.geo_motorway AS motorway
        FROM station_first  sf
        JOIN station_power  sp   ON sf.id_station_itinerance = sp.id_station_itinerance
        JOIN geo_motorway   gm   ON sf.id_station_itinerance = gm.id_station_itinerance
        JOIN aire_sids      airs ON sf.id_station_itinerance = airs.id_station_itinerance
        WHERE sf.implantation_station = '{IMPLANTATION_FILTER}'
          AND sp.max_power_kw >= {MIN_POWER_KW}
          AND sf.geom IS NOT NULL
    """)

    # ── 7. Bounds validation + coordinate deduplication ──────────────────────
    con.execute(f"""
        CREATE TABLE final_stations AS
        WITH bounded AS (
            SELECT pb.*
            FROM pre_bounds pb
            LEFT JOIN mw_bounds mb ON pb.motorway = mb.motorway
            -- allow if no bounds defined for this motorway, or station is within corridor
            WHERE mb.motorway IS NULL OR ST_Within(pb.geom, mb.envelope)
        ),
        deduped AS (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY ROUND(lat, {COORD_GRID_DECIMALS}),
                                 ROUND(lon, {COORD_GRID_DECIMALS})
                    ORDER BY max_power_kw DESC, id_station_itinerance ASC
                ) AS _coord_rn
            FROM bounded
        )
        SELECT * FROM deduped WHERE _coord_rn = 1
    """)

    # ── 8. Report stations rejected by the bounds check ──────────────────────
    skipped = con.execute("""
        SELECT pb.nom_station, pb.motorway, pb.lon, pb.lat
        FROM pre_bounds pb
        LEFT JOIN mw_bounds mb ON pb.motorway = mb.motorway
        WHERE mb.motorway IS NOT NULL AND NOT ST_Within(pb.geom, mb.envelope)
        ORDER BY mb.motorway, pb.nom_station
    """).fetchall()

    if skipped:
        print(f"Skipped {len(skipped)} stations outside motorway bounds:")
        for nom, mw, lo, la in skipped:
            print(f"  [{mw}] {nom} (lon={lo:.4f}, lat={la:.4f})")

    # ── 9. Build GeoJSON ──────────────────────────────────────────────────────
    rows = con.execute("""
        SELECT lon, lat,
               id_station_itinerance,
               COALESCE(nom_station, '')                             AS nom_station,
               COALESCE(adresse_station, '')                         AS adresse,
               COALESCE(nom_operateur, '')                           AS operateur,
               COALESCE(NULLIF(nom_enseigne, ''), nom_operateur, '') AS enseigne,
               COALESCE(CAST(nbre_pdc AS VARCHAR), '')               AS nbre_pdc,
               max_power_kw,
               motorway                                              AS autoroute,
               COALESCE(horaires, '')                                AS horaires
        FROM final_stations
        ORDER BY id_station_itinerance
    """).fetchall()

    features = []
    for lon, lat, sid, nom, addr, oper, ens, nbre, pw, mw, hor in rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id":           sid,
                "nom_station":  nom,
                "adresse":      addr,
                "operateur":    oper,
                "enseigne":     ens,
                "nbre_pdc":     nbre,
                "max_power_kw": pw,
                "autoroute":    mw,
                "horaires":     hor,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"Written {len(features)} stations to {output_path}")
    by_mw = collections.Counter(f['properties']['autoroute'] for f in features)
    for m in TARGET_MOTORWAYS:
        if by_mw.get(m, 0) > 0:
            print(f"  {m}: {by_mw[m]} stations")

    # Also write data.js for use without a local server (file:// protocol)
    js_path = str(pathlib.Path(output_path).parent / 'data.js')
    with open(js_path, 'w', encoding='utf-8') as f:
        f.write('const STATIONS_DATA = '
                + json.dumps(geojson, ensure_ascii=False, separators=(',', ':'))
                + ';')
    print(f"Written {js_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',  default='irve_raw.parquet')
    parser.add_argument('--output', default='stations_autoroutes.geojson')
    args = parser.parse_args()
    build_geojson(args.input, args.output)
