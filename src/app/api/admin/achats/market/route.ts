// src/app/api/admin/achats/market/route.ts
//
// Base marché (brique 4a Achat IA). Superadmin.
// GET                         → candidats/concurrents (achats_market)
// POST discover {category}    → découverte web IA → candidats « à vérifier »
// POST set_status {id,status} → valide | rejete | a_verifier
// POST save {id?, ...}        → créer / éditer un fournisseur marché (manuel)
// POST delete {id}

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { discoverSuppliers } from '@/lib/achats/market'
import { CATEGORIES } from '@/lib/achats/parse-invoice'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 120

function isSuper(u: any) { return u?.role === 'superadmin' || (u?.roles || []).includes('superadmin') }

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data } = await sb.from('achats_market').select('*').order('category').order('status').order('name')
  return NextResponse.json({ market: data || [], allCategories: CATEGORIES })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!isSuper(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'discover') {
    const category = String(body.category || '').trim()
    if (!category) return NextResponse.json({ error: 'Catégorie requise' }, { status: 400 })
    // Exclut nos fournisseurs connus (par nom) + candidats déjà en base.
    const { data: fx } = await sb.from('achats_factures').select('supplier_name').not('supplier_name', 'is', null).limit(2000)
    const ours = [...new Set((fx || []).map((r: any) => r.supplier_name).filter(Boolean))]
    const { data: existing } = await sb.from('achats_market').select('name').eq('category', category)
    const exclude = [...ours, ...(existing || []).map((e: any) => e.name)].slice(0, 60)
    let candidates
    try { candidates = await discoverSuppliers(category, undefined, exclude) }
    catch (e: any) { return NextResponse.json({ error: `Découverte impossible : ${e.message}` }, { status: 500 }) }
    let added = 0
    for (const c of candidates) {
      const { error } = await sb.from('achats_market').insert({
        name: c.name, category, email: c.email, phone: c.phone, website: c.website, region: c.region,
        notes: c.why, status: 'a_verifier', source: 'ia_web',
      })
      if (!error) added++   // conflit d'unicité (name,cat) → ignoré
    }
    return NextResponse.json({ ok: true, found: candidates.length, added })
  }

  if (action === 'set_status') {
    const st = String(body.status || '')
    if (!['a_verifier', 'valide', 'rejete'].includes(st)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    await sb.from('achats_market').update({ status: st, updated_at: new Date().toISOString() }).eq('id', String(body.id || ''))
    return NextResponse.json({ ok: true })
  }

  if (action === 'save') {
    const name = String(body.name || '').trim(), category = String(body.category || '').trim()
    if (!name || !category) return NextResponse.json({ error: 'Nom et catégorie requis' }, { status: 400 })
    const str = (x: any) => { const s = String(x ?? '').trim(); return s || null }
    const row: any = { name, category, email: str(body.email), phone: str(body.phone), website: str(body.website), region: str(body.region), notes: str(body.notes), updated_at: new Date().toISOString() }
    if (body.id) { await sb.from('achats_market').update(row).eq('id', String(body.id)); return NextResponse.json({ ok: true }) }
    row.status = 'valide'; row.source = 'manuel'
    const { error } = await sb.from('achats_market').insert(row)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    await sb.from('achats_market').delete().eq('id', String(body.id || ''))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
