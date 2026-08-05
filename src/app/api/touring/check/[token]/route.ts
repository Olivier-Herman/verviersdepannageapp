// src/app/api/touring/check/[token]/route.ts
//
// API PUBLIQUE (token) du lien Touring. GET = liste des dossiers à trancher ;
// POST = enregistre la réponse de Touring (le superadmin appliquera ensuite).
// Aucune session : le token EST l'autorisation (service_role).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getCheckToken } from '@/lib/touring/check-config'
import { bumpCheckSignal } from '@/lib/touring/check-persist'

export const dynamic = 'force-dynamic'

const VALID_CODES = ['already_invoiced', 'not_covered', 'invoice_hors_comex', 'deplacement_hors_comex', 'other']

async function checkToken(sb: any, token: string): Promise<boolean> {
  const real = await getCheckToken(sb)
  return !!token && !!real && token === real
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  if (!(await checkToken(sb, params.token))) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })

  const { data: rows } = await sb.from('touring_check_dossiers')
    .select('id, dossier_number, intervention_date, fiches, is_combined, status, response_code, response_note')
    .in('status', ['pending', 'answered'])
    .order('intervention_date', { ascending: false })
  return NextResponse.json({ items: rows || [] })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  if (!(await checkToken(sb, params.token))) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const id = String(body?.id || '')
  const code = String(body?.response_code || '')
  const note = String(body?.response_note || '').trim().slice(0, 500)
  if (!id || !VALID_CODES.includes(code)) return NextResponse.json({ error: 'Réponse invalide' }, { status: 400 })
  if (code === 'already_invoiced' && !note) return NextResponse.json({ error: 'N° d\'accord requis' }, { status: 400 })

  const { data: item } = await sb.from('touring_check_dossiers').select('id, status, fiches').eq('id', id).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  if (!['pending', 'answered'].includes(item.status)) return NextResponse.json({ error: 'Dossier déjà traité' }, { status: 409 })

  const { error } = await sb.from('touring_check_dossiers').update({
    response_code: code,
    response_note: note || null,
    status: 'answered',
    answered_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Touring a répondu → on verrouille le tarif des fiches du dossier.
  const missionIds = (Array.isArray(item.fiches) ? item.fiches : []).map((f: any) => f.mission_id).filter(Boolean)
  if (missionIds.length) {
    await sb.from('incoming_missions').update({ tariff_locked: true }).in('id', missionIds).then(() => {}, () => {})
  }
  await bumpCheckSignal(sb, 'touring_answered')
  return NextResponse.json({ ok: true })
}
