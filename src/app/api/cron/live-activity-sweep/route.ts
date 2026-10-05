// Cron : ferme la Live Activity (iPhone) de toute mission terminée, annulée ou mise au
// parc, quel que soit le chemin qui l'a terminée (clôture, dispatch, annulation
// assistance…). Avant, seule l'action chauffeur la fermait (Olivier 05/10/2026, 1VRK946).
import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { pushMissionLiveActivity } from '@/lib/native/pushLiveActivity'

export const dynamic = 'force-dynamic'
const TERMINAL = ['to_invoice', 'completed', 'invoiced', 'parked', 'cancelled', 'no_charge', 'ignored']

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data, error } = await sb.from('incoming_missions').select('id').not('live_activity_push_token', 'is', null).in('status', TERMINAL).limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let ended = 0
  for (const m of data || []) {
    const r = await pushMissionLiveActivity(m.id, { event: 'end' }).catch(() => null)
    if (r?.ok) ended++
    await sb.from('incoming_missions').update({ live_activity_push_token: null }).eq('id', m.id)
  }
  return NextResponse.json({ ok: true, found: (data || []).length, ended })
}
