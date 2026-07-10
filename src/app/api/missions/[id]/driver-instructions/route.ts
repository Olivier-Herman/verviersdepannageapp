// src/app/api/missions/[id]/driver-instructions/route.ts
//
// GET  /api/missions/[id]/driver-instructions → liste des instructions chauffeur
//      (avec statut d'accusé acknowledged_at). Utilisé côté dispatch (édition) ET
//      côté chauffeur (pop-ups à l'acceptation).
// POST /api/missions/[id]/driver-instructions → crée une instruction { text }
//
// Table mission_driver_instructions. Modèle calqué sur billing-remarks.
// Olivier 2026-07-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email, role').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('mission_driver_instructions')
    .select(`
      id, text, created_at, acknowledged_at,
      author:users!created_by(id, name),
      ackuser:users!acknowledged_by(id, name)
    `)
    .eq('mission_id', params.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, instructions: data || [] })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const text = String(body?.text || '').trim()
  if (!text) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('mission_driver_instructions')
    .insert({ mission_id: params.id, text, created_by: actor.id })
    .select(`
      id, text, created_at, acknowledged_at,
      author:users!created_by(id, name),
      ackuser:users!acknowledged_by(id, name)
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, instruction: data })
}
