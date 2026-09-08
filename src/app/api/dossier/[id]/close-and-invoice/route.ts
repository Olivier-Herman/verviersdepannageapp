// src/app/api/dossier/[id]/close-and-invoice/route.ts
//
// POST { mission_ids?: string[] } — « Clôturer et facturer » (Olivier 08/09/2026) :
// un transporteur vient chercher un véhicule en gardiennage → le véhicule sort
// du parc MAINTENANT (le gardiennage s'arrête là, plus une nuit de plus), la
// fiche principale passe « à facturer », la place est libérée, puis les
// factures Odoo du dossier sont créées d'un coup (une par client), gardiennage
// compris. Mêmes gardes que « Forcer un statut » : contrôle de sortie des
// épaves gérées par un bureau d'expertise, scénario SNC obligatoire.

import { NextResponse }         from 'next/server'
import { getServerSession }     from 'next-auth'
import { authOptions }          from '@/lib/auth'
import { createAdminClient }    from '@/lib/supabase'
import { isPreviewOn }          from '@/lib/feature-flags'
import { buildDossier, invalidateDossierCache }         from '@/lib/dossier/build'
import { invoiceDossierGroups } from '@/lib/dossier/invoice'
import { exitParcNow }          from '@/lib/parc/exit-parc'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
    return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  }
  if (role !== 'superadmin' && !(await isPreviewOn('dossier_view', role, user.id))) {
    return NextResponse.json({ error: 'Vue dossier non ouverte à ton rôle.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const wanted: string[] = Array.isArray(body.mission_ids) ? body.mission_ids.filter((x: any) => typeof x === 'string') : []

  const sb = createAdminClient()
  const d0 = await buildDossier(params.id, { light: true })
  if (!d0) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const exit = await exitParcNow(sb, d0.root_id, { id: user.id || null, name: user.name }, 'enlevement_transporteur', 'Clôturer et facturer')
  if (!exit.ok) return NextResponse.json({ error: exit.error, exit_control_blocked: exit.exit_control_blocked }, { status: exit.status })
  const root = { id: d0.root_id }

  // 2. Facturer : les groupes demandés + tout ce qui est prêt maintenant que le
  //    gardiennage est fermé (le gardiennage lui-même en premier lieu).
  try {
    const d = await buildDossier(root.id)   // COMPLET : en léger, un remorquage non figé vaut 0 € et sortait de la sélection (2GUV245, 08/09)
    if (!d) throw new Error('Dossier illisible après clôture')
    const pickable = d.legs.filter(l => !l.nothing_to_bill && l.amount_htva > 0 && (l.channel || 'odoo') === 'odoo' && l.kind !== 'out'
      && !(l.billed_refs.length > 0 && l.billed_htva >= l.amount_htva - 0.01))
    // Les groupes cochés passent tels quels (invoiceDossierGroups vérifie et explique) ; on y ajoute le gardiennage qui vient de se fermer.
    const ids = Array.from(new Set([...wanted, ...pickable.filter(l => l.kind === 'gard' || wanted.length === 0).map(l => l.mission_id)]))
    if (!ids.length) return NextResponse.json({ ok: true, closed: true, invoices: [], warnings: ['Dossier clôturé, mais rien à facturer (tout est déjà facturé ou sans frais).'] })
    const result = await invoiceDossierGroups({ anyMissionId: root.id, missionIds: ids, actorUserId: user.id || null })
    invalidateDossierCache()   // la liste (cache 90 s) doit refléter la facture
    return NextResponse.json({ ok: true, closed: true, ...result })
  } catch (e: any) {
    const msg = String(e?.message || e)
    console.error('[dossier/close-and-invoice]', msg)
    return NextResponse.json({ ok: false, closed: true, error: `Dossier clôturé (véhicule sorti du parc) mais facture non créée : ${msg}. Relance « Facturer ».` }, { status: 400 })
  }
}
