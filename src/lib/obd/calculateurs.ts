// src/lib/obd/calculateurs.ts — adresses des calculateurs autres que le moteur (ABS, airbag, tableau de bord…).
// Le mode 03 ne lit que le moteur : un témoin ABS ou airbag allumé restait invisible (Caddy D-0008/D-0009, Olivier
// 10/11/2026 : « on lit tous les calculateurs et puis on donne un diag complet »). Lecture seule : codes UDS 19 02.
// Prudence : on n'interroge les adresses d'une marque que si le numéro de châssis la donne. Ailleurs, seules les
// adresses de diagnostic réservées à toutes les marques (7E0 à 7E7) sont interrogées.

export type SystemeId = 'moteur' | 'boite' | 'abs' | 'airbag' | 'tableau' | 'passerelle' | 'direction' | 'carrosserie' | 'volant' | 'clim' | 'parking' | 'autre'
// rx vide : adresse apprise, la réponse est reconnue à son en-tête (plage 600 à 7FF).
export interface Calculateur { tx: string; rx: string; systeme: SystemeId; nom?: string | null }
export type Groupe = 'vag' | 'ford' | 'renault' | 'toyota' | 'hyundai' | 'psa'

export const SYSTEMES: Record<SystemeId, { fr: string; sq: string }> = {
  moteur: { fr: 'Moteur', sq: 'Motori' },
  boite: { fr: 'Boîte de vitesses', sq: 'Kambio' },
  abs: { fr: 'Freins (ABS / ESP)', sq: 'Frenat (ABS / ESP)' },
  airbag: { fr: 'Airbags', sq: 'Airbag-ët' },
  tableau: { fr: 'Tableau de bord', sq: 'Paneli i instrumenteve' },
  passerelle: { fr: 'Passerelle (communication)', sq: 'Porta e komunikimit' },
  direction: { fr: 'Direction assistée', sq: 'Drejtimi i asistuar' },
  carrosserie: { fr: 'Électricité de carrosserie', sq: 'Elektrika e karrocerisë' },
  volant: { fr: 'Commandes au volant', sq: 'Komandat në timon' },
  clim: { fr: 'Climatisation', sq: 'Kondicioneri' },
  parking: { fr: 'Aide au parking', sq: 'Ndihma për parkim' },
  autre: { fr: 'Autre calculateur', sq: 'Njësi tjetër' },
}

/** Adresses de diagnostic communes (ISO 15765-4) : réponse = demande + 8. */
const COMMUNS: Calculateur[] = [
  { tx: '7E0', rx: '7E8', systeme: 'moteur' }, { tx: '7E1', rx: '7E9', systeme: 'boite' },
  ...['7E2', '7E3', '7E4', '7E5', '7E6', '7E7'].map(tx => ({ tx, rx: (parseInt(tx, 16) + 8).toString(16).toUpperCase(), systeme: 'autre' as const })),
]

const plus = (tx: string, n: number) => (parseInt(tx, 16) + n).toString(16).toUpperCase()
const table = (n: number, l: [string, SystemeId][]): Calculateur[] => l.map(([tx, systeme]) => ({ tx, rx: plus(tx, n), systeme }))

const MARQUES: Record<Groupe, Calculateur[]> = {
  // VW, Audi, Skoda, Seat, Cupra : réponse = demande + 0x6A.
  vag: table(0x6a, [['713', 'abs'], ['715', 'airbag'], ['714', 'tableau'], ['710', 'passerelle'], ['712', 'direction'], ['70E', 'carrosserie'], ['70C', 'volant'], ['746', 'clim'], ['70A', 'parking']]),
  ford: table(8, [['760', 'abs'], ['737', 'airbag'], ['720', 'tableau'], ['716', 'passerelle'], ['730', 'direction'], ['726', 'carrosserie'], ['733', 'clim'], ['736', 'parking']]),
  // Renault, Dacia : réponse = demande + 0x20.
  renault: table(0x20, [['740', 'abs'], ['752', 'airbag'], ['743', 'tableau'], ['742', 'direction'], ['745', 'carrosserie'], ['744', 'clim']]),
  toyota: table(8, [['7B0', 'abs'], ['780', 'airbag'], ['7C0', 'tableau'], ['7A1', 'direction'], ['7C4', 'clim']]),
  hyundai: table(8, [['7D1', 'abs'], ['7D2', 'airbag'], ['7C6', 'tableau'], ['7D4', 'direction'], ['7A0', 'carrosserie'], ['7B3', 'clim']]),
  // Peugeot, Citroën, DS, Opel récente : rien de sûr au départ, tout vient de l'apprentissage.
  psa: [],
}

