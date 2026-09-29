// src/app/api/fines/batch/route.ts
//
// POST /api/fines/batch   (multipart : files[])
//   Capture par lot de PV scannés (un fichier = un PV). Pour chaque scan :
//   upload dans le bucket 'fines' → OCR Claude (plaque/date/montant/lieu/type/
//   n° PV) → suggestion chauffeur → INSERT amende en BROUILLON (status 'pending',
//   montant nullable, PAS d'envoi aux achats). L'envoi se fait plus tard, quand
//   le montant est renseigné. Accès : admin / superadmin / module facturation.
//
// Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { ingestFineScan, normFineRef } from '@/lib/fines/ingest'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const MAX_FILES = 12   // borne les appels Claude (maxDuration 60s)

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name').eq('email', user.email).maybeSingle()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  const form = await req.formData()
  const files = (form.getAll('files') as File[]).filter(f => f && f.size > 0)
  if (files.length === 0) return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })

  const created: any[] = []
  const errors: { name: string; error: string }[] = []
  const duplicates: { name: string; ref: string; existing_id: string | null; existing_plate: string | null }[] = []
  const toProcess = files.slice(0, MAX_FILES)
  const skipped = files.length - toProcess.length

  // Anti-doublon sur le n° de PV : on charge les refs déjà présents (normalisés).
  const { data: existingRefs } = await sb.from('fines').select('id, plate, infraction_ref').not('infraction_ref', 'is', null)
  const seen = new Map<string, { id: string | null; plate: string | null }>()
  for (const r of (existingRefs || []) as any[]) { const n = normFineRef(r.infraction_ref); if (n) seen.set(n, { id: r.id, plate: r.plate }) }

  for (const file of toProcess) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      const ext = file.name.includes('.') ? file.name.split('.').pop()! : (mime.includes('pdf') ? 'pdf' : 'jpg')
      const r = await ingestFineScan(sb, { buffer, mime, ext, actorId: me.id }, seen)
      if (r.status === 'duplicate') { duplicates.push({ name: file.name, ref: r.ref, existing_id: r.existing_id, existing_plate: r.existing_plate }); continue }
      created.push({ ...r.fine, ocr: r.ocr })
    } catch (err: any) {
      errors.push({ name: file.name, error: err?.message || 'échec' })
    }
  }

  return NextResponse.json({ ok: true, created, errors, duplicates, skipped })
}
