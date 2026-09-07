// src/app/api/missions/[id]/saisie-motif/route.ts
//
// POST { code } → définit ou corrige le MOTIF DE SAISIE d'une fiche depuis la
// fiche dispatch (Défaut d'assurance / Saisie judiciaire / Saisie générale…,
// catalogue police_saisie_motifs). Jusqu'ici seul le formulaire chauffeur le
// posait ; une fiche créée ou requalifiée par le dispatch restait sans motif.
//   - tracé dans le journal (ancien → nouveau)
//   - étiquette parc réimprimée (best-effort) si le véhicule est en parc
// Accès : dispatcher / admin / superadmin + module fourriere. Olivier 2026-09-07.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { reprintLabelForMission } from '@/lib/missions/reprint-label-helper'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere'] })
  if (!acc.ok || !acc.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { code?: string }
  const code = String(body.code || '').trim()
  if (!code) return NextResponse.json({ error: 'Motif requis.' }, { status: 400 })

  const sb = createAdminClient()
  const { data: motif } = await sb.from('police_saisie_motifs').select('code, label').eq('code', code).eq('active', true).maybeSingle()
  if (!motif) return NextResponse.json({ error: 'Motif inconnu ou inactif.' }, { status: 400 })

  const { data: m } = await sb.from('incoming_missions')
    .select('id, status, source, saisie_motif_code, saisie_motif_label, parc_zone_key')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const now = new Date().toISOString()
  const { error } = await sb.from('incoming_missions')
    .update({ saisie_motif_code: motif.code, saisie_motif_label: motif.label, updated_at: now })
    .eq('id', m.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: me } = await sb.from('users').select('name').eq('id', acc.id).maybeSingle()
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: acc.id, action: 'saisie_motif',
    notes: `Motif de saisie ${m.saisie_motif_code ? `« ${m.saisie_motif_label || m.saisie_motif_code} » → ` : 'défini : '}« ${motif.label} » (${me?.name || 'bureau'}, fiche dispatch)`,
    metadata: { from: m.saisie_motif_code || null, to: motif.code },
  }).then(() => {}, () => {})

  // Étiquette : le motif y figure → réimpression si le véhicule est en parc.
  let reprinted = false
  if (m.status === 'parked' && m.parc_zone_key) {
    const r = await reprintLabelForMission({ kind: 'uuid', value: m.id }).catch(() => ({ ok: false }))
    reprinted = !!r.ok
  }
  return NextResponse.json({ ok: true, code: motif.code, label: motif.label, reprinted })
}
