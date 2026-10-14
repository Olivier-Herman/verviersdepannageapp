// src/app/api/dossier/[id]/mark/route.ts
//
// POST { action: 'already_billed' | 'no_charge' | 'auto_billed', mission_ids, invoice_number?, reason? }
//   • auto_billed (Olivier 08/09/2026) : mission Touring validée par nous dans COMEX
//     → Touring s'autofacture ; même marquage que le cron COMEX BKO
//     (completed + invoice_method='auto'), sans numéro de facture Odoo.
// Les deux actions « à côté » de la facturation par dossier (Olivier 07/09/2026) :
//   • Déjà facturé… : une facture faite à la main dans Odoo — on donne le numéro
//     et les groupes couverts (même effet que « Facturation OK » du module).
//   • Ne rien facturer : intervention sans frais, avec motif.
// Fiches réelles (REM / REL…) : mêmes champs que /api/missions/invoice et
// /api/missions/no-charge. Fiches gardiennage : numéro ou gardiennage offert,
// sans changer le statut ni libérer le parc si le véhicule y est encore.

import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { sessionAccess }       from '@/lib/access'
import { authOptions }         from '@/lib/auth'
import { markDossierLegs, MarkError, type MarkAction } from '@/lib/dossier/mark'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  // Rôle principal OU rôles secondaires (roles[]) OU module facturation.
  if (!sessionAccess(session, { modules: ['facturation'] }).ok) {
    return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const action: string = body.action
  const ids: string[] = Array.isArray(body.mission_ids) ? body.mission_ids.filter((x: any) => typeof x === 'string') : []
  const number = String(body.invoice_number || '').trim()
  const reason = String(body.reason || '').trim()
  // Gardiennage : jusqu'à quelle date la facture couvre-t-elle ? (défaut : fin de la période, sinon aujourd'hui)
  const periodTo: Record<string, string> = body.period_to && typeof body.period_to === 'object' ? body.period_to : {}
  if (!ids.length) return NextResponse.json({ error: 'Aucun groupe coché' }, { status: 400 })
  if (action === 'already_billed' && !number) return NextResponse.json({ error: 'Numéro de facture requis' }, { status: 400 })
  if (action === 'no_charge' && !reason) return NextResponse.json({ error: 'Motif requis pour « ne rien facturer »' }, { status: 400 })
  if (!['already_billed', 'no_charge', 'auto_billed'].includes(action)) return NextResponse.json({ error: 'action invalide' }, { status: 400 })

  try {
    const r = await markDossierLegs(params.id, { action: action as MarkAction, ids, number, reason, periodTo }, { id: user.id })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: e instanceof MarkError ? e.status : 500 })
  }
}
