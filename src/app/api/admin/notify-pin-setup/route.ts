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

// Partenaires externes (garages) : jamais concernés par le code de validation.
const EXCLUDED_ROLES = ['garage', 'partner']
const isInternalStaff = (u: { role?: string | null; roles?: string[] | null }) => {
  const rs = new Set<string>([u.role || '', ...(Array.isArray(u.roles) ? u.roles : [])].filter(Boolean))
  return !EXCLUDED_ROLES.some(r => rs.has(r))
}

const PAYLOAD_SETUP = {
  title:      '🔐 Définis ton code de validation',
  body:       'Pour confirmer un encaissement inférieur au montant d\'une mission, tu dois avoir un code personnel à 4 chiffres. Tape ici pour le créer.',
  action_url: '/definir-code',
}
const PAYLOAD_RECALL = {
  title:      '🔐 Te souviens-tu de ton code ?',
  body:       'Tu ne l\'as sûrement pas utilisé depuis longtemps. Tape ici pour confirmer que tu t\'en souviens (ou en redéfinir un).',
  action_url: '/verifier-code',
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (u?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })

  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const target = body?.target === 'all' ? 'all' : 'me'
  const kind   = body?.kind === 'recall' ? 'recall' : 'setup'
  const type    = kind === 'recall' ? 'pin_recall_check'  : 'pin_setup_reminder'
  const payload = kind === 'recall' ? PAYLOAD_RECALL       : PAYLOAD_SETUP

  const { data: me } = await sb.from('users').select('id').eq('email', u.email).maybeSingle()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  if (target === 'me') {
    const r = await sendNotification(me.id, type, payload)
    return NextResponse.json({ ok: true, kind, target: 'me', sent: r.ok ? 1 : 0, result: r })
  }

  // target = all (hors partenaires garages) :
  //   setup  → users actifs SANS code (verify_pin_hash null)
  //   recall → users actifs AVEC code (verify_pin_hash non null)
  const q = sb.from('users').select('id, role, roles').eq('active', true)
  const { data: users } = kind === 'recall' ? await q.not('verify_pin_hash', 'is', null) : await q.is('verify_pin_hash', null)
  const ids = (users || []).filter(isInternalStaff).map(x => x.id)
  if (!ids.length) return NextResponse.json({ ok: true, kind, target: 'all', sent: 0, note: kind === 'recall' ? 'Personne n\'a encore de code.' : 'Tous les users actifs ont déjà un code.' })
  const res = await sendNotificationToMany(ids, type, payload)
  return NextResponse.json({ ok: true, kind, target: 'all', eligible: ids.length, ...res })
}

// GET : état du déploiement du code — qui a défini son code, qui ne l'a pas.
export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (u?.role !== 'superadmin') return NextResponse.json({ error: 'Superadmin uniquement' }, { status: 403 })
  const sb = createAdminClient()
  const { data: users } = await sb.from('users')
    .select('id, name, role, roles, verify_pin_hash')
    .eq('active', true).order('name')
  const list = (users || []).filter(isInternalStaff).map((x: any) => ({ id: x.id, name: x.name, role: x.role, has_pin: !!x.verify_pin_hash }))
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
