// src/app/api/facturation/allianz/list/route.ts
//
// GET /api/facturation/allianz/list
//
// Olivier 2026-06-12 : liste les missions Allianz (Hexalite) à clôturer
// (onglet TO_ASSIGN) et les rapproche de VD Soft (par n° mission Allianz =
// external_id, ou par plaque). Sert le bouton "Clôture Allianz".
//
// Acces : admin / superadmin / module facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { getValidAllianzToken, listAllianzToAssign } from '@/lib/allianz/closure'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function checkAccess(session: any): boolean {
  if (!session) return false
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
}

function normPlate(s: string): string {
  return (s || '').replace(/[-.\s_/]/g, '').toUpperCase()
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!checkAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let token: string
  try { token = await getValidAllianzToken() }
  catch (e: any) { return NextResponse.json({ error: e.message, needsAuth: true }, { status: 503 }) }

  let listing
  try { listing = await listAllianzToAssign(token) }
  catch (e: any) { return NextResponse.json({ error: `Listing Allianz KO : ${e.message}` }, { status: 502 }) }

  const content = listing.content || []
  const sb = createAdminClient()

  // Rapprochement VD Soft : par external_id = assignmentNumber, sinon par plaque
  const numbers = content.map((a: any) => String(a.assignmentNumber)).filter(Boolean)
  const plates  = Array.from(new Set(content.map((a: any) => normPlate(a.customerLicensePlate)).filter(Boolean)))

  // Olivier 2026-06-12 : on ne tient pas compte des missions annulées.
  const byNumber = new Map<string, any>()
  const byPlate  = new Map<string, any>()
  if (numbers.length) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, source, status, vehicle_plate, destination_address, received_at')
      .in('external_id', numbers)
      .neq('status', 'cancelled')
    for (const m of (data || [])) if (m.external_id) byNumber.set(String(m.external_id), m)
  }
  if (plates.length) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, source, status, vehicle_plate, destination_address, received_at')
      .not('vehicle_plate', 'is', null)
      .neq('status', 'cancelled')
      .order('received_at', { ascending: false })
      .limit(500)
    for (const m of (data || [])) {
      const p = normPlate(m.vehicle_plate)
      if (p && !byPlate.has(p)) byPlate.set(p, m)
    }
  }

  // Fallback TowSoft (par plaque) pour les missions absentes de VD Soft.
  // Best-effort : si TowSoft KO, on continue sans (la ligne reste "non rapprochée").
  const towByPlate = new Map<string, any>()
  const unmatchedPlates = Array.from(new Set(
    content
      .filter((a: any) => {
        const num = String(a.assignmentNumber)
        return !byNumber.get(num) && !byPlate.get(normPlate(a.customerLicensePlate))
      })
      .map((a: any) => (a.customerLicensePlate || '').trim())
      .filter(Boolean)
  ))
  if (unmatchedPlates.length) {
    try {
      const { searchTowsoftGlobal } = await import('@/lib/towsoft-client')
      for (const plate of unmatchedPlates) {
        const hits = await searchTowsoftGlobal('immatriculation', plate)
        // exclut les annulées (statut contient "annul")
        const hit = hits.find(h => !/annul/i.test(h.statut || '')) || null
        if (hit) towByPlate.set(normPlate(plate), hit)
      }
    } catch (e: any) {
      console.warn('[allianz/list] TowSoft fallback KO:', e.message)
    }
  }

  const rows = content.map((a: any) => {
    const num = String(a.assignmentNumber)
    const np = normPlate(a.customerLicensePlate)
    const vd = byNumber.get(num) || byPlate.get(np) || null
    const tw = !vd ? (towByPlate.get(np) || null) : null
    const addr = a.breakdownAddress || {}
    return {
      assignmentId:     a.assignmentId,
      caseId:           a.assistanceCaseId,
      assignmentNumber: num,
      plate:            a.customerLicensePlate || null,
      brand:            a.customerVehicleBrand || null,
      model:            a.customerVehicleModel || null,
      product:          a.productName || null,
      policyNumber:     a.policyNumber || null,
      serviceType:      a.initialServiceType || null,
      dispatchTime:     a.estimatedDispatchTime || null,
      breakdown:        addr,
      vdsoft: vd ? {
        id:                 vd.id,
        mission_number:     vd.mission_number,
        external_id:        vd.external_id,
        source:             vd.source,
        status:             vd.status,
        destination_address: vd.destination_address,
        received_at:        vd.received_at,
      } : null,
      towsoft: tw ? {
        towsoft_num:  tw.towsoft_num,
        dossier:      tw.dossier,
        statut:       tw.statut,
        type:         tw.type,
        destination:  tw.destination,
        date_iso:     tw.date_iso,
        fiche_url:    tw.fiche_url,
      } : null,
    }
  })

  return NextResponse.json({ ok: true, count: rows.length, counts: listing.counts, rows })
}
