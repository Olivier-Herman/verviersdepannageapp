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

// Purge des fiches MORTES (Olivier 2026-06-29) : au-delà de 72h, une fiche en
// erreur n'est ni récupérable par le reprocess (fenêtre 72h) ni actionnable
// (« 3 jours après c'est trop tard »). On les supprime pour ne pas gonfler la
// base. Critères STRICTS de sécurité ci-dessous.
const PURGE_THRESHOLD_MS = 72 * 60 * 60 * 1000   // 72h
const PURGE_BATCH        = 300                     // borne par passe
// Jamais supprimer une fiche avancée/traitée.
const SAFE_STATUSES = ['assigned','accepted','in_progress','delivering','parked','to_invoice','completed','invoiced','dispatching','no_charge']

/** Supprime les artefacts d'erreur orphelins > 72h, non actionnables. Retourne le nb supprimé. */
async function purgeDeadMissions(supabase: any): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_THRESHOLD_MS).toISOString()
  const { data: cand } = await supabase
    .from('incoming_missions')
    .select('id, status, external_id, kaze_job_id, odoo_quote_id, odoo_task_id')
    .or('external_id.like.PROCESSING_%,external_id.like.UNKNOWN_SENDER_%,status.eq.parse_error,source.eq.unknown')
    .lt('received_at', cutoff)
    .limit(PURGE_BATCH)
  const safe = (cand || []).filter((m: any) =>
    !SAFE_STATUSES.includes(m.status) && !m.kaze_job_id && !m.odoo_quote_id && !m.odoo_task_id
  )
  if (safe.length === 0) return 0
  const ids: string[] = safe.map((m: any) => m.id)
  // Exclure les parents de chaîne (un enfant pointe dessus).
  const parents = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: kids } = await supabase.from('incoming_missions')
      .select('parent_mission_id').in('parent_mission_id', ids.slice(i, i + 200))
    for (const k of kids || []) if (k.parent_mission_id) parents.add(k.parent_mission_id)
  }
  const finalIds = ids.filter(id => !parents.has(id))
  let deleted = 0
  for (let i = 0; i < finalIds.length; i += 100) {
    const batch = finalIds.slice(i, i + 100)
    for (const t of ['mission_logs', 'dispatch_attempts_log', 'mission_invoice_drafts']) {
      await supabase.from(t).delete().in('mission_id', batch).then(() => {}, () => {})
    }
    const { count, error } = await supabase.from('incoming_missions').delete({ count: 'exact' }).in('id', batch)
    if (!error) deleted += count ?? batch.length
  }
  return deleted
}

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

  // Purge des fiches mortes > 72h (non récupérables, non actionnables).
  let purged = 0
  try {
    purged = await purgeDeadMissions(supabase)
    if (purged) console.log(`[CleanupStalePlaceholders] ${purged} fiche(s) morte(s) > 72h supprimée(s)`)
  } catch (e: any) {
    console.error('[CleanupStalePlaceholders] purge KO:', e?.message)
  }

  // Alerte admin si crashes répétés détectés
  if (cleaned > ALERT_THRESHOLD) {
    await sendPushToRole(['admin', 'superadmin'], {
      title: '⚠️ Webhook crashe',
      body:  `${cleaned} placeholders orphelins nettoyés en 15min — vérifier Vercel logs`,
      url:   '/dispatch',
      tag:   'webhook-crash-alert',
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, cleaned, purged, threshold_ms: STALE_THRESHOLD_MS })
}
