// POST /api/fourriere/destruction-dossiers/[id]/claim { presented_at?, person?, note? }
// Quelqu'un se présente : on fige les frais À CETTE DATE et on garde la trace.
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { fourriereUser }     from '@/lib/fourriere/destruction-access'
import { costAtDate }        from '@/lib/fourriere/destruction-dossier'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const { data: d } = await sb.from('destruction_dossiers').select('*').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const presentedAt = body.presented_at && /^\d{4}-\d{2}-\d{2}$/.test(body.presented_at) ? `${body.presented_at}T12:00:00.000Z` : new Date().toISOString()
  const computed = await costAtDate(d as any, presentedAt)
  const { data: claim, error } = await sb.from('destruction_claims').insert({
    dossier_id: d.id, presented_at: presentedAt, person: body.person || null, note: body.note || null, computed, created_by: u.id, created_by_name: u.name,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (d.mission_id) await sb.from('mission_logs').insert({ mission_id: d.mission_id, actor_id: u.id, action: 'destruction_claim', notes: `Quelqu'un s'est présenté pour le véhicule détruit (dossier ${d.dossier_number})${body.person ? ' : ' + body.person : ''} — frais à cette date : ${computed.totalTvac.toFixed(2)} € TVAC.`, metadata: { claim_id: claim.id } }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, claim })
}
