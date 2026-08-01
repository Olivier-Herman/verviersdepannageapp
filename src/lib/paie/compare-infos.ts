// src/lib/paie/compare-infos.ts
//
// Double contrôle : compare les infos perso LUES sur la fiche de paie (slip_infos,
// = ce que le secrétariat social a encodé) avec la fiche VD Soft (source voulue).
// Une divergence = alerte : ex. un chauffeur a changé d'adresse, la fiche suivante
// devrait la refléter ; si elle diffère encore de VD Soft → pas (encore) adapté.
//
// On ne signale QUE si les deux côtés ont une valeur (sinon rien à recouper).
// Olivier 2026-08-01.

const strip = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const normTxt   = (s: any) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const normDigit = (s: any) => String(s ?? '').replace(/\D/g, '')
const normIban  = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase()
const normNum   = (s: any) => { const n = Number(String(s ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? String(n) : '' }

interface FieldDef { key: string; label: string; norm: (v: any) => string }
const FIELDS: FieldDef[] = [
  { key: 'adresse',          label: 'Adresse',            norm: normTxt   },
  { key: 'code_postal',      label: 'Code postal',        norm: normDigit },
  { key: 'ville',            label: 'Ville',              norm: normTxt   },
  { key: 'national_number',  label: 'N° national',        norm: normDigit },
  { key: 'iban',             label: 'IBAN',               norm: normIban  },
  { key: 'etat_civil',       label: 'État civil',         norm: normTxt   },
  { key: 'personnes_charge', label: 'Personnes à charge', norm: normNum   },
]

export interface Mismatch { key: string; label: string; vdsoft: any; fiche: any }

/**
 * Renvoie la liste des champs qui DIVERGENT entre la fiche VD Soft (`person`) et
 * les infos lues sur la fiche de paie (`slipInfos`). Vide si tout concorde ou si
 * un côté est vide (rien à recouper).
 */
export function compareSlipInfos(person: any, slipInfos: any): Mismatch[] {
  if (!person || !slipInfos) return []
  const out: Mismatch[] = []
  for (const f of FIELDS) {
    const vRaw = person[f.key]
    const sRaw = slipInfos[f.key]
    const v = f.norm(vRaw), s = f.norm(sRaw)
    if (!v || !s) continue            // un côté manquant → pas de recoupement
    if (v !== s) out.push({ key: f.key, label: f.label, vdsoft: vRaw, fiche: sRaw })
  }
  return out
}

/** Sélectionne la fiche la plus récente qui porte des infos exploitables. */
export function latestSlipWithInfos(slips: any[]): any | null {
  const withInfos = (slips || [])
    .filter(s => s.slip_infos && typeof s.slip_infos === 'object')
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
  return withInfos[0] || null
}
