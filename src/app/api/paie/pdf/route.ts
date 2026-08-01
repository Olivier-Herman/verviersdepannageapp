// src/app/api/paie/pdf/route.ts
//
// Télécharge le PDF d'une fiche de paie. Accès : superadmin, OU le travailleur
// propriétaire (personnel lié à son compte) — prépare l'accès perso (Phase 2).

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  const isSuper = u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const sb = createAdminClient()

  const { data: slip } = await sb.from('payslips')
    .select('pdf_b64, period, company_code, worker_name, personnel_id').eq('id', id).maybeSingle()
  if (!slip || !slip.pdf_b64) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  // Droit : superadmin, ou propriétaire de la fiche.
  if (!isSuper) {
    if (!slip.personnel_id) return NextResponse.json({ error: 'Interdit' }, { status: 403 })
    const { data: pers } = await sb.from('personnel').select('user_id').eq('id', slip.personnel_id).maybeSingle()
    if (!pers || pers.user_id !== u.id) return NextResponse.json({ error: 'Interdit' }, { status: 403 })
  }

  const bytes = Buffer.from(slip.pdf_b64, 'base64')
  const fname = `fiche-paie-${slip.company_code || ''}-${slip.period || ''}-${(slip.worker_name || '').replace(/[^A-Za-z0-9]+/g, '_')}.pdf`
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  })
}
