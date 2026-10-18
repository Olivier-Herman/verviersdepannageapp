// src/lib/parc/releve.ts — Relevé de parc sans étiquette (Olivier 18/10/2026, inventaire du dépôt de Verviers).
// Pour un véhicule vu sur place (plaque, châssis, marque…), on cherche partout ce qu'on sait de lui : fiches VD Soft,
// Towsoft, mails (fourrière, info, administration) et ERP (véhicule, devis, factures). Lecture seule.
import { createAdminClient } from '@/lib/supabase'

export interface ReleveSaisie { plate?: string | null; vin?: string | null; brand?: string | null; model?: string | null; date?: string | null }

/** Lieux du relevé → zone de parc VD Soft (null = l'utilisateur choisit la zone). */
export const RELEVE_LIEUX: Record<string, { label: string; zone: string | null }> = {
  verviers:  { label: 'Dépôt Verviers', zone: 'Verviers' },
  pepinster: { label: 'Dépôt Pepinster', zone: null },
  rachid:    { label: 'Rachid — cyclos (zone S)', zone: 'S' },
  labo:      { label: 'Zone Labo (Pepinster)', zone: 'LABO' },
}

export const norm = (s: any) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const plateDash = (p: string) => /^\d[A-Z]{3}\d{3}$/.test(p) ? `${p[0]}-${p.slice(1, 4)}-${p.slice(4)}` : p

export async function rechercherVehicule(s: ReleveSaisie) {
  const plate = norm(s.plate), vin = norm(s.vin)
  const vinTail = vin.length >= 6 ? vin.slice(-6) : ''
  const [vd, ts, mails, erp] = await Promise.allSettled([chercherVdSoft(plate, vinTail), chercherTowsoft(plate, vin), chercherMails(plate, vin), chercherErp(plate)])
  const v = <T,>(r: PromiseSettledResult<T>, d: T) => r.status === 'fulfilled' ? r.value : d
  return {
    vdsoft:  v(vd, [] as any[]),
    towsoft: v(ts, [] as any[]),
    mails:   v(mails, [] as any[]),
    erp:     v(erp, [] as any[]),
    erreurs: [vd, ts, mails, erp].map((r, i) => r.status === 'rejected' ? `${['VD Soft', 'Towsoft', 'Mails', 'ERP'][i]} : ${String((r as any).reason?.message || r.reason).slice(0, 120)}` : null).filter(Boolean),
  }
}

async function chercherVdSoft(plate: string, vinTail: string) {
  if (plate.length < 3 && !vinTail) return []
  const sb = createAdminClient()
  const or = [plate.length >= 3 ? `vehicle_plate.ilike.%${plate}%` : null, plate.length >= 7 ? `vehicle_plate.ilike.%${plateDash(plate)}%` : null, vinTail ? `vehicle_vin.ilike.%${vinTail}%` : null].filter(Boolean).join(',')
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, parc_zone_key, intervention_date, parked_at, dossier_number, officer_name, client_name, dossier_leg')
    .or(or).neq('status', 'cancelled').order('intervention_date', { ascending: false }).limit(15)
  return (data || []).filter((m: any) => !m.dossier_leg && m.source !== 'gardiennage')
}

async function chercherTowsoft(plate: string, vin: string) {
  if (!process.env.TOWSOFT_PASS) return []
  const { searchTowsoftGlobal } = await import('@/lib/towsoft-client')
  const hits: any[] = []
  if (plate.length >= 4) hits.push(...await searchTowsoftGlobal('immatriculation' as any, plate).catch(() => []))
  if (vin.length >= 6) hits.push(...await searchTowsoftGlobal('niv' as any, vin.length >= 17 ? vin : vin.slice(-6)).catch(() => []))
  return [...new Map(hits.map((h: any) => [h.towsoft_num, h])).values()].slice(0, 10).map((h: any) => ({
    num: h.towsoft_num, date: h.date_iso?.slice(0, 10) || h.date_raw, type: h.type, statut: h.statut, plate: h.plate, vin: h.vin,
    marque: [h.brand, h.model].filter(Boolean).join(' '), lieu: h.lieu_intervention, destination: h.destination,
    client: h.client, dossier: h.dossier, remarques: h.remarks, url: h.fiche_url,
  }))
}

