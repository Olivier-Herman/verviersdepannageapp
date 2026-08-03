// src/app/api/profil/verify-code/route.ts
//
// Vérifie que le code à 4 chiffres saisi correspond bien à CELUI de l'utilisateur
// connecté (contrôle « te souviens-tu de ton code ? »). Ne modifie rien.
// Olivier 2026-08-03.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt                from 'bcryptjs'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { pin } = await req.json().catch(() => ({}))
  if (!pin || !/^\d{4}$/.test(String(pin))) {
    return NextResponse.json({ error: 'Code à 4 chiffres requis' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('verify_pin_hash').eq('email', session.user.email).single()
  if (!me?.verify_pin_hash) return NextResponse.json({ ok: false, no_pin: true })

  const ok = await bcrypt.compare(String(pin), me.verify_pin_hash)
  return NextResponse.json({ ok })
}
