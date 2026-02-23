# Disponibilité temps réel des bornes — Recherche et plan d'implémentation

> Branche : `feature/realtime-availability`
> Date : 2026-02-24
> Objectif : Afficher au click sur une station le nombre de prises CCS2 libres et opérationnelles.

---

## Verdict global

**Il n'existe pas d'API gratuite, sans clé, temps réel pour les bornes autoroutières françaises.**

La donnée existe (Girève l'agrège), mais elle est vendue sous forme de service B2B. Les agrégateurs grand public (Chargemap, PlugShare) ont les données mais les gardent dans leur app. La bonne nouvelle : TomTom expose une API avec une offre gratuite exploitable.

---

## Sources de données — État des lieux

### ❌ Sources fermées / B2B only

| Source | Réalité |
|--------|---------|
| **Girève** | Hub national français. Agrège tous les CPOs français via OCPI/eMIP. **Accès commercial uniquement** — aucun tier gratuit. Prix non publics (contact commercial requis). |
| **Eco-Movement** | Source upstream derrière TomTom, Chargetrip, IONITY. 300+ CPOs connectés, données en millisecondes. **Enterprise seulement**, AWS Marketplace. |
| **Chargemap** | API opérateurs-entrant uniquement (pas de lecture publique). Données temps réel réservées aux abonnés Premium (4,99€/mois utilisateurs). Pas d'API publique pour devs. |
| **PlugShare** | API commerciale, pas de free tier. Embed carte générique gratuit, mais pas de page station individuelle. |
| **OCPI direct CPOs** | Ionity : requête data manuelle via Eco-Movement. TotalEnergies : portail dev interne, login requis. Fastned : API ouverte UK seulement. Freshmile/Engie : OCPI login requis. |

### ✅ Sources accessibles gratuitement

#### 1. TomTom EV Charging Stations Availability API ⭐ MEILLEURE OPTION

- **URL** : `https://api.tomtom.com/search/2/chargingAvailability.json?key={KEY}&chargingAvailability={id}`
- **Clé** : Oui, gratuite (inscription sans CB sur developer.tomtom.com)
- **Free tier** : **2 500 requêtes/jour** — largement suffisant (requête à la demande au click)
- **Fraîcheur** : Mise à jour toutes les **3 minutes** via feed Eco-Movement
- **Couverture France** : Oui, via Eco-Movement (300+ CPOs dont réseaux autoroutiers)
- **Données retournées** : Par type de connecteur et niveau de puissance → counts de : disponible, occupé, réservé, hors-service, inconnu
- **Validation communauté** : Utilisé par des développeurs Home Assistant, confirmé fonctionnel
- **Limitation** : 1 station ID par appel (pas de batch) — acceptable pour usage au click

**Problème ID** : TomTom utilise ses propres IDs (issus d'Eco-Movement), pas le `id_station_itinerance` de l'IRVE. Solution : faire d'abord une recherche de POI TomTom par coordonnées GPS pour récupérer le TomTom ID, puis requêter la disponibilité. 2 appels par click.

```
// Étape 1 : Trouver le TomTom ID par coordonnées
GET https://api.tomtom.com/search/2/nearbySearch/.json
  ?key={KEY}&lat={lat}&lon={lon}&radius=100&categorySet=7309

// Étape 2 : Requêter la disponibilité
GET https://api.tomtom.com/search/2/chargingAvailability.json
  ?key={KEY}&chargingAvailability={tomtomId}
```

#### 2. HERE EV Charge Points API v3

- **Clé** : Oui, gratuite (inscription developer.here.com)
- **Free tier** : Existe, limites exactes non confirmées
- **Couverture** : Globale dont France
- **Avantage** : Queries par zone (proximité) — peut matcher directement par coordonnées
- **Endpoint** : `https://ev-v2.cc.api.here.com/ev/stations.json?prox={lon},{lat},{radius}&apiKey={key}`
- **Statut** : Inclus dans la réponse de recherche, pas d'appel séparé

#### 3. Chargetrip API (GraphQL)

- **Clé** : Oui, gratuite (playground disponible)
- **Free tier** : Existe mais le statut temps réel semble réservé au tier payant
- **Données** : Eco-Movement derrière, bonne couverture française
- **Verdict** : À tester, le tier gratuit pourrait suffire pour le statut

#### 4. Belib' Open Data Paris (cas particulier)

- **URL** : `https://opendata.paris.fr/explore/dataset/belib-points-de-recharge-pour-vehicules-electriques-disponibilite-temps-reel/api/`
- **Clé** : Non requise (OpenDataSoft public)
- **Couverture** : **Paris uniquement** (~2 000 points, 0 couverture autoroutes)
- **Verdict** : Hors périmètre du projet

#### 5. AFIR Article 20 — Futur feed gratuit (avril 2026)

Depuis le 14 avril 2025, tous les CPOs publics doivent transmettre statut statique + dynamique au Point d'Accès National (PAN = transport.data.gouv.fr), mis à jour à la minute. Format DATEX-II obligatoire au **14 avril 2026**.

**Actuellement** : transport.data.gouv.fr n'expose que les données statiques IRVE. Le feed temps réel n'est pas encore publiquement accessible.

**Horizon avril 2026** : Il devrait y avoir un flux DATEX-II public et gratuit avec la disponibilité de toutes les bornes françaises — ce serait la solution idéale sans clé API. L'Allemagne a déjà publié son profil DATEX-II en août 2025.

---

## Fallback iframe — État des lieux

### Options évaluées

| Option | Embeddable ? | Disponibilité temps réel ? | Couverture FR autoroutes |
|--------|-------------|---------------------------|--------------------------|
| **Open Charge Map embed** | ✅ Oui (iframe gratuit) | ❌ Non (user-reported) | Partielle |
| **PlugShare map embed** | ✅ Oui (map générique) | Via app (pas embed) | Limitée (US-focused) |
| **Chargemap station page** | ❌ Probablement X-Frame-Options | ✅ Oui (dans l'app) | ✅ Bonne |
| **ChargeHub embed** | ✅ Oui (embed generator) | Inconnu | ❌ US-focused |
| **Bison Futé** | ❌ Carte globale seulement | ✅ Oui (≥50kW autoroutes) | ✅ Oui |

### Fallback recommandé : Lien externe vers Chargemap/Bison Futé

Aucun site ne propose un iframe par station avec disponibilité temps réel pour les autoroutes françaises. Les meilleures options de fallback sont des **liens vers des pages externes** (pas des iframes) :

1. **Chargemap** : `https://chargemap.com/en-us/{slug}-{id}.html` — affiche la disponibilité, mais l'ID Chargemap n'est pas dans l'IRVE (nécessite une table de correspondance)
2. **Bison Futé** : `https://www.bison-fute.gouv.fr/recharge-electrique.html` — carte gouvernementale des bornes ≥50kW sur autoroutes, temps réel, mais pas de page par station
3. **ABRP** (A Better Route Planner) : affiche la disponibilité sur leur carte, pas de deep-link par station documenté

---

## Architecture recommandée

### Stratégie principale : TomTom (lazy, au click)

```
[User clicks station marker]
    ↓
[Popup s'ouvre avec spinner]
    ↓
[Fetch TomTom nearbySearch par lat/lon → obtenir tomtomId]
    ↓ (cache le tomtomId dans la propriété du marker pour les clicks suivants)
[Fetch chargingAvailability avec tomtomId]
    ↓
[Afficher: X disponible / Y total CCS2 (≥150kW)]
    ↓ si pas de données TomTom
[Afficher lien "Voir sur Chargemap ↗" ou "Voir sur Bison Futé ↗"]
```

### Gestion du cache

- Cacher le `tomtomId` dans `marker._tomtomId` après le premier lookup (évite l'étape 1 aux clicks suivants)
- Cacher le résultat de disponibilité 3 minutes (TTL = fraîcheur TomTom) dans `marker._availCache = { ts, data }`
- Pas de pré-fetch — uniquement à la demande (économise le quota gratuit)

### Matching CCS2

Le projet filtre déjà les stations avec CCS Combo. La réponse TomTom contient les connecteurs par type et puissance. Filtrer sur :
- `connectorType` contenant `IEC_62196_T2_COMBO` (CCS2)
- `ratedPowerKW >= 150`
- Compter les connecteurs `available`

### Clé API TomTom

Deux approches possibles :
1. **Clé dans le JS** (acceptable pour un projet personnel/public) — obfusquée, avec restriction de domaine dans la console TomTom
2. **Pas de clé (fallback only)** — si on veut rester sans aucune clé, ne proposer que des liens externes

---

## Plan d'implémentation (phases)

### Phase 1 : TomTom sans clé — liens externes seuls (zéro dépendance)

Afficher dans le popup un lien "Voir la disponibilité" vers :
- Bison Futé (si la station est sur autoroute — ce qui est le cas pour tout ce projet)
- Ou construire un lien Chargemap par coordonnées (`chargemap.com/en-us/map#zoom=17&lat={lat}&lng={lon}`)

**Avantage** : 0 API, 0 clé, fonctionne maintenant
**Inconvénient** : Pas de données dans l'app, redirect vers site externe

### Phase 2 : TomTom avec clé gratuite (recommandé)

- Inscription sur developer.tomtom.com (gratuit)
- Implémenter la logique lazy fetch au click
- Afficher compteurs disponibles/total par type (CCS2 ≥150kW)
- Fallback gracieux si TomTom ne trouve pas la station

### Phase 3 : DATEX-II officiel (avril 2026+)

- Quand transport.data.gouv.fr exposera le feed temps réel DATEX-II
- Remplacer TomTom par la source officielle gratuite et sans clé

---

## Questions ouvertes

1. **Correspondance ID IRVE ↔ TomTom** : La recherche par proximité (100m radius) devrait fonctionner, mais des tests sont nécessaires pour valider que TomTom a bien les bornes autoroutières du jeu de données.

2. **Clé TomTom dans le frontend** : Acceptable pour un projet open source personnel ? Ou préférable de mettre un fallback "lien externe" sans clé ?

3. **CORS** : L'API TomTom supporte-t-elle les appels cross-origin depuis un navigateur ? (normalement oui pour leurs APIs publiques)

4. **Granularité CCS2** : TomTom retourne-t-il la disponibilité par connecteur individuel ou par station globale ? À vérifier dans la réponse réelle.

---

## Ressources

- [TomTom EV Availability API docs](https://developer.tomtom.com/ev-charging-stations-availability-api/documentation/ev-charging-stations-availability-api/ev-charging-stations-availability)
- [TomTom nearbySearch API](https://developer.tomtom.com/search-api/documentation/search-service/nearby-search)
- [Girève DaaS](https://www.gireve.com/data-services-daas/)
- [AFIR Article 20 — Spirii](https://www.spirii.com/en/resources/blog/afir-article-20-what-cpos-need-to-know-about-it)
- [Bison Futé recharge électrique](https://www.bison-fute.gouv.fr/recharge-electrique.html)
- [Home Assistant — TomTom EV watcher](https://community.home-assistant.io/t/watch-for-a-free-spot-at-your-prefered-ev-charging-station/898792)
- [Eco-Movement — comment fonctionne le statut temps réel](https://www.eco-movement.com/how-eco-movement-delivers-real-time-charging-status-information/)
- [Automobile-Propre forum — discussion API bornes](https://forums.automobile-propre.com/topic/api-pour-avoir-la-liste-des-bornes-leur-disponibilit%C3%A9-49397/)
