// src/app/api/facturation/search/route.ts
//
// POST /api/facturation/search { searchType, key }
//
// Recherche unifiee pour la facturation (Olivier 2026-06-12) :
//   - VD Soft  : table incoming_missions (notre base)
//   - TowSoft  : recherche globale live via searchTowsoftGlobal (1 login partage)
//
// Retourne une liste fusionnee taguee par source. Si plusieurs lignes matchent,
// l UI les presente et l utilisateur choisit celle a facturer.
//
// searchType (aligne sur les radios TowSoft) :
//   id_appel | num_facture | num_dossier | immatriculation | niv | modele_marque
//
// Acces : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import {
  searchTowsoftGlobal, TOWSOFT_SEARCH_TYPES, type TowsoftSearchType,
} from '@/lib/towsoft-client'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function normalizePlate(s: string): string {
  return (s || '').replace(/[-.\s_/]/g, '').toUpperCase()
}

function checkAccess(session: any): boolean {
  if (!session) return false
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

interface UnifiedResult {
  source:        'vdsoft' | 'towsoft'
  id:            string          // uuid VD Soft ou towsoft_num
  ref:           string          // affichage principal (# mission / dossier)
  towsoft_num:   string | null
  vdsoft_id:     string | null
  status:        string | null
  ticket:        string | null
  invoice_number: string | null
  dossier:       string | null
  type:          string | null
  date_iso:      string | null
  plate:         string | null
  vin:           string | null
  brand:         string | null
  model:         string | null
  client:        string | null
  lieu:          string | null
  destination:   string | null
  remarks:       string | null
  montant_ttc:   number | null
  fiche_url:     string | null   // lien TowSoft si applicable
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const searchType = String(body.searchType || '') as TowsoftSearchType
  const key        = String(body.key || '').trim()

  if (!key || key.length < 2) {
    return NextResponse.json({ error: 'Terme de recherche trop court (min 2 caractères)' }, { status: 400 })
  }
  if (!(searchType in TOWSOFT_SEARCH_TYPES)) {
    return NextResponse.json({ error: `Type de recherche invalide : ${searchType}` }, { status: 400 })
  }

  const sb = createAdminClient()
  const results: UnifiedResult[] = []
  const errors: string[] = []

  // ── 1. Recherche VD Soft (incoming_missions) ──────────────────────────
  try {
    const cols = `id, mission_number, external_id, dossier_number, source, status,
      vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model,
      client_name, billed_to_name, incident_address, destination_address,
      intervention_date, received_at, invoice_number, amount_to_collect`

    let vdRows: any[] = []
    const like = `%${key}%`

    if (searchType === 'immatriculation') {
      // Recherche plaque normalisee (Supabase ne normalise pas dans ILIKE)
      const { data } = await sb.from('incoming_missions')
        .select(cols).not('vehicle_plate', 'is', null)
        .order('received_at', { ascending: false }).limit(300)
      const qp = normalizePlate(key)
      vdRows = (data || []).filter(m => normalizePlate(m.vehicle_plate || '').includes(qp))
    } else if (searchType === 'niv') {
      const { data } = await sb.from('incoming_missions').select(cols).ilike('vehicle_vin', like).limit(50)
      vdRows = data || []
    } else if (searchType === 'num_dossier') {
      const { data } = await sb.from('incoming_missions').select(cols)
        .or(`dossier_number.ilike.${like},external_id.ilike.${like}`).limit(50)
      vdRows = data || []
    } else if (searchType === 'num_facture') {
      const { data } = await sb.from('incoming_missions').select(cols).ilike('invoice_number', like).limit(50)
      vdRows = data || []
    } else if (searchType === 'id_appel') {
      // # de mission : VD Soft mission_number (numerique) si la cle est numerique
      if (/^\d+$/.test(key)) {
        const { data } = await sb.from('incoming_missions').select(cols).eq('mission_number', Number(key)).limit(50)
        vdRows = data || []
      }
    } else if (searchType === 'modele_marque') {
      const { data } = await sb.from('incoming_missions').select(cols)
        .or(`vehicle_brand.ilike.${like},vehicle_model.ilike.${like}`).limit(50)
      vdRows = data || []
    }
    // client_nom / origine_destination / montant / remarques : TowSoft uniquement
    // (la recherche VD Soft globale existe deja dans /api/search pour ces cas).

    // Olivier 2026-07-04 : non-superadmin → pas de missions 'unknown' (placeholder),
    // et 'cancelled' masquées sauf case cochée (body.showCancelled). Superadmin voit tout.
    const isSuperadmin  = (session!.user as any)?.role === 'superadmin'
    const showCancelled = body.showCancelled === true || body.showCancelled === '1'
    if (!isSuperadmin) {
      vdRows = vdRows.filter(m => m.source !== 'unknown' && (showCancelled || m.status !== 'cancelled'))
    }

    for (const m of vdRows) {
      results.push({
        source:        'vdsoft',
        id:            m.id,
        ref:           m.mission_number != null ? `#${m.mission_number}` : (m.external_id || m.dossier_number || m.id.slice(0, 8)),
        towsoft_num:   null,
        vdsoft_id:     m.id,
        status:        m.status || null,
        ticket:        null,
        invoice_number: m.invoice_number || null,
        dossier:       m.dossier_number || m.external_id || null,
        type:          m.source || null,
        date_iso:      m.intervention_date || m.received_at || null,
        plate:         m.vehicle_plate || null,
        vin:           m.vehicle_vin || null,
        brand:         m.vehicle_brand || null,
        model:         m.vehicle_model || null,
        client:        m.client_name || m.billed_to_name || null,
        lieu:          m.incident_address || null,
        destination:   m.destination_address || null,
        remarks:       null,
        montant_ttc:   m.amount_to_collect != null ? Number(m.amount_to_collect) : null,
        fiche_url:     null,
      })
    }
  } catch (e: any) {
    console.error('[facturation/search] VD Soft KO:', e.message)
    errors.push(`VD Soft : ${e.message}`)
  }

  // ── 2. Recherche TowSoft (live) ───────────────────────────────────────
  try {
    const tw = await searchTowsoftGlobal(searchType, key)
    for (const t of tw) {
      results.push({
        source:        'towsoft',
        id:            t.towsoft_num,
        ref:           `#${t.towsoft_num}`,
        towsoft_num:   t.towsoft_num,
        vdsoft_id:     null,
        status:        t.statut,
        ticket:        t.ticket,
        invoice_number: t.num_facture,
        dossier:       t.dossier,
        type:          t.type,
        date_iso:      t.date_iso,
        plate:         t.plate,
        vin:           t.vin,
        brand:         t.brand,
        model:         t.model,
        client:        t.client,
        lieu:          t.lieu_intervention,
        destination:   t.destination,
        remarks:       t.remarks,
        montant_ttc:   t.montant_ttc,
        fiche_url:     t.fiche_url,
      })
    }
  } catch (e: any) {
    console.error('[facturation/search] TowSoft KO:', e.message)
    errors.push(`TowSoft : ${e.message}`)
  }

  return NextResponse.json({
    ok:      true,
    count:   results.length,
    results,
    errors,           // non bloquant : une source peut echouer sans casser l autre
  })
}
