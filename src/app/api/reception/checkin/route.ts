// Check-in visiteur (PUBLIC — borne QR). Crée une interaction de type 'visit'
// en file d'attente (status='waiting'), rattache/crée le contact, et lie la fiche
// véhicule si une plaque/réf est fournie. Olivier 2026-07-31.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient }         from '@/lib/supabase'
import { phoneKey, phoneDisplay, emailKey, hasIdentity } from '@/lib/reception/identity'
import { withinGeofence }            from '@/lib/reception/geofence'

export const dynamic    = 'force-dynamic'
export const fetchCache = 'force-no-store'

const normPlate = (p: string) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const sb   = createAdminClient()

  // Présence physique requise (géofence accueil) — anti « scan de chez soi ».
  if (!await withinGeofence(sb, body.lat, body.lng)) {
    return NextResponse.json({ error: 'Vous devez être à l’accueil de Verviers Dépannage.' }, { status: 403 })
  }

  const lang  = body.lang === 'en' ? 'en' : 'fr'
  const name  = String(body.name || '').trim() || null
  const phone = String(body.phone || '').trim() || null
  const email = String(body.email || '').trim() || null
  const note  = String(body.note || '').trim() || null
  const vehicleRaw = String(body.vehicle || '').trim()

  // Motif obligatoire + actif.
  const { data: motif } = await sb.from('reception_motifs')
    .select('id, label, service, requires_vehicle').eq('id', String(body.motif_id || '')).eq('active', true).maybeSingle()
  if (!motif) return NextResponse.json({ error: 'Motif invalide' }, { status: 400 })

  // Identité : e-mail OU GSM.
  if (!hasIdentity(phone, email)) {
    return NextResponse.json({ error: 'E-mail ou numéro de GSM requis' }, { status: 400 })
  }

  // Rapprochement fiche : priorité à la fiche explicitement choisie (reconnaissance
  // par numéro OU sélection plaque), sinon résolution depuis la saisie véhicule.
  let missionId: string | null = null
  const pickedId = String(body.mission_id || '').trim()
  if (pickedId) {
    const { data } = await sb.from('incoming_missions').select('id').eq('id', pickedId).maybeSingle()
    if (data) missionId = data.id
  }
  if (!missionId && vehicleRaw) {
    const pk    = normPlate(vehicleRaw)
    const clean = vehicleRaw.replace(/[^A-Za-z0-9-]/g, '')   // sûr pour ilike/or
    const RANK: Record<string, number> = { parked: 5, to_invoice: 4, delivering: 3, in_progress: 2, completed: 1 }
    const pick = (arr: any[]) => (arr || []).filter(Boolean).sort((a, b) => (RANK[b.status] || 0) - (RANK[a.status] || 0))[0]
    // 1) par plaque normalisée
    const { data: byPlate } = await sb.from('incoming_missions')
      .select('id, vehicle_plate, status').ilike('vehicle_plate', `%${clean}%`).limit(30)
    let hit = pick((byPlate || []).filter(m => normPlate(m.vehicle_plate) === pk))
    // 2) sinon par n° de mission / réf externe / n° de dossier
    if (!hit && clean) {
      const parts = [`external_id.ilike.%${clean}%`, `dossier_number.ilike.%${clean}%`]
      if (/^\d+$/.test(clean)) parts.unshift(`mission_number.eq.${clean}`)
      const { data: byRef } = await sb.from('incoming_missions')
        .select('id, status').or(parts.join(',')).limit(30)
      hit = pick(byRef || [])
    }
    if (hit) missionId = hit.id
  }

  // Contact : réutilise un contact existant du dossier avec le même n°/e-mail,
  // sinon en crée un (rôle visiteur).
  let contactId: string | null = null
  const pkey = phoneKey(phone)
  const ekey = emailKey(email)
  if (missionId && (pkey || ekey)) {
    const { data: existing } = await sb.from('fiche_contacts')
      .select('id').eq('mission_id', missionId)
      .or([pkey ? `phone_key.eq.${pkey}` : '', ekey ? `email.eq.${ekey}` : ''].filter(Boolean).join(','))
      .limit(1)
    if (existing?.[0]) contactId = existing[0].id
  }
  if (!contactId) {
    const { data: c } = await sb.from('fiche_contacts').insert({
      mission_id: missionId, name, role: 'visiteur',
      phone: phoneDisplay(phone), phone_key: pkey, email: ekey, source: 'linked_visit',
    }).select('id').single()
    contactId = c?.id || null
  }

  const now = new Date().toISOString()
  const { data: it, error } = await sb.from('fiche_interactions').insert({
    mission_id: missionId, contact_id: contactId, type: 'visit', status: 'waiting',
    motif_id: motif.id, motif_label: motif.label, service: motif.service,
    note, phone: phoneDisplay(phone), email: ekey, visitor_name: name,
    lang, waiting_since: now,
  }).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, id: it?.id, matched: !!missionId })
}
