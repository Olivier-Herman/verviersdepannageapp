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
import { normPlate } from '@/lib/achats/parse-invoice'

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

  const sp = new URL(req.url).searchParams
  const months = Math.min(Math.max(parseInt(sp.get('months') || '12'), 1), 24)
  const category = sp.get('category')
  const light = sp.get('light') === '1'
  const sb = createAdminClient()

  const periodStart = () => { const d = new Date(); d.setMonth(d.getMonth() - (months - 1)); d.setDate(1); return d.toISOString().slice(0, 10) }
  const excludedMemberSet = (config: SupplierConfig) => {
    const s = new Set<number>(config.excluded || [])
    for (const [child, cid] of Object.entries(config.merges || {})) if ((config.excluded || []).includes(cid)) s.add(Number(child))
    return s
  }
  const aiCatsAndCoverage = async (config: SupplierConfig) => {
    const excl = excludedMemberSet(config)
    const { data: fx } = await sb.from('achats_factures')
      .select('categorie, amount_htva, partner_id, parsed_at').gte('invoice_date', periodStart())
    const rows = (fx || []).filter((r: any) => !excl.has(r.partner_id))
    const parsedRows = rows.filter((r: any) => r.parsed_at && r.categorie)
    const catMap: Record<string, number> = {}
    for (const r of parsedRows) catMap[r.categorie] = (catMap[r.categorie] || 0) + (r.amount_htva || 0)
    const aiCategories = Object.entries(catMap).map(([categorie, amount]) => ({ categorie, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount)
    const coverage = { parsed: parsedRows.length, total: rows.length, pct: rows.length ? Math.round(parsedRows.length / rows.length * 100) : 0 }
    return { aiCategories, coverage }
  }

  // Coût par véhicule (plaques extraites), enrichi du nom de dépanneuse (trucks).
  const costByVehicle = async (config: SupplierConfig) => {
    const excl = excludedMemberSet(config)
    const [{ data: fx }, { data: trucks }] = await Promise.all([
      sb.from('achats_factures').select('partner_id, amount_htva, categorie, plaques, parsed_at').gte('invoice_date', periodStart()),
      sb.from('trucks').select('name, plate'),
    ])
    const truckMap = new Map<string, string>()
    for (const t of (trucks || [])) if (t.plate) truckMap.set(normPlate(t.plate), t.name)
    const rows = (fx || []).filter((r: any) => !excl.has(r.partner_id) && r.parsed_at && Array.isArray(r.plaques) && r.plaques.length)
    const agg = new Map<string, { plate: string; truck: string | null; total: number; count: number; cats: Record<string, number> }>()
    for (const r of rows) {
      const pls = (r.plaques as any[]).filter(p => p.plaque)
      for (const p of pls) {
        const amount = typeof p.montant === 'number' ? p.montant : (r.amount_htva || 0) / pls.length
        const g = agg.get(p.plaque) || { plate: p.plaque, truck: truckMap.get(p.plaque) || null, total: 0, count: 0, cats: {} as Record<string, number> }
        g.total += amount; g.count += 1; g.cats[r.categorie] = (g.cats[r.categorie] || 0) + amount
        agg.set(p.plaque, g)
      }
    }
    return [...agg.values()].map(v => ({ ...v, total: Math.round(v.total) })).sort((a, b) => b.total - a.total)
  }

  try {
    const config = await loadConfig(sb)

    // Mode LÉGER (polling temps réel) : uniquement le cache, aucun appel Odoo.
    if (light) {
      return NextResponse.json({ ok: true, light: true, ...(await aiCatsAndCoverage(config)), byVehicle: await costByVehicle(config) })
    }

    // Drill-down : factures rattachées à une plaque.
    const vehicle = sp.get('vehicle')
    if (vehicle) {
      const target = normPlate(vehicle)
      const excl = excludedMemberSet(config)
      const { data: fx } = await sb.from('achats_factures')
        .select('odoo_move_id, supplier_name, partner_id, invoice_date, amount_htva, ref, categorie, resume, plaques')
        .gte('invoice_date', periodStart()).order('invoice_date', { ascending: false }).limit(1000)
      const invoices = (fx || []).filter((r: any) => !excl.has(r.partner_id) && Array.isArray(r.plaques) && r.plaques.some((p: any) => p.plaque === target))
        .map((r: any) => {
          const p = r.plaques.find((x: any) => x.plaque === target)
          const nb = r.plaques.length || 1
          return { odoo_move_id: r.odoo_move_id, supplier_name: r.supplier_name, invoice_date: r.invoice_date, ref: r.ref, categorie: r.categorie, resume: r.resume, montant: typeof p?.montant === 'number' ? p.montant : Math.round((r.amount_htva || 0) / nb) }
        }).sort((a: any, b: any) => b.montant - a.montant)
      return NextResponse.json({ ok: true, vehicle: target, invoices })
    }

    // Drill-down : liste des factures d'une catégorie (exclusions appliquées).
    if (category) {
      const excl = new Set<number>(config.excluded || [])
      for (const [child, cid] of Object.entries(config.merges || {})) if ((config.excluded || []).includes(cid)) excl.add(Number(child))
      const d = new Date(); d.setMonth(d.getMonth() - (months - 1)); d.setDate(1)
      const { data: fx } = await sb.from('achats_factures')
        .select('odoo_move_id, supplier_name, partner_id, invoice_date, amount_htva, ref, resume, sous_categorie')
        .eq('categorie', category).gte('invoice_date', d.toISOString().slice(0, 10))
        .order('amount_htva', { ascending: false }).limit(500)
      return NextResponse.json({ ok: true, category, invoices: (fx || []).filter((r: any) => !excl.has(r.partner_id)) })
    }

    // Drill-down : factures d'un fournisseur (membres fusionnés inclus).
    const supplier = sp.get('supplier')
    if (supplier) {
      const sid = Number(supplier)
      const memberIds = new Set<number>([sid])
      for (const [child, cid] of Object.entries(config.merges || {})) if (cid === sid) memberIds.add(Number(child))
      const { data: fx } = await sb.from('achats_factures')
        .select('odoo_move_id, supplier_name, invoice_date, amount_htva, ref, categorie, resume')
        .in('partner_id', [...memberIds]).gte('invoice_date', periodStart())
        .order('invoice_date', { ascending: false }).limit(1000)
      return NextResponse.json({ ok: true, supplier: sid, invoices: fx || [] })
    }

    const data = await analyzeAchats(months, config)
    const ai = await aiCatsAndCoverage(config)
    return NextResponse.json({ ok: true, config, ...data, ...ai, byVehicle: await costByVehicle(config) })
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
