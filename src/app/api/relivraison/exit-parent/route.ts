// POST /api/relivraison/exit-parent  { mission_id }
//
// Régularise une fiche mère restée « en parc » alors que sa relivraison est
// TERMINÉE (véhicule parti) — cas vu le 09/09/2026 : 5 fiches en zone K dont la
// relivraison datait de juin à septembre, remises en parc à la main après la
// création de la relivraison. La fiche mère sort du parc à la date de fin de la
// relivraison, passe « à facturer » si rien n'a encore été facturé, et ses volets
// gardiennage se ferment à la même date.
import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { releaseParcAndShift } from '@/lib/parc/release'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const roles: string[] = [u.role, ...(u.roles || [])].filter(Boolean)
  const allowed = roles.some(r => ['dispatcher', 'admin', 'superadmin'].includes(r)) || (u.modules || []).includes('missions')
  if (!allowed) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const { mission_id } = await req.json().catch(() => ({}))
  if (!mission_id) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  const sb = createAdminClient()

  const { data: parent } = await sb.from('incoming_missions')
    .select('id, mission_number, status, dossier_leg, invoice_number, invoice_odoo_id, invoiced_at, no_charge_at, completed_at')
    .eq('id', mission_id).maybeSingle()
  if (!parent || parent.dossier_leg) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  if (parent.status !== 'parked') return NextResponse.json({ error: 'Cette fiche n’est pas en parc.' }, { status: 409 })

  const { data: rel } = await sb.from('incoming_missions')
    .select('id, mission_number, status, completed_at')
    .eq('parent_mission_id', parent.id).eq('dossier_leg', false).in('status', ['completed', 'to_invoice', 'invoiced'])
    .order('completed_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  if (!rel) return NextResponse.json({ error: 'Aucune relivraison terminée sur cette fiche : rien à régulariser.' }, { status: 409 })

  const exitIso = rel.completed_at || new Date().toISOString()
  const billed = !!(parent.invoice_number || parent.invoice_odoo_id || parent.invoiced_at || parent.no_charge_at)
  const upd: Record<string, any> = {
    parc_exit_at: exitIso, parc_exit_reason: 'relivraison', updated_at: new Date().toISOString(),
    ...(billed ? { status: 'completed' } : { status: 'to_invoice' }),
    ...(parent.completed_at ? {} : { completed_at: exitIso }),
  }
  await sb.from('incoming_missions').update(upd).eq('id', parent.id)
  // Volets gardiennage encore ouverts : fermés à la même date.
  await sb.from('incoming_missions')
    .update({ parc_exit_at: exitIso, parc_exit_reason: 'relivraison', updated_at: new Date().toISOString() })
    .eq('parc_origin_mission_id', parent.id).eq('dossier_leg', true).is('parc_exit_at', null)
  try { await releaseParcAndShift(sb, parent.id) } catch (e: any) { console.warn('[exit-parent] libération parc :', e?.message) }
  await sb.from('mission_logs').insert({
    mission_id: parent.id, actor_id: u.id, action: 'parc_exit',
    notes: `Sortie du parc régularisée : relivraison #${rel.mission_number ?? ''} terminée le ${new Date(exitIso).toLocaleDateString('fr-BE')} — la fiche était restée « en parc ». ${billed ? 'Déjà facturée → terminée.' : 'Passe « à facturer ».'}`,
    metadata: { rel_mission_id: rel.id, exit_at: exitIso, new_status: upd.status },
  }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, status: upd.status, exit_at: exitIso })
}
