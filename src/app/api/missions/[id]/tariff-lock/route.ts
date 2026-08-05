// src/app/api/missions/[id]/tariff-lock/route.ts
//
// Déverrouillage / verrouillage du tarif d'une fiche. SUPERADMIN uniquement,
// déverrouillage validé par le CODE (PIN) du superadmin.
//   POST { action: 'unlock' | 'lock', pin? }

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u || u.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = body?.action === 'lock' ? 'lock' : 'unlock'
  const sb = createAdminClient()

  if (action === 'unlock') {
    const { data: actor } = await sb.from('users').select('id, verify_pin_hash').eq('email', u.email).maybeSingle()
    if (!actor?.verify_pin_hash) {
      return NextResponse.json({ error: 'Aucun code défini sur ton compte. Définis-le dans ton profil.' }, { status: 400 })
    }
    const ok = await bcrypt.compare(String(body?.pin || ''), actor.verify_pin_hash)
    if (!ok) return NextResponse.json({ error: 'Code incorrect' }, { status: 401 })
  }

  const { error } = await sb.from('incoming_missions')
    .update({ tariff_locked: action === 'lock' }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id, actor_id: (u as any).id || null,
    action: action === 'lock' ? 'tariff_locked' : 'tariff_unlocked',
    notes: action === 'lock' ? 'Tarif verrouillé (manuel)' : 'Tarif déverrouillé (superadmin + code)',
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, tariff_locked: action === 'lock' })
}
