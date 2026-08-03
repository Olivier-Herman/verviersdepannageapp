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
import { extractFineFromScan } from '@/lib/fines/extract-fine'
import { suggestDriverForFine } from '@/lib/fines/suggest-driver'
import { parseTowsoftDateUTC } from '@/lib/towsoft-client'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const ONE_YEAR = 60 * 60 * 24 * 365
const MAX_FILES = 12   // borne les appels Claude (maxDuration 60s)
const normPlate = (p: string | null) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

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
  const normRef = (s: string | null) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const { data: existingRefs } = await sb.from('fines').select('id, plate, infraction_ref').not('infraction_ref', 'is', null)
  const refToFine = new Map<string, { id: string; plate: string | null }>()
  for (const r of (existingRefs || []) as any[]) { const n = normRef(r.infraction_ref); if (n) refToFine.set(n, { id: r.id, plate: r.plate }) }
  const seenRefs = new Set<string>(refToFine.keys())

  for (const file of toProcess) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const base64 = buffer.toString('base64')
      const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')
      const ext = file.name.includes('.') ? file.name.split('.').pop() : (mime.includes('pdf') ? 'pdf' : 'jpg')

      // 1. OCR d'abord (pour connaître le n° de PV avant tout upload/insert)
      const ex = await extractFineFromScan(base64, mime)

      // 2. Anti-doublon : si le n° de PV existe déjà → on ne recrée pas.
      const refN = normRef(ex.infraction_ref)
      if (refN && seenRefs.has(refN)) {
        const ex0 = refToFine.get(refN)
        duplicates.push({ name: file.name, ref: ex.infraction_ref || '', existing_id: ex0?.id || null, existing_plate: ex0?.plate || null })
        continue
      }

      // 3. Upload scan
      const path = `${me.id}/${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`
      const { error: upErr } = await sb.storage.from('fines').upload(path, buffer, { contentType: mime, upsert: false })
      if (upErr) throw new Error(`upload: ${upErr.message}`)
      const { data: signed } = await sb.storage.from('fines').createSignedUrl(path, ONE_YEAR)

      // 4. Suggestion chauffeur (si plaque + date lisibles)
      let driverId: string | null = null
      let matchMethod: 'auto' | 'none' = 'none'
      let matchConfidence: string | null = null
      let missionId: string | null = null
      // Le PV porte une heure LOCALE Belgique → parseTowsoftDateUTC l'interprète
      // en Europe/Brussels (évite le décalage +2h). Défaut : maintenant.
      const infractionDate = parseTowsoftDateUTC(ex.infraction_date) || new Date().toISOString()
      if (ex.plate && ex.infraction_date) {
        try {
          const sug = await suggestDriverForFine(normPlate(ex.plate), new Date(infractionDate))
          if (sug.driver_id) { driverId = sug.driver_id; missionId = sug.mission_id; matchMethod = 'auto'; matchConfidence = sug.confidence }
        } catch { /* best-effort */ }
      }

      // 4. Insert brouillon (pas d'email achats)
      const { data: fine, error: insErr } = await sb.from('fines').insert({
        photo_url:               signed?.signedUrl || path,
        infraction_date:         infractionDate,
        infraction_place:        ex.infraction_place,
        infraction_type:         ex.infraction_type,
        infraction_ref:          ex.infraction_ref,
        identification_code:     ex.identification_code,
        amount:                  ex.amount,              // souvent null (à compléter)
        plate:                   ex.plate ? normPlate(ex.plate) : '—',
        driver_id:               driverId,
        driver_match_method:     matchMethod,
        driver_match_confidence: matchConfidence,
        mission_id:              missionId,
        status:                  'pending',
        purchase_email_sent:     false,
        created_by:              me.id,
      }).select('id, plate, amount, infraction_date, infraction_type, infraction_ref').single()
      if (insErr) throw new Error(insErr.message)

      if (refN) seenRefs.add(refN)   // évite un doublon dans le même lot
      created.push({ ...fine, ocr: ex })
    } catch (err: any) {
      errors.push({ name: file.name, error: err?.message || 'échec' })
    }
  }

  return NextResponse.json({ ok: true, created, errors, duplicates, skipped })
}
