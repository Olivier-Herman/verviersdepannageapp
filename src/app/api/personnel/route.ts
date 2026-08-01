// src/app/api/personnel/route.ts
//
// Console RH : répertoire du personnel + index des fiches de paie (métadonnées).
// GET  → { personnel, users, periods, payslips }
// POST → { action:'update'|'delete'|'link', ... }
// Superadmin uniquement (phase de test). Olivier 2026-08-01.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { nameKey }                   from '@/lib/paie/process-batch'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const isSuper = (u: any) => u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const [{ data: personnel }, { data: users }, { data: slips }] = await Promise.all([
    sb.from('personnel').select('id, name, company_code, matricule, user_id, active').order('name'),
    sb.from('users').select('id, name').order('name'),
    sb.from('payslips').select('id, personnel_id, worker_name, period, company_code, pages').order('period', { ascending: false }),
  ])
  const uName = new Map((users || []).map((u: any) => [u.id, u.name]))
  const cntByPers = new Map<string, number>()
  const lastByPers = new Map<string, string>()
  for (const s of (slips || [])) {
    if (!s.personnel_id) continue
    cntByPers.set(s.personnel_id, (cntByPers.get(s.personnel_id) || 0) + 1)
    if (!lastByPers.has(s.personnel_id)) lastByPers.set(s.personnel_id, s.period)
  }
  const personnelOut = (personnel || []).map((p: any) => ({
    ...p, user_name: p.user_id ? (uName.get(p.user_id) || null) : null,
    payslip_count: cntByPers.get(p.id) || 0, last_period: lastByPers.get(p.id) || null,
  }))
  const periods = [...new Set((slips || []).map((s: any) => s.period).filter(Boolean))].sort().reverse()

  return NextResponse.json({ personnel: personnelOut, users: users || [], periods, payslips: slips || [] })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'update') {
    const id = String(body.id || ''); if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const patch: any = {}
    if (typeof body.name === 'string')      { patch.name = body.name.trim(); patch.name_key = nameKey(body.name) }
    if ('matricule' in body)                patch.matricule = String(body.matricule || '').trim() || null
    if ('company_code' in body)             patch.company_code = String(body.company_code || '').trim() || null
    if ('user_id' in body)                  patch.user_id = body.user_id || null
    if ('active' in body)                   patch.active = !!body.active
    await sb.from('personnel').update(patch).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    const id = String(body.id || '')
    // On détache les fiches (personnel_id → null) avant de supprimer la personne.
    await sb.from('payslips').update({ personnel_id: null }).eq('personnel_id', id)
    await sb.from('personnel').delete().eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'reassign') {
    // Réaffecte une fiche à une autre personne.
    const payslipId = String(body.payslip_id || ''), personnelId = body.personnel_id || null
    if (!payslipId) return NextResponse.json({ error: 'payslip_id requis' }, { status: 400 })
    await sb.from('payslips').update({ personnel_id: personnelId }).eq('id', payslipId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
