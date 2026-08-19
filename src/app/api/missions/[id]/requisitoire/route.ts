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
import { extractRequisitoireFromPdf, extractRequisitoireFromImage, type RequisitoireExtract } from '@/lib/requisitoire/extract'
import { buildMissionUpdateFromExtract } from '@/lib/requisitoire/attach'

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
  let firstFile: File | null = null
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
    if (!firstPath) { firstPath = path; firstFile = file }
  }

  // ── OCR : ce que le document apprend à la fiche ────────────────────────────
  let extract: RequisitoireExtract | null = null
  let ocrError: string | null = null
  if (firstFile) {
    try {
      const b64 = Buffer.from(await firstFile.arrayBuffer()).toString('base64')
      const mime = firstFile.type || ''
      extract = mime.startsWith('image/')
        ? await extractRequisitoireFromImage(b64, mime)
        : await extractRequisitoireFromPdf(b64)
    } catch (e: any) {
      ocrError = e?.message || 'lecture impossible'
      console.error('[requisitoire] OCR KO:', ocrError)
    }
  }

  // Fiche complète pour la fusion (plaque/VIN/PV ne s'écrasent jamais).
  const { data: full } = await sb
    .from('incoming_missions')
    .select('id, dossier_number, vehicle_plate, vehicle_vin, incident_at')
    .eq('id', params.id).maybeSingle()

  let update: Record<string, any> = {
    requisitoire_at:       new Date().toISOString(),
    requisitoire_note:     note || null,
    requisitoire_doc_path: firstPath,
    requisitoire_by:       actor.id,
  }
  let dateAdapted = false
  // Un document lu comme « levée de saisie » ne doit PAS être écrit en
  // réquisitoire : on annexe, on prévient, et on laisse l'humain trancher.
  const misfiled = extract && extract.doc_type === 'levee_saisie'
  if (extract && full && !misfiled) {
    const built = buildMissionUpdateFromExtract(full, extract, {
      docPath: firstPath, actorId: actor.id, isLevee: false, note: note || null,
    })
    update = { ...built.update, ...(note ? { requisitoire_note: note } : {}) }
    dateAdapted = built.dateAdapted
  }

  const { error: updErr } = await sb.from('incoming_missions').update(update).eq('id', params.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Trace lisible de ce que l'OCR a complété (la fiche doit pouvoir se relire).
  if (extract && !misfiled) {
    const bits = [
      extract.pv_number && `PV ${extract.pv_number}`,
      update.vehicle_plate && `plaque ${update.vehicle_plate}`,
      update.vehicle_vin && `VIN ${update.vehicle_vin}`,
      dateAdapted && 'date d\'intervention',
      extract.autorite,
    ].filter(Boolean).join(' · ')
    if (bits) {
      await sb.from('mission_logs').insert({
        mission_id: params.id, actor_id: actor.id, action: 'requisitoire_ocr',
        notes: `Lecture automatique du réquisitoire — ${bits}`,
        metadata: { extract },
      }).then(() => {}, () => {})
    }
  }

  return NextResponse.json({
    ok: true,
    ocr: extract ? {
      doc_type:  extract.doc_type,
      pv_number: extract.pv_number,
      plaque:    extract.plaque,
      vin:       extract.vin,
      autorite:  extract.autorite,
      date:      extract.date_requisition,
      heure:     extract.heure_requisition,
      date_adapted: dateAdapted,
      misfiled,
    } : null,
    ocr_error: ocrError,
  })
}
