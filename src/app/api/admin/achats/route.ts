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
  // Lit TOUTES les factures de la période, paginé + trié (déterministe). Sans
  // ça, PostgREST plafonne à 1000 lignes dans un ordre arbitraire → les totaux
  // « switchent » entre deux états à chaque appel.
  const fetchAllFactures = async (cols: string) => {
    const out: any[] = []
    for (let page = 0; page < 30; page++) {
      const { data } = await sb.from('achats_factures').select(cols)
        .gte('invoice_date', periodStart())
        .order('odoo_move_id', { ascending: true })
        .range(page * 1000, page * 1000 + 999)
      if (!data || !data.length) break
      out.push(...data)
      if (data.length < 1000) break
    }
    return out
  }
  // Lignes d'une facture, montants mis à l'échelle du total HTVA (l'IA estime,
  // on recale pour que la somme des lignes = le montant réel de la facture).
  const scaledLines = (r: any): Array<{ montant: number; categorie: string; plaque: string | null; description: string }> => {
    const items = (Array.isArray(r.items) ? r.items : []).filter((i: any) => i && i.categorie)
    if (!items.length) return r.categorie ? [{ montant: r.amount_htva || 0, categorie: r.categorie, plaque: null, description: r.resume || '' }] : []
    const sum = items.reduce((s: number, i: any) => s + (i.montant || 0), 0)
    const scale = sum > 0 ? (r.amount_htva || 0) / sum : 0
    return items.map((i: any) => ({ montant: (i.montant || 0) * scale, categorie: i.categorie, plaque: i.plaque || null, description: i.description || '' }))
  }

  const aiCatsAndCoverage = async (config: SupplierConfig) => {
    const excl = excludedMemberSet(config)
    const fx = await fetchAllFactures('categorie, amount_htva, partner_id, items, parsed_at')
    const rows = fx.filter((r: any) => !excl.has(r.partner_id))
    const parsedRows = rows.filter((r: any) => r.parsed_at)
    const catMap: Record<string, number> = {}
    for (const r of parsedRows) for (const l of scaledLines(r)) catMap[l.categorie] = (catMap[l.categorie] || 0) + l.montant
    const aiCategories = Object.entries(catMap).map(([categorie, amount]) => ({ categorie, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount)
    const coverage = { parsed: parsedRows.length, total: rows.length, pct: rows.length ? Math.round(parsedRows.length / rows.length * 100) : 0 }
    return { aiCategories, coverage }
  }

  // Coût par véhicule : agrège les LIGNES portant une plaque, enrichi du nom de
  // dépanneuse (trucks). Montants mis à l'échelle du total facture.
  const costByVehicle = async (config: SupplierConfig) => {
    const excl = excludedMemberSet(config)
    const [fx, { data: trucks }] = await Promise.all([
      fetchAllFactures('partner_id, amount_htva, categorie, items, parsed_at'),
      sb.from('trucks').select('name, plate'),
    ])
    const truckMap = new Map<string, string>()
    for (const t of (trucks || [])) if (t.plate) truckMap.set(normPlate(t.plate), t.name)
    const rows = fx.filter((r: any) => !excl.has(r.partner_id) && r.parsed_at)
    const agg = new Map<string, { plate: string; truck: string | null; total: number; count: number; cats: Record<string, number> }>()
    for (const r of rows) {
      for (const l of scaledLines(r)) {
        if (!l.plaque) continue
        if (l.categorie === 'Sous-traitance dépannage') continue   // plaque = véhicule client remorqué, pas notre camion
        const g = agg.get(l.plaque) || { plate: l.plaque, truck: truckMap.get(l.plaque) || null, total: 0, count: 0, cats: {} as Record<string, number> }
        g.total += l.montant; g.count += 1; g.cats[l.categorie] = (g.cats[l.categorie] || 0) + l.montant
        agg.set(l.plaque, g)
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

    // Drill-down : lignes rattachées à une plaque (par facture).
    const vehicle = sp.get('vehicle')
    if (vehicle) {
      const target = normPlate(vehicle)
      const excl = excludedMemberSet(config)
      const fx = await fetchAllFactures('odoo_move_id, supplier_name, partner_id, invoice_date, amount_htva, ref, categorie, resume, items')
      const invoices = fx.filter((r: any) => !excl.has(r.partner_id))
        .map((r: any) => {
          const lines = scaledLines(r).filter(l => l.plaque === target)
          if (!lines.length) return null
          return { odoo_move_id: r.odoo_move_id, supplier_name: r.supplier_name, invoice_date: r.invoice_date, ref: r.ref, categorie: lines[0].categorie, resume: lines.map(l => l.description).filter(Boolean).slice(0, 2).join(' · ') || r.resume, montant: Math.round(lines.reduce((s, l) => s + l.montant, 0)) }
        }).filter(Boolean).sort((a: any, b: any) => b.montant - a.montant)
      return NextResponse.json({ ok: true, vehicle: target, invoices })
    }

    // Drill-down : lignes d'une catégorie (par facture, montant de ligne).
    if (category) {
      const excl = excludedMemberSet(config)
      const fx = await fetchAllFactures('odoo_move_id, supplier_name, partner_id, invoice_date, amount_htva, ref, categorie, resume, items')
      const invoices = fx.filter((r: any) => !excl.has(r.partner_id))
        .map((r: any) => {
          const lines = scaledLines(r).filter(l => l.categorie === category)
          if (!lines.length) return null
          return { odoo_move_id: r.odoo_move_id, supplier_name: r.supplier_name, invoice_date: r.invoice_date, ref: r.ref, sous_categorie: lines.map(l => l.description).filter(Boolean).slice(0, 2).join(' · '), resume: r.resume, amount_htva: Math.round(lines.reduce((s, l) => s + l.montant, 0)) }
        }).filter(Boolean).sort((a: any, b: any) => b.amount_htva - a.amount_htva).slice(0, 500)
      return NextResponse.json({ ok: true, category, invoices })
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
