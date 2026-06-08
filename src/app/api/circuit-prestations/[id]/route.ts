// src/app/api/circuit-prestations/[id]/route.ts
//
// DELETE : supprime une prestation. Si elle a un devis Odoo lie et qu il
// n est pas deja facture, on annule aussi le devis (state='cancel').
//
// PATCH : marquer comme facturee (set invoiced_at). Utile depuis la UI
// "marquer comme facture envoyee" apres la notif lundi.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { withOdooActor, odooRpc } from '@/lib/odoo'
import { createCircuitQuote } from '@/lib/circuit/odoo-quote'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['dispatcher', 'admin', 'superadmin']
function hasAccess(user: any): boolean {
  const role = user.role || ''
  const roles = Array.isArray(user.roles) ? user.roles : []
  return ALLOWED_ROLES.includes(role)
      || roles.some((r: string) => ALLOWED_ROLES.includes(r))
}

// ─────────────────────────────────────────────────────────────────
// GET — recupere une prestation + toutes les autres lignes du meme dossier
// (= meme devis Odoo). Utilise pour pre-remplir la modale Edition.
// ─────────────────────────────────────────────────────────────────
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasAccess(session.user as any)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: clicked, error: cErr } = await sb
    .from('circuit_prestations')
    .select('id, odoo_sale_order_id')
    .eq('id', params.id)
    .maybeSingle()
  if (cErr || !clicked) return NextResponse.json({ error: 'Prestation introuvable' }, { status: 404 })

  const filter = clicked.odoo_sale_order_id
    ? { col: 'odoo_sale_order_id', val: clicked.odoo_sale_order_id }
    : { col: 'id', val: clicked.id }

  const { data, error } = await sb
    .from('circuit_prestations')
    .select(`
      id, client_name, client_odoo_id,
      type, prestation_date, nb_depanneuses,
      odoo_sale_order_id, odoo_sale_order_name,
      notes, invoiced_at, invoiced_by,
      created_by, created_at, updated_at
    `)
    .eq(filter.col, filter.val)
    .order('prestation_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ group: data || [] })
}

// ─────────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────────
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!hasAccess(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()

  const { data: prestation, error: pErr } = await sb
    .from('circuit_prestations')
    .select('id, odoo_sale_order_id, odoo_sale_order_name, invoiced_at, client_name, prestation_date')
    .eq('id', params.id)
    .maybeSingle()
  if (pErr || !prestation) return NextResponse.json({ error: 'Prestation introuvable' }, { status: 404 })

  if (prestation.invoiced_at) {
    return NextResponse.json({
      error: 'Prestation deja facturee, suppression interdite. Annuler manuellement la facture Odoo si besoin.',
    }, { status: 400 })
  }

  // Si le devis Odoo existe ET n est pas le dernier rattache (cas multi-dates),
  // on annule seulement la ligne BDD. Si c est la derniere prestation rattachee
  // au devis, on annule aussi le devis Odoo.
  let odooCancelled = false
  let odooCancelError: string | null = null
  if (prestation.odoo_sale_order_id) {
    const { count } = await sb
      .from('circuit_prestations')
      .select('id', { count: 'exact', head: true })
      .eq('odoo_sale_order_id', prestation.odoo_sale_order_id)
    const isLastForOrder = (count || 0) <= 1
    if (isLastForOrder) {
      try {
        await withOdooActor(actor?.id, async () => {
          await odooRpc('sale.order', 'action_cancel', [[prestation.odoo_sale_order_id]])
        })
        odooCancelled = true
      } catch (e: any) {
        odooCancelError = String(e?.message || e).slice(0, 200)
        console.warn(`[circuit-prestations DELETE] cancel Odoo KO order=${prestation.odoo_sale_order_id}:`, e?.message)
      }
    }
  }

  const { error: delErr } = await sb.from('circuit_prestations').delete().eq('id', params.id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    odoo_cancelled: odooCancelled,
    odoo_cancel_error: odooCancelError,
    message: `Prestation supprimée${odooCancelled ? ' + devis Odoo annulé' : ''}`,
  })
}

// ─────────────────────────────────────────────────────────────────
// PATCH — marquer comme facturee
// ─────────────────────────────────────────────────────────────────
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!hasAccess(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '').trim()

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()

  if (action === 'mark_invoiced') {
    const { data, error } = await sb
      .from('circuit_prestations')
      .update({
        invoiced_at: new Date().toISOString(),
        invoiced_by: actor?.id || null,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, prestation: data, action: 'mark_invoiced' })
  }

  if (action === 'unmark_invoiced') {
    const { data, error } = await sb
      .from('circuit_prestations')
      .update({
        invoiced_at: null,
        invoiced_by: null,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, prestation: data, action: 'unmark_invoiced' })
  }

  return NextResponse.json({ error: 'action invalide (mark_invoiced | unmark_invoiced)' }, { status: 400 })
}