/**
 * Plages essayées pour apprendre les adresses d'un groupe, quelques-unes à chaque lecture. Seulement sur une voiture de
 * 2010 ou plus récente (prise de diagnostic séparée du reste de la voiture) et en lecture seule.
 */
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => (a + i).toString(16).toUpperCase())
export const DECOUVERTE: Partial<Record<Groupe, string[]>> = {
  psa: [...range(0x6a0, 0x6bf), ...range(0x750, 0x77f)],
}
export const ESSAIS_PAR_LECTURE = 16

/** Voiture assez récente pour l'apprentissage : 10e caractère du châssis = lettre (2010 et plus). */
export function decouverteAutorisee(vin: string | null | undefined, groupe: Groupe | null): boolean {
  return !!groupe && !!DECOUVERTE[groupe]?.length && /^[A-HJ-NPR-Y]$/.test(String(vin || '').toUpperCase()[9] || '')
}

/** Système d'après le nom que le calculateur donne de lui-même (22 F1 97). */
export function systemeDeNom(nom: string | null | undefined): SystemeId {
  const n = String(nom || '').toUpperCase()
  if (/ABS|ESP|ESC|BRAKE|BREMS|FREIN|CDS/.test(n)) return 'abs'
  if (/AIRBAG|SRS|RCM|ACU/.test(n)) return 'airbag'
  if (/CLUSTER|KOMBI|INSTR|COMBIN|IPC|DASH/.test(n)) return 'tableau'
  if (/GATEWAY|GTW|\bGW\b|CVM|SGW/.test(n)) return 'passerelle'
  if (/EPS|STEER|LENK|DAE|DIRECT/.test(n)) return 'direction'
  if (/BSI|BCM|BODY|BCB|UCH|BORDNETZ/.test(n)) return 'carrosserie'
  if (/HVAC|CLIM|CLIMA|AIR ?COND|KLIMA/.test(n)) return 'clim'
  if (/PARK|PDC|AAS|UPA/.test(n)) return 'parking'
  if (/ENGINE|MOTOR|ECM|INJ|CMM|DCM|EDC|MED|MEV/.test(n)) return 'moteur'
  if (/GEAR|TRANS|BVA|TCM|GETRIEBE|EAT/.test(n)) return 'boite'
  return 'autre'
}

/** Groupe de marques d'après le numéro de châssis (3 premiers caractères), ou d'après le nom de la marque. */
export function groupeDe(vin: string | null | undefined, marque?: string | null): Groupe | null {
  const w = String(vin || '').toUpperCase().slice(0, 3)
  if (/^(WVW|WV1|WV2|WV3|WAU|WUA|TRU|TMB|VSS|AAV|1VW|3VW)$/.test(w)) return 'vag'
  if (/^(WF0|WF1|1F[A-Z0-9]|2F[A-Z0-9]|3F[A-Z0-9])$/.test(w)) return 'ford'
  if (/^(VF1|UU1)$/.test(w)) return 'renault'
  if (/^(JT[A-Z0-9]|SB1|NMT|VNK)$/.test(w)) return 'toyota'
  if (/^(KMH|KNA|KND|KNE|TMA|U5Y|U6Y)$/.test(w)) return 'hyundai'
  if (/^(VF3|VF7|VR3|VR7|VR1|VXK|VXE)$/.test(w)) return 'psa'
  if (w.length === 3) return null
  const m = String(marque || '').toLowerCase()
  if (/volkswagen|\bvw\b|audi|skoda|škoda|seat|cupra/.test(m)) return 'vag'
  if (/\bford\b/.test(m)) return 'ford'
  if (/renault|dacia/.test(m)) return 'renault'
  if (/toyota|lexus/.test(m)) return 'toyota'
  if (/hyundai|\bkia\b/.test(m)) return 'hyundai'
  if (/peugeot|citro[eë]n|\bds\b/.test(m)) return 'psa'
  return null
}

/** Calculateurs à interroger : les communs, puis ceux de la marque, puis ceux appris (sans doublon d'adresse). */
export function calculateursDe(groupe: Groupe | null, appris: Calculateur[] = []): Calculateur[] {
  const out = [...COMMUNS]
  for (const c of [...(groupe ? MARQUES[groupe] : []), ...appris]) if (!out.some(x => x.tx === c.tx)) out.push(c)
  return out
}

/** Adresses déjà connues sans apprentissage (communes + table de la marque). */
export const adressesFixes = (groupe: Groupe | null) => new Set(calculateursDe(groupe).map(c => c.tx))

/** Nom d'un système dans la langue du chauffeur ; « autre » garde l'adresse pour s'y retrouver. */
export function nomSysteme(id: string | null | undefined, lang: 'fr' | 'sq' = 'fr', adresse?: string | null): string {
  const s = SYSTEMES[(id || 'autre') as SystemeId] || SYSTEMES.autre
  return id === 'autre' || !SYSTEMES[id as SystemeId] ? `${s[lang]}${adresse ? ` ${adresse}` : ''}` : s[lang]
}
