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
| F-2 | 📋 | **Export GPX / liens de navigation** — bouton pour exporter les stations du trajet ou ouvrir dans Google Maps / Waze | Simple à implémenter pour le GPX |
| F-3 | 📋 | **Filtre par puissance minimale** — slider pour ne montrer que les ≥ 150 kW / ≥ 250 kW / ≥ 350 kW | Données déjà présentes (`max_power`) — sera dans le menu Paramètres (⚙) |
| F-4 | 💡 | **Affichage disponibilité temps réel** — indicateur de disponibilité des connecteurs (OCPI / opérateurs qui exposent l'API) | Complexité API variable selon opérateur |
| F-5 | 📋 | **Partage de trajet** — URL shareable avec départ + arrivée + corridor encodés en query params | Simple, hachage côté client |
| F-6 | ✅ | ~~**Historique des trajets récents**~~ | ✅ |
| F-7 | 💡 | **Mode sombre** — thème sombre pour la carte et le panel | Leaflet : tiles CartoDB Dark + CSS variables |
| F-8 | ✅ | ~~**Détection auto départ = position GPS**~~ | ✅ |
| F-9a | 🔍 | **Recommandation réseau pré-trajet** — après calcul d'itinéraire, suggérer 1-2 réseaux auprès desquels souscrire un abonnement mensuel sans engagement pour ce trajet. L'algorithme tourne sous le capot ; l'utilisateur ne voit que la recommandation finale. **Algorithme (interne) :** (1) définir la zone utile = route à partir de `min(150 km, trajet_total × 40%)` jusqu'à la destination (pas de zone morte finale — la dernière station avant l'arrivée est souvent utile pour le trajet retour) ; (2) découper la zone utile en tronçons de 80 km ; (3) pour chaque réseau, calculer le % de tronçons contenant ≥ 1 **station** (unité = station, pas borne/PDC) ; (4) appliquer le même calcul au réseau virtuel **"Alliance"** = {Electra + Ionity + Fastned + Atlante} traité comme un seul opérateur ; (5) classer tous les réseaux + l'Alliance par score décroissant, recommander le top 1-2. | Agrégation sur les stations déjà filtrées — pas de nouvelle requête réseau ; décision de conception à prendre sur l'affichage : encart dépliable dans le panel, ou intégré à U-2 (panneau résultats) ; les noms IRVE des membres de l'Alliance à confirmer dans le Parquet (`nom_enseigne`) |
| F-9b | 🔍 | **Réseau préféré en route** — l'utilisateur configure manuellement les réseaux pour lesquels il dispose d'un avantage tarifaire (persisté en localStorage) ; en mode conduite (U-7), les stations de ces réseaux sont visuellement distinguées parmi les prochaines options. Pas un filtre exclusif : les autres stations restent visibles. **Important :** pas de groupement automatique de l'Alliance — souscrire chez Ionity ne signifie pas systématiquement avoir l'avantage sur Electra/Fastned/Atlante (dépend du contrat), et même quand l'alliance s'applique, la réduction sur les réseaux partenaires est partielle, inférieure au tarif du réseau principal. L'utilisateur coche explicitement chaque réseau pour lequel il a un avantage réel. | Sous-feature de U-7, à concevoir conjointement |

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
| U-1 | 📋 | **Tooltip corridor sur le slider** — afficher la distance en km sous le curseur pendant le glissement | CSS/JS trivial |
| U-2 | 🔍 | **Panneau résultats dépliable** — liste scrollable des stations sur le trajet avec tri par distance de sortie | Utile sur mobile ; à concevoir conjointement avec F-9a (résumé réseau) et U-7 (mode conduite) |
| U-3 | ✅ | ~~**Icône favicon**~~ | ✅ commit `e7b7fce` |
| U-4 | ✅ | ~~**Meta Open Graph**~~ | ✅ |
| U-5 | ✅ | ~~**Bug autocomplete : Entrée ferme la liste**~~ | ✅ commit `923579f` |
| U-6 | ✅ | **Autocomplétion enrichie (noms d'entreprises, POI)** — remplacer ou compléter le geocoder actuel par un service capable de résoudre les noms d'entreprises (ex : "IKEA Lyon", "McDonald's A7"). Contrainte : sans API payante ni clé à configurer. Candidats : Nominatim, Photon (Komoot), OpenCage free tier. Photon semble le meilleur compromis : gratuit, sans clé, POI riches. | Remplace ou complète le geocoder actuel |
| U-7 | 🔍 | **Mode conduite** — vue optimisée pour un conducteur en déplacement sur l'autoroute : panel compact affichant les **3-4 prochaines stations dans un rayon cohérent avec l'autonomie restante** (pas toutes les stations du trajet). Pour chaque station : distance restante, indication "même voie" vs "sortie nécessaire", réseau + indicateur tarifaire si F-9b configuré. Affichage minimaliste adapté à la lecture rapide en roulant (grandes polices, contraste élevé). Mise à jour automatique à chaque position GPS. | Fonctionnalité phare ; nécessite F-8 (géoloc auto) + F-9b (réseau préféré) ; le nombre d'options affiché doit être limité à 3-4 max — noyer le conducteur d'informations est un anti-objectif absolu |
| U-8 | ✅ | ~~**Focus initial sur le champ "Arrivée"** — au chargement de la page, le focus clavier doit être positionné dans le champ Arrivée pour permettre une saisie immédiate~~ | ✅ commit `e7b7fce` |
| U-9 | ✅ | ~~**Double affichage de la taille de corridor** — après calcul d'itinéraire, l'indication du corridor apparaît deux fois dans le bloc formulaire~~ | ✅ commit `e7b7fce` — `route-info` n'affiche plus que la distance (ex. `460 km`), le corridor reste uniquement dans `#corridor-label` |
| U-10 | 📋 | **Taille du corridor CHEAP paramétrable** — exposer dans le menu Paramètres (⚙) la valeur du corridor CHEAP (actuellement codée en dur) | Lier à la même logique de corridor que le slider existant |

---

## Bugs

| # | Statut | Bug | Root cause | Fix |
|---|:------:|-----|-----------|-----|
| B-1 | ✅ | **Bouton Calculer silencieux au premier chargement** — si le champ Départ est vide et que le fallback GPS n'a pas encore de fix, `calculateRoute()` retourne silencieusement sans feedback | `watchPosition` est asynchrone : le premier fix GPS peut mettre plusieurs secondes ; si l'utilisateur clique avant, `geoState.available = false` et la fonction retourne sans message | (1) Distinguer l'état `pending` (GPS en cours) de `unavailable` ; (2) afficher un message d'attente et poller jusqu'à 8 s ; (3) placeholder Départ reflète l'état GPS ; (4) désactiver le bouton Calculer si champ Arrivée vide |

---

## Technique / Dette

| # | Statut | Idée | Notes |
|---|:------:|------|-------|
| T-1 | 💡 | **Séparation `app.js` en modules ES** — le fichier fait ~1 200 lignes ; découper en `map.js`, `route.js`, `markers.js`, `worker-bridge.js` | Nécessite un bundler ou `<script type="module">` + import maps |
| T-2 | 💡 | **Tests automatisés** — Playwright end-to-end : chargement, route Paris→Lyon, non-régression 47 CCS + 66 budget | `/tmp/perf-measure.ts` est une bonne base |
| T-3 | ✅ | ~~**Mise à jour automatique Parquet**~~ | ✅ |
