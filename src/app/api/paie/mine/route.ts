// src/app/api/paie/mine/route.ts
//
// Fiches de paie de l'utilisateur connecté (accès perso). Résout la ou les
// fiche(s) « personnel » liée(s) à son compte, puis ses bulletins.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: persons } = await sb.from('personnel').select('id, name, company_code').eq('user_id', u.id)
  const persIds = (persons || []).map((p: any) => p.id)
  if (!persIds.length) return NextResponse.json({ payslips: [], linked: false })

  const { data: slips } = await sb.from('payslips')
    .select('id, period, company_code, worker_name, type, label, pages')
    .in('personnel_id', persIds).order('period', { ascending: false })

  return NextResponse.json({ payslips: slips || [], linked: true, name: persons?.[0]?.name || u.name })
}
