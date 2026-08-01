// src/app/api/personnel/[id]/route.ts
//
// Fiche employé : détail + ses fiches de paie + solde congés. Superadmin.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const isSuper = (u: any) => u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: person } = await sb.from('personnel').select('*').eq('id', params.id).maybeSingle()
  if (!person) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  const [{ data: slips }, { data: users }] = await Promise.all([
    sb.from('payslips').select('id, period, company_code, type, label, pages, montant_net, vac_available, vac_used, vac_total')
      .eq('personnel_id', params.id).order('period', { ascending: false }),
    sb.from('users').select('id, name').order('name'),
  ])
  const vsrc = (slips || []).find((s: any) => s.vac_available != null || s.vac_total != null)
  const vacation = vsrc ? { total: vsrc.vac_total, used: vsrc.vac_used, available: vsrc.vac_available, period: vsrc.period } : null
  const userName = person.user_id ? ((users || []).find((u: any) => u.id === person.user_id)?.name || null) : null

  return NextResponse.json({ person, payslips: slips || [], vacation, users: users || [], userName })
}
