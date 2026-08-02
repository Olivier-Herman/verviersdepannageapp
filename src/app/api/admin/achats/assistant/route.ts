// src/app/api/admin/achats/assistant/route.ts
//
// Assistant Achats (agent conversationnel dédié, avec mémoire). Superadmin.
// GET                 → historique de la conversation
// POST {content}      → nouveau message → réponse de l'agent (persistée)
// POST {action:'clear'} → efface la conversation

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { runAchatsAssistant } from '@/lib/achats/assistant'
import { CATEGORIES, normPlate } from '@/lib/achats/parse-invoice'

const CFG_KEY = 'achats_supplier_config'
async function loadCfg(sb: any) {
  const { data } = await sb.from('app_settings').select('value').eq('key', CFG_KEY).maybeSingle()
  const def = { merges: {} as Record<string, number>, excluded: [] as number[], ignoredPlates: [] as string[], categoryOverrides: {} as Record<string, string> }
  if (!data?.value) return def
  try { const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value; return { merges: v.merges || {}, excluded: v.excluded || [], ignoredPlates: v.ignoredPlates || [], categoryOverrides: v.categoryOverrides || {} } } catch { return def }
}
const saveCfg = (sb: any, cfg: any) => sb.from('app_settings').upsert({ key: CFG_KEY, value: JSON.stringify(cfg) }, { onConflict: 'key' })
const scaledLines = (r: any): Array<{ montant: number; cat: string; description: string; quantite: number | null; unite: string | null }> => {
  const items = (Array.isArray(r.items) ? r.items : []).filter((i: any) => i?.categorie)
  if (!items.length) return r.categorie ? [{ montant: r.amount_htva || 0, cat: r.categorie, description: r.resume || '', quantite: null, unite: null }] : []
  const sum = items.reduce((a: number, i: any) => a + (i.montant || 0), 0)
  const sc = sum > 0 ? (r.amount_htva || 0) / sum : 0
  return items.map((i: any) => ({ montant: (i.montant || 0) * sc, cat: i.categorie, description: i.description || '', quantite: typeof i.quantite === 'number' && i.quantite > 0 ? i.quantite : null, unite: i.unite || null }))
}
async function fetchFactures(sb: any, months: number) {
  const start = (() => { const d = new Date(); d.setMonth(d.getMonth() - (months - 1)); d.setDate(1); return d.toISOString().slice(0, 10) })()
  const out: any[] = []
  for (let p = 0; p < 40; p++) {
    const { data } = await sb.from('achats_factures').select('odoo_move_id, partner_id, supplier_name, invoice_date, amount_htva, items, categorie, parsed_at').gte('invoice_date', start).order('odoo_move_id').range(p * 1000, p * 1000 + 999)
    if (!data || !data.length) break; out.push(...data); if (data.length < 1000) break
  }
  return out
}

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 120

function isSuper(u: any) { return u?.role === 'superadmin' || (u?.roles || []).includes('superadmin') }

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data } = await sb.from('achats_assistant_messages').select('id, role, content, created_at').order('created_at', { ascending: true }).limit(200)
  return NextResponse.json({ messages: data || [] })
}

async function buildContext(sb: any): Promise<string> {
  const parts: string[] = []
  const { data: recoRow } = await sb.from('app_settings').select('value').eq('key', 'achats_ai_reco').maybeSingle()
  if (recoRow?.value) {
    try { const r = typeof recoRow.value === 'string' ? JSON.parse(recoRow.value) : recoRow.value
      if (r.summary) parts.push('Synthèse des dépenses :\n' + JSON.stringify(r.summary))
      if (r.recos?.length) parts.push('Recommandations en cours :\n' + JSON.stringify(r.recos.map((x: any) => ({ titre: x.title, eco: x.estimated_saving_eur }))))
    } catch { /* noop */ }
  } else {
    parts.push('(Aucune analyse de dépenses récente — suggère de lancer l\'analyse IA depuis Gestion Achat si utile.)')
  }
  const { data: market } = await sb.from('achats_market').select('name, category, email').eq('status', 'valide').limit(80)
  if (market?.length) parts.push('Base marché (fournisseurs validés) :\n' + JSON.stringify(market))
  return parts.join('\n\n').slice(0, 20000)
}

