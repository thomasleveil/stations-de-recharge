// ── Network tariffs ────────────────────────────────────────────────────────
//
// Price data shown in the station sheet, kept apart from the code so a tariff
// update is a data-only PR. app.js merges each entry into the OPERATORS entry
// with the same `name`; if this file fails to load, the app still works and
// only the prices disappear.
//
// One entry per network, keyed by the exact `name` of its OPERATORS entry:
//   tier     1 (€, cheap) · 2 (€€) · 3 (€€€, expensive without subscription)
//   range    displayed price, e.g. '0.39–0.59 €/kWh'
//   note     optional subscription / condition hint, '' when none
//   alerts   optional [{ icon, text }] warnings shown under the price
//   source   page the price was read from (http/https URL)
//   updated  date the price was last checked, 'YYYY-MM-DD'
//            source/updated are null for prices carried over from before this
//            file existed (provenance unknown): fill both when you touch one.
//
// Before opening a PR: npx playwright test tests/tariffs.spec.js
// (the same check runs in CI on every PR touching this file).

const TARIFFS = {
  'TotalEnergies': {
    tier: 2, range: '0.39–0.59 €/kWh', note: '',
    alerts: [{ icon: '⚠️', text: 'Frais de stationnement après 45 min' }],
    source: null, updated: null,
  },
  'IONITY': {
    tier: 3, range: '0.69–0.79 €/kWh', note: '0.39 avec Passport',
    alerts: [{ icon: '💸', text: 'Tarif élevé sans abonnement Passport' }],
    source: null, updated: null,
  },
  'Allego / Electra': {
    tier: 2, range: '0.29–0.49 €/kWh', note: '0.29 avec abo Electra+',
    source: null, updated: null,
  },
  'Fastned': {
    tier: 3, range: '0.59–0.69 €/kWh', note: '0.45 avec Gold',
    source: null, updated: null,
  },
  'ENGIE Vianeo': {
    tier: 2, range: '0.40–0.50 €/kWh', note: '',
    source: null, updated: null,
  },
  'Tesla': {
    tier: 3, range: '0.36–0.67 €/kWh', note: 'Prix dynamique',
    alerts: [{ icon: '📈', text: 'Prix dynamique variable' }],
    source: null, updated: null,
  },
  'Zunder': {
    tier: 1, range: '0.29–0.39 €/kWh', note: '',
    source: null, updated: null,
  },
  'e-Vadea': {
    tier: 2, range: '0.40–0.50 €/kWh', note: '',
    source: null, updated: null,
  },
  'Atlante': {
    tier: 2, range: '0.35–0.50 €/kWh', note: '',
    source: null, updated: null,
  },
  'Plenitude': {
    tier: 2, range: '0.39–0.49 €/kWh', note: '',
    source: null, updated: null,
  },
  'bp pulse': {
    tier: 2, range: '0.39–0.49 €/kWh', note: '',
    source: null, updated: null,
  },
  'IECharge': {
    tier: 2, range: '0.39–0.49 €/kWh', note: '',
    source: null, updated: null,
  },
  'IZIVIA Fast': {
    tier: 2, range: '0.40–0.50 €/kWh', note: '',
    source: null, updated: null,
  },
  // DC 0.29, AC 22 kW 0.18 since 2026-09-18
  'Lidl': {
    tier: 1, range: '0.29 €/kWh', note: 'via appli Lidl Plus, gratuite',
    alerts: [{ icon: '📱', text: 'Payer avec l\'appli Lidl Plus' }],
    source: 'https://www.hellowatt.fr/blog/lidl-borne-recharge-avril/',
    updated: '2026-10-23',
  },
};
