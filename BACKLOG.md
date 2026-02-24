# Backlog — Stations de recharge

Idées, améliorations et bugs connus, classés par thème.

---

## Performance

| # | Idée | Impact estimé | Effort | Notes |
|---|------|:---:|:---:|---|
| P-1 | **Service Worker / offline cache** — mettre en cache le Parquet IndexedDB + assets pour un accès hors-ligne | ★★★ | M | TTL 24 h déjà en place, logique SW naturelle |
| P-2 | **Web Worker DuckDB** — déplacer l'init DuckDB + parsing Parquet dans un Worker dédié pour ne pas bloquer le main thread au 1er chargement | ★★★ | L | WASM cross-worker nécessite SharedArrayBuffer ou postMessage sérialisé |
| P-3 | **Clustering Leaflet** (`markerClusterGroup`) aux zoom faibles — éviter 5 500 markers rendus simultanément | ★★ | M | Attention : incompatible avec canvas renderer actuel |
| P-4 | **Décimation progressive du corridor** — augmenter `DEC_TARGET` dynamiquement selon la longueur de la route (< 500 km → 500 pts, > 500 km → 1 000 pts) | ★ | S | Gain marginal, à valider avec benchmark |

---

## Fonctionnalités

| # | Idée | Notes |
|---|------|-------|
| F-1 | **Étapes intermédiaires** — permettre d'ajouter 1–2 waypoints (ex : Paris → Clermont → Marseille) | Nécessite OSRM `waypoints` + re-découpage du corridor par segment |
| F-2 | **Export GPX / liens de navigation** — bouton pour exporter les stations du trajet ou ouvrir dans Google Maps / Waze | Simple à implémenter pour le GPX |
| F-3 | **Filtre par puissance minimale** — slider pour ne montrer que les ≥ 150 kW / ≥ 250 kW / ≥ 350 kW | Données déjà présentes (`max_power`) |
| F-4 | **Affichage disponibilité temps réel** — indicateur de disponibilité des connecteurs (OCPI / opérateurs qui exposent l'API) | Complexité API variable selon opérateur |
| F-5 | **Partage de trajet** — URL shareable avec départ + arrivée + corridor encodés en query params | Simple, hachage côté client |
| F-6 | **Historique des trajets récents** — mémoriser les 5 derniers trajets calculés (localStorage) | UX pratique pour les trajets récurrents |
| F-7 | **Mode sombre** — thème sombre pour la carte et le panel | Leaflet : tiles CartoDB Dark + CSS variables |
| F-8 | **Détection auto départ = position GPS** — pré-remplir le champ Départ avec la position géolocalisée sans clic | Déjà possible avec `geoState`, juste à connecter au champ |

---

## Qualité des données

| # | Idée | Notes |
|---|------|-------|
| D-1 | **Signaler une erreur** — lien dans la popup pour signaler une station fermée / mal géolocalisée sur data.gouv.fr | Lien direct vers la fiche IRVE |
| D-2 | **Indicateur fraîcheur des données** — afficher la date de la dernière mise à jour du Parquet | L'URL Parquet change quand les données sont mises à jour — à surveiller |

---

## UX / Interface

| # | Idée | Notes |
|---|------|-------|
| U-1 | **Tooltip corridor sur le slider** — afficher la distance en km sous le curseur pendant le glissement | CSS/JS trivial |
| U-2 | **Panneau résultats dépliable** — liste scrollable des stations sur le trajet avec tri par distance de sortie | Utile sur mobile |
| U-3 | **Icône favicon** — pas de favicon actuellement | |
| U-4 | **Meta Open Graph** — image de prévisualisation pour le partage sur les réseaux sociaux | |

---

## Technique / Dette

| # | Idée | Notes |
|---|------|-------|
| T-1 | **Séparation `app.js` en modules ES** — le fichier fait ~1 200 lignes ; découper en `map.js`, `route.js`, `markers.js`, `worker-bridge.js` | Nécessite un bundler ou `<script type="module">` + import maps |
| T-2 | **Tests automatisés** — Playwright end-to-end : chargement, route Paris→Lyon, non-régression 47 CCS + 66 budget | `/tmp/perf-measure.ts` est une bonne base |
| T-3 | **Mise à jour automatique Parquet** — détecter si l'URL du Parquet a changé sur data.gouv.fr et invalider le cache IndexedDB sans attendre 24 h | Vérification ETag ou `Last-Modified` en HEAD request |
