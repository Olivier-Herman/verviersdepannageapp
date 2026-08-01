// src/app/api/conges/route.ts
//
// Module Congés.
// GET  (RH/superadmin) → liste des demandes.
// POST { action:'request', type, start_date, end_date, reason }   (travailleur lié)
// POST { action:'decide', id, decision:'approve'|'refuse', pin, note }  (RH/superadmin, PIN)

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { isPersonnelStaff }          from '@/lib/rh-access'
import { sendEmail, emailLayout }    from '@/lib/emails'
import { applyLeaveToSheets, revertLeaveFromSheets, countWeekdays, workerDayHours, hoursForRange, CONGE_TYPES } from '@/lib/conges/apply'
import { sendNotification }          from '@/lib/notifications/send'
import bcrypt                        from 'bcryptjs'

export const dynamic    = 'force-dynamic'
export const fetchCache  = 'force-no-store'

const NOTIFY_MANAGER = 'mobi@verviersdepannage.be'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isPersonnelStaff(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: reqs } = await sb.from('conge_requests').select('*').order('created_at', { ascending: false }).limit(500)
  const ids = [...new Set((reqs || []).map((r: any) => r.personnel_id).filter(Boolean))]
  const { data: pers } = ids.length ? await sb.from('personnel').select('id, name').in('id', ids) : { data: [] }
  const nameById = new Map((pers || []).map((p: any) => [p.id, p.name]))
  const requests = (reqs || []).map((r: any) => ({ ...r, worker: nameById.get(r.personnel_id) || '?', typeLabel: CONGE_TYPES[r.type] || r.type }))
  return NextResponse.json({ requests })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const sb = createAdminClient()

  if (action === 'request') {
    const type = String(body.type || ''), start = String(body.start_date || ''), end = String(body.end_date || '')
    if (!CONGE_TYPES[type]) return NextResponse.json({ error: 'Type invalide' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start)
      return NextResponse.json({ error: 'Dates invalides' }, { status: 400 })
    const { data: persons } = await sb.from('personnel').select('id, name, kind').eq('user_id', u.id)
    if (!persons?.length) return NextResponse.json({ error: 'Aucune fiche liée à ton compte' }, { status: 400 })
    const days = countWeekdays(start, end)
    if (days < 1) return NextResponse.json({ error: 'La plage ne contient aucun jour ouvrable' }, { status: 400 })
    const hours = hoursForRange(await workerDayHours(sb, persons[0].id), start, end)
    // Indépendant (sous-traitant) : peut « imposer » son congé (auto-approuvé, RH informé).
    const isIndep = persons[0].kind === 'independant'
    const impose  = !!body.impose && isIndep

    await sb.from('conge_requests').insert({
      personnel_id: persons[0].id, user_id: u.id, type, start_date: start, end_date: end,
      days, hours, reason: String(body.reason || '').trim() || null,
      status: impose ? 'approved' : 'pending',
      ...(impose ? { applied: true, decided_by: `${persons[0].name} (indépendant)`, decided_at: new Date().toISOString() } : {}),
    })
    if (impose) await applyLeaveToSheets(sb, persons[0].id, type, start, end).catch(() => {})   // no-op si pas de feuille

    const verb = impose ? 'a imposé un congé' : 'a demandé un congé'
    try {
      const html = emailLayout(
        `<p style="margin:0 0 12px"><b>${persons[0].name}</b> ${verb}${impose ? ' (indépendant, sans validation)' : ''}.</p>
         <p style="margin:0 0 6px"><b>Type :</b> ${CONGE_TYPES[type]}</p>
         <p style="margin:0 0 6px"><b>Du :</b> ${start} <b>au</b> ${end} (${days} jour${days > 1 ? 's' : ''} ouvrable${days > 1 ? 's' : ''})</p>
         ${body.reason ? `<p style="margin:0 0 6px"><b>Motif :</b> ${String(body.reason)}</p>` : ''}
         <p style="margin:12px 0 0;color:#666;font-size:13px">${impose ? 'Pour information — congé déjà approuvé.' : 'À valider dans VD Soft → Gestion du personnel → Congés.'}</p>`,
        impose ? 'Congé imposé' : 'Demande de congé')
      await sendEmail(NOTIFY_MANAGER, `${impose ? 'Congé imposé' : 'Demande de congé'} — ${persons[0].name}`, html, 'RH')
    } catch (e: any) { console.error('[conges] mail manager', e.message) }
    // Notif in-app aux valideurs (superadmin + RH)
    try {
      const { data: mgrs } = await sb.from('users').select('id').or('role.in.(superadmin,rh),roles.ov.{superadmin,rh}')
      await Promise.all((mgrs || []).map((m: any) => sendNotification(m.id, 'conge_requested', {
        title: impose ? 'Congé imposé (indépendant)' : 'Demande de congé',
        body: `${persons[0].name} — ${CONGE_TYPES[type]}, ${start} → ${end} (${days}j)`, action_url: '/personnel/conges',
      })))
    } catch (e: any) { console.error('[conges] notif manager', e.message) }
    return NextResponse.json({ ok: true, imposed: impose })
  }

  if (action === 'decide') {
    if (!isPersonnelStaff(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = String(body.id || ''), decision = String(body.decision || ''), pin = String(body.pin || '')
    if (!id || !['approve', 'refuse'].includes(decision) || !pin) return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })

    const { data: me } = await sb.from('users').select('name, verify_pin_hash').eq('email', u.email).maybeSingle()
    if (!me?.verify_pin_hash) return NextResponse.json({ error: "Aucun PIN configuré sur ton profil (Administration → PIN)." }, { status: 400 })
    if (!(await bcrypt.compare(pin, me.verify_pin_hash))) return NextResponse.json({ error: 'PIN incorrect' }, { status: 403 })

    const { data: r } = await sb.from('conge_requests').select('*').eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })

    // Transitions (re-décision autorisée) : approuver → pose sur la feuille si pas
    // déjà fait ; refuser une demande approuvée → retire le congé de la feuille.
    let appliedInfo: any = null
    if (decision === 'approve') {
      if (!r.applied) appliedInfo = await applyLeaveToSheets(sb, r.personnel_id, r.type, r.start_date, r.end_date)
    } else {
      if (r.applied) await revertLeaveFromSheets(sb, r.personnel_id, r.type, r.start_date, r.end_date)
    }
    await sb.from('conge_requests').update({
      status: decision === 'approve' ? 'approved' : 'refused',
      decided_by: me.name || 'Responsable', decided_at: new Date().toISOString(),
      decision_note: String(body.note || '').trim() || null,
      applied: decision === 'approve',
    }).eq('id', id)

    // Notifie le travailleur
    try {
      const { data: usr } = await sb.from('users').select('email, name').eq('id', r.user_id).maybeSingle()
      const { data: p } = await sb.from('personnel').select('name, email').eq('id', r.personnel_id).maybeSingle()
      const to = usr?.email || p?.email
      const ok = decision === 'approve'
      if (to) {
        const html = emailLayout(
          `<p style="margin:0 0 12px">Bonjour ${(usr?.name || p?.name || '').split(' ')[0]},</p>
           <p style="margin:0 0 12px">Ta demande de congé (${CONGE_TYPES[r.type]}, du ${r.start_date} au ${r.end_date}) a été <b>${ok ? 'approuvée ✅' : 'refusée'}</b>${me.name ? ` par ${me.name}` : ''}.</p>
           ${body.note ? `<p style="margin:0 0 12px;color:#555"><b>Note :</b> ${String(body.note)}</p>` : ''}`,
          ok ? 'Congé approuvé' : 'Congé refusé')
        await sendEmail(to, `Congé ${ok ? 'approuvé' : 'refusé'} — ${r.start_date}`, html, usr?.name || '')
      }
      // Notif in-app au travailleur
      if (r.user_id) await sendNotification(r.user_id, 'conge_decided', {
        title: ok ? 'Congé approuvé ✅' : 'Congé refusé',
        body: `${CONGE_TYPES[r.type]}, du ${r.start_date} au ${r.end_date}${me.name ? ` — ${me.name}` : ''}`, action_url: '/ma-paie',
      })
    } catch (e: any) { console.error('[conges] notif worker', e.message) }

    return NextResponse.json({ ok: true, applied: appliedInfo })
  }

  if (action === 'cancel') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const { data: r } = await sb.from('conge_requests').select('*').eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })

    const staff = isPersonnelStaff(u)
    // Travailleur : peut annuler SA demande encore en attente, sans PIN.
    if (!staff) {
      if (r.user_id !== u.id || r.status !== 'pending') return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
      await sb.from('conge_requests').delete().eq('id', id)
      return NextResponse.json({ ok: true })
    }

    // Manager : annulation de n'importe quelle demande, au PIN + restauration.
    const pin = String(body.pin || '')
    const { data: me } = await sb.from('users').select('verify_pin_hash').eq('email', u.email).maybeSingle()
    if (!me?.verify_pin_hash) return NextResponse.json({ error: "Aucun PIN configuré sur ton profil." }, { status: 400 })
    if (!pin || !(await bcrypt.compare(pin, me.verify_pin_hash))) return NextResponse.json({ error: 'PIN incorrect' }, { status: 403 })

    if (r.applied) await revertLeaveFromSheets(sb, r.personnel_id, r.type, r.start_date, r.end_date)
    await sb.from('conge_requests').delete().eq('id', id)
    if (r.status === 'approved' && r.user_id) {
      try {
        const { data: usr } = await sb.from('users').select('email, name').eq('id', r.user_id).maybeSingle()
        if (usr?.email) {
          const html = emailLayout(`<p>Bonjour,</p><p>Ton congé (${CONGE_TYPES[r.type]}, du ${r.start_date} au ${r.end_date}) a été <b>annulé</b>.</p>`, 'Congé annulé')
          await sendEmail(usr.email, `Congé annulé — ${r.start_date}`, html, usr.name || '')
        }
        await sendNotification(r.user_id, 'conge_decided', { title: 'Congé annulé', body: `${CONGE_TYPES[r.type]}, du ${r.start_date} au ${r.end_date}`, action_url: '/ma-paie' })
      } catch {}
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'request_cancel') {
    // Travailleur : demande l'annulation d'un congé APPROUVÉ (le manager confirmera).
    const id = String(body.id || '')
    const { data: r } = await sb.from('conge_requests').select('*').eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
    if (r.user_id !== u.id && !isPersonnelStaff(u)) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    if (r.status !== 'approved') return NextResponse.json({ error: "Seul un congé approuvé peut faire l'objet d'une demande d'annulation." }, { status: 400 })
    await sb.from('conge_requests').update({ status: 'cancel_requested' }).eq('id', id)
    try {
      const { data: p } = await sb.from('personnel').select('name').eq('id', r.personnel_id).maybeSingle()
      const { data: mgrs } = await sb.from('users').select('id').or('role.in.(superadmin,rh),roles.ov.{superadmin,rh}')
      const html = emailLayout(`<p><b>${p?.name || ''}</b> demande l'<b>annulation</b> de son congé (${CONGE_TYPES[r.type]}, du ${r.start_date} au ${r.end_date}).</p><p style="color:#666;font-size:13px">À confirmer dans VD Soft → Congés.</p>`, 'Annulation de congé demandée')
      await sendEmail(NOTIFY_MANAGER, `Annulation de congé — ${p?.name || ''}`, html, 'RH')
      await Promise.all((mgrs || []).map((m: any) => sendNotification(m.id, 'conge_requested', {
        title: 'Annulation de congé demandée', body: `${p?.name || ''} — ${CONGE_TYPES[r.type]}, ${r.start_date} → ${r.end_date}`, action_url: '/personnel/conges',
      })))
    } catch (e: any) { console.error('[conges] request_cancel notif', e.message) }
    return NextResponse.json({ ok: true })
  }

  if (action === 'refuse_cancel') {
    // Manager : refuse la demande d'annulation → le congé est maintenu.
    if (!isPersonnelStaff(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const id = String(body.id || '')
    const { data: r } = await sb.from('conge_requests').select('*').eq('id', id).maybeSingle()
    if (!r) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
    await sb.from('conge_requests').update({ status: 'approved' }).eq('id', id)
    if (r.user_id) { try { await sendNotification(r.user_id, 'conge_decided', { title: 'Annulation refusée', body: `Ton congé (${CONGE_TYPES[r.type]}, du ${r.start_date} au ${r.end_date}) est maintenu.`, action_url: '/ma-paie' }) } catch {} }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
