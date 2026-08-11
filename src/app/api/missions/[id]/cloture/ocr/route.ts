// src/app/api/missions/[id]/cloture/ocr/route.ts
//
// FLUX 2 — lecture des photos du chauffeur pour remplir CHÂSSIS + KILOMÉTRAGE.
// Olivier 2026-08-11, remonté par Franck : « les km ne se sont pas complétés
// malgré sa photo ». Le compteur est photographié à chaque mission — autant le
// lire plutôt que de le faire retaper.
//
// Deux garde-fous :
//   • on ne renvoie que des valeurs VALIDÉES (VIN 17 car., km entier plausible) —
//     l'OCR préfère null à une approximation, jamais de chiffre deviné ;
//   • on ne PERSISTE que ce qui manque : une valeur déjà saisie par le chauffeur
//     ou reçue de l'assistance n'est jamais écrasée.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { flux2Enabled }      from '@/lib/cloture/gating'
import { detectVehicleFromImages } from '@/lib/ocr/vehicle-detect'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users')
    .select('id, role, roles').eq('email', session.user.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, source, source_format, assigned_to, driver_photos, vehicle_vin, vehicle_mileage')
    .eq('id', params.id).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!(await flux2Enabled(actor as any, m as any))) {
    return NextResponse.json({ error: 'Flux 2 non activé pour cette mission' }, { status: 403 })
  }

  const photos: string[] = ((m as any).driver_photos as string[]) || []
  if (photos.length === 0) return NextResponse.json({ vin: null, km: null, photos: 0 })

  try {
    // Les dernières photos d'abord : le compteur et le châssis sont en général
    // pris au moment de la clôture, pas au début de la mission.
    const { vin, mileage } = await detectVehicleFromImages(photos.slice(-6))

    const patch: Record<string, any> = {}
    if (vin?.value && !(m as any).vehicle_vin) patch.vehicle_vin = vin.value
    if (mileage?.value && (m as any).vehicle_mileage == null) patch.vehicle_mileage = mileage.value
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await sb.from('incoming_missions').update(patch).eq('id', (m as any).id)
      await sb.from('mission_logs').insert({
        mission_id: (m as any).id, actor_id: (actor as any)?.id, action: 'vehicle_ocr_autofill',
        notes: `Lu sur les photos (clôture flux 2) : ${[
          patch.vehicle_vin ? `châssis ${patch.vehicle_vin}` : null,
          patch.vehicle_mileage ? `${patch.vehicle_mileage} km` : null,
        ].filter(Boolean).join(' · ')}`,
        metadata: { source: 'flux2_close_ocr', ...patch },
      }).then(() => {}, () => {})
    }

    return NextResponse.json({
      vin: vin?.value || (m as any).vehicle_vin || null,
      km:  mileage?.value ?? (m as any).vehicle_mileage ?? null,
      read: { vin: !!vin?.value, km: !!mileage?.value },
      photos: photos.length,
    })
  } catch (e: any) {
    // L'OCR ne doit JAMAIS empêcher une clôture : en cas d'échec, le chauffeur saisit.
    return NextResponse.json({ vin: null, km: null, error: e?.message || 'OCR indisponible' })
  }
}
