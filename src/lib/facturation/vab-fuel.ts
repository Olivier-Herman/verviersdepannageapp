// src/lib/facturation/vab-fuel.ts — supplément carburant VAB (Olivier 13/10/2026).
// VAB accorde 2,50 € HTVA par DOSSIER, sur une ligne distincte, pendant les périodes
// annoncées par mail (28/04 : dès le 01/04 ; 10/07 : supprimé pour les dossiers transmis
// dès le 16/07 ; 27/07 : réintroduit au 01/08 ; prolongé au 30/09 puis au 31/10/2026).
// Périodes réglables : Réglages métier « vab_supplement_carburant » (début|fin|montant).
// Client = VAB (le partenaire facturé, pas la source) ; une seule fois par dossier.
import { getBusinessList } from '@/lib/settings/business'
import type { QuoteLine } from '@/lib/odoo-quote'

export async function vabFuelLine(sb: any, o: { clientId: number | null | undefined; mission: any; lines: QuoteLine[]; dossierMissionIds: string[] }): Promise<QuoteLine | null> {
  if (!o.clientId || o.lines.some(l => /carburant/i.test(l.name))) return null
  const { data: cat } = await sb.from('mission_source_catalog').select('default_billed_to_id').eq('key', 'vab').maybeSingle()
  if (!cat?.default_billed_to_id || Number(cat.default_billed_to_id) !== Number(o.clientId)) return null
  const m = o.mission || {}
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(m.received_at || m.intervention_date || Date.now()))
  const periods = (await getBusinessList('vab_supplement_carburant').catch(() => [] as string[]))
    .map(x => String(x).split('|')).filter(p => p.length === 3)
    .map(([from, to, amt]) => ({ from: from.trim(), to: to.trim(), amount: Number(String(amt).replace(',', '.')) }))
  const p = periods.find(x => day >= x.from && day <= x.to && x.amount > 0)
  if (!p) return null
  const ids = [...new Set(o.dossierMissionIds.filter(Boolean))]
  if (ids.length) {
    const { data: prev } = await sb.from('mission_billed_items').select('id').in('mission_id', ids).ilike('label', '%carburant%').limit(1)
    if (prev?.length) return null
  }
  return { kind: 'SERV-DIV', name: 'Supplément carburant VAB', qty: 1, price_unit: p.amount }
}
