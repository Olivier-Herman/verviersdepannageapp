// src/app/api/fourriere/saisies/[id]/etat-frais/[efId]/route.ts
//
// GET → PDF (inline) d'un état de frais DÉJÀ ÉMIS, reconstruit avec son numéro,
// sa période et ses montants d'origine, mais les infos véhicule actuelles de
// la fiche. Ne consomme pas de numéro, n'avance pas le dossier, n'envoie rien.
// Accès : admin / superadmin / module fourriere. Olivier 2026-09-09.

import { NextResponse }           from 'next/server'
import { getServerSession }       from 'next-auth'
import { authOptions }            from '@/lib/auth'
import { createAdminClient }      from '@/lib/supabase'
import { renderEtatFraisFromRow } from '@/lib/missions/saisie-dossier'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  return ['admin', 'superadmin'].includes(u.role || '') || (u.modules || []).includes('fourriere')
}

export async function GET(_req: Request, { params }: { params: { id: string; efId: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { pdf, numero } = await renderEtatFraisFromRow(createAdminClient(), params.id, params.efId)
    return new NextResponse(pdf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="etat-de-frais-${numero}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Génération impossible' }, { status: 400 })
  }
}
