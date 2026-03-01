# Bornes de recharge rapides — France

**https://thomasleveil.github.io/stations-de-recharge/**

Carte interactive des bornes de recharge rapide (≥ 150 kW, CCS Combo) en France métropolitaine et en Corse, conçue pour répondre aux trois questions pratiques du conducteur de véhicule électrique.

---

## Quel opérateur choisir pour mon abonnement ?

Avant un long voyage, il est utile de savoir auprès de quels réseaux souscrire un abonnement mensuel sans engagement pour bénéficier de tarifs réduits.

L'application **calcule un itinéraire** et affiche uniquement les stations situées dans un corridor ajustable autour du trajet. Elle identifie automatiquement les **réseaux les plus présents sur votre route** et suggère les abonnements les plus pertinents.

Les stations des réseaux à tarif réduit (B&B Hotels / ENGIE Vianeo, McDonald's / IZIVIA Fast, IECharge, Tesla Supercharger) sont affichées dans une couleur distincte. Vous pouvez aussi **marquer vos réseaux préférés** (⚙ Paramètres) pour les mettre en avant sur la carte avec une bordure dorée.

---

## Prochaines stations sur mon itinéraire

En route, le **mode conduite** (bouton ⬆ après calcul d'itinéraire, GPS requis) affiche dans un panneau à gauche de l'écran les prochaines stations sur votre trajet, triées par proximité, avec pour chacune :

- la distance restante
- l'opérateur et la puissance maximale
- le nombre de prises disponibles en temps réel (si clé TomTom configurée)
- un lien de navigation directe

---

## Urgence autonomie : bornes à proximité immédiate

Le bouton **⚡** (visible quand le GPS est actif) bascule en mode urgence : la carte recentre sur votre position et liste toutes les bornes de recharge rapide dans un rayon de quelques kilomètres, quelle que soit la route calculée.

---

## Disponibilité en temps réel (optionnel)

L'application peut afficher le nombre de prises CCS disponibles en temps réel au clic sur une station, en mode conduite et en mode urgence. Cette fonctionnalité utilise l'**API TomTom EV Charging Stations Availability** (gratuite, 2 500 requêtes/jour).

### Configurer une clé TomTom gratuite

1. Créer un compte sur [developer.tomtom.com](https://developer.tomtom.com) (aucune carte bancaire requise)
2. Dans le tableau de bord : **Keys** → **Create a new key**
3. Activer les deux produits :
   - **Search API**
   - **EV Charging Stations Availability**
4. Coller la clé dans l'icône ⚙ en haut à droite de la carte

La clé est enregistrée localement dans votre navigateur et n'est jamais envoyée à un serveur tiers.

---

## Données

Les stations proviennent de la **Base nationale des IRVE** publiée sur [data.gouv.fr](https://www.data.gouv.fr/datasets/base-nationale-des-irve-infrastructures-de-recharge-pour-vehicules-electriques), mise à jour quotidiennement. L'application télécharge et filtre les données directement dans votre navigateur — aucun serveur intermédiaire.

---

*Pour la documentation technique, voir [CLAUDE.md](CLAUDE.md).*
