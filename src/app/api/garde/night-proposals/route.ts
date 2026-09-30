// src/app/api/garde/night-proposals/route.ts
//
// Interrupteur « Garde de nuit automatique » (Olivier 30/09/2026) : le dispatcher
// de garde ou un superadmin l'active depuis le tableau de bord quand il va dormir.
// Activé = propositions au 1er départ (appel après 2 min) puis à la réserve ;
// désactivé = simple info. Vaut pour la nuit en cours (retour à « désactivé » à 8 h).
// Cf lib/missions/market-proposals.ts (readNightSwitch).
//
// GET  → { canToggle, on, inNight, nightKey, byName, at }
// POST { on: boolean }

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { gardeNight }        from '@/lib/missions/market-notify'
import { readNightSwitch }   from '@/lib/missions/market-proposals'

export const dynamic = 'force-dynamic'

async function canToggle(sb: ReturnType<typeof createAdminClient>, user: any): Promise<boolean> {
  const roles: string[] = Array.isArray(user?.roles) ? user.roles : []
  if (user?.role === 'superadmin' || roles.includes('superadmin')) return true
  const { data: duty } = await sb.from('dispatcher_on_duty').select('user_id').eq('id', 1).maybeSingle()
  return !!user?.id && duty?.user_id === user.id
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  if (!(await canToggle(sb, user))) return NextResponse.json({ canToggle: false })
  const night = await gardeNight(sb)
  const sw = await readNightSwitch(sb, night?.nightKey || null)
  return NextResponse.json({ canToggle: true, on: sw.on, inNight: !!night?.inNight, nightKey: night?.nightKey || null, byName: sw.byName, at: sw.at })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { on?: unknown }
  if (typeof body.on !== 'boolean') return NextResponse.json({ error: 'on requis' }, { status: 400 })
  const sb = createAdminClient()
  if (!(await canToggle(sb, user))) return NextResponse.json({ error: 'Réservé au dispatcher de garde et aux superadmins.' }, { status: 403 })
  const night = await gardeNight(sb)
  if (!night) return NextResponse.json({ error: 'Planning de garde introuvable.' }, { status: 500 })
  const { data: me } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
  const value = { night: body.on ? night.nightKey : null, by: user.id, byName: me?.name || user.name || null, at: new Date().toISOString() }
  const { error } = await sb.from('app_settings').upsert({ key: 'market_proposals_actif', value: JSON.stringify(value), updated_at: value.at }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, on: body.on, inNight: night.inNight, nightKey: night.nightKey, byName: value.byName, at: value.at })
}
