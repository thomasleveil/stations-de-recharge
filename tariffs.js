// ── Network tariffs ────────────────────────────────────────────────────────
//
// Price data shown in the station sheet, kept apart from the code so a tariff
// update is a data-only PR. app.js merges each entry into the OPERATORS entry
// with the same `name`; if this file fails to load, the app still works and
// only the prices disappear.
//
// One entry per network, keyed by the exact `name` of its OPERATORS entry:
//   tier     1 (€) · 2 (€€) · 3 (€€€), from the typical no-subscription DC
//            price: below 0.40 → 1, below 0.58 → 2, otherwise 3
//   range    no-subscription DC fast-charging price, e.g. '0.39–0.59 €/kWh';
//            when a free app gives a better price (Lidl Plus), take the app price
//   note     optional subscription / condition hint, '' when none
//   alerts   optional [{ icon, text }] warnings shown under the price
//   source   where the price was read: an http(s) URL, or 'appli <Network>'
//            when it was read in the network's own app
//   updated  date the price was last checked, 'YYYY-MM-DD'
//            source/updated are null for prices carried over from before this
//            file existed (provenance unknown): fill both when you touch one.
//
// Before opening a PR: npx playwright test tests/tariffs.spec.js
// (the same check runs in CI on every PR touching this file).

const TARIFFS = {
  // Highway 175 kW, Sept 2026 comparison; the official page says 0.79 for « réseaux haute puissance »
  'TotalEnergies': {
    tier: 3, range: '0.69–0.79 €/kWh', note: '-15 % avec Charge+ Zen',
    alerts: [{ icon: '⚠️', text: 'Frais d\'occupation à la minute selon la station' }],
    source: 'https://www.jechange.fr/energie/electricite/news/autoroute-electrique-1-euro-100-km-face-gazole-contre-10-euros-maison',
    updated: '2026-10-23',
  },
  // 0.59 on highways (April 2026), 0.62 elsewhere since June 2026
  'IONITY': {
    tier: 3, range: '0.59–0.62 €/kWh', note: 'moins cher avec Passport Motion ou Power',
    alerts: [{ icon: '💸', text: 'Tarif élevé sans abonnement Passport' }],
    source: 'https://mac4ever.com/196844',
    updated: '2026-10-23',
  },
  'Electra': {
    tier: 2, range: '0.39–0.61 €/kWh', note: 'prix selon l\'affluence, -0.10 avec Electra+ (1.99 €/mois)',
    alerts: [{ icon: '⏱️', text: '0.40 €/min si la voiture reste branchée au-delà de 80 % sur une station saturée' }],
    source: 'https://www.go-electra.com/fr/electra-plus/',
    updated: '2026-10-23',
  },
  // Idle fee: https://www.allego.eu/fr/frais-de-depassement-de-sejour/
  'Allego': {
    tier: 3, range: '0.59 €/kWh', note: '0.39 avec Allego Plus (9.99 €/mois)',
    alerts: [{ icon: '⏱️', text: '0.25 €/min après 45 min branché sans charger' }],
    source: 'https://www.allego.eu/fr/tarifs/',
    updated: '2026-10-23',
  },
  'Fastned': {
    tier: 3, range: '0.61 €/kWh', note: '0.43 avec Gold Member (5.99 €/mois)',
    source: 'https://www.fastnedcharging.com/fr/recharge/tarifs',
    updated: '2026-10-23',
  },
  'ENGIE Vianeo': {
    tier: 2, range: '0.45–0.54 €/kWh', note: '0.33 avec Vianeo Max (9.99 €/mois)',
    alerts: [{ icon: '📱', text: 'Prix propre à chaque station, affiché dans l\'appli' }],
    source: 'https://lautomobiliste.fr/10/07/2026/pour-033-e-kwh-partout-en-france-engie-vianeo-casse-les-prix-de-la-recharge/',
    updated: '2026-10-23',
  },
  // Non-Tesla vehicles, daytime; off-peak nights around 0.26–0.34
  'Tesla': {
    tier: 2, range: '0.40–0.70 €/kWh', note: 'vers 0.30 la nuit ; moins cher avec l\'abonnement Supercharge',
    alerts: [{ icon: '📈', text: 'Prix dynamique selon l\'heure et la station' }],
    source: 'https://www.tesla-mag.com/?p=47457',
    updated: '2026-10-23',
  },
  // App price; zunder.com still says 0.59 (page modified 2026-07-24)
  'Zunder': {
    tier: 2, range: '0.53 €/kWh', note: '0.39 avec Pro (9.99 €/mois)',
    source: 'appli Zunder',
    updated: '2026-10-23',
  },
  // Official tariff page is JS-rendered; third-party figure
  'e-Vadea': {
    tier: 3, range: '0.62 €/kWh', note: '',
    source: 'https://www.lachaineev.fr/tarif-37-e-vadea.php',
    updated: '2026-10-23',
  },
  'Atlante': {
    tier: 2, range: '0.54 €/kWh', note: '0.29 avec Atlante Go',
    source: 'https://rouleur-electrique.fr/recharge-rapide-en-2026-quel-abonnement-vous-fera-vraiment-economiser/',
    updated: '2026-10-23',
  },
  'Plenitude': {
    tier: 2, range: '0.55 €/kWh', note: '0.69 au-delà de 60 min de charge',
    source: 'https://www.eniplenitude.fr/mobilite-electrique/tarifs',
    updated: '2026-10-23',
  },
  // No readable source in Oct 2026 (official pages 403, third parties disagree: 0.43 / 0.65)
  'bp pulse': {
    tier: 2, range: '0.39–0.49 €/kWh', note: '',
    source: null, updated: null,
  },
  'IECharge': {
    tier: 1, range: '0.25 €/kWh', note: 'sans abonnement',
    source: 'https://iecharge.io/pricing/',
    updated: '2026-10-23',
  },
  // No readable source in Oct 2026 (only a Jan 2025 user report: 0.30–0.35)
  'IZIVIA Fast': {
    tier: 2, range: '0.40–0.50 €/kWh', note: '',
    source: null, updated: null,
  },
  // Lidl Plus price (free app): 0.29 is a limited-time offer with no published
  // end date, the regular Lidl Plus price being 0.39
  'Lidl': {
    tier: 1, range: '0.29 €/kWh', note: 'via appli Lidl Plus, offre à durée limitée',
    alerts: [{ icon: '📱', text: 'Payer avec l\'appli Lidl Plus' }],
    source: 'https://selectra.info/energie/actualites/marche/lidl-leclerc-recharge-conditions-empreinte-22-kw',
    updated: '2026-10-23',
  },
};
