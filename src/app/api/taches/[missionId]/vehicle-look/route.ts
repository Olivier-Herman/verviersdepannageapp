// src/app/api/taches/[missionId]/vehicle-look/route.ts
//
// POST — lit sur les photos du chauffeur ce que la fiche ne dit pas et dont
// l'assistance a besoin à l'ouverture du dossier (Olivier 28/09/2026) :
// couleur, type de boîte de vitesses, marque et modèle. Une seule lecture par
// fiche (gardée dans la prise en charge) ; la boîte complète la fiche si vide.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { tachesAccess } from '@/lib/taches/access'
import { extractJsonFromImages } from '@/lib/ocr/vision-json'
import type { Answers } from '@/lib/taches/accident-steps'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `Tu regardes les photos d'un véhicule accidenté prises par un dépanneur. Donne ce que tu VOIS, sans deviner.
Retourne UNIQUEMENT un JSON strict :
{ "color": <couleur de carrosserie en français, un ou deux mots (ex. "gris foncé"), ou null>,
  "gearbox": <"Automatique" si un levier ou sélecteur P-R-N-D est visible, "Manuelle" si une grille de vitesses 1-2-3-4-5-R est visible, sinon null>,
  "brand": <marque lisible sur le véhicule ou null>,
  "model": <modèle lisible sur le véhicule ou null> }`

export async function POST(_req: Request, { params }: { params: { missionId: string } }) {
  const acc = await tachesAccess()
  if (!acc.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions').select('id, driver_photos, vehicle_gearbox').eq('id', params.missionId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  const { data: run } = await sb.from('process_runs').select('answers').eq('mission_id', m.id).eq('process_key', 'accident_police').maybeSingle()
  const answers: Answers = (run?.answers as Answers) || {}
  if (answers.vehicle_look?.at) return NextResponse.json({ look: answers.vehicle_look, cached: true })

  const urls: string[] = (Array.isArray(m.driver_photos) ? m.driver_photos : []).slice(0, 8)
  if (!urls.length) return NextResponse.json({ look: null, error: 'Aucune photo sur la fiche.' })
  const images: { base64: string; mimeType: string }[] = []
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) continue
      const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0]
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) continue
      images.push({ base64: Buffer.from(await r.arrayBuffer()).toString('base64'), mimeType: type })
    } catch {}
  }
  if (!images.length) return NextResponse.json({ look: null, error: 'Photos illisibles.' })
  const out = await extractJsonFromImages(images, SYSTEM, 'Photos du véhicule. Retourne uniquement le JSON.', 300).catch((e: any) => ({ ok: false as const, error: e?.message || 'erreur' }))
  if (!out.ok) return NextResponse.json({ look: null, error: out.error })
  const d = out.data || {}
  const clean = (v: any) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null)
  const gearbox = d.gearbox === 'Automatique' || d.gearbox === 'Manuelle' ? d.gearbox : null
  const look = { color: clean(d.color), gearbox, brand: clean(d.brand), model: clean(d.model), at: new Date().toISOString() }
  await sb.from('process_runs').upsert({ mission_id: m.id, process_key: 'accident_police', answers: { ...answers, vehicle_look: look }, updated_at: look.at }, { onConflict: 'mission_id,process_key' })
  if (gearbox && !m.vehicle_gearbox) await sb.from('incoming_missions').update({ vehicle_gearbox: gearbox, updated_at: look.at }).eq('id', m.id)
  return NextResponse.json({ look })
}
