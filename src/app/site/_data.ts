// src/app/site/_data.ts
//
// Contenu factuel du site public. Une seule source : les chiffres viennent de
// VD Soft (période du 01/06 au 20/08/2026), pas d'une promesse marketing. Quand
// on les rafraîchit, c'est ici — et nulle part ailleurs dans les pages.
//
// Le jour où on veut des compteurs qui se recalculent tout seuls, c'est ce
// fichier qui devient une requête. Olivier 2026-08-21.

export const TEL         = '087 35 18 20'
export const TEL_HREF    = 'tel:+3287351820'
export const PERIODE     = 'du 1er juin au 20 août 2026'

/** Chiffres publiés. Chacun porte sa source : on n'annonce rien qu'on ne mesure. */
export const CHIFFRES = [
  { n: '≈ 3 000', label: 'interventions réalisées en 3 mois', src: '01/06 → 20/08/2026' },
  { n: '47',      label: 'demandes traitées par jour, en moyenne', src: 'sur 81 jours consécutifs' },
  { n: '208',     label: 'communes et localités desservies', src: 'adresses d’intervention distinctes' },
  { n: '70 %',    label: 'sur place en moins de 30 minutes après le départ', src: 'médiane 18 min · 1 681 mesures' },
  { n: '14',      label: 'dépanneuses et camions en service', src: 'du véhicule léger au poids lourd' },
]

export const TICKER = [
  '≈ 3 000 interventions cet été', '208 communes desservies', '14 camions',
  '24h/24, 7j/7', '18 minutes de médiane sur place', 'Fourrière police',
  'Spa-Francorchamps', '5 dépôts', TEL,
]

/** Communes réellement desservies, avec leur volume sur la période. */
export const COMMUNES: [string, number][] = [
  ['Verviers', 431], ['Spa', 260], ['Theux', 167], ['Pepinster', 137], ['Sprimont', 118],
  ['Stavelot', 95], ['Malmedy', 83], ['Jalhay', 81], ['Aywaille', 79], ['Dison', 76],
  ['Francorchamps', 71], ['Sougné-Remouchamps', 56], ['Beverce', 55], ['Sart-lez-Spa', 55],
  ['Polleur', 43], ['Waimes', 42], ['Lontzen', 36], ['Louveigné', 34], ['Herve', 33],
  ['Harzé', 32], ['Eupen', 25],
]
export const COMMUNES_AUTRES = 187

/** Dépôts ouverts au public. Tiège et Francorchamps restent des points d'appui. */
export const DEPOTS = [
  { tag: 'Siège & fourrière', nom: 'Pepinster', adresse: ['Rue Lefin 12', '4860 Pepinster'],
    note: 'Parc principal, accueil fourrière, bureaux.' },
  { tag: 'Dépôt', nom: 'Verviers', adresse: ['Rue de la Cité 22', '4800 Verviers'],
    note: 'Parc et point de départ pour le centre-ville.' },
  { tag: 'Dépôt', nom: 'Aywaille', adresse: ['4920 Aywaille'],
    note: 'Vallée de l’Amblève, E25 et Sougné-Remouchamps.' },
]

/** Liste arrêtée par Olivier le 21/08/2026 — c'est celle qu'on affiche, telle
 *  quelle. Elle alimente l'accueil ET le prompt de l'assistant. */
export const ASSISTEURS = [
  'Touring', 'VAB', 'Mondial Assistance', 'Ethias', 'AXA', 'Allianz',
  'AG Insurance', 'P&V Assistance', 'IMA Benelux', 'Eurocross', 'ANWB',
  'Vivium', 'Ardenne Prévoyante', 'Inter Partner Assistance',
]

/** Tarif officiel des frais de justice — ce n'est pas un tarif maison.
 *  Repris de la grille `source_tariff_lines` (source police_saisie, voiture,
 *  barème 2026). Une seule source pour la page Fourrière ET pour le prompt de
 *  l'assistant : deux montants différents sur le même sujet, c'est un litige.
 *
 *  Le gardiennage change de nature après la levée de saisie : tant que la
 *  saisie court il relève des frais de justice (1,56 €), au-delà le véhicule
 *  occupe une place chez nous à nos conditions (20 €). Olivier 2026-08-21. */
export const TARIF_FOURRIERE = [
  { poste: 'Prise en charge du véhicule (enlèvement), 15 km inclus',
    base: 'forfait, une fois', htva: '94,06 €', tvac: '113,81 €' },
  { poste: 'Kilomètre au-delà des 15 km inclus',
    base: 'par kilomètre',     htva: '1,57 €',  tvac: '1,90 €'   },
  { poste: 'Gardiennage pendant la saisie',
    base: 'par jour entamé',   htva: '1,56 €',  tvac: '1,89 €'   },
  { poste: 'Frais administratifs',
    base: 'forfait, une fois', htva: '37,67 €', tvac: '45,58 €'  },
  { poste: 'Gardiennage après la levée de saisie',
    base: 'par jour entamé',   htva: '20,00 €', tvac: '24,20 €'  },
]

/** Mal garée : ce n'est PAS une saisie, et ce n'est pas moins cher pour autant.
 *  Olivier 2026-08-21 — la page disait « frais plus limités », c'était faux. */
export const TARIF_MAL_GAREE = [
  { poste: 'Enlèvement d’une voiture',    base: 'forfait, une fois', htva: '165,29 €', tvac: '200,00 €' },
  { poste: 'Enlèvement d’une camionnette', base: 'forfait, une fois', htva: '206,61 €', tvac: '250,00 €' },
  { poste: 'Gardiennage',                  base: 'par jour entamé',   htva: '20,00 €',  tvac: '24,20 €'  },
]

export const NAV = [
  { href: '/site',            label: 'Accueil' },
  { href: '/site/depannage',  label: 'Dépannage' },
  { href: '/site/fourriere',  label: 'Fourrière' },
  { href: '/site/circuit',    label: 'Circuit & événements' },
  { href: '/site/vente',      label: 'Véhicules à vendre' },
  { href: '/site/pros',       label: 'Pros' },
  { href: '/site/contact',    label: 'Contact' },
]
