// src/app/api/superv/tgr/route.ts
//
// GET /api/superv/tgr?token=…&from=…&to=…
// Données de supervision TGR pour le responsable Touring — PUBLIC mais gaté par
// un JETON stable révocable (table tgr_supervisor_tokens). Lecture seule.
// Olivier 2026-07-11.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getTgrSupervisionData } from '@/lib/tgr/supervision'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const token = (searchParams.get('token') || '').trim()
  if (!token) return NextResponse.json({ error: 'Lien invalide' }, { status: 401 })

  const sb = createAdminClient()
  const { data: tok } = await sb.from('tgr_supervisor_tokens')
    .select('token, revoked').eq('token', token).maybeSingle()
  if (!tok || tok.revoked) {
    return NextResponse.json({ error: 'Lien invalide ou révoqué' }, { status: 403 })
  }

  const from = searchParams.get('from') || undefined
  const to   = searchParams.get('to')   || undefined
  const data = await getTgrSupervisionData(sb, { from, to })
  return NextResponse.json({ ok: true, ...data })
}
