// src/app/api/francofolies/registre-action/route.ts
//
// Actions superadmin sur une ligne du registre Francofolies :
//   - action 'set_email'       : corrige l'email du propriétaire (fiche +
//     encaissement lié) — utile quand l'adresse a été mal encodée à l'enlèvement.
//   - action 'resend_receipt'  : renvoie le reçu client à l'email courant
//     (mêmes données que l'enlèvement : réf, montant TVAC, mode de paiement…).
//
// Olivier 2026-07-26.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any)?.role !== 'superadmin') {
    return NextResponse.json({ error: 'Réservé au superadmin' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const missionId = String(body?.mission_id || '')
  const action    = String(body?.action || '')
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const sb = createAdminClient()

  // ── Corriger l'email ──────────────────────────────────────────────────────
  if (action === 'set_email') {
    const email = String(body?.email || '').trim()
    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Email invalide' }, { status: 400 })
    }
    const val = email || null
    const { error } = await sb.from('incoming_missions').update({ client_email: val }).eq('id', missionId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await sb.from('interventions').update({ client_email: val })
      .eq('mission_id', missionId).eq('service_type', 'encaissement').then(() => {}, () => {})
    await sb.from('mission_logs').insert({
      mission_id: missionId, action: 'francofolies_email_changed',
      metadata: { to: val, by: (session.user as any)?.email || null },
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, client_email: val })
  }

  // ── Renvoyer le reçu ──────────────────────────────────────────────────────
  if (action === 'resend_receipt') {
    const { data: m } = await sb.from('incoming_missions')
      .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, client_name, client_email, amount_to_collect, payment_method, no_charge_at')
      .eq('id', missionId).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
    if ((m as any).no_charge_at) return NextResponse.json({ error: 'Restitution sans frais — pas de reçu' }, { status: 400 })
    const email = String((m as any).client_email || '').trim()
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Aucun email valide sur la fiche — corrige-le d'abord" }, { status: 400 })
    }
    try {
      const { sendClientReceipt } = await import('@/lib/receipt')
      await sendClientReceipt({
        clientEmail:     email,
        clientName:      (m as any).client_name || '',
        reference:       (m as any).external_id || `FF-${(m as any).vehicle_plate}`,
        amount:          Number((m as any).amount_to_collect ?? 0),
        paymentMode:     (m as any).payment_method || 'cash',
        plate:           (m as any).vehicle_plate || '',
        vehicleDisplay:  [(m as any).vehicle_brand, (m as any).vehicle_model].filter(Boolean).join(' ') || '—',
        motifText:       'Véhicule mal garé — Francofolies de Spa',
        locationAddress: 'Francofolies de Spa',
      })
    } catch (e: any) {
      return NextResponse.json({ error: `Envoi KO : ${e?.message || 'erreur'}` }, { status: 500 })
    }
    await sb.from('mission_logs').insert({
      mission_id: missionId, action: 'francofolies_receipt_resent',
      metadata: { to: email, by: (session.user as any)?.email || null },
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, sent_to: email })
  }

  return NextResponse.json({ error: 'action inconnue' }, { status: 400 })
}
