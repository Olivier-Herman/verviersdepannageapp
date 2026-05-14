// src/app/api/cron/auto-archive/route.ts
//
// Cron quotidien (3h du matin UTC). Archive automatiquement les missions
// completed depuis > 7 jours apres facturation complete.
//
// Regle critique pour les chaines REM ↔ REL :
//   on n'archive UNE mission de la chaine que si TOUS les maillons sont
//   completed depuis > 7 jours. Empeche d'archiver une REM alors que la
//   REL est encore active (sinon UX cassee dans le dispatch).

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const ARCHIVE_DELAY_DAYS = 7

export async function GET(req: Request) {
  // Auth Vercel cron (header Bearer CRON_SECRET)
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const cutoff = new Date(Date.now() - ARCHIVE_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // 1) Candidats : missions completed avec invoiced_at < cutoff et archived_at NULL
  const { data: candidates, error } = await sb
    .from('incoming_missions')
    .select('id, parent_mission_id, status, invoiced_at, external_id')
    .eq('status', 'completed')
    .not('invoiced_at', 'is', null)
    .lt('invoiced_at', cutoff)
    .is('archived_at', null)
    .limit(500)

  if (error) {
    console.error('[auto-archive]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, archived: 0 })
  }

  // 2) Pour chaque candidat, verifier que sa chaine REM+REL est totalement
  //    completed depuis > 7j. On rassemble les IDs concernes pour eviter les
  //    queries Supabase une-par-une.
  const candidateIds   = candidates.map(m => m.id)
  const parentIds      = candidates.map(m => m.parent_mission_id).filter(Boolean) as string[]

  // Charger parents (pour les REL) et enfants (pour les REM)
  const { data: chainMissions } = await sb
    .from('incoming_missions')
    .select('id, parent_mission_id, status, invoiced_at')
    .or(
      [
        parentIds.length > 0  ? `id.in.(${parentIds.join(',')})` : '',
        candidateIds.length   ? `parent_mission_id.in.(${candidateIds.join(',')})` : '',
      ].filter(Boolean).join(',')
    )

  const chainById = new Map<string, any>()
  ;(chainMissions || []).forEach(m => chainById.set(m.id, m))
  const childrenByParent = new Map<string, any[]>()
  ;(chainMissions || []).forEach(m => {
    if (!m.parent_mission_id) return
    const arr = childrenByParent.get(m.parent_mission_id) || []
    arr.push(m)
    childrenByParent.set(m.parent_mission_id, arr)
  })

  const toArchive: string[] = []

  for (const m of candidates) {
    let chainOk = true

    // Verifier le parent (si REL)
    if (m.parent_mission_id) {
      const parent = chainById.get(m.parent_mission_id)
      if (!parent) {
        // Parent disparu : on archive quand meme
      } else if (parent.status !== 'completed' || !parent.invoiced_at || parent.invoiced_at >= cutoff) {
        chainOk = false
      }
    }

    // Verifier les enfants REL (si REM)
    const children = childrenByParent.get(m.id) || []
    for (const child of children) {
      if (child.status !== 'completed' || !child.invoiced_at || child.invoiced_at >= cutoff) {
        chainOk = false
        break
      }
    }

    if (chainOk) toArchive.push(m.id)
  }

  if (toArchive.length === 0) {
    return NextResponse.json({
      ok: true,
      archived: 0,
      candidates: candidates.length,
      skipped_chain_incomplete: candidates.length,
    })
  }

  // 3) UPDATE en batch
  const now = new Date().toISOString()
  const { error: updErr } = await sb
    .from('incoming_missions')
    .update({ archived_at: now })
    .in('id', toArchive)
  if (updErr) {
    console.error('[auto-archive] update failed:', updErr.message)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  console.log(`[auto-archive] ${toArchive.length} mission(s) archivees`)

  return NextResponse.json({
    ok: true,
    archived: toArchive.length,
    candidates: candidates.length,
    skipped_chain_incomplete: candidates.length - toArchive.length,
    cutoff_at: cutoff,
  })
}
