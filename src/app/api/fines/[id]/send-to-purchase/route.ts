// src/app/api/fines/[id]/send-to-purchase/route.ts
//
// POST /api/fines/[id]/send-to-purchase
//   Envoie une amende COMPLÈTE (montant renseigné) aux achats (email) et passe
//   son statut à 'sent_to_purchase'. Accès : admin / superadmin / facturation.
//
// Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendFinePurchaseEmail } from '@/lib/emails'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()
  const { data: f, error } = await sb
    .from('fines')
    .select(`
      id, plate, amount, infraction_date, infraction_place, infraction_type, infraction_ref,
      photo_url, notes, status, purchase_email_sent,
      driver:users!fines_driver_id_fkey(name),
      mission:incoming_missions!fines_mission_id_fkey(mission_number, external_id, dossier_number)
    `)
    .eq('id', params.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!f)    return NextResponse.json({ error: 'Amende introuvable' }, { status: 404 })

  if (f.amount == null || Number(f.amount) <= 0) {
    return NextResponse.json({ error: 'Montant manquant : renseigne le montant avant d’envoyer aux achats.' }, { status: 400 })
  }
  if (f.status === 'sent_to_purchase' || f.purchase_email_sent) {
    return NextResponse.json({ error: 'Déjà envoyée aux achats.' }, { status: 400 })
  }

  // Adresse achats (même réglage que les avances / le POST fines).
  const { data: setting } = await sb.from('app_settings').select('value').eq('key', 'odoo_purchase_email').maybeSingle()
  if (!setting?.value) return NextResponse.json({ error: 'Adresse email achats non configurée (app_settings.odoo_purchase_email).' }, { status: 400 })
  const purchaseEmail = JSON.parse(setting.value) as string

  const mission: any = f.mission
  const missionRef = mission
    ? (mission.mission_number != null ? `#${mission.mission_number}` : (mission.external_id || mission.dossier_number || undefined))
    : undefined

  try {
    await sendFinePurchaseEmail({
      to:              purchaseEmail,
      plate:           f.plate,
      amount:          Number(f.amount),
      infractionDate:  f.infraction_date,
      infractionPlace: f.infraction_place || undefined,
      infractionType:  f.infraction_type || undefined,
      infractionRef:   f.infraction_ref || undefined,
      photoUrl:        f.photo_url,
      driverName:      (f.driver as any)?.name || undefined,
      missionRef,
      employeeName:    user.name || 'Admin',
      notes:           f.notes || undefined,
    })
  } catch (mailErr: any) {
    return NextResponse.json({ error: `Envoi email échoué : ${mailErr?.message || 'inconnu'}` }, { status: 500 })
  }

  const nowIso = new Date().toISOString()
  const { error: uErr } = await sb.from('fines')
    .update({ status: 'sent_to_purchase', purchase_email_sent: true, purchase_email_sent_at: nowIso })
    .eq('id', params.id)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, status: 'sent_to_purchase', purchase_email_sent_at: nowIso })
}
