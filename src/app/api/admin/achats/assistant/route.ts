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
import { CATEGORIES } from '@/lib/achats/parse-invoice'

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

// Exécuteur d'outils de l'assistant.
function makeExec(sb: any) {
  return async (name: string, input: any): Promise<string> => {
    if (name === 'add_market_supplier') {
      const cat = String(input.category || '')
      if (!input.name || !(CATEGORIES as readonly string[]).includes(cat)) return 'Nom/catégorie invalide.'
      const s = (x: any) => { const v = String(x ?? '').trim(); return v || null }
      const { error } = await sb.from('achats_market').insert({
        name: String(input.name).slice(0, 120), category: cat, email: s(input.email), phone: s(input.phone),
        website: s(input.website), region: s(input.region), notes: s(input.why), status: 'valide', source: 'ia_web',
      })
      return error ? `Non ajouté (${error.message.includes('duplicate') ? 'déjà en base' : error.message}).` : `OK — « ${input.name} » ajouté à la base marché (${cat}).`
    }
    if (name === 'inspect_category') {
      const cat = String(input.category || '')
      if (!(CATEGORIES as readonly string[]).includes(cat)) return 'Catégorie inconnue.'
      const cfgRow = await sb.from('app_settings').select('value').eq('key', 'achats_supplier_config').maybeSingle()
      let overrides: Record<string, string> = {}, merges: Record<string, number> = {}
      try { const c = cfgRow.data?.value ? (typeof cfgRow.data.value === 'string' ? JSON.parse(cfgRow.data.value) : cfgRow.data.value) : {}; overrides = c.categoryOverrides || {}; merges = c.merges || {} } catch { /* noop */ }
      const start = (() => { const d = new Date(); d.setMonth(d.getMonth() - 11); d.setDate(1); return d.toISOString().slice(0, 10) })()
      const out: any[] = []
      for (let p = 0; p < 30; p++) {
        const { data } = await sb.from('achats_factures').select('partner_id, supplier_name, amount_htva, items, categorie, parsed_at').gte('invoice_date', start).order('odoo_move_id').range(p * 1000, p * 1000 + 999)
        if (!data || !data.length) break; out.push(...data); if (data.length < 1000) break
      }
      const bySup = new Map<number, { name: string; amount: number }>()
      for (const r of out) {
        const ov = overrides[String(r.partner_id)]
        const items = (Array.isArray(r.items) ? r.items : []).filter((i: any) => i?.categorie)
        const sum = items.reduce((a: number, i: any) => a + (i.montant || 0), 0)
        const scale = sum > 0 ? (r.amount_htva || 0) / sum : 0
        const lines: Array<{ montant: number; cat: string }> = items.length ? items.map((i: any) => ({ montant: (i.montant || 0) * scale, cat: ov || i.categorie })) : (r.categorie ? [{ montant: r.amount_htva || 0, cat: ov || r.categorie }] : [])
        const amt = lines.filter((l) => l.cat === cat).reduce((a: number, l) => a + l.montant, 0)
        if (amt <= 0) continue
        const cid = merges[r.partner_id] ?? r.partner_id
        const g = bySup.get(cid) || { name: r.supplier_name || `#${cid}`, amount: 0 }
        g.amount += amt; bySup.set(cid, g)
      }
      const suppliers = [...bySup.values()].map(s => ({ ...s, amount: Math.round(s.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 15)
      return JSON.stringify({ category: cat, total: suppliers.reduce((a, s) => a + s.amount, 0), fournisseurs: suppliers })
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
