// src/app/api/taches/[missionId]/documents/route.ts
//
// POST (multipart, files[]) — les pages scannées ou photographiées de tout ce
// qui était à bord. On les range sur la fiche (mission_documents, kind
// 'parc_scan'), on les lit d'un coup, on garde la lecture dans le run et on
// complète la fiche avec ce qui manque (nom, téléphone, mail, adresse, châssis).
// La question « Scanner » se coche seule ici (answers.scan = 'fait').
//
// Rafale (Olivier 28/09/2026) : une requête est plafonnée vers 4,5 Mo, soit
// trois photos. Le navigateur envoie donc chaque page directement au stockage :
//   POST { sign: [{ mime }] }                → une adresse d'envoi par page ;
//   POST { read: [{ path, name, mime }] }    → rattache les pages à la fiche et
//                                              les lit en une fois.
// Le multipart d'origine reste accepté (petits lots, chargeur du scanner).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tachesAccess } from '@/lib/taches/access'
import { readVehicleDocuments, type PageInput } from '@/lib/taches/read-documents'
import type { Answers } from '@/lib/taches/accident-steps'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

const BUCKET = 'mission-documents'
const MAX_PAGES = 40

export async function POST(req: Request, { params }: { params: { missionId: string } }) {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, vehicle_plate, vehicle_vin, client_name, client_phone, client_email, client_address').eq('id', params.missionId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })

  const pages: PageInput[] = []
  const stored: string[] = []
  const extOf = (mime: string) => mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'
  const okMime = (mime: string) => /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(mime)
  const stamp = Date.now()

  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    // 1) Adresses d'envoi direct vers le stockage, une par page.
    if (Array.isArray(body.sign)) {
      const list = body.sign.slice(0, MAX_PAGES)
      const uploads: { path: string; url: string }[] = []
      for (let i = 0; i < list.length; i++) {
        const mime = String(list[i]?.mime || 'image/jpeg')
        if (!okMime(mime)) return NextResponse.json({ error: `Format refusé : ${mime}` }, { status: 400 })
        const path = `${m.id}/parc_scan/${stamp}_${Math.random().toString(36).slice(2, 8)}_${i + 1}.${extOf(mime)}`
        const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
        if (error || !data) return NextResponse.json({ error: `Envoi impossible : ${error?.message || 'stockage'}` }, { status: 500 })
        uploads.push({ path, url: data.signedUrl })
      }
      return NextResponse.json({ uploads })
    }
    // 2) Lecture des pages déjà envoyées.
    const list: { path: string; name?: string; mime?: string }[] = Array.isArray(body.read) ? body.read.slice(0, MAX_PAGES) : []
    if (!list.length) return NextResponse.json({ error: 'Aucune page reçue.' }, { status: 400 })
    for (let i = 0; i < list.length; i++) {
      const path = String(list[i].path || '')
      if (!path.startsWith(`${m.id}/parc_scan/`)) return NextResponse.json({ error: 'Page étrangère à cette fiche.' }, { status: 400 })
      const { data: blob, error } = await sb.storage.from(BUCKET).download(path)
      if (error || !blob) return NextResponse.json({ error: `Page ${i + 1} introuvable : réessayer l’envoi.` }, { status: 400 })
      const buf = Buffer.from(await blob.arrayBuffer())
      const mime = String(list[i].mime || blob.type || 'image/jpeg')
      const { data: doc } = await sb.from('mission_documents').insert({
        mission_id: m.id, kind: 'parc_scan', file_path: path, file_name: list[i].name || `scan_${i + 1}.${extOf(mime)}`, mime_type: mime, file_size: buf.length, uploaded_by: acc.userId,
      }).select('id').single()
      if (doc) stored.push(doc.id)
      pages.push({ base64: buf.toString('base64'), mimeType: mime })
    }
  } else {
    const form = await req.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PAGES)
    if (!files.length) return NextResponse.json({ error: 'Aucune page reçue.' }, { status: 400 })
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const buf = Buffer.from(await f.arrayBuffer())
      const mime = f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      const path = `${m.id}/parc_scan/${stamp}_${i + 1}.${extOf(mime)}`
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: false })
      if (upErr) return NextResponse.json({ error: `Enregistrement impossible : ${upErr.message}` }, { status: 500 })
      const { data: doc } = await sb.from('mission_documents').insert({
        mission_id: m.id, kind: 'parc_scan', file_path: path, file_name: f.name || `scan_${i + 1}.${extOf(mime)}`, mime_type: mime, file_size: buf.length, uploaded_by: acc.userId,
      }).select('id').single()
      if (doc) stored.push(doc.id)
      pages.push({ base64: buf.toString('base64'), mimeType: mime })
    }
  }
  const pageCount = pages.length

  const read = await readVehicleDocuments(pages, { plate: m.vehicle_plate, vin: m.vehicle_vin })
  const now = new Date().toISOString()
  const { data: run } = await sb.from('process_runs').select('answers, status, started_by').eq('mission_id', m.id).eq('process_key', 'accident_police').maybeSingle()
  const answers: Answers = { ...((run?.answers as Answers) || {}), docs: 'oui', scan: 'fait' }
  const reading = read.ok ? read.reading : null
  await sb.from('process_runs').upsert({ mission_id: m.id, process_key: 'accident_police', status: 'todo', answers, reading, updated_at: now, ...(run ? {} : { started_by: acc.userId }) }, { onConflict: 'mission_id,process_key' })
  if (stored.length && reading) await sb.from('mission_documents').update({ ocr: reading }).in('id', stored)

  // La fiche reçoit ce qu'elle n'avait pas encore — jamais d'écrasement.
  const patch: Record<string, any> = {}
  if (reading?.owner?.name && !m.client_name) patch.client_name = reading.owner.name
  if (reading?.owner?.phone && !m.client_phone) patch.client_phone = reading.owner.phone
  if (reading?.owner?.email && !m.client_email) patch.client_email = reading.owner.email
  if (reading?.owner?.address && !m.client_address) patch.client_address = reading.owner.address
  if (reading?.vin && !m.vehicle_vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(reading.vin)) patch.vehicle_vin = reading.vin.toUpperCase()
  if (Object.keys(patch).length) await sb.from('incoming_missions').update({ ...patch, updated_at: now }).eq('id', m.id)

  const present = (reading?.documents || []).filter(d => d.present).map(d => d.type)
  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: acc.userId, action: 'documents_scanned',
    notes: read.ok
      ? `Documents du véhicule scannés (${pageCount} page${pageCount > 1 ? 's' : ''}) : ${present.join(', ') || 'rien de reconnu'}${reading?.owner?.name ? ` — titulaire ${reading.owner.name}` : ''}${reading?.insurer?.name ? ` — assureur ${reading.insurer.name}` : ''}.`
      : `Documents du véhicule scannés (${pageCount} page${pageCount > 1 ? 's' : ''}) — lecture impossible : ${(read as any).error}.`,
    metadata: { documents: stored, patched: Object.keys(patch) },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: read.ok, reading, error: read.ok ? undefined : (read as any).error, documents: stored.length, patched: Object.keys(patch) })
}
