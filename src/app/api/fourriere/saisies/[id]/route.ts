// src/app/api/fourriere/saisies/[id]/route.ts
//
// Mise à jour d'un dossier saisie (avancement machine à états + champs).
//   PATCH { state?, recipient?, levee_date?, notes?, justinvoice_ref?, odoo_invoice_id? }
//   GET   → dossier + son historique d'états de frais
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { SAISIE_STATES }     from '@/lib/missions/saisie-dossier'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { data: dossier } = await sb.from('saisie_dossiers').select('*').eq('id', params.id).maybeSingle()
  if (!dossier) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
  const { data: etats } = await sb.from('saisie_etats_frais')
    .select('*').eq('dossier_id', params.id).order('created_at', { ascending: false }).order('id', { ascending: false })
  return NextResponse.json({ dossier, etats: etats || [] })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.state !== undefined) {
    if (!SAISIE_STATES.includes(body.state)) return NextResponse.json({ error: 'État invalide' }, { status: 400 })
    patch.state = body.state
  }
  if (body.recipient !== undefined) {
    if (!['parquet', 'domaine', 'client'].includes(body.recipient)) return NextResponse.json({ error: 'Destinataire invalide' }, { status: 400 })
    patch.recipient = body.recipient
  }
  if (body.levee_date !== undefined)       patch.levee_date = body.levee_date || null
  if (body.notes !== undefined)            patch.notes = body.notes || null
  if (body.justinvoice_ref !== undefined)  patch.justinvoice_ref = body.justinvoice_ref || null
  if (body.odoo_invoice_id !== undefined)  patch.odoo_invoice_id = body.odoo_invoice_id || null

  const { data, error } = await sb.from('saisie_dossiers').update(patch).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, dossier: data })
}

// Retire le dossier de l'intégration (la mission reste intacte → revient dans les
// « à intégrer »). Cascade supprime les états de frais liés. Olivier 2026-08-09.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const { error } = await sb.from('saisie_dossiers').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
