// src/app/api/requisitoire/depot/[token]/route.ts
//
// PUBLIC (le token EST l'autorisation, comme /touring/check/[token]).
//   GET  → résumé du dossier pour la page policier (véhicule, saisie, PV…).
//   POST → dépôt du réquisitoire (PDF) → rattaché à la fiche (bucket
//          mission-remarks + remarque timeline) + requisitoire_at posé.
// Olivier 2026-08-08.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15 MB

async function findByToken(sb: any, token: string) {
  if (!token || token.length < 8) return null
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, incident_address, address, created_at, saisie_motif_label, police_pv_number, requisitoire_at, requisitoire_stop')
    .eq('requisitoire_token', token).maybeSingle()
  return data || null
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const m = await findByToken(sb, params.token)
  if (!m) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })
  return NextResponse.json({
    ref:        m.mission_number != null ? `SAI-${m.mission_number}` : null,
    plate:      m.vehicle_plate,
    vehicle:    [m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || null,
    location:   m.incident_address || m.address || null,
    saisie_at:  m.created_at,
    motif:      m.saisie_motif_label,
    pv:         m.police_pv_number,
    received:   !!m.requisitoire_at,
  })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const m = await findByToken(sb, params.token)
  if (!m) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })

  const formData = await req.formData()
  const files = (formData.getAll('files') as File[]).filter(f => f && f.size > 0)
  const note  = String(formData.get('note') || '').trim()
  if (!files.length) return NextResponse.json({ error: 'Joignez le réquisitoire (PDF ou image).' }, { status: 400 })
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) return NextResponse.json({ error: `Fichier "${f.name}" trop gros (max 15 MB)` }, { status: 400 })
  }

  // Remarque timeline (auteur null = dépôt police via lien).
  const remarkText = `📋 Réquisitoire déposé par la police (lien public)${note ? ` — ${note}` : ''}`
  const { data: remark, error: insErr } = await sb.from('mission_remarks')
    .insert({ mission_id: m.id, text: remarkText, created_by: null }).select().single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  let firstPath: string | null = null
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'requisitoire.pdf'
    const path = `${m.id}/${remark.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage.from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) { console.error('[requisitoire depot] upload:', upErr.message); continue }
    await sb.from('mission_remark_attachments').insert({
      remark_id: remark.id, file_path: path, file_name: file.name,
      file_size: file.size, mime_type: file.type || null, uploaded_by: null,
    })
    if (!firstPath) firstPath = path
  }
  if (!firstPath) return NextResponse.json({ error: "Échec de l'enregistrement du fichier." }, { status: 500 })

  await sb.from('incoming_missions').update({
    requisitoire_at:       new Date().toISOString(),
    requisitoire_note:     note || 'Déposé par la police via le lien',
    requisitoire_doc_path: firstPath,
    requisitoire_by:       null,
  }).eq('id', m.id)

  await sb.from('mission_logs').insert({
    mission_id: m.id, action: 'requisitoire_depot_public',
    notes: `Réquisitoire déposé via le lien public (${files.length} fichier(s)).`,
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true })
}
