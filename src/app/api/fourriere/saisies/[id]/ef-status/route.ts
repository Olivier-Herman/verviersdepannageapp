// src/app/api/fourriere/saisies/[id]/ef-status/route.ts
//
// Marque manuellement un ÉTAT DE FRAIS (devis) accepté/refusé (retour papier sans
// upload). POST { ef_id, status:'accepte'|'refuse' }. Met à jour le rollup dossier.
// Accès : admin/superadmin/module fourriere. Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const efId = String(body.ef_id || '')
  const status = String(body.status || '')
  if (!efId || !['accepte', 'refuse'].includes(status)) return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })

  const sb = createAdminClient()
  const now = new Date().toISOString()
  const { data: ef, error } = await sb.from('saisie_etats_frais')
    .update({ status, validation_at: now }).eq('id', efId).eq('dossier_id', params.id).select('numero').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('saisie_dossiers').update({
    state: status, validation_at: now,
    notes: `${status === 'refuse' ? 'Refusé' : 'Accepté'} par le Parquet (manuel — ${ef.numero}).`,
    updated_at: now,
  }).eq('id', params.id)

  return NextResponse.json({ ok: true })
}
