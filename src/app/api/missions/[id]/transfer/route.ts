// GET  /api/missions/[id]/transfer → chauffeurs à qui transférer (nom + libre/occupé, sans distance :
//      pas de calcul Google facturé — Olivier 18/10/2026).
// POST /api/missions/[id]/transfer { action: 'request'|'cancel'|'accept'|'refuse', to_user_id?, reason?, called? }
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { requestTransfer, cancelTransfer, respondTransfer } from '@/lib/missions/pause-transfer'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: users } = await sb.from('users').select('id, name, role, roles, active').eq('active', true)
  const drivers = (users || []).filter((x: any) => x.id !== u.id && (x.role === 'driver' || (Array.isArray(x.roles) && (x.roles.includes('driver') || x.roles.includes('chauffeur')))))
  const { data: busy } = await sb.from('incoming_missions').select('assigned_to').in('status', ['accepted', 'on_way', 'on_site', 'in_progress', 'delivering']).is('paused_at', null).not('assigned_to', 'is', null)
  const occ = new Set((busy || []).map((r: any) => r.assigned_to))
  return NextResponse.json({ drivers: drivers.map((x: any) => ({ id: x.id, name: x.name, occupe: occ.has(x.id) })).sort((a: any, b: any) => Number(a.occupe) - Number(b.occupe) || a.name.localeCompare(b.name, 'fr')) })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  const actor = { id: u.id, name: u.name || 'Chauffeur' }
  try {
    if (b.action === 'request') return NextResponse.json({ ok: true, ...(await requestTransfer(sb, params.id, actor, String(b.to_user_id || ''), String(b.reason || '').slice(0, 120), b.called === true)) })
    if (b.action === 'cancel')  return NextResponse.json({ ok: true, ...(await cancelTransfer(sb, params.id, actor)) })
    if (b.action === 'accept')  return NextResponse.json({ ok: true, ...(await respondTransfer(sb, params.id, actor, true)) })
    if (b.action === 'refuse')  return NextResponse.json({ ok: true, ...(await respondTransfer(sb, params.id, actor, false)) })
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e?.message || String(e) }, { status: 400 }) }
}
