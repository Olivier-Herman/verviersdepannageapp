// src/app/api/cron/pin-reminder/route.ts
//
// Rappel QUOTIDIEN « définis ton code de validation » : tant qu'un utilisateur
// actif n'a pas de code (verify_pin_hash null), on lui renvoie la notif chaque
// jour avec le lien direct vers /profil#pin. Olivier 2026-08-03.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToMany } from '@/lib/notifications/send'

export const dynamic    = 'force-dynamic'
export const fetchCache  = 'force-no-store'
export const maxDuration = 60

const PAYLOAD = {
  title:      '🔐 Définis ton code de validation',
  body:       'Il te manque ton code personnel à 4 chiffres (pour confirmer un encaissement inférieur au montant d\'une mission). Tape ici pour le créer en 10 secondes.',
  action_url: '/definir-code',
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  // Hors partenaires externes (garages) : non concernés par le code de validation.
  const EXCLUDED = ['garage', 'partner']
  const { data: users } = await sb.from('users').select('id, role, roles').eq('active', true).is('verify_pin_hash', null)
  const ids = (users || [])
    .filter((u: any) => { const rs = new Set([u.role || '', ...(Array.isArray(u.roles) ? u.roles : [])]); return !EXCLUDED.some(r => rs.has(r)) })
    .map((u: any) => u.id)
  if (!ids.length) return NextResponse.json({ ok: true, without_pin: 0, sent: 0 })
  const res = await sendNotificationToMany(ids, 'pin_setup_reminder', PAYLOAD)
  return NextResponse.json({ ok: true, without_pin: ids.length, ...res })
}
