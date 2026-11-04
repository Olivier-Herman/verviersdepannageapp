// src/app/api/dossier/[id]/garantie/route.ts
//
// Garantie de paiement d'une assistance sur un dossier (Olivier 04/11/2026) :
//   GET   → garanties du dossier + partage assistance / client
//   PATCH { id, gardiennage_inclus?, amount_ttc? } → réglage (tant que la part n'est pas validée)
//   POST  { id } → facture la part de l'assistance (brouillon), déduite du solde client
// Accès : facturation (rôle ou module), comme la facturation du dossier.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { sessionAccess }     from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { buildDossier, invalidateDossierCache } from '@/lib/dossier/build'
import { garantiesDuDossier, planGarantie, facturerPartAssistance } from '@/lib/facturation/garantie'
import { getInvoiceMove } from '@/lib/odoo-quote'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!sessionAccess(session, { modules: ['facturation'] }).ok) return { error: NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 }) }
  return { user: session.user as any }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const g0 = await guard(); if ('error' in g0) return g0.error
  const sb = createAdminClient()
  const d = await buildDossier(params.id, { light: false })
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const garanties = await garantiesDuDossier(sb, d)
  const out = await Promise.all(garanties.map(async g => {
    const doc_url = g.doc_path ? (await sb.storage.from('mission-remarks').createSignedUrl(g.doc_path, 3600)).data?.signedUrl || null : null
    const mv = g.invoice_odoo_id ? await getInvoiceMove(g.invoice_odoo_id).catch(() => null) : null
    return { ...g, doc_url, plan: planGarantie(d, g), invoice: mv ? { id: mv.id, state: mv.state, url: mv.url } : null }
  }))
  return NextResponse.json({ ok: true, garanties: out })
}

export async function PATCH(req: Request) {
  const g0 = await guard(); if ('error' in g0) return g0.error
  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const sb = createAdminClient()
  const { data: g } = await sb.from('mission_guarantees').select('id, mission_id, invoice_odoo_id').eq('id', body.id).maybeSingle()
  if (!g) return NextResponse.json({ error: 'Garantie introuvable' }, { status: 404 })
  if (g.invoice_odoo_id) {
    const mv = await getInvoiceMove(g.invoice_odoo_id).catch(() => null)
    if (mv && mv.state === 'posted') return NextResponse.json({ error: 'La facture de l’assistance est validée : la garantie ne se modifie plus.' }, { status: 409 })
  }
  const upd: any = {}
  if (typeof body.gardiennage_inclus === 'boolean') upd.gardiennage_inclus = body.gardiennage_inclus
  if (body.amount_ttc != null && Number(body.amount_ttc) > 0) upd.amount_ttc = Math.round(Number(body.amount_ttc) * 100) / 100
  if (!Object.keys(upd).length) return NextResponse.json({ error: 'Rien à modifier' }, { status: 400 })
  await sb.from('mission_guarantees').update(upd).eq('id', g.id)
  await sb.from('mission_logs').insert({ mission_id: g.mission_id, actor_id: g0.user.id || null, action: 'note',
    notes: `Garantie de paiement modifiée : ${'gardiennage_inclus' in upd ? (upd.gardiennage_inclus ? 'gardiennage inclus' : 'gardiennage exclu (à charge du client)') : ''}${upd.amount_ttc ? ` montant garanti ${upd.amount_ttc} € TVAC` : ''}` })
  // Part déjà facturée en brouillon : recalculée tout de suite avec le nouveau réglage.
  if (g.invoice_odoo_id) {
    const r = await facturerPartAssistance(sb, g.id, g0.user.id || null)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  }
  invalidateDossierCache()
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const g0 = await guard(); if ('error' in g0) return g0.error
  const body = await req.json().catch(() => ({}))
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const r = await facturerPartAssistance(createAdminClient(), body.id, g0.user.id || null)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  invalidateDossierCache()
  return NextResponse.json(r)
}
