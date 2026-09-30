// POST /api/missions/[id]/claim : un chauffeur s attribue une mission
// disponible (status 'new' ou 'dispatching', non assignee, < 30 min). Atomique
// pour eviter 2 chauffeurs qui prennent la meme mission en meme temps.
// Olivier 2026-06-02. Cf page /missions-dispo.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { getBusinessNumber } from '@/lib/settings/business'
import { claimMission }      from '@/lib/missions/claim'

export const dynamic = 'force-dynamic'

// Fenêtre de fraîcheur = réglage métier momo_market_fresh_minutes (45 min depuis le
// 09/09/2026) ; 3 h quand le chauffeur prend la fiche depuis le bouton « Siabis »
// de la création (Olivier 20/09/2026 : « on ne sait jamais »).
// Logique partagée avec les propositions de nuit : lib/missions/claim.ts.
const SIABIS_FRESH_MINUTES = 180

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as { via?: string }
  const FRESH_MINUTES = body?.via === 'siabis' ? SIABIS_FRESH_MINUTES : await getBusinessNumber('momo_market_fresh_minutes').catch(() => 45)
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = (session.user as any).id
  const role   = (session.user as any).role
  const roles: string[] = Array.isArray((session.user as any).roles) ? (session.user as any).roles : []
  const isDriver = role === 'driver' || roles.includes('driver') || roles.includes('chauffeur') ||
                   ['admin', 'superadmin', 'dispatcher'].includes(role)  // admins/dispatchers peuvent aussi tester
  if (!isDriver) return NextResponse.json({ error: 'Reserve aux chauffeurs' }, { status: 403 })
  if (!userId)   return NextResponse.json({ error: 'Pas d identite' }, { status: 401 })

  const r = await claimMission(params.id, userId, { via: body?.via === 'siabis' ? 'siabis' : 'market', freshMinutes: FRESH_MINUTES })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, missionId: r.missionId })
}
