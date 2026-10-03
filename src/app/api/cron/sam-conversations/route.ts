// src/app/api/cron/sam-conversations/route.ts
//
// Conversations Sam / Sonic (Olivier 03/10/2026), toutes les 10 min :
//   1. ferme celles sans message depuis 30 min ;
//   2. écrit le résumé (2-3 lignes) des conversations terminées ;
//   3. supprime les messages après 12 mois (le résumé reste).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { withAiContext } from '@/lib/ai/usage'
import { IDLE_MINUTES, KEEP_MONTHS, summarize } from '@/lib/sam/journal'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function handleGET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const now = new Date()
  const idle = new Date(now.getTime() - IDLE_MINUTES * 60_000).toISOString()
  const { data: closed } = await sb.from('sam_conversations').update({ ended_at: now.toISOString(), end_reason: 'inactivite' })
    .is('ended_at', null).lt('last_at', idle).select('id')

  const { data: todo } = await sb.from('sam_conversations').select('id').not('ended_at', 'is', null).is('summary', null).is('purged_at', null).order('ended_at').limit(10)
  let summarized = 0, failed = 0
  for (const c of todo || []) {
    try {
      const s = await summarize(c.id)
      await sb.from('sam_conversations').update({ summary: s || '(conversation vide)' }).eq('id', c.id)
      summarized++
    } catch (e: any) { failed++; console.error('[cron/sam-conversations] résumé', c.id, e?.message) }
  }

  const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - KEEP_MONTHS)
  const { data: old } = await sb.from('sam_conversations').select('id').not('ended_at', 'is', null).lt('ended_at', cutoff.toISOString()).is('purged_at', null).limit(200)
  for (const c of old || []) {
    await sb.from('sam_messages').delete().eq('conversation_id', c.id)
    await sb.from('sam_conversations').update({ purged_at: now.toISOString() }).eq('id', c.id)
  }
  return NextResponse.json({ ok: failed === 0, closed: closed?.length || 0, summarized, failed, purged: old?.length || 0 })
}

// Les appels d'IA de ce passage sont comptés sous « cron:sam-conversations » (conso_ia).
export async function GET(...args: Parameters<typeof handleGET>) {
  return withAiContext({ declencheur: 'cron:sam-conversations' }, () => handleGET(...args))
}
