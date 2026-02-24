# Stations de recharge — Autoroutes

**https://thomasleveil.github.io/stations-de-recharge/**

## Problématique

Pour planifier un voyage en voiture électrique, il est utile de connaître à l'avance les réseaux d'opérateurs de stations de recharge afin de décider auprès desquels prendre un abonnement pour bénéficier de tarifs réduits.

## Ce que fait l'application

Carte interactive des bornes de recharge rapide (≥ 150 kW, CCS Combo) sur les principales autoroutes françaises. Permet de :

- visualiser toutes les stations par opérateur (TotalEnergies, IONITY, Allego/Electra, Fastned, ENGIE Vianeo, IZIVIA Fast, Zunder, Tesla…)
- afficher aussi les stations de réseaux abordables (€) : B&B Hotels, IECharge, McDonald's/IZIVIA Fast, Tesla Supercharger
- calculer un itinéraire et n'afficher que les stations dans un corridor ajustable (200 m à 3 km) autour du trajet
- utiliser sa position GPS comme point de départ d'itinéraire

## Architecture

Application 100 % statique — aucun backend, aucune étape de build.

| Fichier | Rôle |
|---|---|
| `index.html` | Shell HTML |
| `app.js` | Carte Leaflet, fetch IRVE, filtrage DuckDB WASM, cache IndexedDB, itinéraire |
| `filter-worker.js` | Web Worker pour le filtrage de corridor (off-thread) |
| `style.css` | Styles |

## Données

Source : **Base nationale des IRVE** publiée sur [data.gouv.fr](https://www.data.gouv.fr/datasets/base-nationale-des-irve-infrastructures-de-recharge-pour-vehicules-electriques), mise à jour quotidienne (~6 MB, 188 000 lignes, une par connecteur).

Schémas de référence :
- [Schéma IRVE statique](https://schema.data.gouv.fr/etalab/schema-irve-statique/latest/documentation.html)
- [Schéma IRVE dynamique](https://schema.data.gouv.fr/etalab/schema-irve-dynamique/)

L'application télécharge le fichier Parquet directement depuis data.gouv.fr au premier chargement, exécute le filtrage en SQL via **DuckDB WASM** dans le navigateur, puis met le résultat en cache dans **IndexedDB** pour 24 heures.

```
Premier chargement  →  fetch data.gouv.fr (~6 MB)  →  DuckDB WASM filter  →  IndexedDB
Chargements suivants  →  IndexedDB (instantané, sans réseau)
```

### Critères de filtrage — stations rapides

- `implantation_station` = "Station dédiée à la recharge rapide" ou "Parking privé à usage public"
- Puissance maximale ≥ 150 kW (au moins un connecteur CCS Combo)
- Accès 24h/24 7j/7
- Au moins 4 points de charge par station
- Exclusion des stations Tesla et camions/poids lourds

### Critères de filtrage — stations abordables (€)

Stations de réseaux à tarifs réduits avec abonnement, affichées dans un corridor de ±10 km autour de l'itinéraire :

- **ENGIE Vianeo — B&B Hotels** (préfixe `FRVIA*`, nom contenant "B&B HOTEL")
- **IECharge** (préfixe `FRIEN*`)
- **IZIVIA Fast / McDonald's** (préfixe `FRIZF*`)
- **Tesla Supercharger** (préfixe `FRTSL*`, ouvert à tous les VE)

Si une station appartient aux deux catégories, elle est classée "rapide" (priorité à la catégorie fast).

## Disponibilité temps réel (optionnel)

L'application peut afficher le nombre de prises CCS disponibles en temps réel au clic sur une station. Cette fonctionnalité utilise l'**API TomTom EV Charging Stations Availability** (gratuite, 2 500 requêtes/jour).

### Créer une clé TomTom gratuite

1. Créer un compte sur [developer.tomtom.com](https://developer.tomtom.com) (aucune carte bancaire requise)
2. Dans le tableau de bord, aller dans **Keys** → **Create a new key**
3. Donner un nom à la clé, puis activer les deux produits suivants :
   - **Search API** — nécessaire pour rechercher une station par coordonnées GPS
   - **EV Charging Stations Availability** — nécessaire pour récupérer l'état des connecteurs
4. Sauvegarder

> Sans ces deux produits cochés, les requêtes retournent une erreur 403 "Not authorized".

### Saisir la clé dans l'application

Cliquer sur l'icône ⚙ en haut à droite de la carte, puis coller la clé dans le champ **Clé API TomTom**. La clé est enregistrée localement dans `localStorage` et n'est jamais envoyée à un serveur tiers.

## Lancement en local

```bash
python3 -m http.server 8765
# ouvrir http://localhost:8765
```
