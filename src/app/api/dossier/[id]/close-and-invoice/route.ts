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
import { buildDossier }         from '@/lib/dossier/build'
import { invoiceDossierGroups } from '@/lib/dossier/invoice'
import { assertExitAllowed }    from '@/lib/missions/exit-control'
import { releaseParcAndShift }  from '@/lib/parc/release'

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
  const { data: root } = await sb.from('incoming_missions').select('id, status, source, snc_scenario, mission_number, parc_zone_key').eq('id', d0.root_id).maybeSingle()
  if (!root) return NextResponse.json({ error: 'Fiche principale introuvable' }, { status: 404 })
  if (root.status !== 'parked') return NextResponse.json({ error: `Le véhicule n'est pas au parc (fiche ${root.status}) : rien à clôturer, utilise « Facturer ».` }, { status: 409 })
  if (['police_snc', 'sia_couvert'].includes(String(root.source || '')) && !root.snc_scenario) {
    return NextResponse.json({ error: 'Scénario SNC requis avant de clôturer : choisis-le sur la fiche.' }, { status: 409 })
  }
  const gate = await assertExitAllowed(sb, root.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error, exit_control_blocked: true }, { status: 409 })

  // 1. Sortie du parc maintenant : la fiche quitte 'parked' → le trigger ferme
  //    le gardiennage ouvert (parc_exit_at = now, plus aucune nuit comptée).
  const now = new Date().toISOString()
  const { error: upErr } = await sb.from('incoming_missions')
    .update({ status: 'to_invoice', completed_at: now, updated_at: now })
    .eq('id', root.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  await sb.from('incoming_missions')
    .update({ parc_exit_reason: 'enlevement_transporteur', updated_at: now })
    .eq('parent_mission_id', root.id).eq('dossier_leg', true).eq('parc_exit_reason', 'sortie').gte('parc_exit_at', new Date(Date.now() - 120_000).toISOString())
    .then(() => {}, () => {})
  let released: any = null
  try { released = await releaseParcAndShift(sb, root.id) } catch (e: any) { console.warn('[close-and-invoice] libération parc KO (non bloquant):', e?.message) }
  await sb.from('mission_logs').insert({
    mission_id: root.id, actor_id: user.id || null, action: 'force_status_to_invoice',
    notes: `Clôturer et facturer : enlèvement par un transporteur, sortie du parc${root.parc_zone_key ? ` (zone ${root.parc_zone_key})` : ''}, gardiennage arrêté maintenant`,
    metadata: { via: 'dossier_close_and_invoice', released },
  }).then(() => {}, () => {})

  // 2. Facturer : les groupes demandés + tout ce qui est prêt maintenant que le
  //    gardiennage est fermé (le gardiennage lui-même en premier lieu).
  try {
    const d = await buildDossier(root.id, { light: true })
    if (!d) throw new Error('Dossier illisible après clôture')
    const pickable = d.legs.filter(l => !l.nothing_to_bill && l.amount_htva > 0 && (l.channel || 'odoo') === 'odoo' && l.kind !== 'out'
      && !(l.billed_refs.length > 0 && l.billed_htva >= l.amount_htva - 0.01))
    const ids = Array.from(new Set([...wanted.filter(id => pickable.some(l => l.mission_id === id)), ...pickable.filter(l => l.kind === 'gard' || wanted.length === 0).map(l => l.mission_id)]))
    if (!ids.length) return NextResponse.json({ ok: true, closed: true, invoices: [], warnings: ['Dossier clôturé, mais rien à facturer (tout est déjà facturé ou sans frais).'] })
    const result = await invoiceDossierGroups({ anyMissionId: root.id, missionIds: ids, actorUserId: user.id || null })
    return NextResponse.json({ ok: true, closed: true, ...result })
  } catch (e: any) {
    const msg = String(e?.message || e)
    console.error('[dossier/close-and-invoice]', msg)
    return NextResponse.json({ ok: false, closed: true, error: `Dossier clôturé (véhicule sorti du parc) mais facture non créée : ${msg}. Relance « Facturer ».` }, { status: 400 })
  }
}
