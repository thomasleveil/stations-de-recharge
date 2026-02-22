#!/usr/bin/env python3
"""
Filters the national IRVE Parquet file to keep only EV charging stations
that are dedicated fast-charging stations (implantation_station), provide
≥ 150 kW on at least one connector, and offer CCS Combo charging.

Uses DuckDB with the spatial extension for fast in-process SQL + geometry ops.

Usage:
    wget -O irve_raw.parquet "https://object.files.data.gouv.fr/hydra-parquet/hydra-parquet/eb76d20a-8501-400e-b336-d85724de5435.parquet"
    python3 filter_stations.py [--input irve_raw.parquet] [--output stations.geojson]

Also writes data.js (embedded JS constant) so the map works without a local server.
"""
import json
import argparse
import pathlib
import duckdb

MIN_POWER_KW = 150
MIN_PDC = 4
IMPLANTATION_FILTER  = 'Station dédiée à la recharge rapide'
PARKING_IMPLANTATION = 'Parking privé à usage public'


def build_geojson(input_path: str, output_path: str):
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")

    # ── 1. Load Parquet — add lat / lon / power_kw columns ───────────────────
    print("Loading Parquet…")
    con.execute("""
        CREATE TABLE irve AS
        SELECT *,
            TRY_CAST(consolidated_latitude  AS DOUBLE) AS lat,
            TRY_CAST(consolidated_longitude AS DOUBLE) AS lon,
            TRY_CAST(
                REPLACE(COALESCE(CAST(puissance_nominale AS VARCHAR), '0'), ',', '.')
                AS DOUBLE
            ) AS power_kw
        FROM read_parquet(?)
    """, [input_path])

    # ── 2. First connector per station (representative row) ──────────────────
    con.execute("""
        CREATE TABLE station_first AS
        WITH rn AS (
            SELECT *,
                ROW_NUMBER() OVER (PARTITION BY id_station_itinerance ORDER BY rowid) AS _rn
            FROM irve
        )
        SELECT * FROM rn WHERE _rn = 1
    """)

    # ── 3. Max power per station (all connectors) ────────────────────────────
    con.execute("""
        CREATE TABLE station_power AS
        SELECT id_station_itinerance, MAX(power_kw) AS max_power_kw
        FROM irve
        GROUP BY id_station_itinerance
    """)

    # ── 4. CCS Combo connector detection (any connector in the station) ───────
    con.execute("""
        CREATE TABLE ccs_sids AS
        SELECT DISTINCT id_station_itinerance FROM irve
        WHERE prise_type_combo_ccs = TRUE
    """)

    # ── 4.5. Count CCS fast connectors per station (power ≥ 150 kW) ─────────
    con.execute(f"""
        CREATE TABLE station_ccs_fast AS
        SELECT id_station_itinerance,
               COUNT(*) AS nbre_ccs_fast
        FROM irve
        WHERE prise_type_combo_ccs = TRUE
          AND power_kw >= {MIN_POWER_KW}
        GROUP BY id_station_itinerance
    """)

    # ── 4.6. Truck-only station detection (any connector signals truck use) ───
    # Combines:
    #   • restriction_gabarit containing 'poids lourd' (explicit IRVE field)
    #   • nom_station keywords: truck / camion / poids lourd(s)
    # Milence and Watt'up Truck don't fill restriction_gabarit correctly,
    # but always put the signal in the station name.
    con.execute(r"""
        CREATE TABLE truck_sids AS
        SELECT DISTINCT id_station_itinerance FROM irve
        WHERE lower(COALESCE(restriction_gabarit, '')) LIKE '%poids lourd%'
           OR lower(COALESCE(nom_station, ''))         LIKE '%truck%'
           OR lower(COALESCE(nom_station, ''))         LIKE '%camion%'
           OR lower(COALESCE(nom_station, ''))         LIKE '%poids lourd%'
    """)

    # ── 5. Apply filters ─────────────────────────────────────────────────────
    # Rules:
    #   1. implantation_station = 'Station dédiée à la recharge rapide'
    #   2. max power across all connectors ≥ 150 kW
    #   3. at least one connector with CCS Combo
    #   4. valid (non-null, non-zero) GPS coordinates
    con.execute(f"""
        CREATE TABLE final_stations AS
        SELECT sf.*,
               sp.max_power_kw,
               COALESCE(cf.nbre_ccs_fast, 0) AS nbre_ccs_fast,
               CASE WHEN sf.implantation_station = '{IMPLANTATION_FILTER}'
                    THEN 'dedicee' ELSE 'parking'
               END AS station_type
        FROM station_first      sf
        JOIN station_power       sp  ON sf.id_station_itinerance = sp.id_station_itinerance
        JOIN ccs_sids            ccs ON sf.id_station_itinerance = ccs.id_station_itinerance
        LEFT JOIN station_ccs_fast cf ON sf.id_station_itinerance = cf.id_station_itinerance
        LEFT JOIN truck_sids     ts  ON sf.id_station_itinerance = ts.id_station_itinerance
        WHERE sf.implantation_station IN ('{IMPLANTATION_FILTER}', '{PARKING_IMPLANTATION}')
          AND sp.max_power_kw >= {MIN_POWER_KW}
          AND COALESCE(TRY_CAST(sf.nbre_pdc AS INTEGER), 0) >= {MIN_PDC}
          AND sf.lat IS NOT NULL AND sf.lat != 0
          AND sf.lon IS NOT NULL AND sf.lon != 0
          AND ts.id_station_itinerance IS NULL
    """)

    # ── 6. Build GeoJSON ──────────────────────────────────────────────────────
    rows = con.execute("""
        SELECT lon, lat,
               id_station_itinerance,
               COALESCE(nom_station, '')                             AS nom_station,
               COALESCE(adresse_station, '')                         AS adresse,
               COALESCE(nom_operateur, '')                           AS operateur,
               COALESCE(NULLIF(nom_enseigne, ''), nom_operateur, '') AS enseigne,
               COALESCE(CAST(nbre_pdc AS VARCHAR), '')               AS nbre_pdc,
               max_power_kw,
               nbre_ccs_fast,
               COALESCE(horaires, '')                                AS horaires,
               station_type
        FROM final_stations
        ORDER BY id_station_itinerance
    """).fetchall()

    features = []
    for lon, lat, sid, nom, addr, oper, ens, nbre, pw, nccs, hor, stype in rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "id":           sid,
                "nom_station":  nom,
                "adresse":      addr,
                "operateur":    oper,
                "enseigne":     ens,
                "nbre_pdc":      nbre,
                "max_power_kw":  pw,
                "nbre_ccs_fast": nccs,
                "horaires":      hor,
                "station_type":  stype,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"Written {len(features)} stations to {output_path}")

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
    parser.add_argument('--output', default='stations.geojson')
    args = parser.parse_args()
    build_geojson(args.input, args.output)
