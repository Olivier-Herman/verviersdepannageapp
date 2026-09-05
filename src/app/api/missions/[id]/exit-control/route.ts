// src/app/api/missions/[id]/exit-control/route.ts
//
// GET  → état du contrôle de sortie (armé ? checklist, pièces, blocage)
// POST → actions du bureau fourrière sur la checklist :
//   { action: 'path',      path: 'informex'|'autre', destination?, by_name, note? }
//   { action: 'assistance', assistance_mission_id?, note? }   → chemin 'assistance'
//   { action: 'identity',  identity: {...}, role: 'buyer'|'mandate'|'transporter', mandate_note?, company? }
//   { action: 'company',   company: { name, vat, vies_ok, truck_plate } }
//   { action: 'informex_qr', raw }                              → saisie manuelle du contenu QR / référence
//   { action: 'force',     reason, pin }                        → sortie forcée (PIN personnel bcrypt)
//   { action: 'reset_path' }                                    → efface le chemin (avant signature uniquement)
//
// Accès : dispatcher / admin / superadmin + modules fourriere / facturation.
// Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import bcrypt                from 'bcryptjs'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'
import { getExitControlState, isExitControlSource } from '@/lib/missions/exit-control'

export const dynamic = 'force-dynamic'

const guard = (session: any) => sessionAccess(session, {
  roles:   ['admin', 'superadmin', 'dispatcher'],
  modules: ['fourriere', 'facturation'],
})

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const acc = guard(session)
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const state = await getExitControlState(sb, params.id)
  return NextResponse.json(state)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const acc = guard(session)
  if (!acc.ok || !acc.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const sb = createAdminClient()
  const missionId = params.id
  const body = await req.json().catch(() => ({})) as any
  const now = new Date().toISOString()

  const { data: mission } = await sb.from('incoming_missions')
    .select('id, source, status, vehicle_plate, vehicle_vin').eq('id', missionId).maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (!isExitControlSource(mission.source)) {
    return NextResponse.json({ error: 'Cette fiche n\'est pas soumise au contrôle de sortie.' }, { status: 409 })
  }
  const state = await getExitControlState(sb, missionId)
  if (!state.armed) {
    return NextResponse.json({ error: 'Aucun passage d\'expert enregistré : la fiche n\'est pas soumise au contrôle.' }, { status: 409 })
  }
  const control = state.control
  const { data: me } = await sb.from('users').select('id, name, verify_pin_hash').eq('id', acc.id).maybeSingle()
  const meName = me?.name || 'bureau'

  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: missionId, actor_id: acc.id, action, notes, metadata }).then(() => {}, () => {})
  const patch = async (fields: Record<string, any>) => {
    const { error } = await sb.from('mission_exit_control').update({ ...fields, updated_at: now }).eq('mission_id', missionId)
    if (error) throw new Error(error.message)
  }

  try {
    switch (body.action) {
      case 'path': {
        if (control.attestation_signed_at) return NextResponse.json({ error: 'Attestation déjà signée : le chemin ne peut plus changer.' }, { status: 409 })
        const path = body.path === 'informex' ? 'informex' : body.path === 'autre' ? 'autre' : null
        if (!path) return NextResponse.json({ error: 'Chemin invalide (informex | autre).' }, { status: 400 })
        const byName = String(body.by_name || '').trim()
        if (!byName) return NextResponse.json({ error: 'Indique qui, au bureau d\'expertise, a donné l\'instruction.' }, { status: 400 })
        const destination = String(body.destination || '').trim()
        if (path === 'autre' && !destination) return NextResponse.json({ error: 'Destination requise pour une autre sortie.' }, { status: 400 })
        await patch({
          path, path_destination: path === 'autre' ? destination : null, path_chosen_at: now,
          path_chosen_by_kind: 'staff', path_chosen_by_name: byName, path_chosen_by_user: acc.id,
          path_note: String(body.note || '').trim() || null, assistance_mission_id: null,
        })
        await log('exit_control_path', `Chemin de sortie : ${path === 'informex' ? 'Informex' : `autre sortie → ${destination}`} — sur instruction de ${byName}${control.expert_bureau ? ` (${control.expert_bureau})` : ''}, encodé par ${meName}.`, { path, destination, by_name: byName })
        break
      }
      case 'assistance': {
        if (control.attestation_signed_at) return NextResponse.json({ error: 'Attestation déjà signée : le chemin ne peut plus changer.' }, { status: 409 })
        const ref = String(body.note || '').trim()
        if (!ref && !body.assistance_mission_id) return NextResponse.json({ error: 'Indique l\'assistance et la référence du dossier.' }, { status: 400 })
        await patch({
          path: 'assistance', path_chosen_at: now, path_chosen_by_kind: 'staff', path_chosen_by_name: meName,
          path_chosen_by_user: acc.id, path_note: ref || null, assistance_mission_id: body.assistance_mission_id || null,
        })
        await log('exit_control_path', `Chemin de sortie : reprise par une assistance — ${ref || body.assistance_mission_id} (encodé par ${meName}).`, { path: 'assistance', note: ref })
        break
      }
      case 'reset_path': {
        if (control.attestation_signed_at) return NextResponse.json({ error: 'Attestation déjà signée : le chemin ne peut plus changer.' }, { status: 409 })
        await patch({ path: null, path_destination: null, path_chosen_at: null, path_chosen_by_kind: null, path_chosen_by_name: null, path_chosen_by_user: null, path_note: null, assistance_mission_id: null })
        await log('exit_control_path', `Chemin de sortie effacé par ${meName}.`, { path: null })
        break
      }
      case 'identity': {
        if (control.attestation_signed_at) return NextResponse.json({ error: 'Attestation déjà signée : l\'identité ne peut plus changer.' }, { status: 409 })
        const id = body.identity && typeof body.identity === 'object' ? body.identity : null
        if (!id || (!id.lastName && !id.firstName)) return NextResponse.json({ error: 'Nom ou prénom requis.' }, { status: 400 })
        const role = ['buyer', 'mandate', 'transporter'].includes(body.role) ? body.role : (control.identity_role || 'buyer')
        const identity = {
          firstName: id.firstName || null, lastName: id.lastName || null, birthDate: id.birthDate || null,
          nationality: id.nationality || null, documentNumber: id.documentNumber || id.nationalNumber || null,
          documentType: id.documentType || null, country: id.country || null,
          street: id.street || null, zip: id.zip || null, city: id.city || null,
          phone: id.phone || null, email: id.email || null,
          source: ['eid', 'ocr', 'manual'].includes(id.source) ? id.source : 'manual',
        }
        const fields: any = { identity, identity_at: now, identity_by: acc.id, identity_role: role, mandate_note: String(body.mandate_note || '').trim() || null }
        if (body.company && typeof body.company === 'object') fields.company = body.company
        await patch(fields)
        await log('exit_control_identity', `Identité enregistrée (${identity.source}) : ${[identity.firstName, identity.lastName].filter(Boolean).join(' ')} — ${role === 'buyer' ? 'acheteur' : role === 'mandate' ? 'mandataire' : 'transporteur'}${fields.mandate_note ? ` — mandat : ${fields.mandate_note}` : ''} (par ${meName}).`, { role, source: identity.source })
        break
      }
      case 'company': {
        if (control.attestation_signed_at) return NextResponse.json({ error: 'Attestation déjà signée.' }, { status: 409 })
        const c = body.company && typeof body.company === 'object' ? body.company : {}
        await patch({ company: { name: c.name || null, vat: c.vat || null, vies_ok: c.vies_ok ?? null, truck_plate: c.truck_plate || null } })
        break
      }
      case 'informex_qr': {
        const raw = String(body.raw || '').trim()
        if (!raw) return NextResponse.json({ error: 'Contenu du QR / référence requis.' }, { status: 400 })
        await patch({ informex_qr_raw: raw, informex_qr_at: now, informex_qr_by: acc.id })
        await log('exit_control_informex', `Bon Informex encodé manuellement par ${meName} : ${raw.slice(0, 200)}`, { raw, manual: true })
        break
      }
      case 'force': {
        const reason = String(body.reason || '').trim()
        const pin = String(body.pin || '').trim()
        if (reason.length < 5) return NextResponse.json({ error: 'Motif obligatoire (5 caractères minimum).' }, { status: 400 })
        if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN à 4 chiffres requis.' }, { status: 400 })
        if (!me?.verify_pin_hash) return NextResponse.json({ error: 'Aucun PIN configuré. Définis ton PIN dans Mon Profil.' }, { status: 400 })
        const ok = await bcrypt.compare(pin, me.verify_pin_hash)
        if (!ok) {
          await log('exit_control_force_denied', `⛔ Sortie forcée refusée : PIN incorrect (${meName}). Motif annoncé : ${reason}`, { reason })
          return NextResponse.json({ error: 'PIN incorrect.' }, { status: 403 })
        }
        await patch({ forced_at: now, forced_by: acc.id, forced_reason: reason })
        await log('exit_control_forced', `⚠️ SORTIE FORCÉE par ${meName} (PIN validé) — motif : ${reason}. Checklist incomplète : ${state.reason || '—'}`, { reason, checks: state.checks })
        await sb.from('mission_remarks').insert({
          mission_id: missionId, created_by: acc.id,
          text: `⚠️ SORTIE FORCÉE hors contrôle de sortie par ${meName} — motif : ${reason}`,
        }).then(() => {}, () => {})
        break
      }
      default:
        return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur' }, { status: 500 })
  }

  const fresh = await getExitControlState(sb, missionId)
  return NextResponse.json(fresh)
}