// Exécuteur d'outils de l'assistant (conseil + actions + stats).
function makeExec(sb: any) {
  return async (name: string, input: any): Promise<string> => {
    // ── Ajout marché ──
    if (name === 'add_market_supplier') {
      const cat = String(input.category || '')
      if (!input.name || !(CATEGORIES as readonly string[]).includes(cat)) return 'Nom/catégorie invalide.'
      const s = (x: any) => { const v = String(x ?? '').trim(); return v || null }
      const { error } = await sb.from('achats_market').insert({ name: String(input.name).slice(0, 120), category: cat, email: s(input.email), phone: s(input.phone), website: s(input.website), region: s(input.region), notes: s(input.why), status: 'valide', source: 'ia_web' })
      return error ? `Non ajouté (${error.message.includes('duplicate') ? 'déjà en base' : error.message}).` : `OK — « ${input.name} » ajouté à la base marché (${cat}).`
    }

    // ── Actions sur la config (redispatch / fusion / exclusion / véhicule) ──
    if (['reclassify_supplier', 'reset_supplier_category', 'merge_suppliers', 'exclude_supplier', 'ignore_vehicle'].includes(name)) {
      const cfg = await loadCfg(sb)
      const canon = (id: number) => cfg.merges[id] ?? id
      if (name === 'reclassify_supplier') {
        const id = Number(input.supplier_id), c = String(input.category || '')
        if (!id || !(CATEGORIES as readonly string[]).includes(c)) return 'id ou catégorie invalide.'
        cfg.categoryOverrides[String(id)] = c; await saveCfg(sb, cfg)
        return `OK — toutes les dépenses du fournisseur #${id} classées en « ${c} ».`
      }
      if (name === 'reset_supplier_category') { delete cfg.categoryOverrides[String(Number(input.supplier_id))]; await saveCfg(sb, cfg); return `OK — redispatch du #${Number(input.supplier_id)} annulé.` }
      if (name === 'merge_suppliers') {
        const src = Number(input.source_id), keep = Number(input.keep_id)
        if (!src || !keep || src === keep) return 'ids invalides.'
        cfg.merges[src] = keep; for (const k of Object.keys(cfg.merges)) if (cfg.merges[k] === src) cfg.merges[k] = keep
        cfg.excluded = cfg.excluded.filter((x: number) => x !== src); await saveCfg(sb, cfg)
        return `OK — #${src} fusionné dans #${keep}.`
      }
      if (name === 'exclude_supplier') { const id = canon(Number(input.supplier_id)); if (!id) return 'id invalide.'; if (!cfg.excluded.includes(id)) cfg.excluded.push(id); await saveCfg(sb, cfg); return `OK — #${id} exclu.` }
      if (name === 'ignore_vehicle') { const p = normPlate(String(input.plate || '')); if (!p) return 'plaque invalide.'; if (!cfg.ignoredPlates.includes(p)) cfg.ignoredPlates.push(p); await saveCfg(sb, cfg); return `OK — véhicule ${p} ignoré.` }
    }

    // ── Lecture / stats ──
    if (name === 'inspect_category' || name === 'query_spend') {
      const cfg = await loadCfg(sb)
      const months = name === 'query_spend' ? Math.min(Math.max(Number(input.months) || 12, 1), 36) : 12
      const rows = await fetchFactures(sb, months)
      const cat = input.category && (CATEGORIES as readonly string[]).includes(String(input.category)) ? String(input.category) : null
      const supplierId = name === 'query_spend' ? (Number(input.supplier_id) || null) : null
      const keyword = name === 'query_spend' ? String(input.keyword || '').trim().toLowerCase() : ''
      const groupBy = name === 'query_spend' ? String(input.group_by || (cat ? 'month' : 'category')) : 'supplier'
      const excl = new Set<number>(cfg.excluded || [])
      for (const [child, cid] of Object.entries(cfg.merges || {})) if (excl.has(cid as number)) excl.add(Number(child))

      const groups = new Map<string, { total: number; lines: number; invoices: Set<any>; vol: Record<string, number> }>()
      const samples: Array<{ desc: string; montant: number; qte: number | null; unite: string | null; supplier: string }> = []
      const volTotal: Record<string, number> = {}
      for (const r of rows) {
        if (excl.has(r.partner_id)) continue
        const cid = cfg.merges[r.partner_id] ?? r.partner_id
        if (supplierId && cid !== supplierId) continue
        const ov = cfg.categoryOverrides[String(r.partner_id)]
        for (const l of scaledLines(r)) {
          const lc = ov || l.cat
          if (cat && lc !== cat) continue
          if (keyword && !String(l.description).toLowerCase().includes(keyword)) continue
          const key = groupBy === 'month' ? String(r.invoice_date || '').slice(0, 7)
            : groupBy === 'supplier' ? (r.supplier_name || `#${cid}`)
            : groupBy === 'category' ? lc : 'total'
          const g = groups.get(key) || { total: 0, lines: 0, invoices: new Set(), vol: {} }
          g.total += l.montant; g.lines += 1; g.invoices.add(r.odoo_move_id)
          if (l.quantite && l.unite) { g.vol[l.unite] = (g.vol[l.unite] || 0) + l.quantite; volTotal[l.unite] = (volTotal[l.unite] || 0) + l.quantite }
          groups.set(key, g)
          if (keyword && samples.length < 20) samples.push({ desc: l.description.slice(0, 80), montant: Math.round(l.montant), qte: l.quantite, unite: l.unite, supplier: r.supplier_name || `#${cid}` })
        }
      }
      const roundVol = (v: Record<string, number>) => Object.fromEntries(Object.entries(v).map(([u, n]) => [u, Math.round(n)]))
      const arr = [...groups.entries()].map(([group, g]) => ({ group, total_htva: Math.round(g.total), nb_lignes: g.lines, nb_factures: g.invoices.size, volume: roundVol(g.vol) }))
        .sort((a, b) => groupBy === 'month' ? a.group.localeCompare(b.group) : b.total_htva - a.total_htva).slice(0, 40)
      const grandTotal = arr.reduce((a, x) => a + x.total_htva, 0)
      const volGlobal = roundVol(volTotal)
      return JSON.stringify({ periode_mois: months, filtre: { categorie: cat, fournisseur_id: supplierId, mot_cle: keyword || null }, groupe_par: groupBy, total_htva: grandTotal, volume_total: volGlobal, note_volume: Object.keys(volGlobal).length ? 'quantités extraites des factures (fiable quand présent)' : 'aucune quantité extraite sur cette sélection (factures pas encore re-parsées avec quantités ?)', groupes: arr, ...(keyword ? { exemples_lignes: samples } : {}) })
    }

    return 'Outil inconnu.'
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))

  if (body.action === 'clear') {
    await sb.from('achats_assistant_messages').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    return NextResponse.json({ ok: true })
  }

  const content = String(body.content || '').trim()
  if (!content) return NextResponse.json({ error: 'Message vide' }, { status: 400 })
  await sb.from('achats_assistant_messages').insert({ role: 'user', content })

  const { data: hist } = await sb.from('achats_assistant_messages').select('role, content').order('created_at', { ascending: true }).limit(60)
  const context = await buildContext(sb)
  let reply: string
  try { reply = await runAchatsAssistant(context, (hist || []) as any, makeExec(sb)) }
  catch (e: any) { reply = `Désolé, une erreur est survenue (${e.message}).` }

  await sb.from('achats_assistant_messages').insert({ role: 'assistant', content: reply })
  return NextResponse.json({ ok: true, reply })
}
