// src/app/api/missions/[id]/contacts/route.ts
//
// Répertoire de contacts + journal d'interactions (visites/appels/notes) d'une
// fiche véhicule. Alimente l'onglet « Contacts & interactions » du dispatch.
//   GET  → { contacts, interactions }
//   POST { action:'add_contact'|'update_contact'|'delete_contact'|'add_note', ... }
// Accès : session (staff). Tables serveur-only → service_role. Olivier 2026-07-31.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { phoneKey, phoneDisplay, emailKey } from '@/lib/reception/identity'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ROLES = ['client', 'assistance', 'courtier', 'ami', 'visiteur', 'autre']

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const [{ data: contacts }, { data: interactions }] = await Promise.all([
    sb.from('fiche_contacts')
      .select('id, name, role, phone, email, redirect_to, source, created_at')
      .eq('mission_id', params.id).order('created_at', { ascending: true }),
    sb.from('fiche_interactions')
      .select('id, type, motif_label, note, status, phone, email, visitor_name, handled_by, waiting_since, started_at, ended_at, created_at')
      .eq('mission_id', params.id).order('created_at', { ascending: false }).limit(50),
  ])

  const handlerIds = [...new Set((interactions || []).map(i => i.handled_by).filter(Boolean))]
  const names = new Map<string, string>()
  if (handlerIds.length) {
    const { data: us } = await sb.from('users').select('id, name').in('id', handlerIds)
    for (const u of (us || [])) names.set(u.id, u.name || '—')
  }
  const items = (interactions || []).map(i => ({ ...i, handler: i.handled_by ? (names.get(i.handled_by) || '—') : null }))

  return NextResponse.json({ contacts: contacts || [], interactions: items })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'add_contact' || action === 'update_contact') {
    const name  = String(body.name || '').trim() || null
    const role  = ROLES.includes(body.role) ? body.role : 'autre'
    const phone = String(body.phone || '').trim() || null
    const email = String(body.email || '').trim() || null
    if (!name && !phone && !email) return NextResponse.json({ error: 'Nom, téléphone ou e-mail requis' }, { status: 400 })
    const payload: any = {
      name, role,
      phone: phone ? phoneDisplay(phone) : null,
      phone_key: phone ? phoneKey(phone) : null,
      email: email ? emailKey(email) : null,
    }
    if (action === 'add_contact') {
      const { error } = await sb.from('fiche_contacts').insert({
        ...payload, mission_id: params.id, source: 'manual', created_by: me.id,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const cid = String(body.contact_id || '')
      if (!cid) return NextResponse.json({ error: 'contact_id requis' }, { status: 400 })
      const { error } = await sb.from('fiche_contacts').update(payload).eq('id', cid).eq('mission_id', params.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_contact') {
    const cid = String(body.contact_id || '')
    if (!cid) return NextResponse.json({ error: 'contact_id requis' }, { status: 400 })
    await sb.from('fiche_contacts').delete().eq('id', cid).eq('mission_id', params.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_note') {
    const note = String(body.note || '').trim()
    if (!note) return NextResponse.json({ error: 'Note vide' }, { status: 400 })
    const now = new Date().toISOString()
    const { error } = await sb.from('fiche_interactions').insert({
      mission_id: params.id, type: 'note', status: 'done', note,
      handled_by: me.id, started_at: now, ended_at: now,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
