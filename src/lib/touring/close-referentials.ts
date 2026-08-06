// src/lib/touring/close-referentials.ts
//
// Référentiels des codes panne COMEX (pour le formulaire complet dispatch).
// Dump COMEX 2026-08-06 (widgets detailPanneCode/Desc/ResultSelect).
//   - PANNE_DESC   (Code Type)     : 42 codes — COMPLET.
//   - PANNE_RESULT (Code Résultat) : 20 codes — COMPLET.
//   - PANNE_CAUSE  (Code Incident) : SOUS-ENSEMBLE courant (~38) — la liste COMEX
//     en compte 495 ; on expose ici les causes fréquentes + celles des presets.
//     Les presets remplissent de toute façon les 3 codes ; la liste sert à ajuster.
// Cascade Incident→Type→Résultat = côté client COMEX (non répliquée) → ici listes
// plates (le dispatch reste libre, COMEX valide à l'envoi).

export interface CodeOption { code: string; label: string }

export const PANNE_DESC: CodeOption[] = [
  { code: '10', label: 'Cassé' }, { code: '11', label: 'Plié' }, { code: '12', label: 'Fendu / Déchiré' },
  { code: '13', label: 'Abîmé' }, { code: '14', label: 'Crevé' }, { code: '15', label: 'Obstrué' },
  { code: '16', label: 'Gelé' }, { code: '17', label: 'Insuffisant' }, { code: '18', label: 'Excessif' },
  { code: '19', label: 'Humidité / Mouillé' }, { code: '20', label: 'Noyé' }, { code: '21', label: 'Bouchon' },
  { code: '22', label: 'Surchauffé' }, { code: '23', label: 'Pollué (plein contraire - eau)' }, { code: '24', label: 'Fuite' },
  { code: '25', label: 'Calé / Bloqué' }, { code: '26', label: 'Usé' }, { code: '27', label: 'Desserré' },
  { code: '28', label: 'Brûlé' }, { code: '29', label: 'Déchargé' }, { code: '30', label: 'Court-circuit' },
  { code: '31', label: 'Circuit coupé' }, { code: '32', label: 'Mauvais contact' }, { code: '33', label: 'Déconnecté' },
  { code: '34', label: 'Fusible fondu / absent' }, { code: '35', label: 'Circuit de secours (témoin ON)' },
  { code: '36', label: 'Erreur humaine' }, { code: '37', label: 'Perdu / disparu' }, { code: '38', label: 'Dangereux' },
  { code: '39', label: 'Mal réglé' }, { code: '40', label: 'Mal ajusté' }, { code: '41', label: 'Mauvais type' },
  { code: '42', label: 'Accident' }, { code: '43', label: 'Volé / Vandalisme' }, { code: '44', label: 'Dégâts du feu' },
  { code: '45', label: 'Enfermé' }, { code: '46', label: 'Cause inconnue' }, { code: '47', label: 'Pas synchronisé' },
  { code: '48', label: 'Embourbé' }, { code: '49', label: 'Déchargé - Erreur véhicule' },
  { code: '71', label: 'Màj système indispensable' }, { code: '73', label: 'Dégâts de rongeur' },
]

export const PANNE_RESULT: CodeOption[] = [
  { code: '50', label: 'Dépannage provisoire' }, { code: '51', label: 'Comp. remplacé (stock membre)' },
  { code: '52', label: 'Comp. remplacé (stock propre)' }, { code: '53', label: 'Comp. remplacé (concessionnaire)' },
  { code: '54', label: 'Comp. remplacé (autres sources)' }, { code: '55', label: 'Comp. réparé (temporaire)' },
  { code: '56', label: 'Comp. réparé (définitif)' }, { code: '57', label: 'Remise à niveau / Réglage' },
  { code: '58', label: 'Rechargé' }, { code: '59', label: 'Mise en marche (batteries)' },
  { code: '60', label: 'Ouverture voiture' }, { code: '61', label: 'Échange de roue' },
  { code: '62', label: 'Reprogrammé' }, { code: '63', label: 'Pas de réparation / Conseil' },
  { code: '71', label: 'Non réparable - comp. indisponible' }, { code: '72', label: 'Non réparable - matériel indisp.' },
  { code: '73', label: 'Réparation sur route impossible' }, { code: '74', label: 'Diagnostic impossible' },
  { code: '76', label: 'Échange de roue - Utilisation' }, { code: '90', label: 'Réparation refusée par membre' },
]

export const PANNE_CAUSE: CodeOption[] = [
  { code: '355', label: 'Moteur' }, { code: '359', label: 'Huile moteur' }, { code: '377', label: 'Courroie de distribution' },
  { code: '400', label: 'Batterie' }, { code: '403', label: 'Bornes batterie' }, { code: '401', label: 'Tresse de masse batterie' },
  { code: '427', label: 'Démarreur moteur' }, { code: '429', label: 'Relais démarreur (Bendix)' }, { code: '150', label: 'Alternateur' },
  { code: '617', label: 'Bougies' }, { code: '607', label: 'Boîtier électronique allumage' },
  { code: '704', label: 'Embrayage' }, { code: '722', label: 'Boîte vitesses manuelle' }, { code: '700', label: 'Boîte vitesses automatique (BVA)' },
  { code: '246', label: 'Pneu (avec roue de secours)' }, { code: '259', label: 'Pneu (sans roue de secours)' },
  { code: '247', label: 'Valve de pneumatique' }, { code: '248', label: 'Jante' },
  { code: '300', label: 'Liquide de refroidissement' }, { code: '323', label: 'Pompe à eau' }, { code: '315', label: 'Radiateur' },
  { code: '313', label: 'Durit' }, { code: '314', label: 'Durit radiateur' },
  { code: '206', label: 'Étrier de freins' }, { code: '207', label: 'Disque de freins' }, { code: '209', label: 'Liquide de freins' },
  { code: '215', label: 'Plaquettes de freins' },
  { code: '515', label: 'Carburant' }, { code: '554', label: 'Carburant Diesel' }, { code: '543', label: 'Injecteurs (diesel)' },
  { code: '545', label: 'Pompe injection (diesel)' }, { code: '533', label: 'Pompe à carburant' },
  { code: '660', label: 'Clé (perdue ou défectueuse)' }, { code: '680', label: "Clés enfermées dans l'habitacle" },
  { code: '678', label: 'Clés enfermées dans le coffre' }, { code: '661', label: 'Serrure portes' }, { code: '239', label: 'Blocage de direction' },
  { code: '144', label: 'Accident' }, { code: '145', label: 'Incendie' }, { code: '146', label: 'Volé / Vandalisme' },
  { code: '999', label: 'Véhicule entier' },
]

export const labelOf = (list: CodeOption[], code: string) =>
  list.find(o => o.code === code)?.label || (code ? `Code ${code}` : '')
