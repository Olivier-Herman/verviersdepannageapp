// src/app/api/client-capture/route.ts
//
// POST { mission_id?, plate? } → { token, url, expires_at }
// Crée un jeton « QR client » (30 min) : le chauffeur affiche le QR, le client
// l'ouvre sur son téléphone (/c/[token]) et remplit ses coordonnées lui-même,
// dans sa langue. Rien ne bloque le chauffeur : il continue son formulaire, et
// les champs se remplissent quand le client valide. Olivier 19/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
const TTL_MIN = 30

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { mission_id?: string; plate?: string }
  const missionId = String(body.mission_id || '').trim() || null
  const plate = String(body.plate || '').trim().toUpperCase() || null
  const sb = createAdminClient()
  let mission_id: string | null = null
  if (missionId && /^[0-9a-f-]{36}$/i.test(missionId)) {
    const { data: m } = await sb.from('incoming_missions').select('id').eq('id', missionId).maybeSingle()
    mission_id = m?.id || null
  }
  const expires = new Date(Date.now() + TTL_MIN * 60_000).toISOString()
  const { data: row, error } = await sb.from('client_capture')
    .insert({ mission_id, plate, created_by: u.id, expires_at: expires })
    .select('id').single()
  if (error || !row) return NextResponse.json({ error: error?.message || 'Création du lien impossible' }, { status: 500 })
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  return NextResponse.json({ token: row.id, url: `${origin}/c/${row.id}`, expires_at: expires })
}
