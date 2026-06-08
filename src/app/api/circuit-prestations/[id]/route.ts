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

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES = ['dispatcher', 'admin', 'superadmin']
function hasAccess(user: any): boolean {
  const role = user.role || ''
  const roles = Array.isArray(user.roles) ? user.roles : []
  return ALLOWED_ROLES.includes(role)
      || roles.some((r: string) => ALLOWED_ROLES.includes(r))
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
