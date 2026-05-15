// src/app/api/missions/[id]/payment-derogation/route.ts
//
// Workflow derogation paiement (cf migration 202605151200_payment_derogations).
//
// GET  : recupere la derogation pending courante d une mission (null sinon)
// POST : chauffeur cree une demande { motive } → notif dispatcher de garde

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendNotification }  from '@/lib/notifications/send'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data } = await sb
    .from('payment_derogations')
    .select('id, mission_id, motive, status, requested_at, requester:users!payment_derogations_requested_by_fkey(id, name)')
    .eq('mission_id', params.id)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ derogation: data || null })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { motive?: string }
  const motive = (body.motive || '').trim()
  if (!motive) return NextResponse.json({ error: 'Motif obligatoire' }, { status: 400 })

  const sb = createAdminClient()

  const { data: me } = await sb
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 401 })

  // Verifie qu il n y a pas deja une demande pending sur cette mission
  const { data: existing } = await sb
    .from('payment_derogations')
    .select('id')
    .eq('mission_id', params.id)
    .eq('status', 'pending')
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'Une demande est deja en attente sur cette mission' }, { status: 409 })
  }

  // Mission context pour la notif
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, dossier_number, external_id, client_name, amount_to_collect, vehicle_plate, incident_city')
    .eq('id', params.id)
    .maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // Crée la demande
  const { data: derogation, error } = await sb
    .from('payment_derogations')
    .insert({
      mission_id:   params.id,
      requested_by: me.id,
      motive,
    })
    .select('id')
    .single()
  if (error || !derogation) return NextResponse.json({ error: error?.message || 'Erreur creation' }, { status: 500 })

  // Notifie le dispatcher de garde
  const { data: onDuty } = await sb
    .from('dispatcher_on_duty')
    .select('user_id')
    .eq('id', 1)
    .maybeSingle()
  if (onDuty?.user_id) {
    const label = `${mission.dossier_number || mission.external_id || params.id.slice(0,8)}${mission.client_name ? ' — ' + mission.client_name : ''}`
    try {
      await sendNotification(onDuty.user_id, 'payment_derogation_requested', {
        title:      `🆘 Dérogation paiement demandée`,
        body:       `${me.name} — ${label} (${mission.amount_to_collect || 0} €) : ${motive.slice(0, 80)}`,
        action_url: `/dispatch/${params.id}`,
        mission_id: params.id,
        derogation_id: derogation.id,
      } as any)
    } catch (e: any) {
      console.error('[Derogation] Notif dispatcher echouee:', e.message)
    }
  } else {
    console.warn('[Derogation] Aucun dispatcher de garde defini — pas de notif envoyee')
  }

  // Log mission_logs pour audit
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   me.id,
    action:     'payment_derogation_requested',
    notes:      `Dérogation demandée : ${motive}`,
  })

  return NextResponse.json({ ok: true, derogation_id: derogation.id })
}

// PATCH : le chauffeur modifie le motif d une demande pending (la sienne)
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as { motive?: string }
  const motive = (body.motive || '').trim()
  if (!motive || motive.length < 5) return NextResponse.json({ error: 'Motif trop court' }, { status: 400 })

  const sb = createAdminClient()
  const { data: me } = await sb
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 401 })

  // Update uniquement si encore pending ET cree par ce chauffeur
  const { data: updated, error } = await sb
    .from('payment_derogations')
    .update({ motive })
    .eq('mission_id', params.id)
    .eq('requested_by', me.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Aucune demande pending a modifier' }, { status: 404 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   me.id,
    action:     'payment_derogation_modified',
    notes:      `Motif modifié : ${motive}`,
  })

  return NextResponse.json({ ok: true })
}

// DELETE : le chauffeur annule sa demande pending
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: me } = await sb
    .from('users')
    .select('id, name')
    .eq('email', session.user.email!)
    .single()
  if (!me) return NextResponse.json({ error: 'User introuvable' }, { status: 401 })

  // Hard delete : pas encore decide, aucun audit metier a preserver (le log
  // mission_logs garde la trace de l intention initiale)
  const { data: deleted, error } = await sb
    .from('payment_derogations')
    .delete()
    .eq('mission_id', params.id)
    .eq('requested_by', me.id)
    .eq('status', 'pending')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: 'Aucune demande pending a annuler' }, { status: 404 })
  }

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   me.id,
    action:     'payment_derogation_cancelled',
    notes:      'Demande annulée par le chauffeur',
  })

  return NextResponse.json({ ok: true })
}
