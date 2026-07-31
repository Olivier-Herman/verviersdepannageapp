// Config géofence de l'accueil (centre + rayon) pour le suivi continu côté borne.
// Non sensible (une localisation d'entreprise) ; la sécurité repose sur le vrai
// GPS du téléphone, revalidé côté serveur au check-in.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getGeofence }       from '@/lib/reception/geofence'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET() {
  const g = await getGeofence(createAdminClient())
  return NextResponse.json(g)
}