async function chercherMails(plate: string, vin: string) {
  const termes = [plate.length >= 5 ? plate : null, plate.length >= 7 ? plateDash(plate) : null, vin.length >= 11 ? vin : null].filter(Boolean) as string[]
  if (!termes.length) return []
  const { getAppOnlyToken } = await import('@/lib/graph-mail-search')
  const tok = await getAppOnlyToken()
  const out: any[] = []
  for (const box of ['fourriere@verviersdepannage.be', 'info@verviersdepannage.com', 'administration@verviersdepannage.com']) {
    for (const q of termes) {
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${box}/messages?$search="${encodeURIComponent(q)}"&$top=8&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,webLink`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })
      const j: any = await r.json().catch(() => ({}))
      for (const m of j.value || []) out.push({ id: m.id, boite: box.split('@')[0], date: String(m.receivedDateTime || '').slice(0, 10), de: m.from?.emailAddress?.address, objet: m.subject, apercu: String(m.bodyPreview || '').replace(/\s+/g, ' ').slice(0, 220), pj: !!m.hasAttachments, lien: m.webLink })
    }
  }
  return [...new Map(out.map(m => [m.id, m])).values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)
}

async function chercherErp(plate: string) {
  if (plate.length < 5) return []
  const { odooRpc } = await import('@/lib/odoo')
  const veh: any[] = await odooRpc('fleet.vehicle', 'search_read', [['|', ['license_plate', 'ilike', plate], ['license_plate', 'ilike', plateDash(plate)]]], { fields: ['id', 'license_plate', 'model_id', 'vin_sn', 'state_id'], context: { active_test: false }, limit: 5 })
  if (!veh.length) return []
  const so: any[] = await odooRpc('sale.order', 'search_read', [[['x_studio_many2one_field_78n_1j6fmmeom', 'in', veh.map(v => v.id)]]], { fields: ['name', 'partner_id', 'date_order', 'invoice_ids', 'client_order_ref'], limit: 10 })
  const invIds = so.flatMap(s => s.invoice_ids || [])
  const inv: any[] = invIds.length ? await odooRpc('account.move', 'read', [invIds], { fields: ['name', 'partner_id', 'amount_total', 'payment_state', 'invoice_date', 'move_type'] }) : []
  return veh.map(v => ({
    vehicule: `${v.license_plate || ''} ${v.model_id?.[1] || ''}`.trim(), chassis: v.vin_sn || null, etat: v.state_id?.[1] || null,
    devis: so.map(s => `${s.name} ${s.partner_id?.[1] || ''} ${String(s.date_order || '').slice(0, 10)} ${s.client_order_ref || ''}`.trim()),
    factures: inv.map(i => ({ nom: i.name, client: i.partner_id?.[1], montant: i.amount_total, paye: i.payment_state, date: i.invoice_date, type: i.move_type })),
  }))
}

/** Source VD Soft déduite du type Towsoft (même logique que la reprise Towsoft). */
export function sourceDepuisTowsoft(type: string | null | undefined): string {
  const m = String(type || '').toLowerCase()
  if (m.includes('mal') && m.includes('gar')) return 'police_mg'
  if (m.includes('accident')) return 'police_accident'
  if (m.includes('saisie')) return 'police_saisie'
  if (m.includes('rodeo') || m.includes('rodéo')) return 'police_rodeo'
  if (m.includes('avp') || m.includes('abandon')) return 'police_avp'
  if (m.includes('priv')) return 'prive'
  return 'legacy_towsoft_migration'
}
