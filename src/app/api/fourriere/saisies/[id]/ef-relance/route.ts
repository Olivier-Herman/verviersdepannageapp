// src/app/api/fourriere/saisies/[id]/ef-relance/route.ts
//
// Relance MANUELLE d'un état de frais envoyé (renvoi du PDF au destinataire).
// Jamais automatique — le Parquet n'apprécie pas (Olivier 2026-09-03).
//   POST { ef_id }              → envoie le rappel
//   POST { ef_id, stop: bool }  → (dés)active le drapeau « ne plus relancer »
// Accès : admin / superadmin / module fourriere.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEfRelance }     from '@/lib/missions/saisie-relance'

export const dynamic     = 'force-dynamic'
export const maxDuration = 40

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
  if (!efId) return NextResponse.json({ error: 'ef_id requis' }, { status: 400 })
  const sb = createAdminClient()

  if (typeof body.stop === 'boolean') {
    const { error } = await sb.from('saisie_etats_frais').update({ relance_stop: body.stop }).eq('id', efId).eq('dossier_id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, stop: body.stop })
  }

  const res = await sendEfRelance(sb, params.id, efId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, email: res.email })
}
