// src/app/api/admin/notify-pin-setup/route.ts
//
// Envoie la notif « définis ton code de validation » (pin_setup_reminder).
//   POST { target: 'me' }  → uniquement l'appelant (test)
//   POST { target: 'all' } → tous les users actifs SANS code (verify_pin_hash null)
// Superadmin uniquement. Olivier 2026-08-03.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification, sendNotificationToMany } from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

const PAYLOAD = {
  title:      '🔐 Définis ton code de validation',
  body:       'Pour valider un encaissement ou un transfert de caisse, tu dois avoir un code personnel à 4 chiffres. Tape ici pour le créer.',
  action_url: '/profil#pin',
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (u?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })

  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const target = body?.target === 'all' ? 'all' : 'me'

  const { data: me } = await sb.from('users').select('id').eq('email', u.email).maybeSingle()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  if (target === 'me') {
    const r = await sendNotification(me.id, 'pin_setup_reminder', PAYLOAD)
    return NextResponse.json({ ok: true, target: 'me', sent: r.ok ? 1 : 0, result: r })
  }

  // target = all → tous les users actifs qui n'ont PAS encore de code
  const { data: users } = await sb.from('users').select('id').eq('active', true).is('verify_pin_hash', null)
  const ids = (users || []).map(x => x.id)
  if (!ids.length) return NextResponse.json({ ok: true, target: 'all', sent: 0, note: 'Tous les users actifs ont déjà un code.' })
  const res = await sendNotificationToMany(ids, 'pin_setup_reminder', PAYLOAD)
  return NextResponse.json({ ok: true, target: 'all', eligible: ids.length, ...res })
}

// GET : état du déploiement du code — qui a défini son code, qui ne l'a pas.
export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (u?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  const sb = createAdminClient()
  const { data: users } = await sb.from('users')
    .select('id, name, role, verify_pin_hash')
    .eq('active', true).order('name')
  const list = (users || []).map((x: any) => ({ id: x.id, name: x.name, role: x.role, has_pin: !!x.verify_pin_hash }))
  const without = list.filter(x => !x.has_pin)
  const withPin = list.filter(x => x.has_pin)
  return NextResponse.json({
    total: list.length,
    without_pin: without.length,
    with_pin: withPin.length,
    without: without.map(x => ({ name: x.name, role: x.role })),
    with:    withPin.map(x => ({ name: x.name, role: x.role })),
  })
}
