// src/app/api/missions/[id]/requisitoire/route.ts
//
// POST /api/missions/[id]/requisitoire
//   multipart : note? (texte) + file? (document scanné / PDF)
//   Annexe un réquisitoire à une mission police_saisie.
//
// Le document est stocké comme pièce jointe d'une mission_remark (réutilise le
// bucket 'mission-remarks' + l'UI Remarques pour le download). En parallèle on
// pose les colonnes requisitoire_* sur la mission pour le badge / le workflow.
//
// Olivier 2026-06-13 — Police Saisie Phase 1.

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
  const note  = String(formData.get('note') || '').trim()
  const files = formData.getAll('files') as File[]
  const realFiles = files.filter(f => f && f.size > 0)

  if (realFiles.length === 0 && !note) {
    return NextResponse.json({ error: 'Annexe un document ou saisis une note.' }, { status: 400 })
  }
  for (const f of realFiles) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Fichier "${f.name}" trop gros (max 10 MB)` }, { status: 400 })
    }
  }

  const sb = createAdminClient()

  // Mission existe ?
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, source')
    .eq('id', params.id)
    .maybeSingle()
  if (mErr)   return NextResponse.json({ error: mErr.message }, { status: 500 })
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Remarque de traçabilité (porte le document + apparaît dans la timeline)
  const remarkText = `📋 Réquisitoire annexé${note ? ` — ${note}` : ''}`
  const { data: remark, error: insErr } = await sb
    .from('mission_remarks')
    .insert({ mission_id: params.id, text: remarkText, created_by: actor.id })
    .select()
    .single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  let firstPath: string | null = null
  for (const file of realFiles) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    const path = `${params.id}/${remark.id}/${Date.now()}_${safeName}`
    const buf = new Uint8Array(await file.arrayBuffer())
    const { error: upErr } = await sb.storage
      .from('mission-remarks')
      .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) { console.error('[requisitoire] upload error:', upErr.message); continue }
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

  // Flag workflow sur la mission
  const { error: updErr } = await sb
    .from('incoming_missions')
    .update({
      requisitoire_at:       new Date().toISOString(),
      requisitoire_note:     note || null,
      requisitoire_doc_path: firstPath,
      requisitoire_by:       actor.id,
    })
    .eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
