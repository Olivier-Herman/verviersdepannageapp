// Vérifie que le téléphone est dans la zone de l'accueil (géofence Pepinster).
// GET /api/reception/geo-check?lat=..&lng=..  → { allowed }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase'
import { withinGeofence }            from '@/lib/reception/geofence'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const allowed = await withinGeofence(createAdminClient(), searchParams.get('lat'), searchParams.get('lng'))
  return NextResponse.json({ allowed })
}
