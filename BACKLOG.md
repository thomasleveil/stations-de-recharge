# Backlog — Stations de recharge

Idées, améliorations et bugs connus, classés par thème.

### Statuts

| Symbole | Signification |
|---------|--------------|
| 💡 | **Idée** — concept brut, pas encore évalué |
| 🔍 | **À mûrir** — réflexion fonctionnelle nécessaire avant d'implémenter |
| 📋 | **À faire** — spécifié, prêt à implémenter |
| ✅ | **Fait** — implémenté (conservé pour l'historique) |

---

## Performance

| # | Statut | Idée | Impact estimé | Effort | Notes |
|---|:------:|------|:---:|:---:|---|
| P-1 | 💡 | **Service Worker / offline cache** — mettre en cache le Parquet IndexedDB + assets pour un accès hors-ligne | ★★★ | M | TTL 24 h déjà en place, logique SW naturelle |
| P-2 | 💡 | **Web Worker DuckDB** — déplacer l'init DuckDB + parsing Parquet dans un Worker dédié pour ne pas bloquer le main thread au 1er chargement | ★★★ | L | WASM cross-worker nécessite SharedArrayBuffer ou postMessage sérialisé |
| P-3 | 💡 | **Clustering des markers en mode sans itinéraire** — quand aucun itinéraire n'est calculé, regrouper les 5 500+ markers en clusters pour alléger la page ; revenir aux markers individuels dès qu'une route est active | ★★★ | M | MapLibre GL JS supporte le clustering natif via `cluster: true` sur la source GeoJSON (`cluster_radius`, `cluster_max_zoom`). Alternative : désactiver les markers individuels et afficher uniquement des compteurs par département en mode global |
| P-4 | 💡 | **Décimation progressive du corridor** — augmenter `DEC_TARGET` dynamiquement selon la longueur de la route (< 500 km → 500 pts, > 500 km → 1 000 pts) | ★ | S | Gain marginal, à valider avec benchmark |

---

## Fonctionnalités

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| F-1 | 💡 | **Étapes intermédiaires** — permettre d'ajouter 1–2 waypoints (ex : Paris → Clermont → Marseille) | Nécessite OSRM `waypoints` + re-découpage du corridor par segment |
| F-2 | ~~📋~~ | ~~**Export GPX / liens de navigation**~~ | ❌ Annulé — valeur insuffisante |
| F-3 | ✅ | ~~**Filtre par puissance minimale**~~ | ✅ |
| F-4 | 💡 | **Affichage disponibilité temps réel** — indicateur de disponibilité des connecteurs (OCPI / opérateurs qui exposent l'API) | Complexité API variable selon opérateur |
| F-5 | ✅ | ~~**Partage de trajet**~~ | ✅ commit `e7b7fce` |
| F-6 | ✅ | ~~**Historique des trajets récents**~~ | ✅ |
| F-7 | 💡 | **Mode sombre** — thème sombre pour la carte et le panel | MapLibre : swapper le style raster (`CARTO_STYLE`) vers tiles CartoDB Dark + CSS variables pour le panel |
| F-8 | ✅ | ~~**Détection auto départ = position GPS**~~ | ✅ |
| F-9a | ✅ | **Recommandation réseau pré-trajet** — après calcul d'itinéraire, suggérer 1-2 réseaux auprès desquels souscrire un abonnement mensuel sans engagement pour ce trajet. | ✅ Encart `#network-recommendation` sous `#route-info` ; algorithme `computeNetworkRecommendation()` : zone utile = `min(150 km, routeKm×40%)`, tronçons 80 km, score = tronçons couverts / total, Alliance virtuelle {Electra+IONITY+Fastned+Atlante} |
| F-9b | ✅ | **Réseau préféré en route** — l'utilisateur configure manuellement les réseaux pour lesquels il dispose d'un avantage tarifaire (persisté en localStorage) ; quand un itinéraire est actif, les stations de ces réseaux ont une bordure or. Pas un filtre exclusif. | ✅ Checkboxes par opérateur dans les Paramètres (⚙), `preferredNetworks` Set persisté (`irve-preferred-networks`), `applyPreferredStyling()` applique bordure or (`#F59E0B`, weight 3) dans `updateVisibility()` |

---

## Qualité des données

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| D-1 | 💡 | **Signaler une erreur** — lien dans la popup pour signaler une station fermée / mal géolocalisée sur data.gouv.fr | Lien direct vers la fiche IRVE |
| D-2 | ✅ | ~~**Indicateur fraîcheur des données**~~ | ✅ |
| D-3 | ✅ | ~~**Doublons Allego (et autres) dans la liste de stations**~~ — certains opérateurs (ex : Allego) déclarent chaque PDC comme une `id_station_itinerance` distincte ; le filtre SQL ne les regroupe pas | Déduplication JS dans `buildMarkers` / `buildCheapMarkers` par `(operateur, lat×1e4, lon×1e4)`, en gardant la puissance max |

---

## UX / Interface

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| U-1 | ✅ | ~~**Tooltip corridor sur le slider**~~ | ✅ commit `e7b7fce` |
| U-2 | ✅ | ~~**Panneau résultats dépliable**~~ | ✅ commit `1f5846c` — `showRouteResults()` : liste scrollable triée par progression, titre "N stations", toggle dépliable |
| U-3 | ✅ | ~~**Icône favicon**~~ | ✅ commit `e7b7fce` |
| U-4 | ✅ | ~~**Meta Open Graph**~~ | ✅ |
| U-5 | ✅ | ~~**Bug autocomplete : Entrée ferme la liste**~~ | ✅ commit `923579f` |
| U-6 | ✅ | **Autocomplétion enrichie (noms d'entreprises, POI)** — remplacer ou compléter le geocoder actuel par un service capable de résoudre les noms d'entreprises (ex : "IKEA Lyon", "McDonald's A7"). Contrainte : sans API payante ni clé à configurer. Candidats : Nominatim, Photon (Komoot), OpenCage free tier. Photon semble le meilleur compromis : gratuit, sans clé, POI riches. | Remplace ou complète le geocoder actuel |
| U-7 | ✅ | ~~**Mode conduite**~~ | ✅ — sidebar `#drive-panel` pleine hauteur, 25 vw, côté gauche ; bouton ⬆ affiché après calcul d'itinéraire si GPS actif ; `enterDriveMode()` / `exitDriveMode()` ajoute/retire `.drive-mode-active` sur `body` → `#panel` (départ/arrivée) se décale à `left: calc(25vw + 6px)` et reste visible ; `refreshDrivePanel()` ; 10 prochaines stations en liste verticale (plus proche en bas, `column-reverse`), layout horizontal par card : distance | opérateur + nom de station + puissance + dispo ; bordure bleue sur la prochaine, or si réseau préféré (F-9b) |
| U-7b | ✅ | ~~**Disponibilité TomTom dans les cards mode conduite**~~ — fetch automatique à chaque refresh du panel (cache 3 min) ; tap sur une card → force-refresh (efface `_availCache`) ; fetch séquentiel 300 ms entre chaque station | ✅ commits `13cee19` `37badff` `9ac24ab` — `_driveAhead[]` + `_driveFetched` + `_fetchInProgress` ; `_fetchDriveAvailability(forceRefresh)` ; handler délégué sur `#dm-cards` ; slot `.dm-avail` |
| U-8 | ✅ | ~~**Focus initial sur le champ "Arrivée"** — au chargement de la page, le focus clavier doit être positionné dans le champ Arrivée pour permettre une saisie immédiate~~ | ✅ commit `e7b7fce` |
| U-9 | ✅ | ~~**Double affichage de la taille de corridor** — après calcul d'itinéraire, l'indication du corridor apparaît deux fois dans le bloc formulaire~~ | ✅ commit `e7b7fce` — `route-info` n'affiche plus que la distance (ex. `460 km`), le corridor reste uniquement dans `#corridor-label` |
| U-10 | ✅ | ~~**Taille du corridor CHEAP paramétrable**~~ | ✅ |

---

## Bugs

| # | Statut | Bug | Root cause | Fix |
|---|:------:|-----|-----------|-----|
| B-1 | ✅ | ~~**Bouton Calculer silencieux au premier chargement**~~ | ✅ commit `056a83c` |
| B-2 | ✅ | ~~**Titre du panneau figé à "≥ 150 kW" après changement de filtre puissance**~~ | `subEl.textContent` utilisait `150` en dur | ✅ |
| B-3 | ✅ | ~~**Recommandation réseau non recalculée après changement de filtre ou de corridor**~~ | Handlers power/corridor/cheap appelaient `updateVisibility()` sans `showNetworkRecommendation()` | ✅ |
| B-4 | ✅ | ~~**Markers standards absents intermittents au premier calcul**~~ | Appels concurrents à `calculateRoute()` possibles via Enter ou `_autoCalcOnReady` | `_calcInProgress` guard + `try/finally` |

---

## Technique / Dette

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| T-1 | 💡 | **Séparation `app.js` en modules ES** — le fichier fait ~1 200 lignes ; découper en `map.js`, `route.js`, `markers.js`, `worker-bridge.js` | Nécessite un bundler ou `<script type="module">` + import maps |
| T-2 | 💡 | **Tests automatisés** — Playwright end-to-end : chargement, route Paris→Lyon, non-régression 47 CCS + 66 budget | `/tmp/perf-measure.ts` est une bonne base |
| T-3 | ✅ | ~~**Mise à jour automatique Parquet**~~ | ✅ |
| T-4 | ✅ | ~~**Migration MapLibre GL JS**~~ — remplacer Leaflet 1.9.4 par MapLibre GL JS (rendu WebGL) | ✅ PR #14 — source GeoJSON + layer `circle` WebGL pour les markers principaux, `maplibregl.Marker` DOM pour les réseaux abordables, `IControl` plain object pour le bouton géoloc, `map.jumpTo()` / `map.resize()` / `map.fitBounds()` |
