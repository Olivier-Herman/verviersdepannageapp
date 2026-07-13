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

  const sb = createAdminClient()
  const { data: mission, error } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate, vehicle_vin, driver_photos')
    .eq('id', params.id)
    .single()
  if (error || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

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

  if (Object.keys(upd).length > 0) {
    upd.updated_at = new Date().toISOString()
    await sb.from('incoming_missions').update(upd).eq('id', params.id)
    await sb.from('mission_logs').insert({
      mission_id: params.id, actor_id: user.id, action: 'vehicle_ocr_autofill',
      notes: `VIN/plaque complété(s) depuis les photos (manuel) : ${Object.entries(upd).filter(([k]) => k !== 'updated_at').map(([k, v]) => `${k}=${v}`).join(', ')}`,
      metadata: { source: 'manual_ocr', filled: upd },
    }).then(() => {}, () => {})
  }

  return NextResponse.json({
    ok: true,
    detected: { plate: plate?.value || null, vin: vin?.value || null },
    filled: { vehicle_plate: upd.vehicle_plate || null, vehicle_vin: upd.vehicle_vin || null },
    nothing: Object.keys(upd).length === 0,
  })
}
