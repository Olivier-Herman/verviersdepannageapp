// src/app/api/missions/[id]/invoice-draft/route.ts
//
// GET    : retourne le brouillon des lignes du devis pour cette mission
// PUT    : sauvegarde (upsert) les lignes du brouillon
// DELETE : efface le brouillon (appele au push vers Odoo)
//
// Acces : admin/superadmin/module 'facturation'.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const VALID_KINDS = ['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV']

async function ensureAccess() {
  const session = await getServerSession(authOptions)
  if (!session) return { user: null, error: { code: 401, msg: 'Unauthorized' } as const }
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
    return { user: null, error: { code: 403, msg: 'Accès réservé à la facturation.' } as const }
  }
  return { user, error: null }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { user, error } = await ensureAccess()
  if (!user) return NextResponse.json({ error: error!.msg }, { status: error!.code })

  const sb = createAdminClient()
  const { data, error: dbErr } = await sb
    .from('mission_invoice_drafts')
    .select('lines, updated_at, updated_by')
    .eq('mission_id', params.id)
    .maybeSingle()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  if (!data) return NextResponse.json({ draft: null })
  return NextResponse.json({ draft: { lines: data.lines, updated_at: data.updated_at, updated_by: data.updated_by } })
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { user, error } = await ensureAccess()
  if (!user) return NextResponse.json({ error: error!.msg }, { status: error!.code })

  const body = await req.json().catch(() => ({}))
  const rawLines: any[] = Array.isArray(body.lines) ? body.lines : []
  // Valide et normalise les lignes
  const lines = rawLines.map(l => ({
    kind:       VALID_KINDS.includes(l.kind) ? l.kind : 'SERV-DIV',
    name:       String(l.name || ''),
    qty:        Number(l.qty) || 0,
    price_unit: Number(l.price_unit) || 0,
  }))

  const sb = createAdminClient()
  const { data, error: dbErr } = await sb
    .from('mission_invoice_drafts')
    .upsert({
      mission_id: params.id,
      lines,
      updated_at: new Date().toISOString(),
      updated_by: user.id || null,
    }, { onConflict: 'mission_id' })
    .select()
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ draft: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { user, error } = await ensureAccess()
  if (!user) return NextResponse.json({ error: error!.msg }, { status: error!.code })

  const sb = createAdminClient()
  const { error: dbErr } = await sb
    .from('mission_invoice_drafts')
    .delete()
    .eq('mission_id', params.id)

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
