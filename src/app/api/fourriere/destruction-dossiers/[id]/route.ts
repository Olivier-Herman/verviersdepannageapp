// GET /api/fourriere/destruction-dossiers/[id]?at=YYYY-MM-DD → dossier + frais à la date (défaut aujourd'hui) + présentations
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { fourriereUser }     from '@/lib/fourriere/destruction-access'
import { costAtDate }        from '@/lib/fourriere/destruction-dossier'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data: d } = await sb.from('destruction_dossiers').select('*').eq('id', params.id).maybeSingle()
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const at = new URL(req.url).searchParams.get('at')
  const atIso = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00.000Z` : new Date().toISOString()
  const cost = await costAtDate(d as any, atIso)
  const { data: claims } = await sb.from('destruction_claims').select('*').eq('dossier_id', d.id).order('presented_at', { ascending: false })
  let mission: any = null
  if (d.mission_id) {
    const { data: m } = await sb.from('incoming_missions').select('id, mission_number, source, vehicle_plate, client_name, parked_at').eq('id', d.mission_id).maybeSingle()
    mission = m
  }
  return NextResponse.json({ dossier: d, cost, claims: claims || [], mission })
}
