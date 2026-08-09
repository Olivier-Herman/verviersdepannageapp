// src/app/api/fourriere/saisies/[id]/envoyer/route.ts
//
// Génère l'état de frais ET l'envoie au destinataire (mail depuis fourriere@,
// PDF joint + lien de dépôt de la validation). Route mail selon le motif :
// saisie judiciaire → frais de justice ; sinon → Parquet. Avance en 'ef_envoye'.
//   POST { billingTo?, recipient?, roundTripKm? }
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendEtatFrais }     from '@/lib/missions/saisie-dossier'

export const dynamic = 'force-dynamic'
export const maxDuration = 40

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userId = (session!.user as any).id || null
  const body = await req.json().catch(() => ({}))

  const sb = createAdminClient()
  const res = await sendEtatFrais(sb, params.id, {
    billingTo: body.billingTo || undefined,
    recipient: body.recipient || undefined,
    roundTripKm: body.roundTripKm != null ? Number(body.roundTripKm) : undefined,
  }, userId)

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true, email: res.email, numero: res.numero })
}
