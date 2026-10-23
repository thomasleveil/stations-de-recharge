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
| F-4 | ✅ | ~~**Affichage disponibilité temps réel**~~ — indicateur de disponibilité des connecteurs au clic sur une station | ✅ Via TomTom EV Charging Stations Availability API (optionnel, clé dans ⚙) ; `fetchAvailability(m)` avec cache 3 min ; spinner dans popup, bouton ↺ refresh ; aussi dans les cards mode conduite (U-7b) et mode urgence |
| F-5 | ✅ | ~~**Partage de trajet**~~ | ✅ commit `e7b7fce` |
| F-6 | ✅ | ~~**Historique des trajets récents**~~ | ✅ |
| F-7 | ✅ | ~~**Mode sombre**~~ — thème automatique via SunCalc (crépuscule civil) + bouton ☀/☽ en haut à droite. Panels drive/emergency adaptés au thème. | ✅ PR #17 — SunCalc.js CDN (~3 kB), `_checkSunCalcTheme()` au GPS fix + toutes les 5 min, override session-only, `prefers-color-scheme` en fallback, scrollbar adaptée en dark |
| F-8 | ✅ | ~~**Détection auto départ = position GPS**~~ | ✅ |
| F-9a | ✅ | **Recommandation réseau pré-trajet** — après calcul d'itinéraire, suggérer 1-2 réseaux auprès desquels souscrire un abonnement mensuel sans engagement pour ce trajet. | ✅ Encart `#network-recommendation` sous `#route-info` ; algorithme `computeNetworkRecommendation()` : zone utile = `min(150 km, routeKm×40%)`, tronçons 80 km, score = tronçons couverts / total, Alliance virtuelle {Electra+IONITY+Fastned+Atlante} |
| F-9b | ✅ | **Réseau préféré en route** — l'utilisateur configure manuellement les réseaux pour lesquels il dispose d'un avantage tarifaire (persisté en localStorage) ; quand un itinéraire est actif, les stations de ces réseaux ont une bordure or. Pas un filtre exclusif. | ✅ Checkboxes par opérateur dans les Paramètres (⚙), `preferredNetworks` Set persisté (`irve-preferred-networks`), `applyPreferredStyling()` délègue à `updateVisibility()` ; bordure or (`#F59E0B`, `strokeWidth: 3`) injectée dans les propriétés GeoJSON |
| F-10 | ✅ | **Réseau Lidl (Lidl Plus)** — ajouter les bornes DC Lidl aux réseaux abordables, avec le logo Lidl sur la carte au lieu d'un rond. | ✅ commits `cdeb818` + `c19b459` — `FRLDL%` + CCS dans `cheap_network_sids` (les sites AC 22 kW seuls sont exclus) ; couche symbol `stations-brand-layer` pilotée par `OPERATORS[].brand` / `MAP_BRAND_ICONS` ; cache `stations-v3`. Tarif affiché : 0,29 €/kWh DC via Lidl Plus (oct. 2026) |
| F-11 | 💡 | **Logos sur la carte pour les autres réseaux abordables** — Tesla, IECharge, McDonald's, B&B restent de simples ronds sur la carte ; il suffit d'ajouter `brand` + une entrée `MAP_BRAND_ICONS`. | Vérifier la lisibilité quand plusieurs logos se chevauchent |
| F-12 | 🔍 | **Bornes AC 22 kW Lidl (0,18 €/kWh)** — le tarif AC est le plus bas, mais 22 kW n'a d'intérêt que pendant les courses. Les afficher ? | Exclues pour l'instant : ~200 sites lents, sans filtre de puissance côté abordables |

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
| U-12 | ✅ | ~~**Refonte de l'interface depuis zéro**~~ — trois tâches (préparer un trajet, conduire, trouver une borne maintenant) en moins d'étapes ; carte et panneau en zones fixes, plus rien de flottant sur la carte (légende, menu réglages, encadré recommandation, popups supprimés ou déplacés dans le panneau) | ✅ branche `redesign/ux-from-scratch`, commits `8e18970` `3fe1778` `589a19a` — `ui.js` (interface) séparé du moteur `app.js` ; un champ « Où allez-vous ? », une sélection = trajet calculé ; une liste d'arrêts par km avec zones blanches en ligne et réseau écrit en texte ; écran conduite à une carte (« Naviguer » 72 px, commandes ≥ 64 px) ; « Bornes proches » en un tap depuis tous les états ; réglages dans le panneau ; axe-core 0 violation (24 états) ; specs `plan-flow`, `drive-flow`, `nearby-flow`, `layout` ; abandons et limites listés dans les notes de revue |

---

## Bugs

