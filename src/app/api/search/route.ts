// src/app/api/search/route.ts
//
// Recherche globale (Cmd+K) - cherche dans missions, encaissements, avances,
// véhicules et utilisateurs. Resultats limités par categorie + filtres
// permissions automatiques.
//
// Normalisation plaque : "1-ABC-123", "1Abc123", "1abc123" matchent tous.
// VIN/plaque : substring (ILIKE %x%).
// Date : si query est un format date (12/05, 12/05/2026, 2026-05-12),
// filtre aussi intervention_date.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { FOURRIERE_ZONE_BY_ID } from '@/lib/fourriere'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

const ODOO_URL     = process.env.ODOO_URL || ''
const ODOO_DB      = process.env.ODOO_DB || ''
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY || ''

async function odooCall<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: {
        service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs]
      }
    })
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

const PER_CATEGORY_LIMIT_DEFAULT = 8
const PER_CATEGORY_LIMIT_FULL    = 30

interface SearchResult {
  category:     'mission' | 'encaissement' | 'avance' | 'invoice' | 'driver' | 'user' | 'vehicle'
  id:           string
  title:        string
  subtitle:     string
  meta:         string                 // info contextuelle (date, statut, source...)
  href:         string                 // navigation principale (Consulter)
  pdfUrl?:      string                 // si dispo : telechargement PDF direct
}

/** Normalise une plaque pour comparaison : retire séparateurs, MAJUSCULES. */
function normalizePlate(s: string): string {
  return s.replace(/[-.\s_/]/g, '').toUpperCase()
}

