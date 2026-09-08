// src/app/api/missions/[id]/amount-due/route.ts
//
// GET — montant encore ouvert sur le DOSSIER du véhicule (estimé − facturé −
// encaissé), HTVA et TVAC, avec le détail par groupe. Sert au bouton
// « Restituer » de l'écran QR (Olivier 08/09/2026) : 0 → on sort simplement le
// véhicule ; sinon on informe et on demande quoi faire.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { buildDossier }     from '@/lib/dossier/build'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const r2 = (n: number) => Math.round(n * 100) / 100

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const d = await buildDossier(params.id).catch(() => null)
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const remaining = Math.max(0, r2(d.totals.remaining))
  return NextResponse.json({
    ok: true, ref: d.ref, root_id: d.root_id,
    estimated_htva: r2(d.totals.estimated), billed_htva: r2(d.totals.billed), collected: r2(d.totals.collected),
    remaining_htva: remaining, remaining_tvac: r2(remaining * 1.21),
    unknown: d.legs.some(l => l.amount_unknown),
    billed_to: d.billed_to.name || null,
    legs: d.legs.filter(l => l.kind !== 'out').map(l => ({ letter: l.letter, title: l.title, amount_htva: r2(l.amount_htva), billed: l.billed_refs.length > 0, nothing: l.nothing_to_bill || null, open: l.open })),
  })
}
