// src/app/api/missions/[id]/domaine/route.ts
//
// POST /api/missions/[id]/domaine
//   multipart : remise_date (YYYY-MM-DD) + vente_date? + note? + file?
//   Enregistre la remise au Domaine (État) d'une mission police_saisie.
//
// Règle métier (Olivier 2026-06-13) :
//   - (document OU commentaire) + date de remise obligatoires.
//   - La date de remise = fin de la période facturable au client/parquet.
//   - Remise -> vente : jours au tarif parc saisie facturés à l'État (Excel).
//   - La remise résout la saisie -> lève le blocage police (police_levee_saisie_ok).
//
// Le document est stocké comme pièce jointe d'une mission_remark.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const remiseDate = String(formData.get('remise_date') || '').trim()       // YYYY-MM-DD
  const enlevDate  = String(formData.get('enlevement_date') || '').trim()    // YYYY-MM-DD (optionnel)
  const venteDate  = String(formData.get('vente_date') || '').trim()         // YYYY-MM-DD (optionnel)
  const note       = String(formData.get('note') || '').trim()
  const files = (formData.getAll('files') as File[]).filter(f => f && f.size > 0)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(remiseDate)) {
    return NextResponse.json({ error: 'Date de remise requise (format AAAA-MM-JJ).' }, { status: 400 })
  }
  if (enlevDate && !/^\d{4}-\d{2}-\d{2}$/.test(enlevDate)) {
    return NextResponse.json({ error: 'Date d\'enlèvement invalide (format AAAA-MM-JJ).' }, { status: 400 })
  }
  if (enlevDate && enlevDate < remiseDate) {
    return NextResponse.json({ error: 'L\'enlèvement ne peut pas précéder la remise.' }, { status: 400 })
  }
  if (venteDate && !/^\d{4}-\d{2}-\d{2}$/.test(venteDate)) {
    return NextResponse.json({ error: 'Date de vente invalide (format AAAA-MM-JJ).' }, { status: 400 })
  }
  if (venteDate && enlevDate && venteDate < enlevDate) {
    return NextResponse.json({ error: 'La vente ne peut pas précéder l\'enlèvement.' }, { status: 400 })
  }
  if (files.length === 0 && !note) {
    return NextResponse.json({ error: 'Annexe un document OU saisis un commentaire.' }, { status: 400 })
  }
  for (const f of files) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Fichier "${f.name}" trop gros (max 10 MB)` }, { status: 400 })
    }
  }

  const sb = createAdminClient()

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, source')
    .eq('id', params.id)
    .maybeSingle()
  if (mErr)     return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const remiseFr = remiseDate.split('-').reverse().join('/')
  const venteFr  = venteDate ? venteDate.split('-').reverse().join('/') : null
  const remarkText = `🏛 Remise au Domaine (remise : ${remiseFr}${venteFr ? `, vente : ${venteFr}` : ''})${note ? ` — ${note}` : ''}`
  const { data: remark, error: insErr } = await sb
    .from('mission_remarks')
    .insert({ mission_id: params.id, text: remarkText, created_by: actor.id })
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  let firstPath: string | null = null
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    const path = `${params.id}/${remark.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage
      .from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) { console.error('[domaine] upload error:', upErr.message); continue }
    await sb.from('mission_remark_attachments').insert({
      remark_id:   remark.id,
      file_path:   path,
      file_name:   file.name,
      file_size:   file.size,
      mime_type:   file.type || null,
      uploaded_by: actor.id,
    })
    if (!firstPath) firstPath = path
  }

  const update: any = {
    domaine_at:              new Date().toISOString(),
    domaine_remise_date:     remiseDate,
    domaine_enlevement_date: enlevDate || null,
    domaine_vente_date:      venteDate || null,
    domaine_note:            note || null,
    domaine_by:              actor.id,
    police_levee_saisie_ok:  true,
  }
  if (firstPath) update.domaine_doc_path = firstPath

  const { error: updErr } = await sb
    .from('incoming_missions')
    .update(update)
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   actor.id,
    action:     'domaine_remise',
    notes:      remarkText,
    metadata:   { remise_date: remiseDate, vente_date: venteDate || null, has_doc: !!firstPath },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true })
}
