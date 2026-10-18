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
/** 0 et O se confondent à la lecture (Olivier 18/10/2026). Châssis : O, I, Q n'existent pas (norme VIN) → 0, 1, 0.
 *  Plaque : on essaie les deux lectures ; en base, « _ » (un caractère quelconque) remplace 0 / O. */
const vinPropre = (v: string) => v.replace(/O/g, '0').replace(/Q/g, '0').replace(/I/g, '1')
const lectures = (p: string) => [...new Set([p, p.replace(/O/g, '0'), p.replace(/0/g, 'O')])]
const joker = (p: string) => p.replace(/[0O]/g, '_')
const plateDash = (p: string) => /^\d[A-Z]{3}\d{3}$/.test(p) ? `${p[0]}-${p.slice(1, 4)}-${p.slice(4)}` : p

export async function rechercherVehicule(s: ReleveSaisie) {
  const plate = norm(s.plate), vin = vinPropre(norm(s.vin))
  // Châssis complet : on cherche sa fin (6) ; châssis partiel (ce qui est lisible, même au milieu) : tel quel dès 4 caractères.
  const vinTail = vin.length >= 17 ? vin.slice(-6) : vin.length >= 4 ? vin : ''
  // Ni plaque ni châssis lisibles : recherche par marque / modèle (+ date), véhicules encore au parc (Olivier 18/10/2026).
  const parModele = !plate && !vin
  const [vd, ts, mails, erp] = await Promise.allSettled(parModele
    ? [chercherVdSoftModele(s), chercherTowsoftModele(s), Promise.resolve([]), Promise.resolve([])]
    : [chercherVdSoft(plate, vinTail), chercherTowsoft(plate, vin), chercherMails(plate, vin), chercherErp(plate)])
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
  const or = [plate.length >= 3 ? `vehicle_plate.ilike.%${joker(plate)}%` : null, plate.length >= 7 ? `vehicle_plate.ilike.%${joker(plateDash(plate))}%` : null, vinTail ? `vehicle_vin.ilike.%${joker(vinTail)}%` : null, vinTail ? `vehicle_plate.ilike.%${joker(vinTail)}%` : null].filter(Boolean).join(',')
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, source, status, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, parc_zone_key, intervention_date, parked_at, dossier_number, officer_name, client_name, dossier_leg')
    .or(or).order('intervention_date', { ascending: false }).limit(15)   // annulées comprises : un véhicule présent avec une fiche annulée est une anomalie à voir
  return (data || []).filter((m: any) => !m.dossier_leg && m.source !== 'gardiennage')
}

async function chercherTowsoft(plate: string, vin: string) {
  if (!process.env.TOWSOFT_PASS) return []
  const { searchTowsoftGlobal } = await import('@/lib/towsoft-client')
  const hits: any[] = []
  if (plate.length >= 4) for (const p of lectures(plate)) hits.push(...await searchTowsoftGlobal('immatriculation' as any, p).catch(() => []))
  if (vin.length >= 4) {
    hits.push(...await searchTowsoftGlobal('niv' as any, vin).catch(() => []))
    if (vin.length >= 17) hits.push(...await searchTowsoftGlobal('niv' as any, vin.slice(-6)).catch(() => []))
    // Dans Towsoft, le chauffeur tapait parfois le châssis dans le champ plaque (Olivier 18/10/2026).
    const essais = vin.length >= 17 ? [vin, vin.slice(-8), vin.slice(-6)] : [vin]
    for (const q of [...new Set(essais)]) hits.push(...await searchTowsoftGlobal('immatriculation' as any, q).catch(() => []))
  }
  return [...new Map(hits.map((h: any) => [h.towsoft_num, h])).values()].slice(0, 10).map(towsoftLigne)
}

const towsoftLigne = (h: any) => ({
    num: h.towsoft_num, date: h.date_iso?.slice(0, 10) || h.date_raw, type: h.type, statut: h.statut, plate: h.plate, vin: h.vin,
    marque: [h.brand, h.model].filter(Boolean).join(' '), lieu: h.lieu_intervention, destination: h.destination,
    client: h.client, dossier: h.dossier, remarques: h.remarks, url: h.fiche_url,
  })

const proche = (date: string | null | undefined) => (d: any) => date ? Math.abs(+new Date(String(d || '').slice(0, 10)) - +new Date(date)) : 0
const mots = (x: any) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 2)

/** Sans plaque ni châssis : véhicules de la même marque (et du modèle si donné) encore au parc dans VD Soft. */
async function chercherVdSoftModele(s: ReleveSaisie) {
  const brand = String(s.brand || '').trim(), model = String(s.model || '').trim()
  if (brand.length < 2 && model.length < 2) return []
  let q = createAdminClient().from('incoming_missions')
    .select('id, mission_number, source, status, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, parc_zone_key, intervention_date, parked_at, dossier_number, officer_name, client_name, dossier_leg')
    .in('status', ['parked', 'gardiennage']).is('dossier_leg', false).neq('source', 'gardiennage').limit(200)
  if (brand.length >= 2) q = q.ilike('vehicle_brand', `%${brand}%`)
  const { data } = await q
  const mm = mots(model)
  const out = (data || []).filter((m: any) => !mm.length || mm.some(w => mots(`${m.vehicle_model} ${m.vehicle_brand}`).includes(w)))
  return out.sort((a: any, b: any) => proche(s.date)(a.intervention_date) - proche(s.date)(b.intervention_date)).slice(0, 25)
}

/** Sans plaque ni châssis : fiches Towsoft de cette marque / ce modèle, les plus proches de la date. */
async function chercherTowsoftModele(s: ReleveSaisie) {
  if (!process.env.TOWSOFT_PASS) return []
  const brand = String(s.brand || '').trim(), model = String(s.model || '').trim()
  if (brand.length < 2 && model.length < 2) return []
  const { searchTowsoftGlobal } = await import('@/lib/towsoft-client')
  const hits: any[] = [...await searchTowsoftGlobal('modele_marque' as any, [brand, model].filter(Boolean).join(' ')).catch(() => [])]
  if (!hits.length && model) hits.push(...await searchTowsoftGlobal('modele_marque' as any, model).catch(() => []))
  if (!hits.length && brand) hits.push(...await searchTowsoftGlobal('modele_marque' as any, brand).catch(() => []))
  const mm = mots(model)
  const f = hits.filter((h: any) => /saisie|police|fourri|abandon|accident|mal/i.test(`${h.type || ''} ${h.ticket || ''}`) && (!mm.length || mm.some(w => mots(`${h.brand} ${h.model}`).includes(w))))
  return [...new Map(f.map((h: any) => [h.towsoft_num, h])).values()].sort((a: any, b: any) => proche(s.date)(a.date_iso) - proche(s.date)(b.date_iso)).slice(0, 15).map(towsoftLigne)
}

async function chercherMails(plate: string, vin: string) {
  const termes = [...new Set([...(plate.length >= 5 ? lectures(plate) : []), ...(plate.length >= 7 ? lectures(plate).map(plateDash) : []), vin.length >= 8 ? vin : null].filter(Boolean) as string[])]
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
  const variantes = [...new Set(lectures(plate).flatMap(p => [p, plateDash(p)]))]
  const dom: any[] = [...Array(variantes.length - 1).fill('|'), ...variantes.map(v => ['license_plate', 'ilike', v])]
  const veh: any[] = await odooRpc('fleet.vehicle', 'search_read', [dom], { fields: ['id', 'license_plate', 'model_id', 'vin_sn', 'state_id'], context: { active_test: false }, limit: 5 })
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
