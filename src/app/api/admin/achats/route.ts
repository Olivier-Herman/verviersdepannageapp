// src/app/api/admin/achats/route.ts
//
// Moteur d'optimisation des achats — agrégats des factures fournisseurs Odoo +
// répertoire fournisseurs (fusions parent/doublons + exclusions non-achat),
// stocké côté VD Soft (app_settings, Odoo jamais modifié). Superadmin.
// Olivier 2026-07-31.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { analyzeAchats, type SupplierConfig } from '@/lib/achats/odoo-spend'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 60

const KEY = 'achats_supplier_config'
const DEFAULT: SupplierConfig = { merges: {}, excluded: [] }

async function loadConfig(sb: any): Promise<SupplierConfig> {
  const { data } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  if (!data?.value) return { ...DEFAULT }
  try {
    const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    return { merges: v.merges || {}, excluded: v.excluded || [] }
  } catch { return { ...DEFAULT } }
}
const saveConfig = (sb: any, cfg: SupplierConfig) =>
  sb.from('app_settings').upsert({ key: KEY, value: JSON.stringify(cfg) }, { onConflict: 'key' })

function isSuper(u: any) { return u?.role === 'superadmin' || (u?.roles || []).includes('superadmin') }

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const months = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('months') || '12'), 1), 24)
  const sb = createAdminClient()
  try {
    const config = await loadConfig(sb)
    const data = await analyzeAchats(months, config)
    return NextResponse.json({ ok: true, config, ...data })
  } catch (e: any) {
    console.error('[admin/achats]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()
  const cfg = await loadConfig(sb)
  const canon = (id: number) => cfg.merges[id] ?? id

  if (action === 'merge') {
    // Fusionne childId dans canonicalId (le fournisseur « à garder »).
    const child = Number(body.childId), into = Number(body.canonicalId)
    if (!child || !into || child === into) return NextResponse.json({ error: 'ids invalides' }, { status: 400 })
    cfg.merges[child] = into
    // Si des fiches pointaient vers child, les re-pointer vers la nouvelle cible.
    for (const k of Object.keys(cfg.merges)) if (cfg.merges[k] === child) cfg.merges[k] = into
    cfg.excluded = cfg.excluded.filter(id => id !== child)   // un membre fusionné n'est plus canonique
  } else if (action === 'unmerge') {
    delete cfg.merges[Number(body.childId)]
  } else if (action === 'exclude') {
    const id = canon(Number(body.id))
    if (!cfg.excluded.includes(id)) cfg.excluded.push(id)
  } else if (action === 'include') {
    cfg.excluded = cfg.excluded.filter(id => id !== Number(body.id))
  } else {
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  }

  await saveConfig(sb, cfg)
  return NextResponse.json({ ok: true, config: cfg })
}
