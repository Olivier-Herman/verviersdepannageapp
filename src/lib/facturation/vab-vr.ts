// src/lib/facturation/vab-vr.ts — forfait « livraison de véhicule de remplacement » VAB (Olivier 13/10/2026).
// Grille VAB 2026, « Voiture remplacement : frais administratif livraison / récup » : une ligne
// distincte par livraison, au montant du créneau (réglage métier « vab_forfait_vr » : jour|soir|nuit).
// Le forfait n'entre pas dans le sous-total majoré : les trois montants sont déjà ceux de VAB.
// Créneau jugé sur l'heure de livraison du VR (étape pointée), à défaut sur la réception.
import { getBusinessList } from '@/lib/settings/business'
import { isBelgianHoliday } from '@/lib/surcharges'
import type { QuoteLine } from '@/lib/odoo-quote'

export type CreneauVab = 'jour' | 'soir' | 'nuit'

/** Créneau VAB d'un instant : nuit 0h-5h tous les jours ; jour lun-ven 7h-19h hors fériés ; soir le reste. */
export function creneauVab(at: Date): CreneauVab {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const h = Number(get('hour')) % 24
  if (h < 5) return 'nuit'
  const wd = get('weekday')
  const local = new Date(Number(get('year')), Number(get('month')) - 1, Number(get('day')))
  const ouvrable = !['Sat', 'Sun'].includes(wd) && !isBelgianHoliday(local)
  return ouvrable && h >= 7 && h < 19 ? 'jour' : 'soir'
}

/** Montants du forfait VR par créneau (réglage métier). Réglage absent = erreur franche, jamais 0. */
export async function forfaitsVr(): Promise<Record<CreneauVab, number>> {
  const out: Partial<Record<CreneauVab, number>> = {}
  for (const x of await getBusinessList('vab_forfait_vr')) {
    const [k, v] = String(x).split('|')
    const n = Number(String(v || '').replace(',', '.'))
    if (['jour', 'soir', 'nuit'].includes(k) && n > 0) out[k as CreneauVab] = n
  }
  if (!out.jour || !out.soir || !out.nuit) throw new Error('Réglage « vab_forfait_vr » incomplet (jour|soir|nuit).')
  return out as Record<CreneauVab, number>
}

/** Ligne du forfait VR pour une fiche qui porte une livraison de VR VAB (vab_vr), sinon null. */
export async function vabVrLine(o: { mission: any; lines: QuoteLine[] }): Promise<QuoteLine | null> {
  // Case du dispatch : false = jamais, true = toujours (livraison non détectée), NULL = détection.
  if (o.mission?.vr_forfait === false) return null
  const vr = o.mission?.vab_vr || (o.mission?.vr_forfait === true ? {} : null)
  if (!vr || o.lines.some(l => /remplacement/i.test(l.name))) return null
  const at = new Date(vr.delivered_at || vr.added_at || o.mission.intervention_date || o.mission.received_at || Date.now())
  const c = creneauVab(at)
  const montants = await forfaitsVr()
  const plaque = vr.plate ? ` ${vr.plate}` : ''
  const libelle = c === 'jour' ? '7 h-19 h' : c === 'nuit' ? '24 h-5 h' : 'soir, nuit ou week-end'
  return { kind: 'SERV-DIV', name: `Livraison véhicule de remplacement${plaque} (frais administratifs VAB, ${libelle})`, qty: 1, price_unit: montants[c] }
}