// ─────────────────────────────────────────────────────────────────
// PUT — modifier le dossier complet (toutes les lignes du meme devis)
// Olivier 2026-06-08 : impossible de modifier une seule ligne car le devis
// Odoo regroupe toutes les dates. On annule l ancien devis + on cree un
// nouveau devis avec les nouvelles donnees + on remplace les lignes BDD.
// ─────────────────────────────────────────────────────────────────
interface UpdateBody {
  client_name:     string
  client_odoo_id:  number
  type:            'incentive' | 'after_six'
  dates:           string[]
  nb_depanneuses?: number
  notes?:          string
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!hasAccess(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()
  const actorId = actor?.id || null

  // 1. Recupere la prestation cliquee + les autres lignes du meme devis
  const { data: clicked, error: cErr } = await sb
    .from('circuit_prestations')
    .select('id, odoo_sale_order_id, invoiced_at')
    .eq('id', params.id)
    .maybeSingle()
  if (cErr || !clicked) return NextResponse.json({ error: 'Prestation introuvable' }, { status: 404 })

  const { data: groupRows } = clicked.odoo_sale_order_id
    ? await sb
        .from('circuit_prestations')
        .select('id, invoiced_at, prestation_date')
        .eq('odoo_sale_order_id', clicked.odoo_sale_order_id)
    : { data: [{ id: clicked.id, invoiced_at: clicked.invoiced_at, prestation_date: null }] }

  // Refuse si au moins UNE ligne du groupe est facturee
  if ((groupRows || []).some(r => r.invoiced_at)) {
    return NextResponse.json({
      error: 'Au moins une date du dossier est deja facturee. Modification interdite. Supprime/annule la facture Odoo si besoin.',
    }, { status: 400 })
  }

  // 2. Body de mise a jour
  const body = await req.json() as UpdateBody
  const clientName   = String(body.client_name || '').trim()
  const clientOdooId = body.client_odoo_id || null
  const type         = body.type
  const dates        = Array.isArray(body.dates) ? body.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []
  const nbDep        = type === 'after_six' ? 1 : Math.max(1, Math.min(6, body.nb_depanneuses || 1))
  const notes        = body.notes?.trim() || null

  if (!clientName)     return NextResponse.json({ error: 'client_name requis' }, { status: 400 })
  if (!clientOdooId)   return NextResponse.json({ error: 'client_odoo_id requis' }, { status: 400 })
  if (!['incentive', 'after_six'].includes(type)) return NextResponse.json({ error: 'type invalide' }, { status: 400 })
  if (dates.length === 0) return NextResponse.json({ error: 'au moins 1 date requise' }, { status: 400 })

  const oldOrderId = clicked.odoo_sale_order_id
  const groupIds   = (groupRows || []).map(r => r.id)

  // 3. Annule l ancien devis Odoo (si existait)
  if (oldOrderId) {
    try {
      await withOdooActor(actorId, async () => {
        await odooRpc('sale.order', 'action_cancel', [[oldOrderId]])
      })
    } catch (e: any) {
      console.warn(`[circuit PUT] cancel ancien devis ${oldOrderId} KO:`, e?.message)
      // On continue meme si l annulation echoue : le nouveau devis sera cree
      // et l ancien restera comme dossier orphan a nettoyer manuellement.
    }
  }

  // 4. Cree le nouveau devis Odoo
  let newOrder: { id: number; name: string }
  try {
    newOrder = await withOdooActor(actorId, () => createCircuitQuote({
      partnerId: clientOdooId,
      lines:     dates.map(d => ({ type, date: d, nb_depanneuses: nbDep })),
      notes:     notes || undefined,
    }))
  } catch (e: any) {
    return NextResponse.json({
      error: `Creation nouveau devis Odoo KO : ${e?.message || e}. ATTENTION: l ancien devis (${oldOrderId}) a peut-etre deja ete annule. Verifier manuellement dans Odoo.`,
    }, { status: 500 })
  }

  // 5. Supprime les anciennes lignes BDD + insert les nouvelles
  if (groupIds.length > 0) {
    await sb.from('circuit_prestations').delete().in('id', groupIds)
  }

  const rows = dates.map(d => ({
    client_name:    clientName,
    client_odoo_id: clientOdooId,
    type,
    prestation_date: d,
    nb_depanneuses: nbDep,
    odoo_sale_order_id:   newOrder.id,
    odoo_sale_order_name: newOrder.name,
    notes,
    created_by:     actorId,
  }))
  const { data: inserted, error: insErr } = await sb
    .from('circuit_prestations')
    .insert(rows)
    .select()
  if (insErr) {
    return NextResponse.json({
      ok: false,
      warning: `Nouveau devis Odoo cree (${newOrder.name}) MAIS persistance VD Soft KO : ${insErr.message}. Verifier manuellement.`,
      odoo_sale_order: newOrder,
    }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    old_order_id: oldOrderId,
    odoo_sale_order: newOrder,
    prestations: inserted || [],
    message: `Dossier modifié : ancien devis annulé, nouveau devis ${newOrder.name} créé avec ${dates.length} date(s)`,
  })
}
