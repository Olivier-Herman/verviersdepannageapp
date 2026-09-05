// src/app/api/capture/token/route.ts
//
// POST { mission_id, kind } → { token, url, expires_at }
//
// Crée un jeton de capture (15 min, usage unique) : la fiche affiche un QR
// qui ouvre /capture/[token] sur le téléphone du bureau. Les photos et la
// signature prises là-bas atterrissent directement sur la fiche.
// kind : 'id_card' | 'cmr' | 'informex' | 'signature'
// Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

const CAPTURE_KINDS = ['id_card', 'cmr', 'informex', 'signature'] as const
const TTL_MIN = 15

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere', 'facturation'] })
  if (!acc.ok || !acc.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { mission_id?: string; kind?: string }
  const missionId = String(body.mission_id || '').trim()
  const kind = String(body.kind || '')
  if (!missionId || !(CAPTURE_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'mission_id + kind requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: mission } = await sb.from('incoming_missions').select('id').eq('id', missionId).maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const expires = new Date(Date.now() + TTL_MIN * 60_000).toISOString()
  const { data: tok, error } = await sb.from('capture_tokens')
    .insert({ mission_id: missionId, kind, created_by: acc.id, expires_at: expires })
    .select('id').single()
  if (error || !tok) return NextResponse.json({ error: error?.message || 'Création jeton échouée' }, { status: 500 })

  const origin = new URL(req.url).origin
  return NextResponse.json({ token: tok.id, url: `${origin}/capture/${tok.id}`, expires_at: expires })
}
