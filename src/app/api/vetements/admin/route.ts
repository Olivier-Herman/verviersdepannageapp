// GET  /api/vetements/admin → campagne, personnes (taille ou en attente), totaux.
// POST /api/vetements/admin { action: 'exclude'|'include'|'remind'|'close'|'open', user_id? }
// Réservé admin / superadmin. Module temporaire (Olivier 09/10/2026).
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'
import { getCampagne, saveCampagne, personnelConcerne, TAILLES } from '@/lib/vetements'

export const dynamic = 'force-dynamic'

async function state() {
  const camp = await getCampagne()
  const people = await personnelConcerne(camp)
  const { data: t } = await createAdminClient().from('tailles_vetements').select('user_id, tshirt, pull, answered_at, updated_at')
  const byId = new Map((t || []).map((x: any) => [x.user_id, x]))
  const rows = people.map(p => ({ ...p, tshirt: byId.get(p.id)?.tshirt || null, pull: byId.get(p.id)?.pull || null, answered_at: byId.get(p.id)?.answered_at || null }))
  const counted = rows.filter(r => !r.excluded && r.tshirt)
  const totals = TAILLES.map(s => ({ size: s, tshirt: counted.filter(r => r.tshirt === s).length, pull: counted.filter(r => r.pull === s).length }))
  return { campagne: camp, rows, totals, sizes: TAILLES }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  return NextResponse.json(await state())
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const camp = await getCampagne()
  const uid = String(b.user_id || '')
  if (b.action === 'exclude' && uid) camp.excluded = [...new Set([...camp.excluded, uid])]
  else if (b.action === 'include' && uid) camp.excluded = camp.excluded.filter(x => x !== uid)
  else if (b.action === 'close') camp.active = false
  else if (b.action === 'open') camp.active = true
  else if (b.action === 'remind') {
    const s = await state()
    const waiting = s.rows.filter(r => !r.excluded && !r.tshirt)
    for (const r of waiting) await sendNotification(r.id, 'feature_announcement', {
      title: '👕 Sam attend tes tailles', body: 'Ouvre l’app : il me faut ta taille de t-shirt et de pull, aujourd’hui.', action_url: '/dashboard',
    }).catch(() => {})
    return NextResponse.json({ ...(await state()), reminded: waiting.length })
  } else return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  await saveCampagne(camp)
  return NextResponse.json(await state())
}
