// src/app/api/missions/[id]/levee-saisie/route.ts
//
// POST /api/missions/[id]/levee-saisie
//   multipart : type (definitive|temporaire) + date (YYYY-MM-DD) + note? + file?
//   Enregistre une levée de saisie sur une mission police_saisie.
//
// Règle métier (Olivier 2026-06-13) :
//   (document OU commentaire) ET date de levée  ->  police_levee_saisie_ok = true
//   (enlève le blocage police de la fiche).
//   La date de levée pilote le calcul du gardiennage à 2 tarifs.
//
// Le document est stocké comme pièce jointe d'une mission_remark (réutilise le
// bucket 'mission-remarks' + l'UI Remarques pour le download).

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
  const type = String(formData.get('type') || '').trim()
  const date = String(formData.get('date') || '').trim()           // YYYY-MM-DD
  const note = String(formData.get('note') || '').trim()
  const files = (formData.getAll('files') as File[]).filter(f => f && f.size > 0)

  if (type !== 'definitive' && type !== 'temporaire') {
    return NextResponse.json({ error: 'Type de levée invalide (définitive ou temporaire).' }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Date de levée requise (format AAAA-MM-JJ).' }, { status: 400 })
  }
  // Déblocage : document OU commentaire obligatoire
  if (files.length === 0 && !note) {
    return NextResponse.json({ error: 'Annexe un document de levée OU saisis un commentaire (ex : « Levée par téléphone »).' }, { status: 400 })
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

  const typeLabel = type === 'definitive' ? 'définitive' : 'temporaire'
  const dateFr = date.split('-').reverse().join('/')
  const remarkText = `🔓 Levée de saisie ${typeLabel} (date : ${dateFr})${note ? ` — ${note}` : ''}`
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
    if (upErr) { console.error('[levee-saisie] upload error:', upErr.message); continue }
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

  // Enregistre la levée + lève le blocage police
  const { error: updErr } = await sb
    .from('incoming_missions')
    .update({
      levee_saisie_at:        new Date().toISOString(),
      levee_saisie_date:      date,
      levee_saisie_type:      type,
      levee_saisie_note:      note || null,
      levee_saisie_doc_path:  firstPath,
      levee_saisie_by:        actor.id,
      police_levee_saisie_ok: true,
    })
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   actor.id,
    action:     'levee_saisie',
    notes:      remarkText,
    metadata:   { type, date, has_doc: !!firstPath },
  })

  return NextResponse.json({ ok: true })
}
