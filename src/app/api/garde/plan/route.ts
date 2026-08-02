// src/app/api/garde/plan/route.ts
//
// Planning de garde (rotation prévue).
// GET ?events=1&from=&to=  → planning jour par jour avec noms (tout user connecté)
// GET                      → config + chauffeurs (RH/superadmin, pour éditer)
// POST                     → enregistre la config (RH/superadmin)

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPersonnelStaff }  from '@/lib/rh-access'
import { computeGardePlan, mondayOf, GARDE_HOURS_DEFAULT, type GardeConfig } from '@/lib/garde/plan'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const KEY = 'garde_config'
const pad2 = (n: number) => String(n).padStart(2, '0')
const isoD = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

async function loadConfig(sb: any): Promise<GardeConfig> {
  const { data } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  const def: GardeConfig = { anchor_monday: isoD(mondayOf(new Date())), weekly: [], wednesday: [], night_fixed: null, ...GARDE_HOURS_DEFAULT }
  if (!data?.value) return def
  try { const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value; return { ...def, ...v } } catch { return def }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const cfg = await loadConfig(sb)
  const sp = req.nextUrl.searchParams

  if (sp.get('events') === '1') {
    const from = sp.get('from'), to = sp.get('to')
    if (!from || !to) return NextResponse.json({ error: 'from/to requis' }, { status: 400 })
    const days = computeGardePlan(cfg, new Date(from + 'T00:00:00'), new Date(to + 'T00:00:00'))
    const ids = [...new Set(days.flatMap(d => [d.weekly_garde, d.night_first]).filter(Boolean) as string[])]
    const { data: us } = ids.length ? await sb.from('users').select('id, name').in('id', ids) : { data: [] }
    const nameById = new Map((us || []).map((x: any) => [x.id, x.name]))
    let enriched = days.map(d => ({ ...d, weekly_garde_name: d.weekly_garde ? nameById.get(d.weekly_garde) || '?' : null, night_first_name: d.night_first ? nameById.get(d.night_first) || '?' : null }))
    if (sp.get('mine') === '1') {
      enriched = enriched
        .map(d => ({ ...d, mine_role: d.weekly_garde === u.id ? 'semaine' : (d.night_first === u.id ? 'nuit1' : null) }))
        .filter(d => (d as any).mine_role) as any
    }
    return NextResponse.json({ days: enriched, hours: { day_start: cfg.day_start, day_end: cfg.day_end, night_start: cfg.night_start, night_end: cfg.night_end } })
  }

  // Édition config (RH/superadmin)
  if (!isPersonnelStaff(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: drivers } = await sb.from('users').select('id, name').eq('active', true).or('role.eq.driver,roles.ov.{driver,chauffeur}').order('name')
  return NextResponse.json({ config: cfg, drivers: drivers || [] })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!isPersonnelStaff(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const b = await req.json().catch(() => ({}))
  const clean = (a: any) => Array.isArray(a) ? a.filter((x: any) => typeof x === 'string' && x) : []
  const cfg: GardeConfig = {
    anchor_monday: isoD(mondayOf(new Date(String(b.anchor_monday || isoD(mondayOf(new Date()))) + 'T00:00:00'))),
    weekly: clean(b.weekly), wednesday: clean(b.wednesday),
    night_fixed: b.night_fixed || null,
    day_start: String(b.day_start || GARDE_HOURS_DEFAULT.day_start), day_end: String(b.day_end || GARDE_HOURS_DEFAULT.day_end),
    night_start: String(b.night_start || GARDE_HOURS_DEFAULT.night_start), night_end: String(b.night_end || GARDE_HOURS_DEFAULT.night_end),
  }
  await sb.from('app_settings').upsert({ key: KEY, value: JSON.stringify(cfg) }, { onConflict: 'key' })
  return NextResponse.json({ ok: true })
}
