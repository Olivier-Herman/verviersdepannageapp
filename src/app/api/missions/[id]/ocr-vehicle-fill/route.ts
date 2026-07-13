// src/app/api/missions/[id]/ocr-vehicle-fill/route.ts
//
// POST — lance l'OCR (Claude Haiku) sur les PHOTOS CHAUFFEUR de la mission et
// COMPLÈTE les champs VIDES vehicle_plate / vehicle_vin (jamais d'écrasement).
// Déclenché manuellement depuis la fiche dispatch (bouton) pour une fiche déjà en
// parc — complément du filet auto à la mise en parc. Olivier 2026-07-13.
// Accès : dispatcher / admin / superadmin / fourrière.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { detectVehicleFromImages } from '@/lib/ocr/vehicle-detect'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const modules: string[] = user.modules || []
  const allowed = ['dispatcher', 'admin', 'superadmin'].some(r => r === role || roles.includes(r))
    || modules.includes('fourriere')
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const isSuperadmin = role === 'superadmin' || roles.includes('superadmin')

  const sb = createAdminClient()
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate, vehicle_vin, driver_photos, vehicle_ocr_attempted_at')
    .eq('id', params.id)
    .single()
  if (error || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Anti-gaspillage IA : une seule tentative OCR par fiche. Le superadmin peut
  // outrepasser (il assume le coût). Olivier 2026-07-13.
  if ((mission as any).vehicle_ocr_attempted_at && !isSuperadmin) {
    return NextResponse.json({ error: 'OCR déjà tenté sur cette fiche.' }, { status: 409 })
  }

  const photos: string[] = (mission.driver_photos as string[]) || []
  if (photos.length === 0) return NextResponse.json({ error: 'Aucune photo chauffeur sur la fiche.' }, { status: 400 })

  const plateEmpty = !((mission.vehicle_plate || '').trim())
  const vinEmpty   = !((mission.vehicle_vin as string || '').trim())

  let plate, vin
  try {
    ({ plate, vin } = await detectVehicleFromImages(photos.slice(0, 6)))
  } catch (e: any) {
    return NextResponse.json({ error: `OCR échec : ${e?.message || e}` }, { status: 500 })
  }

  const upd: Record<string, any> = {}
  if (vinEmpty   && vin?.value)   upd.vehicle_vin   = vin.value
  if (plateEmpty && plate?.value) upd.vehicle_plate = plate.value
  // Repli : aucune plaque lisible mais VIN connu → 5 derniers du châssis.
  if (plateEmpty && !upd.vehicle_plate) {
    const knownVin = (vin?.value || (mission.vehicle_vin as string) || '').trim()
    if (knownVin.length >= 5) upd.vehicle_plate = knownVin.slice(-5)
  }

  // Marqueur « tentative faite » posé à CHAQUE appel (même sans résultat) → borne
  // l'usage IA à une tentative par fiche (hors superadmin).
  const now = new Date().toISOString()
  const filledKeys = Object.keys(upd)
  upd.vehicle_ocr_attempted_at = now
  upd.updated_at = now
  await sb.from('incoming_missions').update(upd).eq('id', params.id)
  if (filledKeys.length > 0) {
    await sb.from('mission_logs').insert({
      mission_id: params.id, actor_id: user.id, action: 'vehicle_ocr_autofill',
      notes: `VIN/plaque complété(s) depuis les photos (manuel) : ${filledKeys.map(k => `${k}=${upd[k]}`).join(', ')}`,
      metadata: { source: 'manual_ocr', filled: filledKeys.reduce((o, k) => ({ ...o, [k]: upd[k] }), {}) },
    }).then(() => {}, () => {})
  }

  return NextResponse.json({
    ok: true,
    detected: { plate: plate?.value || null, vin: vin?.value || null },
    filled: { vehicle_plate: upd.vehicle_plate || null, vehicle_vin: upd.vehicle_vin || null },
    nothing: Object.keys(upd).length === 0,
  })
}
