// src/app/api/cron/cleanup-stale-placeholders/route.ts
//
// Nettoyage automatique des placeholders orphelins laissés par
// processEmailMessage quand la fonction Vercel est tuée brutalement
// (SIGTERM par maxDuration, OOM, panic) entre l'INSERT placeholder
// (PROCESSING_*) et l'UPDATE final.
//
// Sans cleanup, ces placeholders bloquent la ré-tentative via UNIQUE
// constraint sur source_email_id : un nouvel appel à processEmailMessage
// pour le même messageId reçoit 23505 → return duplicate → l'email
// n'est jamais traité.
//
// Stratégie : tout PROCESSING_* en status='new' depuis > 5 min est
// considéré comme orphelin et marqué parse_error pour libérer le slot.

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToRole }    from '@/lib/push'

const STALE_THRESHOLD_MS = 5 * 60 * 1000         // 5 min
const ALERT_THRESHOLD    = 3                       // > 3 nettoyés en 1 passe → push admin

export async function GET(req: Request) {
  // Olivier 2026-06-03 (audit J-2 W2 KO) : auth Bearer CRON_SECRET.
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const cutoff   = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString()

  const { data, error } = await supabase
    .from('incoming_missions')
    .update({
      status:      'parse_error',
      raw_content: 'Webhook timeout — placeholder orphelin nettoyé automatiquement',
    })
    .like('external_id', 'PROCESSING_%')
    .eq('status', 'new')
    .lt('received_at', cutoff)
    .select('id, source_email_id, received_at')

  if (error) {
    console.error('[CleanupStalePlaceholders] Erreur:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const cleaned = data?.length || 0
  console.log(`[CleanupStalePlaceholders] ${cleaned} placeholder(s) orphelin(s) nettoyé(s)`)

  // Alerte admin si crashes répétés détectés
  if (cleaned > ALERT_THRESHOLD) {
    await sendPushToRole(['admin', 'superadmin'], {
      title: '⚠️ Webhook crashe',
      body:  `${cleaned} placeholders orphelins nettoyés en 15min — vérifier Vercel logs`,
      url:   '/dispatch',
      tag:   'webhook-crash-alert',
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, cleaned, threshold_ms: STALE_THRESHOLD_MS })
}
