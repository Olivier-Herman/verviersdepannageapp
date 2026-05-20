// src/app/api/admin/kaze/import/[jobId]/route.ts
//
// Import manuel d un Job Kaze dans incoming_missions.
//
// Usage :
//   POST /api/admin/kaze/import/<kaze_job_id>
//
// Acces : admin / superadmin uniquement.
//
// Sert pour :
//   1) Tester le mapping sur les 3 missions deja recues (sans attendre que
//      IMA reactive la diffusion Kaze).
//   2) Replay manuel d une mission qui aurait rate (webhook perdu, etc.).

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { importKazeJob }             from '@/lib/kaze/import'

export const dynamic     = 'force-dynamic'
export const runtime     = 'nodejs'
export const maxDuration = 30

export async function POST(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Accès réservé admin' }, { status: 403 })
  }

  const jobId = params.jobId
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'jobId UUID requis' }, { status: 400 })
  }

  try {
    const result = await importKazeJob(jobId)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message, stack: e.stack?.split('\n').slice(0, 5) },
      { status: 500 },
    )
  }
}

// GET pour preview : retourne le job Kaze + mapping SANS toucher a la BDD
export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Accès réservé admin' }, { status: 403 })
  }

  const jobId = params.jobId
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'jobId UUID requis' }, { status: 400 })
  }

  try {
    const { getJob }              = await import('@/lib/kaze/client')
    const { mapKazeJobToMission } = await import('@/lib/kaze/mapper')
    const { lookupPartner }       = await import('@/lib/odoo-quote')

    const job    = await getJob(jobId)
    const mapped = mapKazeJobToMission(job)

    let partner = null
    if (mapped.billing_entity_name || mapped.billing_vat) {
      partner = await lookupPartner({
        vat:  mapped.billing_vat,
        name: mapped.billing_entity_name,
      })
    }

    return NextResponse.json({
      preview: true,
      mapped,
      odoo_partner: partner,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message, stack: e.stack?.split('\n').slice(0, 5) },
      { status: 500 },
    )
  }
}
