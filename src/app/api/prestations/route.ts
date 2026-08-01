// src/app/api/prestations/route.ts
//
// Module Prestations (superadmin).
// GET  ?period=AAAA-MM → { periods, period, sheets }
// POST { action:'import', from? } | { action:'save', id, days } | { action:'validate'|'unvalidate', id }

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { importPrestations }         from '@/lib/prestations/import'

export const dynamic    = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration = 300

const isSuper = (u: any) => u?.role === 'superadmin' || (u?.roles || []).includes('superadmin')

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: all } = await sb.from('prestation_sheets').select('period').order('period', { ascending: false })
  const periods = [...new Set((all || []).map((r: any) => r.period))]
  const period = req.nextUrl.searchParams.get('period') || periods[0] || null

  let sheets: any[] = []
  if (period) {
    const { data } = await sb.from('prestation_sheets').select('*').eq('period', period).order('worker_name')
    sheets = data || []
  }
  return NextResponse.json({ periods, period, sheets })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'import') {
    try {
      const results = await importPrestations(body.from || undefined)
      return NextResponse.json({ ok: true, results })
    } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }

  if (action === 'save') {
    const id = String(body.id || '')
    if (!id || typeof body.days !== 'object') return NextResponse.json({ error: 'id + days requis' }, { status: 400 })
    await sb.from('prestation_sheets').update({ days: body.days, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'validate' || action === 'unvalidate') {
    const v = action === 'validate'
    if (body.period) await sb.from('prestation_sheets').update({ validated: v, validated_at: v ? new Date().toISOString() : null }).eq('period', body.period)
    else if (body.id) await sb.from('prestation_sheets').update({ validated: v, validated_at: v ? new Date().toISOString() : null }).eq('id', body.id)
    else return NextResponse.json({ error: 'id ou period requis' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