/** Détecte si la query ressemble à une date et retourne le range ISO début/fin. */
function tryParseDate(q: string): { from: string; to: string } | null {
  const trimmed = q.trim()

  // YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const [, y, mo, d] = m
    const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    return { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }
  }
  // DD/MM/YYYY
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    return { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }
  }
  // DD/MM ou DD-MM (année courante)
  m = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})$/)
  if (m) {
    const [, d, mo] = m
    const y = new Date().getFullYear()
    const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
    return { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` }
  }
  return null
}

function fmtDateShort(d: string | null | undefined): string {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return '' }
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Recherche globale : accessible a TOUS les utilisateurs authentifies sans
  // filtre par role (decide explicitement le 2026-05-13). Permet a tout le
  // monde de retrouver une fiche par plaque/VIN/client/etc.

  const { searchParams } = new URL(req.url)
  const qRaw = (searchParams.get('q') || '').trim()
  if (qRaw.length < 2) return NextResponse.json({ results: [], categories: {} })

  // Filtre par categories : ?cats=mission,invoice  (vide = toutes)
  const catsParam = (searchParams.get('cats') || '').trim()
  const wantedCats = catsParam ? new Set(catsParam.split(',').map(c => c.trim()).filter(Boolean)) : null
  const wants = (cat: string) => !wantedCats || wantedCats.has(cat)

  // Mode "full" : utilise par la page /recherche pour ratisser plus large
  const fullMode = searchParams.get('full') === '1'
  const PER_CATEGORY_LIMIT = fullMode ? PER_CATEGORY_LIMIT_FULL : PER_CATEGORY_LIMIT_DEFAULT

  const q                = qRaw                                  // version brute
  const qLike            = `%${q}%`
  const qPlate           = normalizePlate(q)                     // pour plaques
  const dateRange        = tryParseDate(q)

  const sb = createAdminClient()
  const out: SearchResult[] = []

  // ── Missions ───────────────────────────────────────────────
  if (wants('mission')) {
    const missionsQuery = sb
    .from('incoming_missions')
    .select('id, external_id, dossier_number, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, client_name, client_phone, incident_address, destination_address, source, status, intervention_date, received_at, assigned_to, archived_at, no_charge_at, no_charge_reason, invoice_method, invoice_number')
    .or([
      `external_id.ilike.${qLike}`,
      `dossier_number.ilike.${qLike}`,
      `client_name.ilike.${qLike}`,
      `client_phone.ilike.${qLike}`,
      `incident_address.ilike.${qLike}`,
      `destination_address.ilike.${qLike}`,
      `vehicle_vin.ilike.${qLike}`,
      `vehicle_brand.ilike.${qLike}`,
      `vehicle_model.ilike.${qLike}`,
    ].join(','))
    .order('received_at', { ascending: false })
    .limit(PER_CATEGORY_LIMIT * 3)

  // Plaque normalisee : second pass (Supabase ne permet pas REPLACE dans ILIKE)
  let missionsByPlate: any[] = []
  if (qPlate.length >= 2) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, external_id, dossier_number, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, client_name, client_phone, incident_address, destination_address, source, status, intervention_date, received_at, assigned_to, archived_at, no_charge_at, no_charge_reason, invoice_method, invoice_number')
      .not('vehicle_plate', 'is', null)
      .order('received_at', { ascending: false })
      .limit(200)
    missionsByPlate = (data || []).filter(m =>
      normalizePlate(m.vehicle_plate || '').includes(qPlate)
    )
  }

  let missionsByDate: any[] = []
  if (dateRange) {
    const { data } = await sb
      .from('incoming_missions')
      .select('id, external_id, dossier_number, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, client_name, client_phone, incident_address, destination_address, source, status, intervention_date, received_at, assigned_to, archived_at, no_charge_at, no_charge_reason, invoice_method, invoice_number')
      .gte('intervention_date', dateRange.from)
      .lte('intervention_date', dateRange.to)
      .order('intervention_date', { ascending: false })
      .limit(PER_CATEGORY_LIMIT * 2)
    missionsByDate = data || []
  }

  const { data: missionsBase } = await missionsQuery
  // Dedup par id
  const missionsMap = new Map<string, any>()
  for (const m of [...(missionsBase || []), ...missionsByPlate, ...missionsByDate]) {
    if (!missionsMap.has(m.id)) missionsMap.set(m.id, m)
  }
  const missions = [...missionsMap.values()].slice(0, PER_CATEGORY_LIMIT)

  for (const m of missions) {
    const plate = m.vehicle_plate || '—'
    const veh   = [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')
    const archivedPrefix = m.archived_at ? '🗄 ' : m.no_charge_at ? '🚫 ' : ''
    const statusExtras: string[] = []
    if (m.archived_at)   statusExtras.push('🗄 Archivée')
    if (m.no_charge_at)  statusExtras.push(`🚫 Sans frais${m.no_charge_reason ? ' — ' + m.no_charge_reason : ''}`)
    else if (m.invoice_method === 'auto')    statusExtras.push('⚡ Autofacturée')
    else if (m.invoice_number)               statusExtras.push(`🧾 ${m.invoice_number}`)
    const extrasStr = statusExtras.length ? ' · ' + statusExtras.join(' · ') : ''
    out.push({
      category: 'mission',
      id:       m.id,
      title:    `${archivedPrefix}${m.external_id || m.dossier_number || m.id.slice(0, 8)} · ${plate}`,
      subtitle: [m.client_name, veh, m.incident_address].filter(Boolean).join(' · '),
      meta:     `${m.source || ''} · ${m.status}${extrasStr} · ${fmtDateShort(m.intervention_date || m.received_at)}`.trim(),
      href:     `/dispatch/${m.id}`,
    })
  }
  } // /wants('mission')

  // ── Encaissements (interventions) ──────────────────────────
  if (wants('encaissement')) {
  const interventionsQuery = sb
    .from('interventions')
    .select('id, plate, brand_text, model_text, client_name, payment_mode, amount, notes, created_at, driver_id, mission_id')
    .or([
      `client_name.ilike.${qLike}`,
      `brand_text.ilike.${qLike}`,
      `model_text.ilike.${qLike}`,
      `notes.ilike.${qLike}`,
    ].join(','))
    .order('created_at', { ascending: false })
    .limit(PER_CATEGORY_LIMIT * 2)

  const { data: interventionsBase } = await interventionsQuery

  let interventionsByPlate: any[] = []
  if (qPlate.length >= 2) {
    const { data } = await sb
      .from('interventions')
      .select('id, plate, brand_text, model_text, client_name, payment_mode, amount, notes, created_at, driver_id, mission_id')
      .not('plate', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200)
    interventionsByPlate = (data || []).filter(i =>
      normalizePlate(i.plate || '').includes(qPlate)
    )
  }

  const intervMap = new Map<string, any>()
  for (const i of [...(interventionsBase || []), ...interventionsByPlate]) {
    if (!intervMap.has(i.id)) intervMap.set(i.id, i)
  }
  const interventions = [...intervMap.values()].slice(0, PER_CATEGORY_LIMIT)

  for (const i of interventions) {
    out.push({
      category: 'encaissement',
      id:       i.id,
      title:    `${Number(i.amount || 0).toFixed(2)} € · ${i.plate || '—'}`,
      subtitle: [i.client_name, [i.brand_text, i.model_text].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      meta:     `${i.payment_mode || ''} · ${fmtDateShort(i.created_at)}`.trim(),
      href:     i.mission_id ? `/dispatch/${i.mission_id}` : '/encaissements',
    })
  }
  } // /wants('encaissement')

  // ── Avances de fonds ───────────────────────────────────────
  if (wants('avance')) {
    const { data: avancesBase } = await sb
      .from('avance_fonds')
      .select('id, plate, client_name, amount, status, created_at, notes')
      .or([
        `client_name.ilike.${qLike}`,
        `notes.ilike.${qLike}`,
      ].join(','))
      .order('created_at', { ascending: false })
      .limit(PER_CATEGORY_LIMIT)

    let avancesByPlate: any[] = []
    if (qPlate.length >= 2) {
      const { data } = await sb
        .from('avance_fonds')
        .select('id, plate, client_name, amount, status, created_at, notes')
        .not('plate', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200)
      avancesByPlate = (data || []).filter(a =>
        normalizePlate(a.plate || '').includes(qPlate)
      )
    }
    const avMap = new Map<string, any>()
    for (const a of [...(avancesBase || []), ...avancesByPlate]) {
      if (!avMap.has(a.id)) avMap.set(a.id, a)
    }
    for (const a of [...avMap.values()].slice(0, PER_CATEGORY_LIMIT)) {
      out.push({
        category: 'avance',
        id:       a.id,
        title:    `${Number(a.amount || 0).toFixed(2)} € · ${a.plate || '—'}`,
        subtitle: a.client_name || '',
        meta:     `${a.status || ''} · ${fmtDateShort(a.created_at)}`.trim(),
        href:     '/avance-fonds',
      })
    }
  } // /wants('avance')

  // ── Dépanneurs / chauffeurs ────────────────────────────────
  if (wants('driver')) {
    const { data: drivers } = await sb
      .from('users')
      .select('id, name, email, role, active')
      .ilike('name', qLike)
      .eq('role', 'driver')
      .limit(PER_CATEGORY_LIMIT)
    for (const d of drivers || []) {
      out.push({
        category: 'driver',
        id:       d.id,
        title:    d.name || d.email,
        subtitle: d.email,
        meta:     d.active ? 'actif' : 'inactif',
        href:     `/admin/users#${d.id}`,
      })
    }
  }

  // ── Utilisateurs (autres rôles) ────────────────────────────
  if (wants('user')) {
    const { data: users } = await sb
      .from('users')
      .select('id, name, email, role, active')
      .or(`name.ilike.${qLike},email.ilike.${qLike}`)
      .neq('role', 'driver')
      .limit(PER_CATEGORY_LIMIT)
    for (const u of users || []) {
      out.push({
        category: 'user',
        id:       u.id,
        title:    u.name || u.email,
        subtitle: `${u.email} · ${u.role}`,
        meta:     u.active ? 'actif' : 'inactif',
        href:     `/admin/users#${u.id}`,
      })
    }
  }

  // ── Factures Odoo ──────────────────────────────────────────
  // Cherche dans account.move par numero OU nom partenaire. Best effort
  // (Odoo HS → on log et on continue sans bloquer le reste).
  if (wants('invoice') && q.length >= 3 && ODOO_URL && ODOO_API_KEY) {
    try {
      const invoices = await odooCall<any[]>('account.move', 'search_read', [
        [
          '&',
          ['state', '!=', 'cancel'],
          ['move_type', 'in', ['out_invoice', 'out_refund']],
          '|',
          ['name', 'ilike', q],
          ['partner_id.name', 'ilike', q],
        ],
      ], {
        fields: ['id', 'name', 'partner_id', 'amount_total', 'invoice_date', 'state', 'move_type'],
        limit:  PER_CATEGORY_LIMIT,
        order:  'invoice_date desc',
      })

      for (const inv of invoices || []) {
        const partnerName = inv.partner_id?.[1] || '—'
        const isRefund    = inv.move_type === 'out_refund'
        const stateLabel  = inv.state === 'posted' ? 'comptabilisée' : inv.state === 'draft' ? 'brouillon' : inv.state
        const reportName  = isRefund ? 'account.report_invoice_with_payments' : 'account.report_invoice'
        out.push({
          category: 'invoice',
          id:       String(inv.id),
          title:    `${isRefund ? '↩ ' : ''}${inv.name || '—'} · ${partnerName}`,
          subtitle: `${Number(inv.amount_total || 0).toFixed(2)} €`,
          meta:     `${fmtDateShort(inv.invoice_date)} · ${stateLabel}`,
          href:     `${ODOO_URL}/web#id=${inv.id}&model=account.move&view_type=form`,
          pdfUrl:   `${ODOO_URL}/report/pdf/${reportName}/${inv.id}`,
        })
      }
    } catch (e: any) {
      console.error('[search] Odoo invoices fail (non bloquant):', e.message)
    }
  }

  // ── Véhicules Odoo ─────────────────────────────────────────
  // Cherche par plaque normalisee OU VIN (substring). Limite la latence si Odoo HS.
  if (wants('vehicle') && q.length >= 3 && ODOO_URL && ODOO_API_KEY) {
    try {
      const odooQ = qPlate.length >= 3 ? qPlate : q.toUpperCase()
      const domain = ['|',
        ['license_plate', 'ilike', odooQ],
        ['vin_sn',        'ilike', odooQ],
      ]
      const vehicles = await odooCall<any[]>('fleet.vehicle', 'search_read', [domain], {
        fields: ['id', 'license_plate', 'vin_sn', 'brand_id', 'model_id', 'state_id'],
        limit:  PER_CATEGORY_LIMIT,
        order:  'license_plate asc',
      })

      const modelIds = Array.from(new Set(
        (vehicles || []).map((v: any) => v.model_id?.[0]).filter((x: any) => typeof x === 'number')
      ))
      const modelMap = new Map<number, string>()
      if (modelIds.length > 0) {
        const models = await odooCall<any[]>('fleet.vehicle.model', 'read', [modelIds], { fields: ['id', 'name'] })
        for (const m of models) modelMap.set(m.id, m.name)
      }

      for (const v of vehicles || []) {
        const brand = v.brand_id?.[1] || ''
        const model = v.model_id?.[0] ? (modelMap.get(v.model_id[0]) || v.model_id[1] || '') : ''
        const stateId = v.state_id?.[0]
        const fourriereZone = stateId ? FOURRIERE_ZONE_BY_ID[stateId] : null
        const fourrierePrefix = fourriereZone ? `🚓 ${fourriereZone.label} · ` : ''
        out.push({
          category: 'vehicle',
          id:       String(v.id),
          title:    `${fourrierePrefix}${v.license_plate || '—'} · ${brand} ${model}`.trim(),
          subtitle: v.vin_sn ? `VIN ${v.vin_sn}` : '',
          meta:     fourriereZone
            ? `EN FOURRIÈRE · ${fourriereZone.full_name}`
            : `Fiche Odoo (factures, ticket assistance, Towsoft)`,
          href:     `${ODOO_URL}/web#id=${v.id}&model=fleet.vehicle&view_type=form`,
        })
      }
    } catch (e: any) {
      console.error('[search] Odoo vehicles fail (non bloquant):', e.message)
    }
  }

  // ── Groupement par catégorie pour l'UI ─────────────────────
  const categories: Record<string, SearchResult[]> = {}
  for (const r of out) {
    if (!categories[r.category]) categories[r.category] = []
    categories[r.category].push(r)
  }

  return NextResponse.json({
    query: qRaw,
    total: out.length,
    categories,
  })
}
