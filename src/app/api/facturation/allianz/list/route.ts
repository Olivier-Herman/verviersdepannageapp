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

  const byNumber = new Map<string, any>()
  const byPlate  = new Map<string, any>()
  if (numbers.length) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, source, status, vehicle_plate, destination_address, received_at')
      .in('external_id', numbers)
    for (const m of (data || [])) if (m.external_id) byNumber.set(String(m.external_id), m)
  }
  if (plates.length) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, external_id, dossier_number, source, status, vehicle_plate, destination_address, received_at')
      .not('vehicle_plate', 'is', null)
      .order('received_at', { ascending: false })
      .limit(500)
    for (const m of (data || [])) {
      const p = normPlate(m.vehicle_plate)
      if (p && !byPlate.has(p)) byPlate.set(p, m)
    }
  }

  const rows = content.map((a: any) => {
    const num = String(a.assignmentNumber)
    const vd = byNumber.get(num) || byPlate.get(normPlate(a.customerLicensePlate)) || null
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
    }
  })

  return NextResponse.json({ ok: true, count: rows.length, counts: listing.counts, rows })
}
