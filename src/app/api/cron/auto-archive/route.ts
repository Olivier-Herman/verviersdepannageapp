// src/app/api/cron/auto-archive/route.ts
//
// Cron quotidien (3h du matin UTC). Archive automatiquement les missions
// completed depuis > 7 jours apres facturation OU non-facturation (sans frais).
//
// Regle critique pour les chaines REM ↔ REL :
//   on n'archive UNE mission de la chaine que si TOUS les maillons sont
//   completed depuis > 7 jours (chacun soit facture, soit sans frais).
//   Empeche d'archiver une REM alors que la REL est encore active.

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const ARCHIVE_DELAY_DAYS = 7

interface ChainMission {
  id:                string
  parent_mission_id: string | null
  status:            string
  invoiced_at:       string | null
  no_charge_at:      string | null
}

function chainSettled(m: ChainMission, cutoff: string): boolean {
  if (m.status !== 'completed') return false
  const settledAt = m.invoiced_at || m.no_charge_at
  return Boolean(settledAt) && settledAt! < cutoff
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const cutoff = new Date(Date.now() - ARCHIVE_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // 1) Candidats : missions completed reglees (facture OU sans frais) avant cutoff
  const { data: candidates, error } = await sb
    .from('incoming_missions')
    .select('id, parent_mission_id, status, invoiced_at, no_charge_at, external_id')
    .eq('status', 'completed')
    .is('archived_at', null)
    .or('invoiced_at.not.is.null,no_charge_at.not.is.null')
    .limit(500)

  if (error) {
    console.error('[auto-archive]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, archived: 0 })
  }

  // Filtre cutoff cote app (Supabase ne supporte pas COALESCE dans .lt() facilement)
  const eligible = candidates.filter(m => {
    const settledAt = m.invoiced_at || m.no_charge_at
    return settledAt && settledAt < cutoff
  })

  if (eligible.length === 0) {
    return NextResponse.json({ ok: true, archived: 0, candidates: candidates.length })
  }

  // 2) Verifier la chaine REM+REL : tous les maillons doivent etre regles depuis > cutoff
  const candidateIds = eligible.map(m => m.id)
  const parentIds    = eligible.map(m => m.parent_mission_id).filter(Boolean) as string[]

  const orClauses = [
    parentIds.length > 0  ? `id.in.(${parentIds.join(',')})` : '',
    candidateIds.length   ? `parent_mission_id.in.(${candidateIds.join(',')})` : '',
  ].filter(Boolean).join(',')

  const { data: chainMissions } = orClauses
    ? await sb
        .from('incoming_missions')
        .select('id, parent_mission_id, status, invoiced_at, no_charge_at')
        .or(orClauses)
    : { data: [] as ChainMission[] }

  const chainById = new Map<string, ChainMission>()
  ;(chainMissions || []).forEach(m => chainById.set(m.id, m as ChainMission))
  const childrenByParent = new Map<string, ChainMission[]>()
  ;(chainMissions || []).forEach(m => {
    if (!m.parent_mission_id) return
    const arr = childrenByParent.get(m.parent_mission_id) || []
    arr.push(m as ChainMission)
    childrenByParent.set(m.parent_mission_id, arr)
  })

  const toArchive: string[] = []

  for (const m of eligible) {
    let chainOk = true

    if (m.parent_mission_id) {
      const parent = chainById.get(m.parent_mission_id)
      if (parent && !chainSettled(parent, cutoff)) chainOk = false
    }

    const children = childrenByParent.get(m.id) || []
    for (const child of children) {
      if (!chainSettled(child, cutoff)) { chainOk = false; break }
    }

    if (chainOk) toArchive.push(m.id)
  }

  if (toArchive.length === 0) {
    return NextResponse.json({
      ok: true,
      archived: 0,
      candidates: candidates.length,
      eligible:   eligible.length,
      skipped_chain_incomplete: eligible.length,
    })
  }

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
    archived:   toArchive.length,
    candidates: candidates.length,
    eligible:   eligible.length,
    skipped_chain_incomplete: eligible.length - toArchive.length,
    cutoff_at:  cutoff,
  })
}
