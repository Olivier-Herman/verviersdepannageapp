// src/app/api/fourriere/domaine/export/route.ts
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD → export Excel (.xlsx) du gardiennage
// Domaine (État) sur la période. Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { computeVenteEpavesRegister } from '@/lib/domaine/vente-epaves-register'
import { buildVenteEpavesXlsxBuffer } from '@/lib/fourriere/domaine-xlsx'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin'].includes(role) || modules.includes('fourriere')
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const from = (searchParams.get('from') || '').slice(0, 10)
  const to   = (searchParams.get('to')   || '').slice(0, 10)
  if (!from || !to) return NextResponse.json({ error: 'Période (from/to) requise' }, { status: 400 })

  const sb = createAdminClient()
  const { groups, total, totalDays } = await computeVenteEpavesRegister(sb, from, to)
  const buffer = buildVenteEpavesXlsxBuffer(groups, total, totalDays)
  const fname = `gardiennage_domaine_${from}_${to}.xlsx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  })
}
