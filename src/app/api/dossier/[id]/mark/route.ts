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
import { authOptions }         from '@/lib/auth'
import { createAdminClient }   from '@/lib/supabase'
import { buildDossier, invalidateDossierCache } from '@/lib/dossier/build'
import { releaseParcAndShift } from '@/lib/parc/release'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation')) {
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

  const d = await buildDossier(params.id, { light: true })
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const legs = d.legs.filter(l => ids.includes(l.mission_id) && l.kind !== 'out')
  if (!legs.length) return NextResponse.json({ error: 'Aucun groupe valide' }, { status: 400 })

  const sb = createAdminClient()
  const now = new Date().toISOString()
  const { data: rows } = await sb.from('incoming_missions').select('id, dossier_leg, status, parked_at, invoice_number, storage_waived').in('id', legs.map(l => l.mission_id))
  const rowById: Record<string, any> = {}; for (const r of rows || []) rowById[r.id] = r
  // Le véhicule est-il encore au parc (gardiennage ouvert) ? Alors on ne libère pas la place.
  const stillParked = d.legs.some(l => l.kind === 'gard' && l.open)

  let resolved: { id: number; url: string } | null = null
  if (action === 'already_billed') {
    try { const { resolveInvoiceByNumber } = await import('@/lib/odoo-invoice'); resolved = await resolveInvoiceByNumber(number) } catch { resolved = null }
  }

  // Saisie facturée au propriétaire : le Parquet ne paie que le solde. On note
  // la période payée sur le dossier Saisie (créé s'il n'existe pas encore —
  // fiche d'avant l'intégration auto, ex. APPARTC 08/09/2026).
  if (action === 'already_billed') {
    const { data: r0 } = await sb.from('incoming_missions').select('id, source, saisie_motif_code').eq('id', d.root_id).maybeSingle()
    if (r0 && (String(r0.source || '') === 'police_saisie' || r0.saisie_motif_code)) {
      let { data: sd } = await sb.from('saisie_dossiers').select('id, client_billed_to_date, depannage_billed_client').eq('mission_id', d.root_id).maybeSingle()
      if (!sd) {
        const { SAISIE_MISSION_SNAP, snapshotSaisieMission } = await import('@/lib/missions/saisie-dossier')
        const { data: full } = await sb.from('incoming_missions').select(SAISIE_MISSION_SNAP).eq('id', d.root_id).maybeSingle()
        if (full) { const r = await sb.from('saisie_dossiers').insert(snapshotSaisieMission(full)).select('id, client_billed_to_date, depannage_billed_client').single(); sd = r.data }
      }
      if (sd) {
        const gardTo = legs.filter(l => l.kind === 'gard').map(l => periodTo[l.mission_id] || (l.ended_at ? String(l.ended_at).slice(0, 10) : now.slice(0, 10))).sort().pop() || null
        const remBilled = legs.some(l => l.kind === 'rem' && l.mission_id === d.root_id)
        const upd: Record<string, any> = { updated_at: now }
        if (gardTo && (!sd.client_billed_to_date || gardTo > String(sd.client_billed_to_date))) upd.client_billed_to_date = gardTo
        if (remBilled && !sd.depannage_billed_client) upd.depannage_billed_client = true
        if (Object.keys(upd).length > 1) await sb.from('saisie_dossiers').update(upd).eq('id', sd.id)
      }
    }
  }

  const done: string[] = []
  for (const l of legs) {
    const r = rowById[l.mission_id]; if (!r) continue
    if (action === 'already_billed') {
      if (r.dossier_leg) {
        await sb.from('incoming_missions').update({ invoice_number: number, invoice_odoo_id: resolved?.id ?? null, invoice_url: resolved?.url ?? null, invoiced_at: now, invoiced_by: user.id, invoice_method: 'manual', updated_at: now }).eq('id', l.mission_id)
      } else {
        // D5 (audit 08/09/2026) : véhicule encore au parc → champs de facturation seulement, la fiche reste « parked » et le gardiennage continue ; la sortie passe par Restituer / Clôturer.
        await sb.from('incoming_missions').update({ ...(stillParked ? {} : { status: 'completed', completed_at: r.status === 'completed' ? undefined : now }), invoice_method: 'manual', invoice_number: number, invoice_odoo_id: resolved?.id ?? null, invoice_url: resolved?.url ?? null, invoiced_at: now, invoiced_by: user.id, updated_at: now }).eq('id', l.mission_id)
        if (!stillParked) { try { await releaseParcAndShift(sb, l.mission_id) } catch {} }
      }
      const pTo = l.kind === 'gard' ? (periodTo[l.mission_id] || (l.ended_at ? String(l.ended_at).slice(0, 10) : now.slice(0, 10))) : null
      const pFrom = l.kind === 'gard' && l.started_at ? String(l.started_at).slice(0, 10) : null
      await sb.from('mission_billed_items').insert({
        mission_id: l.mission_id, kind: l.kind === 'gard' ? 'SERV-PARC' : 'SERV-PEC', label: `${l.title} — déjà facturé (n° ${number})`,
        qty: 1, price_unit: l.amount_htva, amount_htva: l.amount_htva, invoice_number: number, invoice_odoo_id: resolved?.id ?? null,
        period_from: pFrom, period_to: pTo,
        dossier_letter: l.letter, billed_by: user.id, billed_to_id: l.billed_to_id, billed_to_name: l.billed_to_name,
      })
      await sb.from('mission_logs').insert({ mission_id: l.mission_id, actor_id: user.id, action: 'invoiced', notes: `Déjà facturé n° ${number} (dossier ${d.ref}, groupe ${l.letter})${resolved ? ' · lien Odoo résolu' : ''}`, metadata: { invoice_number: number, invoice_odoo_id: resolved?.id ?? null, dossier_letter: l.letter } })
    } else if (action === 'auto_billed') {
      if (r.dossier_leg) {
        await sb.from('incoming_missions').update({ invoice_method: 'auto', invoiced_at: now, invoiced_by: user.id, updated_at: now }).eq('id', l.mission_id)
      } else {
        await sb.from('incoming_missions').update({ ...(stillParked ? {} : { status: 'completed', completed_at: r.status === 'completed' ? undefined : now }), invoice_method: 'auto', invoiced_at: now, invoiced_by: user.id, updated_at: now }).eq('id', l.mission_id)   // D5
        if (!stillParked) { try { await releaseParcAndShift(sb, l.mission_id) } catch {} }
      }
      // Pas de ligne mission_billed_items : comme le cron COMEX, invoice_method='auto' + invoiced_at suffit (le dossier affiche « auto-facturation »).
      await sb.from('mission_logs').insert({ mission_id: l.mission_id, actor_id: user.id, action: 'invoiced', notes: `Autofacturé — validé dans COMEX (dossier ${d.ref}, groupe ${l.letter})`, metadata: { method: 'auto', dossier_letter: l.letter } })
    } else {
      if (r.dossier_leg) {
        await sb.from('incoming_missions').update({ storage_waived: true, no_charge_at: now, no_charge_reason: reason, no_charge_by: user.id, updated_at: now }).eq('id', l.mission_id)
      } else {
        await sb.from('incoming_missions').update({ ...(stillParked ? {} : { status: 'completed', completed_at: r.status === 'completed' ? undefined : now }), no_charge_at: now, no_charge_reason: reason, no_charge_by: user.id, updated_at: now }).eq('id', l.mission_id)   // D5
        if (!stillParked) { try { await releaseParcAndShift(sb, l.mission_id) } catch {} }
      }
      await sb.from('mission_logs').insert({ mission_id: l.mission_id, actor_id: user.id, action: 'no_charge', notes: `Intervention sans frais : ${reason} (dossier ${d.ref}, groupe ${l.letter})`, metadata: { reason, dossier_letter: l.letter } })
    }
    done.push(l.letter)
  }
  await sb.from('mission_logs').insert({ mission_id: d.root_id, actor_id: user.id, action: action === 'no_charge' ? 'no_charge' : 'invoiced',
    notes: action === 'already_billed' ? `Dossier ${d.ref} : groupes ${done.join(' ')} déjà facturés sur ${number}` : action === 'auto_billed' ? `Dossier ${d.ref} : groupes ${done.join(' ')} autofacturés (validé COMEX)` : `Dossier ${d.ref} : groupes ${done.join(' ')} sans frais — ${reason}` }).then(() => {}, () => {})
  invalidateDossierCache()
  return NextResponse.json({ ok: true, covers: done, invoice: resolved })
}
