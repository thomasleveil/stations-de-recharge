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
| P-3 | 💡 | **Clustering des markers en mode sans itinéraire** — quand aucun itinéraire n'est calculé, regrouper les 5 500+ markers en clusters pour alléger la page ; revenir aux markers individuels dès qu'une route est active | ★★★ | M | `markerClusterGroup` incompatible avec canvas renderer → nécessite de basculer sur SVG ou réécrire le clustering. Alternative : désactiver les markers individuels et afficher uniquement des compteurs par département en mode global |
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
| F-7 | 💡 | **Mode sombre** — thème sombre pour la carte et le panel | Leaflet : tiles CartoDB Dark + CSS variables |
| F-8 | ✅ | ~~**Détection auto départ = position GPS**~~ | ✅ |
| F-9a | ✅ | **Recommandation réseau pré-trajet** — après calcul d'itinéraire, suggérer 1-2 réseaux auprès desquels souscrire un abonnement mensuel sans engagement pour ce trajet. | ✅ Encart `#network-recommendation` sous `#route-info` ; algorithme `computeNetworkRecommendation()` : zone utile = `min(150 km, routeKm×40%)`, tronçons 80 km, score = tronçons couverts / total, Alliance virtuelle {Electra+IONITY+Fastned+Atlante} |
| F-9b | ✅ | **Réseau préféré en route** — l'utilisateur configure manuellement les réseaux pour lesquels il dispose d'un avantage tarifaire (persisté en localStorage) ; quand un itinéraire est actif, les stations de ces réseaux ont une bordure or. Pas un filtre exclusif. | ✅ Checkboxes par opérateur dans les Paramètres (⚙), `preferredNetworks` Set persisté (`irve-preferred-networks`), `applyPreferredStyling()` applique bordure or (`#F59E0B`, weight 3) dans `updateVisibility()` |

---

## Qualité des données

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| D-1 | 💡 | **Signaler une erreur** — lien dans la popup pour signaler une station fermée / mal géolocalisée sur data.gouv.fr | Lien direct vers la fiche IRVE |
| D-2 | ✅ | ~~**Indicateur fraîcheur des données**~~ | ✅ |

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
| U-7 | ✅ | ~~**Mode conduite**~~ | ✅ — panel `#drive-panel` plein-écran bas ; bouton ⬆ affiché après calcul d'itinéraire si GPS actif ; `enterDriveMode()` / `exitDriveMode()` / `refreshDrivePanel()` ; 4 prochaines stations avec distance, réseau, puissance, bordure or si réseau préféré (F-9b) |
| U-8 | ✅ | ~~**Focus initial sur le champ "Arrivée"** — au chargement de la page, le focus clavier doit être positionné dans le champ Arrivée pour permettre une saisie immédiate~~ | ✅ commit `e7b7fce` |
| U-9 | ✅ | ~~**Double affichage de la taille de corridor** — après calcul d'itinéraire, l'indication du corridor apparaît deux fois dans le bloc formulaire~~ | ✅ commit `e7b7fce` — `route-info` n'affiche plus que la distance (ex. `460 km`), le corridor reste uniquement dans `#corridor-label` |
| U-10 | ✅ | ~~**Taille du corridor CHEAP paramétrable**~~ | ✅ |

---

## Bugs

| # | Statut | Bug | Root cause | Fix |
|---|:------:|-----|-----------|-----|
| B-1 | ✅ | ~~**Bouton Calculer silencieux au premier chargement**~~ | ✅ commit `056a83c` |

---

## Technique / Dette

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| T-1 | 💡 | **Séparation `app.js` en modules ES** — le fichier fait ~1 200 lignes ; découper en `map.js`, `route.js`, `markers.js`, `worker-bridge.js` | Nécessite un bundler ou `<script type="module">` + import maps |
| T-2 | 💡 | **Tests automatisés** — Playwright end-to-end : chargement, route Paris→Lyon, non-régression 47 CCS + 66 budget | `/tmp/perf-measure.ts` est une bonne base |
| T-3 | ✅ | ~~**Mise à jour automatique Parquet**~~ | ✅ |
