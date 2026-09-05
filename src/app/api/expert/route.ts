// src/app/api/expert/route.ts
//
// API PUBLIQUE de l'espace expert (page /expert, QR A4 à l'accueil). La clé
// d'appareil (stockée sur le téléphone) tient lieu d'identité ; chaque bureau
// est validé une fois par le bureau fourrière (popup bloquant).
//
// GET  ?key=…            → { device, bureaus, catalog, vehicles }  (sans clé : { catalog })
// POST { action, key?, … }
//   register    { first_name, bureau }            → crée l'appareil + demande d'accès
//   add_bureau  { bureau }                        → nouvelle demande d'accès
//   lookup      { plate, bureau }                 → fiche Police – Accident en parc (zone + photos) ou null
//   seen        { mission_id, bureau }            → « Véhicule vu » (registre + contrôle de sortie)
//   note        { mission_id, text }              → question / remarque sur la fiche
//   path        { mission_id, path, destination?, note? } → chemin de sortie choisi par l'expert
// Olivier 2026-09-05.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import {
  newDeviceKey, loadDevice, deviceBureaus, requestBureauAccess, lookupParkedAccident,
  recordExpertVisit, deviceVehicles, officeUserIds,
} from '@/lib/expert/access'
import { sendNotification } from '@/lib/notifications/send'
import { getExitControlState } from '@/lib/missions/exit-control'

export const dynamic = 'force-dynamic'

const json = (b: any, status = 200) => NextResponse.json(b, { status })

async function catalog(sb: any): Promise<string[]> {
  const { data } = await sb.from('expertise_bureaus').select('name').eq('active', true).order('sort_order').order('name')
  return (data || []).map((b: any) => b.name)
}

async function snapshot(sb: any, device: any) {
  const [bureaus, vehicles] = await Promise.all([deviceBureaus(sb, device.id), deviceVehicles(sb, device.id)])
  return {
    device: { id: device.id, first_name: device.first_name },
    bureaus, vehicles,
    approved: bureaus.filter((b: any) => b.status === 'approved').map((b: any) => b.bureau),
  }
}

export async function GET(req: Request) {
  const sb = createAdminClient()
  const key = new URL(req.url).searchParams.get('key') || ''
  const cat = await catalog(sb)
  const device = key ? await loadDevice(sb, key) : null
  if (!device) return json({ device: null, catalog: cat })
  return json({ ...(await snapshot(sb, device)), catalog: cat })
}

