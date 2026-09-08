// src/app/api/missions/[id]/exit-parc/route.ts
//
// POST { reason?: 'restitution' | 'enlevement_transporteur', note? } — le
// véhicule quitte le parc maintenant, SANS facturer (le dossier reste « à
// facturer » pour le bureau, ou est déjà réglé). Utilisé par « Restituer » de
// l'écran QR (Olivier 08/09/2026 : « si le montant à payer est à 0, juste
// sortir la voiture du parc ; sinon … laisser partir sans facturation »).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { exitParcNow, type ExitReason } from '@/lib/parc/exit-parc'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const body = await req.json().catch(() => ({}))
  const reason: ExitReason = body.reason === 'enlevement_transporteur' ? 'enlevement_transporteur' : 'restitution'
  const sb = createAdminClient()
  const r = await exitParcNow(sb, params.id, { id: user.id || null, name: user.name }, reason, typeof body.note === 'string' ? body.note.trim() : undefined)
  if (!r.ok) return NextResponse.json({ error: r.error, exit_control_blocked: r.exit_control_blocked }, { status: r.status })
  return NextResponse.json({ ok: true, released: r.released })
}
