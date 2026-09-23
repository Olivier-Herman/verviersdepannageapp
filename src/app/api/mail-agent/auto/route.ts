// GET : réglage d'automatisation par famille + statistiques de décisions.
// POST { family, action | null } : (dés)active l'automatique d'une famille. Superadmin.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { readAutoFamilies, autoStats, FAMILIES, PROPOSALS } from '@/lib/mail-agent/triage'
export const dynamic = 'force-dynamic'
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['admin', 'superadmin'] }).ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  return NextResponse.json({ auto: await readAutoFamilies(sb), stats: await autoStats(sb), families: FAMILIES, proposals: PROPOSALS })
}
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!sessionAccess(session, { roles: ['superadmin'] }).ok) return NextResponse.json({ error: 'Superadmin requis' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const family = String(body.family || ''); const action = body.action ? String(body.action) : null
  if (!FAMILIES[family]) return NextResponse.json({ error: 'Famille inconnue' }, { status: 400 })
  if (action && !(PROPOSALS[family] || []).some(p => p.key === action) && action !== 'classer') return NextResponse.json({ error: 'Action inconnue pour cette famille' }, { status: 400 })
  const sb = createAdminClient()
  const cur = await readAutoFamilies(sb); cur[family] = action
  await sb.from('app_settings').upsert({ key: 'mail_agent_auto', value: JSON.stringify(cur), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  return NextResponse.json({ ok: true, auto: cur })
}
