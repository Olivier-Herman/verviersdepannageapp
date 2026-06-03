// src/app/api/schedule/active/route.ts
//
// Olivier 2026-06-03 : endpoint public (auth seulement) qui retourne les
// plages actives groupees par kind. Utilise par DispatchClient pour
// afficher les vraies heures dans la modal "Activer/désactiver la garde".

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data, error } = await sb
    .from('schedule_periods')
    .select('kind, hour_start, hour_end, cross_midnight')
    .eq('active', true)
    .order('hour_start')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const grouped = { day: [] as any[], night: [] as any[], autodispatch_night: [] as any[] }
  for (const r of data || []) {
    const cfg = {
      hour_start: Number(r.hour_start),
      hour_end:   Number(r.hour_end),
      cross_midnight: !!r.cross_midnight,
    }
    if (r.kind === 'day')                      grouped.day.push(cfg)
    else if (r.kind === 'night')               grouped.night.push(cfg)
    else if (r.kind === 'autodispatch_night')  grouped.autodispatch_night.push(cfg)
  }
  return NextResponse.json(grouped)
}
