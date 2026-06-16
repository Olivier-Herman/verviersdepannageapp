// src/app/api/admin/missions/errors/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const maxDuration = 60

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes((session.user as any)?.role))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: missions } = await supabase
    .from('incoming_missions')
    .select('id, external_id, source, source_format, status, received_at, raw_content, sender_email')
    .or('status.eq.parse_error,source.eq.unknown,external_id.like.UNKNOWN_SENDER_%')
    .order('received_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ missions: missions || [] })
}

// POST : re-parse les missions en parse_error (modèle Claude réparé). Re-applique
// le parsing sur le raw_content stocké et repasse en 'new' si ça réussit.
//   body : { id?: string }  (un id précis, sinon toutes les parse_error)
// Olivier 2026-06-16.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes((session.user as any)?.role))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const onlyId = body.id ? String(body.id) : null

  const supabase = createAdminClient()
  // Lot limité : le re-fetch email + parse Claude prend ~10s/mission → on
  // traite peu par appel pour rester sous la limite Vercel (60s). L'UI reboucle.
  const BATCH = onlyId ? 1 : 4
  // Même périmètre que le GET : parse_error + source unknown + placeholders.
  let q = supabase
    .from('incoming_missions')
    .select('id, source, source_format, raw_content, external_id, source_email_id')
    .or('status.eq.parse_error,source.eq.unknown,external_id.like.PROCESSING_%,external_id.like.UNKNOWN_SENDER_%')
    .order('received_at', { ascending: false })
  if (onlyId) q = q.eq('id', onlyId)
  const { data: rows, error } = await q.limit(BATCH)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { parseMissionContent } = await import('@/lib/missions/parser')
  const { processEmailMessage } = await import('@/lib/missions/processor')
  let reparsed = 0, refetched = 0, failed = 0
  const errors: string[] = []

  for (const m of rows || []) {
    const raw = (m.raw_content || '').trim()
    const isEmptyPlaceholder = String(m.external_id || '').startsWith('PROCESSING_') &&
      (!raw || raw.length < 80 || /placeholder orphelin/i.test(raw))

    // Cas 1 : placeholder vide (email jamais extrait) → on re-fetch l'email via
    // son id Graph (source_email_id). On supprime d'abord le placeholder pour
    // lever la dedup, puis processEmailMessage recrée la mission complète.
    if (isEmptyPlaceholder && m.source_email_id) {
      try {
        await supabase.from('incoming_missions').delete().eq('id', m.id)
        const res: any = await processEmailMessage(m.source_email_id)
        if (res.status === 'inserted' || res.status === 'duplicate') refetched++
        else { failed++; errors.push(`${m.id}: refetch ${res.status} ${res.error || res.reason || ''}`.slice(0, 140)) }
      } catch (e: any) {
        failed++; errors.push(`${m.id}: refetch ${e.message?.slice(0, 100)}`)
      }
      continue
    }

    // Cas 2 : contenu présent → on re-parse (modèle réparé).
    if (!raw) { failed++; continue }
    try {
      const parsed = await parseMissionContent(
        (m.source as any) || 'unknown',
        { textContent: raw, sourceFormat: (m.source_format as any) || 'email_plain', rawContent: raw },
        'Reprocess parse_error',
      )
      const upd: Record<string, any> = {
        status:          'new',
        parse_confidence: parsed.confidence ?? 0.5,
        updated_at:      new Date().toISOString(),
      }
      for (const f of ['dossier_number','mission_type','incident_type','incident_description',
        'client_name','client_phone','client_address','vehicle_plate','vehicle_brand','vehicle_model',
        'vehicle_vin','vehicle_fuel','vehicle_gearbox','incident_address','incident_city',
        'destination_name','destination_address','amount_guaranteed','incident_at'] as const) {
        if ((parsed as any)[f] != null && (parsed as any)[f] !== '') upd[f] = (parsed as any)[f]
      }
      const { error: uErr } = await supabase.from('incoming_missions').update(upd).eq('id', m.id)
      if (uErr) { failed++; errors.push(`${m.id}: ${uErr.message}`) } else reparsed++
    } catch (e: any) {
      failed++; errors.push(`${m.id}: ${e.message?.slice(0, 120)}`)
    }
  }

  // more = il restait peut-être d'autres missions à traiter (lot plein).
  const processed = (rows || []).length
  return NextResponse.json({ ok: true, reparsed, refetched, failed, processed, more: !onlyId && processed >= BATCH, errors: errors.slice(0, 10) })
}
