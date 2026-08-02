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
import { getGroupPartnerIds, achatsRpc } from '@/lib/achats/odoo-rpc'
import { generateAchatRecommendations, buildAchatSummary, runAchatsChat } from '@/lib/achats/ai-recommendations'
import { CATEGORIES } from '@/lib/achats/parse-invoice'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 60

const KEY = 'achats_supplier_config'
const AI_KEY = 'achats_ai_reco'

const loadReco = async (sb: any) => {
  const { data } = await sb.from('app_settings').select('value').eq('key', AI_KEY).maybeSingle()
  if (!data?.value) return null
  try { return typeof data.value === 'string' ? JSON.parse(data.value) : data.value } catch { return null }
}

// Contenu détaillé d'une catégorie de dépense (pour l'outil inspect_category du
// chat) : ventilation par fournisseur sur les N derniers mois, overrides appliqués.
async function categoryContent(sb: any, cfg: SupplierConfig, category: string, months = 12) {
  const start = (() => { const d = new Date(); d.setMonth(d.getMonth() - (months - 1)); d.setDate(1); return d.toISOString().slice(0, 10) })()
  const canon = (id: number) => cfg.merges[id] ?? id
  const excl = new Set<number>(cfg.excluded || [])
  for (const [child, cid] of Object.entries(cfg.merges || {})) if (excl.has(cid)) excl.add(Number(child))
  for (const id of await getGroupPartnerIds()) excl.add(id)
  const overrides = cfg.categoryOverrides || {}
  const scaled = (r: any): Array<{ montant: number; categorie: string; description: string }> => {
    const items = (Array.isArray(r.items) ? r.items : []).filter((i: any) => i && i.categorie)
    if (!items.length) return r.categorie ? [{ montant: r.amount_htva || 0, categorie: r.categorie, description: r.resume || '' }] : []
    const sum = items.reduce((s: number, i: any) => s + (i.montant || 0), 0)
    const scale = sum > 0 ? (r.amount_htva || 0) / sum : 0
    return items.map((i: any) => ({ montant: (i.montant || 0) * scale, categorie: i.categorie, description: i.description || '' }))
  }
  const out: any[] = []
  for (let page = 0; page < 30; page++) {
    const { data } = await sb.from('achats_factures')
      .select('partner_id, supplier_name, invoice_date, amount_htva, items, categorie, parsed_at')
      .gte('invoice_date', start).order('odoo_move_id', { ascending: true }).range(page * 1000, page * 1000 + 999)
    if (!data || !data.length) break
    out.push(...data); if (data.length < 1000) break
  }
  const bySup = new Map<number, { id: number; name: string; amount: number; lines: number; samples: string[] }>()
  let total = 0
  for (const r of out) {
    if (excl.has(r.partner_id)) continue
    const ov = overrides[String(r.partner_id)]
    const lines = scaled(r).filter(l => (ov || l.categorie) === category)
    if (!lines.length) continue
    const cid = canon(r.partner_id)
    const g = bySup.get(cid) || { id: cid, name: r.supplier_name || `#${cid}`, amount: 0, lines: 0, samples: [] as string[] }
    for (const l of lines) { g.amount += l.montant; g.lines += 1; if (g.samples.length < 3 && l.description) g.samples.push(l.description.slice(0, 60)) }
    total += lines.reduce((s, l) => s + l.montant, 0)
    bySup.set(cid, g)
  }
  const suppliers = [...bySup.values()].map(s => ({ ...s, amount: Math.round(s.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 20)
  return { category, months, total: Math.round(total), nb_fournisseurs: bySup.size, fournisseurs: suppliers }
}
const DEFAULT: SupplierConfig = { merges: {}, excluded: [], ignoredPlates: [], categoryOverrides: {} }

async function loadConfig(sb: any): Promise<SupplierConfig> {
  const { data } = await sb.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  if (!data?.value) return { ...DEFAULT }
  try {
    const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    return { merges: v.merges || {}, excluded: v.excluded || [], ignoredPlates: v.ignoredPlates || [], categoryOverrides: v.categoryOverrides || {} }
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
  // Exclusion complète appliquée à la lecture du cache : exclusions manuelles
  // + TOUTE l'intercompagnie (partenaires du groupe VD/Riga/DGJ). Le cache peut
  // contenir d'anciennes lignes intercompagnie (sync antérieur au filtre).
  const fullExclusion = async (config: SupplierConfig) => {
    const s = excludedMemberSet(config)
    for (const id of await getGroupPartnerIds()) s.add(id)
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
    return items.map((i: any) => ({ montant: (i.montant || 0) * scale, categorie: i.categorie, plaque: i.plaque ? normPlate(i.plaque) : null, description: i.description || '' }))
  }

  const aiCatsAndCoverage = async (config: SupplierConfig) => {
    const excl = await fullExclusion(config)
    const fx = await fetchAllFactures('categorie, amount_htva, partner_id, items, parsed_at')
    const rows = fx.filter((r: any) => !excl.has(r.partner_id))
    const parsedRows = rows.filter((r: any) => r.parsed_at)
    const overrides = config.categoryOverrides || {}
    const catMap: Record<string, number> = {}
    for (const r of parsedRows) {
      const ov = overrides[String(r.partner_id)]   // redispatch : force la catégorie du fournisseur
      for (const l of scaledLines(r)) { const c = ov || l.categorie; catMap[c] = (catMap[c] || 0) + l.montant }
    }
    const aiCategories = Object.entries(catMap).map(([categorie, amount]) => ({ categorie, amount: Math.round(amount) })).sort((a, b) => b.amount - a.amount)
    const coverage = { parsed: parsedRows.length, total: rows.length, pct: rows.length ? Math.round(parsedRows.length / rows.length * 100) : 0 }
    return { aiCategories, coverage }
  }

  // Coût par véhicule : agrège les LIGNES portant une plaque, enrichi du nom de
  // dépanneuse (trucks). Montants mis à l'échelle du total facture.
  const costByVehicle = async (config: SupplierConfig) => {
    const excl = await fullExclusion(config)
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
    const ignored = new Set((config.ignoredPlates || []).map((p: string) => normPlate(p)))
    // Retire les plaques à 1 seule facture (bruit : nos véhicules en génèrent plusieurs) + les ignorées.
    return [...agg.values()].filter(v => v.count > 1 && !ignored.has(v.plate)).map(v => ({ ...v, total: Math.round(v.total) })).sort((a, b) => b.total - a.total)
  }

  try {
    const config = await loadConfig(sb)

    // Mode LÉGER (polling temps réel) : uniquement le cache, aucun appel Odoo.
    if (light) {
      return NextResponse.json({ ok: true, light: true, ...(await aiCatsAndCoverage(config)), byVehicle: await costByVehicle(config) })
    }

    // ── Répertoire fournisseurs enrichi (brique 2) ──────────────────────
    if (sp.get('suppliers') === '1') {
      const data = await analyzeAchats(months, config)
      const active = data.allSuppliers.filter((s: any) => !s.excluded)
      const canonId = (id: number) => config.merges[id] ?? id
      const overrides = config.categoryOverrides || {}
      const fx = await fetchAllFactures('partner_id, invoice_date, amount_htva, items, categorie, parsed_at')
      const agg = new Map<number, { cats: Record<string, number>; last: string }>()
      for (const r of fx) {
        const cid = canonId(r.partner_id)
        const g = agg.get(cid) || { cats: {}, last: '' }
        if (r.invoice_date && r.invoice_date > g.last) g.last = r.invoice_date
        if (r.parsed_at) { const ov = overrides[String(r.partner_id)]; for (const l of scaledLines(r)) { const c = ov || l.categorie; g.cats[c] = (g.cats[c] || 0) + l.montant } }
        agg.set(cid, g)
      }
      const { data: metaRows } = await sb.from('achats_suppliers').select('*')
      const metaById = new Map((metaRows || []).map((m: any) => [Number(m.partner_id), m]))
      const grand = active.reduce((s: number, x: any) => s + x.htva, 0) || 1
      const suppliers = active.map((s: any) => {
        const g = agg.get(s.id) || { cats: {}, last: '' }
        const dominant = Object.entries(g.cats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c)
        return { id: s.id, name: s.name, htva: s.htva, count: s.count, share: Math.round((s.htva / grand) * 1000) / 10, last_date: g.last || null, dominant, meta: metaById.get(s.id) || null }
      })
      return NextResponse.json({ ok: true, suppliers, allCategories: CATEGORIES })
    }

    // Drill-down : lignes rattachées à une plaque (par facture).
    const vehicle = sp.get('vehicle')
    if (vehicle) {
      const target = normPlate(vehicle)
      const excl = await fullExclusion(config)
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
      const excl = await fullExclusion(config)
      const fx = await fetchAllFactures('odoo_move_id, supplier_name, partner_id, invoice_date, amount_htva, ref, categorie, resume, items')
      const overrides = config.categoryOverrides || {}
      const invoices = fx.filter((r: any) => !excl.has(r.partner_id))
        .map((r: any) => {
          const ov = overrides[String(r.partner_id)]
          const lines = scaledLines(r).filter(l => (ov || l.categorie) === category)
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

    // Recommandations IA : génération à la demande (bouton) + cache app_settings.
    if (sp.get('ai') === 'analyze') {
      const data = await analyzeAchats(months, config)
      const ai = await aiCatsAndCoverage(config)
      const recos = await generateAchatRecommendations(data, ai.aiCategories)
      const reco = { generated_at: new Date().toISOString(), months, total_saving: recos.reduce((s, r) => s + r.estimated_saving_eur, 0), recos, summary: buildAchatSummary(data, ai.aiCategories) }
      await sb.from('app_settings').upsert({ key: AI_KEY, value: JSON.stringify(reco) }, { onConflict: 'key' })
      return NextResponse.json({ ok: true, reco })
    }

    const data = await analyzeAchats(months, config)
    const ai = await aiCatsAndCoverage(config)
    return NextResponse.json({ ok: true, config, ...data, ...ai, byVehicle: await costByVehicle(config), aiReco: await loadReco(sb) })
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

  // Chat : discuter des recommandations / dépenses avec l'IA — ET AGIR (tool-use).
  if (action === 'ai_chat') {
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-16)
    if (!messages.length) return NextResponse.json({ error: 'Message vide' }, { status: 400 })
    let cache = await loadReco(sb)
    if (!cache?.summary) {
      const data = await analyzeAchats(12, cfg)   // fallback : résumé sur 12 mois si pas encore analysé
      cache = { recos: [], summary: buildAchatSummary(data, []) }
    }
    // Exécuteur d'outils : applique réellement les changements sur la config.
    const execTool = async (name: string, input: any): Promise<string> => {
      if (name === 'reclassify_supplier') {
        const id = Number(input.supplier_id), cat = String(input.category || '')
        if (!id || !(CATEGORIES as readonly string[]).includes(cat)) return 'Paramètres invalides (id ou catégorie).'
        cfg.categoryOverrides = cfg.categoryOverrides || {}
        cfg.categoryOverrides[String(id)] = cat
        await saveConfig(sb, cfg)
        return `OK — toutes les dépenses du fournisseur #${id} sont désormais classées en « ${cat} ».`
      }
      if (name === 'merge_suppliers') {
        const src = Number(input.source_id), keep = Number(input.keep_id)
        if (!src || !keep || src === keep) return 'ids invalides.'
        cfg.merges[src] = keep
        for (const k of Object.keys(cfg.merges)) if (cfg.merges[k] === src) cfg.merges[k] = keep
        cfg.excluded = cfg.excluded.filter(x => x !== src)
        await saveConfig(sb, cfg)
        return `OK — fournisseur #${src} fusionné dans #${keep}.`
      }
      if (name === 'exclude_supplier') {
        const id = canon(Number(input.supplier_id))
        if (!id) return 'id invalide.'
        if (!cfg.excluded.includes(id)) cfg.excluded.push(id)
        await saveConfig(sb, cfg)
        return `OK — fournisseur #${id} exclu de l'analyse.`
      }
      if (name === 'ignore_vehicle') {
        const p = normPlate(String(input.plate || ''))
        if (!p) return 'Plaque invalide.'
        cfg.ignoredPlates = cfg.ignoredPlates || []
        if (!cfg.ignoredPlates.includes(p)) cfg.ignoredPlates.push(p)
        await saveConfig(sb, cfg)
        return `OK — véhicule ${p} retiré de l'analyse coût/véhicule.`
      }
      if (name === 'reset_supplier_category') {
        const id = String(Number(input.supplier_id))
        if (cfg.categoryOverrides) delete cfg.categoryOverrides[id]
        await saveConfig(sb, cfg)
        return `OK — redispatch du fournisseur #${id} annulé (catégorie d'origine rétablie).`
      }
      if (name === 'inspect_category') {
        const cat = String(input.category || '')
        if (!(CATEGORIES as readonly string[]).includes(cat)) return 'Catégorie inconnue.'
        const content = await categoryContent(sb, cfg, cat)
        return JSON.stringify(content)
      }
      return 'Outil inconnu.'
    }
    const { reply, acted } = await runAchatsChat(cache.summary, cache.recos || [], messages, execTool)
    return NextResponse.json({ ok: true, reply, acted })
  }

  // ── Répertoire fournisseurs enrichi : métadonnées + import contacts Odoo ──
  if (action === 'supplier_save') {
    const pid = Number(body.partner_id)
    if (!pid) return NextResponse.json({ error: 'partner_id manquant' }, { status: 400 })
    const m = body.meta || {}
    const str = (x: any) => { const s = String(x ?? '').trim(); return s || null }
    const row = {
      partner_id:     pid,
      contact_name:   str(m.contact_name),
      email:          str(m.email),
      phone:          str(m.phone),
      categories:     Array.isArray(m.categories) ? m.categories.map((c: any) => String(c)).filter(Boolean) : [],
      payment_terms:  str(m.payment_terms),
      lead_time_days: m.lead_time_days !== '' && m.lead_time_days != null ? Math.max(0, Number(m.lead_time_days) || 0) : null,
      rating:         m.rating !== '' && m.rating != null ? Math.min(5, Math.max(1, Number(m.rating) || 0)) : null,
      notes:          str(m.notes),
      updated_at:     new Date().toISOString(),
    }
    const { error } = await sb.from('achats_suppliers').upsert(row, { onConflict: 'partner_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'supplier_import') {
    const ids: number[] = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 300)
    if (!ids.length) return NextResponse.json({ error: 'ids manquants' }, { status: 400 })
    const partners = await achatsRpc<any[]>('res.partner', 'read', [ids, ['email', 'phone']])
    const { data: existing } = await sb.from('achats_suppliers').select('partner_id, email, phone').in('partner_id', ids)
    const exById = new Map((existing || []).map((e: any) => [Number(e.partner_id), e]))
    let filled = 0
    const rows = (partners || []).map((p: any) => {
      const ex = exById.get(p.id)
      const email = ex?.email || (p.email || null)
      const phone = ex?.phone || (p.phone || null)
      if ((!ex?.email && p.email) || (!ex?.phone && p.phone)) filled++
      return { partner_id: p.id, email, phone, updated_at: new Date().toISOString() }
    }).filter((r: any) => r.email || r.phone)
    if (rows.length) await sb.from('achats_suppliers').upsert(rows, { onConflict: 'partner_id' })
    return NextResponse.json({ ok: true, filled })
  }

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
  } else if (action === 'ignore_plate') {
    const p = normPlate(String(body.plate || ''))
    if (p) { cfg.ignoredPlates = cfg.ignoredPlates || []; if (!cfg.ignoredPlates.includes(p)) cfg.ignoredPlates.push(p) }
  } else if (action === 'unignore_plate') {
    const p = normPlate(String(body.plate || ''))
    cfg.ignoredPlates = (cfg.ignoredPlates || []).filter(x => x !== p)
  } else {
    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  }

  await saveConfig(sb, cfg)
  return NextResponse.json({ ok: true, config: cfg })
}
