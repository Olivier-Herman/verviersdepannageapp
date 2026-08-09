// src/app/api/saisie-validation/[token]/route.ts
//
// PUBLIC (le token EST l'autorisation, comme /requisitoire/depot).
//   GET  → résumé du dossier pour la page de validation (véhicule, PV, n° EF).
//   POST → dépôt de la validation (cachet/signature, PDF/image) → stockée +
//          dossier passé en 'accepte'. Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60
const MAX_FILE_SIZE = 15 * 1024 * 1024

async function findByToken(sb: any, token: string) {
  if (!token || token.length < 8) return null
  const { data } = await sb.from('saisie_dossiers')
    .select('id, mission_id, ef_number, vehicle_plate, vehicle_brand, vehicle_model, dossier_ref, validation_at, state')
    .eq('validation_token', token).maybeSingle()
  return data || null
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const d = await findByToken(sb, params.token)
  if (!d) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })
  return NextResponse.json({
    numero:   d.ef_number,
    plate:    d.vehicle_plate,
    vehicle:  [d.vehicle_brand, d.vehicle_model].filter(Boolean).join(' ') || null,
    pv:       d.dossier_ref,
    received: !!d.validation_at,
  })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const d = await findByToken(sb, params.token)
  if (!d) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })

  const formData = await req.formData()
  const files = (formData.getAll('files') as File[]).filter(f => f && f.size > 0)
  const note  = String(formData.get('note') || '').trim()
  if (!files.length) return NextResponse.json({ error: 'Joignez la validation (PDF ou image).' }, { status: 400 })
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) return NextResponse.json({ error: `Fichier "${f.name}" trop gros (max 15 MB)` }, { status: 400 })
  }

  let firstPath: string | null = null
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'validation.pdf'
    const path = `saisie-validation/${d.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage.from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) { console.error('[saisie-validation] upload:', upErr.message); continue }
    if (!firstPath) firstPath = path
  }
  if (!firstPath) return NextResponse.json({ error: "Échec de l'enregistrement du fichier." }, { status: 500 })

  await sb.from('saisie_dossiers').update({
    validation_doc_path: firstPath,
    validation_at:       new Date().toISOString(),
    state:               'accepte',
    notes:               note ? `Validation : ${note}` : undefined,
    updated_at:          new Date().toISOString(),
  }).eq('id', d.id)

  // Trace sur la timeline de la fiche si liée.
  if (d.mission_id) {
    await sb.from('mission_remarks')
      .insert({ mission_id: d.mission_id, text: `✅ Validation état de frais ${d.ef_number || ''} reçue (lien public)${note ? ` — ${note}` : ''}`, created_by: null })
      .then(() => {}, () => {})
  }

  return NextResponse.json({ ok: true })
}
