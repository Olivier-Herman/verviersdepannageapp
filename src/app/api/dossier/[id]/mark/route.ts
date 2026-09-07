// src/app/api/dossier/[id]/mark/route.ts
//
// POST { action: 'already_billed' | 'no_charge', mission_ids, invoice_number?, reason? }
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
import { buildDossier }        from '@/lib/dossier/build'
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
  if (!ids.length) return NextResponse.json({ error: 'Aucun groupe coché' }, { status: 400 })
  if (action === 'already_billed' && !number) return NextResponse.json({ error: 'Numéro de facture requis' }, { status: 400 })
  if (action === 'no_charge' && !reason) return NextResponse.json({ error: 'Motif requis pour « ne rien facturer »' }, { status: 400 })
  if (!['already_billed', 'no_charge'].includes(action)) return NextResponse.json({ error: 'action invalide' }, { status: 400 })

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

  const done: string[] = []
  for (const l of legs) {
    const r = rowById[l.mission_id]; if (!r) continue
    if (action === 'already_billed') {
      if (r.dossier_leg) {
        await sb.from('incoming_missions').update({ invoice_number: number, invoice_odoo_id: resolved?.id ?? null, invoice_url: resolved?.url ?? null, invoiced_at: now, invoiced_by: user.id, invoice_method: 'manual', updated_at: now }).eq('id', l.mission_id)
      } else {
        await sb.from('incoming_missions').update({ status: 'completed', invoice_method: 'manual', invoice_number: number, invoice_odoo_id: resolved?.id ?? null, invoice_url: resolved?.url ?? null, invoiced_at: now, invoiced_by: user.id, completed_at: r.status === 'completed' ? undefined : now, updated_at: now }).eq('id', l.mission_id)
        if (!stillParked) { try { await releaseParcAndShift(sb, l.mission_id) } catch {} }
      }
      await sb.from('mission_billed_items').insert({
        mission_id: l.mission_id, kind: l.kind === 'gard' ? 'SERV-PARC' : 'SERV-PEC', label: `${l.title} — déjà facturé (n° ${number})`,
        qty: 1, price_unit: l.amount_htva, amount_htva: l.amount_htva, invoice_number: number, invoice_odoo_id: resolved?.id ?? null,
        dossier_letter: l.letter, billed_by: user.id, billed_to_id: l.billed_to_id, billed_to_name: l.billed_to_name,
      })
      await sb.from('mission_logs').insert({ mission_id: l.mission_id, actor_id: user.id, action: 'invoiced', notes: `Déjà facturé n° ${number} (dossier ${d.ref}, groupe ${l.letter})${resolved ? ' · lien Odoo résolu' : ''}`, metadata: { invoice_number: number, invoice_odoo_id: resolved?.id ?? null, dossier_letter: l.letter } })
    } else {
      if (r.dossier_leg) {
        await sb.from('incoming_missions').update({ storage_waived: true, no_charge_at: now, no_charge_reason: reason, no_charge_by: user.id, updated_at: now }).eq('id', l.mission_id)
      } else {
        await sb.from('incoming_missions').update({ status: 'completed', no_charge_at: now, no_charge_reason: reason, no_charge_by: user.id, completed_at: r.status === 'completed' ? undefined : now, updated_at: now }).eq('id', l.mission_id)
        if (!stillParked) { try { await releaseParcAndShift(sb, l.mission_id) } catch {} }
      }
      await sb.from('mission_logs').insert({ mission_id: l.mission_id, actor_id: user.id, action: 'no_charge', notes: `Intervention sans frais : ${reason} (dossier ${d.ref}, groupe ${l.letter})`, metadata: { reason, dossier_letter: l.letter } })
    }
    done.push(l.letter)
  }
  await sb.from('mission_logs').insert({ mission_id: d.root_id, actor_id: user.id, action: action === 'already_billed' ? 'invoiced' : 'no_charge',
    notes: action === 'already_billed' ? `Dossier ${d.ref} : groupes ${done.join(' ')} déjà facturés sur ${number}` : `Dossier ${d.ref} : groupes ${done.join(' ')} sans frais — ${reason}` }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, covers: done, invoice: resolved })
}