export async function POST(req: Request) {
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({})) as any
  const action = String(body.action || '')
  const key = String(body.key || '')

  if (action === 'register') {
    const firstName = String(body.first_name || '').trim().slice(0, 60)
    const cat = await catalog(sb)
    const bureausIn: string[] = Array.isArray(body.bureaus) ? body.bureaus : (body.bureau ? [body.bureau] : [])
    const bureaus = bureausIn.map(b => String(b || '').trim().slice(0, 160)).filter(b => cat.includes(b))
    if (!firstName) return json({ error: 'Ton prénom, s\'il te plaît.' }, 400)
    if (!bureaus.length) return json({ error: 'Choisis au moins un bureau d\'expertise dans la liste.' }, 400)
    let device = key ? await loadDevice(sb, key) : null
    let deviceKey = key
    if (!device) {
      deviceKey = newDeviceKey()
      const { data, error } = await sb.from('expert_devices')
        .insert({ device_key: deviceKey, first_name: firstName, user_agent: (req.headers.get('user-agent') || '').slice(0, 300) })
        .select('*').single()
      if (error || !data) return json({ error: error?.message || 'Création impossible' }, 500)
      device = data
    } else if (device.first_name !== firstName) {
      await sb.from('expert_devices').update({ first_name: firstName }).eq('id', device.id)
      device = { ...device, first_name: firstName }
    }
    const rows = await requestBureauAccess(sb, device, bureaus)
    return json({ ok: true, key: deviceKey, requests: rows, ...(await snapshot(sb, device)) })
  }

  const device = await loadDevice(sb, key)
  if (!device) return json({ error: 'Accès inconnu ou révoqué. Repasse par le QR de l\'accueil.' }, 401)
  const bureaus = await deviceBureaus(sb, device.id)
  const approvedFor = (b: string) => bureaus.some((x: any) => x.bureau === b && x.status === 'approved')

  switch (action) {
    case 'add_bureau': {
      const cat = await catalog(sb)
      const bureausIn: string[] = Array.isArray(body.bureaus) ? body.bureaus : (body.bureau ? [body.bureau] : [])
      const bureaus = bureausIn.map(b => String(b || '').trim().slice(0, 160)).filter(b => cat.includes(b))
      if (!bureaus.length) return json({ error: 'Choisis au moins un bureau.' }, 400)
      const rows = await requestBureauAccess(sb, device, bureaus)
      return json({ ok: true, requests: rows, ...(await snapshot(sb, device)) })
    }
    case 'lookup': {
      const bureau = String(body.bureau || '').trim()
      if (!approvedFor(bureau)) return json({ error: 'Accès pas encore validé pour ce bureau.' }, 403)
      const plate = String(body.plate || '').trim()
      const m = await lookupParkedAccident(sb, plate)
      if (!m) return json({ ok: true, found: false, message: 'Aucun véhicule accidenté déposé par la police à cette plaque. Adressez-vous au comptoir.' })
      return json({ ok: true, found: true, vehicle: m })
    }
    case 'seen': {
      const bureau = String(body.bureau || '').trim()
      if (!approvedFor(bureau)) return json({ error: 'Accès pas encore validé pour ce bureau.' }, 403)
      const missionId = String(body.mission_id || '')
      const { data: m } = await sb.from('incoming_missions').select('id, status, source').eq('id', missionId).maybeSingle()
      if (!m || m.status !== 'parked' || m.source !== 'police_accident') return json({ error: 'Véhicule introuvable en parc.' }, 404)
      await recordExpertVisit(sb, device, bureau, missionId)
      return json({ ok: true, ...(await snapshot(sb, device)) })
    }
    case 'note': {
      const missionId = String(body.mission_id || '')
      const text = String(body.text || '').trim().slice(0, 1000)
      if (!text) return json({ error: 'Message vide.' }, 400)
      const { data: v } = await sb.from('mission_visitors').select('id, expert_bureau').eq('expert_device_id', device.id).eq('mission_id', missionId).limit(1).maybeSingle()
      if (!v) return json({ error: 'Ce véhicule n\'est pas dans ta liste.' }, 403)
      await sb.from('mission_remarks').insert({ mission_id: missionId, text: `❓ Expert ${device.first_name} (${v.expert_bureau || '—'}) : ${text}` })
      const { data: m } = await sb.from('incoming_missions').select('vehicle_plate').eq('id', missionId).maybeSingle()
      for (const userId of await officeUserIds(sb)) {
        await sendNotification(userId, 'expert_visit', {
          title: `Question d'expert : ${m?.vehicle_plate || ''}`,
          body: `${device.first_name} (${v.expert_bureau || '—'}) : ${text.slice(0, 200)}`,
          action_url: `/dispatch/${missionId}`, mission_id: missionId,
          data: { kind: 'expert_note', device_id: device.id },
        })
      }
      return json({ ok: true })
    }
    case 'path': {
      const missionId = String(body.mission_id || '')
      const { data: v } = await sb.from('mission_visitors').select('id, expert_bureau').eq('expert_device_id', device.id).eq('mission_id', missionId).limit(1).maybeSingle()
      if (!v) return json({ error: 'Ce véhicule n\'est pas dans ta liste.' }, 403)
      const state = await getExitControlState(sb, missionId)
      if (!state.armed) return json({ error: 'Pas de contrôle de sortie sur cette fiche.' }, 409)
      if (state.control?.attestation_signed_at) return json({ error: 'Le véhicule est déjà sorti ou l\'attestation est signée.' }, 409)
      const path = body.path === 'informex' ? 'informex' : body.path === 'autre' ? 'autre' : null
      if (!path) return json({ error: 'Chemin invalide.' }, 400)
      const destination = String(body.destination || '').trim().slice(0, 200)
      if (path === 'autre' && !destination) return json({ error: 'Destination requise.' }, 400)
      const now = new Date().toISOString()
      await sb.from('mission_exit_control').update({
        path, path_destination: path === 'autre' ? destination : null, path_chosen_at: now,
        path_chosen_by_kind: 'expert', path_chosen_by_name: `${device.first_name} (${v.expert_bureau || '—'})`,
        path_chosen_by_user: null, path_note: String(body.note || '').trim().slice(0, 300) || null, updated_at: now,
      }).eq('mission_id', missionId)
      await sb.from('mission_logs').insert({
        mission_id: missionId, action: 'exit_control_path',
        notes: `Chemin de sortie choisi par l'expert ${device.first_name} (${v.expert_bureau || '—'}) : ${path === 'informex' ? 'Informex (véhicule vendu)' : `autre sortie → ${destination}`}.`,
        metadata: { path, destination, by_kind: 'expert', device_id: device.id },
      }).then(() => {}, () => {})
      return json({ ok: true, ...(await snapshot(sb, device)) })
    }
    default:
      return json({ error: 'Action inconnue.' }, 400)
  }
}
