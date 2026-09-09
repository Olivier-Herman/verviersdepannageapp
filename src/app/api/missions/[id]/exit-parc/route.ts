// src/app/api/missions/[id]/exit-parc/route.ts
//
// POST { reason?: 'restitution' | 'enlevement_transporteur' | 'sortie', note? }
// Sortie du parc MAINTENANT sans facturation Odoo : le véhicule a été repris
// (propriétaire, transporteur), le gardiennage s'arrête, la place est libérée.
// Cas d'usage : saisie levée « frais de justice » (1AJP474, Olivier 09/09/2026)
// — la facturation passe par l'état de frais, pas par « Clôturer et facturer ».
// Gardes de exitParcNow : contrôle de sortie, scénario SNC.
// Accès : dispatcher / admin / superadmin + modules fourriere / facturation.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { exitParcNow, type ExitReason } from '@/lib/parc/exit-parc'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const acc = sessionAccess(session, { roles: ['admin', 'superadmin', 'dispatcher'], modules: ['fourriere', 'facturation'] })
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { reason?: string; note?: string }
  const reason: ExitReason = (['restitution', 'enlevement_transporteur', 'sortie'] as const).includes(body.reason as any) ? (body.reason as ExitReason) : 'restitution'
  const sb = createAdminClient()
  const res = await exitParcNow(sb, params.id, { id: acc.id || null, name: (session?.user as any)?.name || null }, reason, String(body.note || '').trim() || undefined)
  if (!res.ok) return NextResponse.json({ error: res.error, exit_control_blocked: res.exit_control_blocked }, { status: res.status })
  return NextResponse.json({ ok: true, released: res.released })
}
