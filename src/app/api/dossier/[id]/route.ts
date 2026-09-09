// src/app/api/dossier/[id]/route.ts
//
// LECTURE SEULE. Le dossier d'une fiche (REM racine + gardiennages + REL +
// mails sans action) avec lettres, estimation par groupe et totaux. Sert la
// Vue dossier (rafraîchissement après un changement de client de facturation).
// Accès : superadmin, ou flag 'dossier_view' ouvert au rôle. Olivier 07/09/2026.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { isPreviewOn }      from '@/lib/feature-flags'
import { buildDossier }     from '@/lib/dossier/build'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any)?.role || ''
  if (role !== 'superadmin' && !(await isPreviewOn('dossier_view', role, (session.user as any)?.id))) {   // pilotes (Jona) aussi — 08/09 : 403 → montants à 0
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }
  // `mode=list` : ce que demande la LISTE Facturation par dossier — les montants
  // du moteur de facturation, sans les extras réservés à la fiche (recherche
  // d'orphelins par plaque, relecture Odoo). La page s'affiche d'abord avec les
  // montants figés, puis remplace chaque ligne par son vrai montant au fur et à
  // mesure : 24 s d'attente avant le premier pixel, ce n'est pas tenable
  // (Olivier 09/09/2026).
  const listMode = new URL(req.url).searchParams.get('mode') === 'list'
  const dossier = listMode
    ? await buildDossier(params.id, { light: true, price: true, cache: true })
    : await buildDossier(params.id)
  if (!dossier) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  return NextResponse.json({ ok: true, dossier })
}
