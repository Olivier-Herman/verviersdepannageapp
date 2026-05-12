// src/app/api/admin/sources/route.ts
//
// CRUD du catalogue des sources de mission.
//
// GET    /api/admin/sources           → { sources: [...] } (avec count missions par source)
// POST   /api/admin/sources           → { key, label, sort_order? }
// PATCH  /api/admin/sources           → { key, label?, active?, sort_order?, notes? }
// DELETE /api/admin/sources?key=...   → supprime si pas de missions historiques, sinon force active=false

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return { error: 'Forbidden', status: 403 } as const
  }
  return { user } as const
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const sb = createAdminClient()

  const { data: sources } = await sb
    .from('mission_source_catalog')
    .select('*')
    .order('sort_order')
    .order('label')

  // Count missions par source (utile pour decider archivage vs suppression)
  const { data: missions } = await sb
    .from('incoming_missions')
    .select('source')
    .not('source', 'is', null)
    .limit(10000)

  const counts = new Map<string, number>()
  for (const m of missions || []) {
    if (!m.source) continue
    counts.set(m.source, (counts.get(m.source) || 0) + 1)
  }

  // Compter aussi les mappings mission_sources qui referencent cette source
  const { data: mappings } = await sb.from('mission_sources').select('source')
  const mappingCounts = new Map<string, number>()
  for (const ms of mappings || []) {
    mappingCounts.set(ms.source, (mappingCounts.get(ms.source) || 0) + 1)
  }

  // Surcharge_clients lies a cette source
  const { data: clientLinks } = await sb.from('surcharge_clients').select('key')
  const surchargeSet = new Set((clientLinks || []).map(c => c.key))

  return NextResponse.json({
    sources: (sources || []).map(s => ({
      ...s,
      mission_count:    counts.get(s.key) || 0,
      mapping_count:    mappingCounts.get(s.key) || 0,
      has_surcharge:    surchargeSet.has(s.key),
    })),
  })
}

function normalizeKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

export async function POST(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as { key?: string; label?: string; sort_order?: number; notes?: string }
  const label = (body.label || '').trim()
  if (!label) return NextResponse.json({ error: 'Libellé requis' }, { status: 400 })

  const key = body.key ? normalizeKey(body.key) : normalizeKey(label)
  if (!key) return NextResponse.json({ error: 'Clé invalide' }, { status: 400 })

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('mission_source_catalog')
    .insert({
      key,
      label,
      sort_order: body.sort_order ?? 100,
      notes:      body.notes || null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `La clé "${key}" existe déjà` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ source: data })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json() as { key?: string; label?: string; active?: boolean; sort_order?: number; notes?: string }
  const key = (body.key || '').trim()
  if (!key) return NextResponse.json({ error: 'key requis' }, { status: 400 })

  const update: any = { updated_at: new Date().toISOString() }
  if (body.label !== undefined)      update.label      = body.label.trim()
  if (body.active !== undefined)     update.active     = body.active
  if (body.sort_order !== undefined) update.sort_order = body.sort_order
  if (body.notes !== undefined)      update.notes      = body.notes

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('mission_source_catalog')
    .update(update)
    .eq('key', key)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ source: data })
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin()
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(req.url)
  const key = (searchParams.get('key') || '').trim()
  const force = searchParams.get('force') === '1'
  if (!key) return NextResponse.json({ error: 'key requis' }, { status: 400 })

  const sb = createAdminClient()

  // Si des missions utilisent cette source → on refuse la suppression dure
  // mais on peut soft-delete via PATCH active=false. Ou force=1 pour ignorer.
  const { count } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .eq('source', key)

  if ((count || 0) > 0 && !force) {
    return NextResponse.json({
      error: `${count} mission(s) historique(s) utilisent cette source. Désactive-la plutôt que de la supprimer.`,
      mission_count: count,
    }, { status: 409 })
  }

  const { error } = await sb.from('mission_source_catalog').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
