# Bornes de recharge rapides — France

[![Deployed on GitHub Pages](https://img.shields.io/github/deployments/thomasleveil/stations-de-recharge/github-pages?label=deploy&logo=github)](https://thomasleveil.github.io/stations-de-recharge/)
[![Data: IRVE data.gouv.fr](https://img.shields.io/badge/data-IRVE%20data.gouv.fr-blue)](https://www.data.gouv.fr/datasets/base-nationale-des-irve-infrastructures-de-recharge-pour-vehicules-electriques)

Carte interactive des bornes de recharge rapide (≥ 150 kW, CCS Combo) en France métropolitaine et en Corse.
Filtrage par itinéraire, recommandations d'abonnements réseau, mode conduite avec GPS, disponibilité temps réel.

**[Ouvrir l'application](https://thomasleveil.github.io/stations-de-recharge/)**

---

## Fonctionnalités

### 🗺️ Calcul d'itinéraire et filtrage

Saisissez un départ et une arrivée : l'application calcule le trajet (OSRM) et n'affiche que les stations situées dans un corridor ajustable autour de la route. Chaque station est colorée selon son opérateur.

### 📈 Recommandation d'abonnements

Après le calcul d'itinéraire, l'application identifie les réseaux les plus présents sur votre route et suggère les abonnements mensuels sans engagement les plus pertinents.

### 🚗 Mode conduite

Bouton disponible après calcul d'itinéraire (GPS requis). Affiche dans un panneau à gauche les prochaines stations sur votre trajet, triées par proximité :

- Distance restante
- Opérateur et puissance maximale
- Nombre de prises disponibles en temps réel (si clé TomTom configurée)
- Lien de navigation directe

### ⚡ Mode urgence

Le bouton ⚡ recentre la carte sur votre position GPS et liste toutes les bornes rapides dans un rayon immédiat, indépendamment de tout itinéraire.

### 💰 Stations à tarif réduit

Les stations des réseaux à tarif réduit (B&B Hotels / ENGIE Vianeo, McDonald's / IZIVIA Fast, IECharge, Tesla Supercharger) sont mises en évidence. Vous pouvez aussi marquer vos réseaux préférés dans les paramètres pour les mettre en avant avec une bordure dorée.

### 🌐 Disponibilité temps réel (optionnel)

Affiche le nombre de prises CCS disponibles via l'API TomTom. Gratuit (2 500 req/jour), clé configurable dans les paramètres.

---

## Données

Les stations proviennent de la **Base nationale des IRVE** publiée sur [data.gouv.fr](https://www.data.gouv.fr/datasets/base-nationale-des-irve-infrastructures-de-recharge-pour-vehicules-electriques), mise à jour quotidiennement.

Les données sont téléchargées et filtrées directement dans votre navigateur via DuckDB WASM — aucun serveur intermédiaire. Un cache local (IndexedDB, 24h) évite les téléchargements répétés.

**Critères de filtrage :** implantation en parking dédié ou privé, puissance ≥ 150 kW, au moins 4 points de charge, CCS Combo, hors poids lourds.

---

## Configurer la disponibilité temps réel

Pour activer l'affichage des prises disponibles :

1. Créer un compte sur [developer.tomtom.com](https://developer.tomtom.com) (gratuit, sans carte bancaire)
2. **Keys** → **Create a new key**, activer :
   - Search API
   - EV Charging Stations Availability
3. Coller la clé dans les paramètres de l'application (⚙ en haut à droite)

La clé reste dans votre navigateur et n'est jamais transmise à un tiers.

---

## Architecture

Application statique, sans backend ni étape de build.

| Fichier | Rôle |
|---|---|
| `index.html` | Shell, charge les dépendances CDN |
| `app.js` | Carte, DuckDB WASM, IndexedDB, marqueurs, itinéraires |
| `style.css` | Interface, légende, popups, marqueurs |
| `filter-worker.js` | Web Worker pour le filtrage corridor hors thread principal |

**Stack :** MapLibre GL JS, DuckDB WASM, OSRM, Photon (géocodage), turf.js

---

## Développement local

```bash
python3 -m http.server 8765
```

Puis ouvrir [http://localhost:8765](http://localhost:8765).
Un serveur HTTP est requis (DuckDB WASM utilise des Web Workers, bloqués en `file://`).

---

*Documentation technique détaillée : [CLAUDE.md](CLAUDE.md)*
