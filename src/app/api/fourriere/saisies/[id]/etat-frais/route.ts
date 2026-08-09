// src/app/api/fourriere/saisies/[id]/etat-frais/route.ts
//
// Génère l'état de frais d'un dossier saisie et le renvoie en PDF (inline).
//   POST { billingTo?, recipient?, chargedKmBeyond? }  → PDF
// Attribue/réutilise le numéro EF, persiste saisie_etats_frais, avance le dossier.
// Accès : admin / superadmin / module fourriere. Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { generateEtatFrais } from '@/lib/missions/saisie-dossier'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

  try {
    const sb = createAdminClient()
    const { pdf, numero } = await generateEtatFrais(sb, params.id, {
      billingTo: body.billingTo || undefined,
      recipient: body.recipient || undefined,
      chargedKmBeyond: body.chargedKmBeyond != null ? Number(body.chargedKmBeyond) : undefined,
      roundTripKm: body.roundTripKm != null ? Number(body.roundTripKm) : undefined,
    }, userId)
    return new NextResponse(pdf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="etat-de-frais-${numero}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Génération échouée' }, { status: 500 })
  }
}
