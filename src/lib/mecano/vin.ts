// src/lib/mecano/vin.ts
//
// Validation / décodage VIN (n° de châssis, ISO 3779).
// Règle métier : on valide sur la STRUCTURE (17 car. + alphabet légal, pas de VIN
// factice). On NE rejette PAS sur le chiffre-clé de contrôle car beaucoup de VIN
// européens ne le respectent pas alors qu'ils sont valides — on l'expose comme
// simple signal.

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/  // pas de I, O, Q

/** Nettoie un VIN saisi (majuscules, retire espaces/tirets). */
export function cleanVin(raw: string | null | undefined): string {
  return String(raw || '').toUpperCase().replace(/[\s-]/g, '')
}

/** VIN structurellement plausible : 17 car., alphabet légal, pas un placeholder. */
export function isPlausibleVin(raw: string | null | undefined): boolean {
  const v = cleanVin(raw)
  if (!VIN_RE.test(v)) return false
  if (/^(.)\1{16}$/.test(v)) return false          // 17× le même caractère (XXXX…)
  if (/^0{5,}/.test(v) || v === '00000000000000000') return false
  return true
}

// Chiffre-clé de contrôle ISO (position 9). Signal indicatif seulement.
const TRANS: Record<string, number> = {
  A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8, J:1,K:2,L:3,M:4,N:5,P:7,R:9,
  S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9,
  '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
}
const WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2]

/** true si le chiffre-clé ISO est correct (souvent faux sur VIN EU → indicatif). */
export function vinCheckDigitOk(raw: string | null | undefined): boolean {
  const v = cleanVin(raw)
  if (!VIN_RE.test(v)) return false
  let sum = 0
  for (let i = 0; i < 17; i++) { const t = TRANS[v[i]]; if (t === undefined) return false; sum += t * WEIGHTS[i] }
  const r = sum % 11
  const expected = r === 10 ? 'X' : String(r)
  return v[8] === expected
}

// Décodage année-modèle (10e caractère). Heuristique standard : si le 7e caractère
// est une LETTRE → millésime 2010-2039, si c'est un CHIFFRE → 1980-2009.
const YEAR_CODES = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','R','S','T','V','W','X','Y','1','2','3','4','5','6','7','8','9']

/** Année-modèle décodée du VIN, ou null si indéterminable. */
export function decodeVinYear(raw: string | null | undefined): number | null {
  const v = cleanVin(raw)
  if (!VIN_RE.test(v)) return null
  const idx = YEAR_CODES.indexOf(v[9])
  if (idx < 0) return null
  const seventhIsDigit = /[0-9]/.test(v[6])
  const base = seventhIsDigit ? 1980 : 2010
  const year = base + idx
  // Garde-fou : pas d'année future absurde.
  return year <= new Date().getUTCFullYear() + 1 ? year : year - 30
}
