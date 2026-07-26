// POST /api/missions/live-activity-debug  { stage, missionId?, data? }
// Traceur temporaire pour diagnostiquer le démarrage de la Live Activity sur le
// device d'un chauffeur (on ne peut pas lire ses logs Xcode). Chaque étape de
// startForMission poste ici → on lit la dernière trace côté serveur.
// Olivier 2026-07-26. À retirer une fois le souci réglé.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email || 'anon'
  const body = await req.json().catch(() => ({}))
  try {
    await createAdminClient().from('app_settings').upsert({
      key: 'la_debug_last',
      value: { at: new Date().toISOString(), user: email, stage: body?.stage || '?', missionId: body?.missionId || null, data: body?.data ?? null },
    }, { onConflict: 'key' })
  } catch { /* best-effort */ }
  return NextResponse.json({ ok: true })
}