| # | Statut | Bug | Root cause | Fix |
|---|:------:|-----|-----------|-----|
| B-1 | ✅ | ~~**Bouton Calculer silencieux au premier chargement**~~ | ✅ commit `056a83c` |
| B-2 | ✅ | ~~**Titre du panneau figé à "≥ 150 kW" après changement de filtre puissance**~~ | `subEl.textContent` utilisait `150` en dur | ✅ |
| B-3 | ✅ | ~~**Recommandation réseau non recalculée après changement de filtre ou de corridor**~~ | Handlers power/corridor/cheap appelaient `updateVisibility()` sans `showNetworkRecommendation()` | ✅ |
| B-4 | ✅ | ~~**Markers standards absents intermittents au premier calcul**~~ | Appels concurrents à `calculateRoute()` possibles via Enter ou `_autoCalcOnReady` | `_calcInProgress` guard + `try/finally` |
| B-5 | ✅ | ~~**Données IRVE jamais chargées — `ReferenceError: maplibregl is not defined`**~~ | `index.html` chargeait `maplibre-gl@latest` ; la v6 est ESM-only (`dist/maplibre-gl.js` n'existe plus → 404 bloqué par ORB), l'app plantait avant le fetch du Parquet | Version épinglée `maplibre-gl@5.24.0` (CSS + JS) + `tests/maplibre-load.spec.js` |
| B-6 | ✅ | ~~**Fond de carte vide — tuiles CARTO « API KEY REQUIRED »**~~ | `basemaps.cartocdn.com` sert désormais une tuile filigranée sans clé API | OpenFreeMap vectoriel (styles Positron + Dark, sans clé) ; couches sombres préfixées `dark:` ajoutées masquées, le thème bascule la visibilité ; repli sur le clair si le style sombre est injoignable. `tests/basemap.spec.js` |
| B-7 | ✅ | ~~**Kilométrages faux le long de l'itinéraire**~~ — liste des résultats, « Suivante +N km », zones blanches, recommandation réseau (Rennes→Lyon : IONITY Longvilliers affiché au km 198 au lieu de 166) | `nearestDistAndProgress()` calculait la progression par **indice de segment** (`(i + t) / nbSegments`) alors que les segments de la polyligne OSRM (11 902 points) ont des longueurs très inégales | Progression = distance cumulée au point projeté / longueur totale (`cumulativeKm()` dans `filter-worker.js`), projection dans un repère métrique local au lieu des degrés bruts. `tests/route-progress.spec.js` — ✅ commit `31fef6b` |
| B-8 | ✅ | ~~**Mode conduite : stations déjà dépassées listées, distances à vol d'oiseau**~~ — à Bourges (~km 390 de Rennes→Lyon), le panneau affichait des stations de Rennes à 320 km derrière | `refreshDrivePanel()` triait par progression depuis le **départ** sans tenir compte de la position GPS, et affichait `_geoHaversineM()` (ligne droite) | Position GPS projetée sur l'itinéraire (`_routeProgressAt()`, copie de la géométrie gardée côté main thread) ; seules les stations devant sont listées, la plus proche d'abord ; distance = km station − km utilisateur le long du trajet, mise à jour sur place à chaque fix GPS. `tests/route-progress.spec.js` — ✅ commit `31fef6b` |

---

## Technique / Dette

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| T-1 | 💡 | **Séparation `app.js` en modules ES** — le fichier fait ~2 400 lignes ; découper en `map.js`, `route.js`, `markers.js`, `worker-bridge.js` | Nécessite un bundler ou `<script type="module">` + import maps |
| T-2 | 💡 | **Tests automatisés (couverture fonctionnelle)** — tests Playwright partiels en place (`tests/geoloc.spec.js`, `tests/qa-fixes.spec.js`, `tests/suncalc-dark-mode.spec.js`) ; manque : route Paris→Lyon, non-régression comptage stations, drive/emergency mode | Socle existant à compléter |
| T-3 | ✅ | ~~**Mise à jour automatique Parquet**~~ | ✅ |
| T-4 | ✅ | ~~**Migration MapLibre GL JS**~~ — remplacer Leaflet 1.9.4 par MapLibre GL JS (rendu WebGL) | ✅ PR #14 — source GeoJSON + layer `circle` WebGL pour les markers principaux, `maplibregl.Marker` DOM pour les réseaux abordables, `IControl` plain object pour le bouton géoloc, `map.jumpTo()` / `map.resize()` / `map.fitBounds()` |
| T-5 | 📋 | **Épingler DuckDB WASM** — `app.js` importe `@duckdb/duckdb-wasm@latest` | Même risque que B-5 : une version majeure cassante casserait le chargement sans aucun changement de code |
| T-6 | 📋 | **Tests en échec : clic `#route-go` intercepté par l'autocomplétion** — `network-recommendation.spec.js` (« appears after route calculation ») et `photon-geocoder.spec.js` (« fallback uses Photon ») | Le mock Photon renvoie une suggestion qui laisse `.autocomplete-item` ouvert par-dessus le bouton ; fermer la liste (Escape) avant le clic |
| T-8 | ✅ | **Tarifs des réseaux dans un fichier de données** — mettre à jour les prix par PR sans refaire une recette complète de l'application | ✅ commit `6e5f0aa` — `tariffs.js` (`TARIFFS`, clé = `OPERATORS[].name`) fusionné dans `OPERATORS` au chargement ; `tests/tariffs.spec.js` sans navigateur + workflow `tariffs.yml` sur les PR ; `tests/tariffs-render.spec.js` couvre l'affichage et le cas fichier cassé. Sources/dates inconnues (`null`) pour 13 réseaux sur 14 : à renseigner au fil des mises à jour |
| T-9 | 💡 | **Prix B&B HOTELS / McDonald's** — les variantes `ENGIE Vianeo - B&B HOTELS` et `IZIVIA Fast - McDonald's` héritent du tarif du réseau parent ; leur prix réel est probablement différent | Ajouter des entrées `TARIFFS` dédiées, et que la fusion les applique aux variantes |
| T-7 | 💡 | **Projection GPS robuste en mode conduite** — `_routeProgressAt()` (B-8) prend le point le plus proche de toute la polyligne : sur un itinéraire qui repasse près de lui-même (aller-retour, boucle), la position peut être projetée sur le mauvais passage ; aucune détection de sortie d'itinéraire | Chercher d'abord autour de la dernière progression connue (fenêtre glissante, progression monotone) ; au-delà de N km de l'itinéraire, signaler « hors itinéraire » plutôt que lister des stations |
