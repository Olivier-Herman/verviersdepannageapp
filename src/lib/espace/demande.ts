// src/lib/espace/demande.ts
//
// Demande d'intervention passée depuis l'espace client (Olivier 10/10/2026) : elle arrive dans les
// commandes du dispatch (statut « new », à valider), le dispatch est notifié, et la ligne du dépannage
// est appelée avec un message vocal propre à la société (« nouvelle demande EBAC dans les commandes »).

import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { getBusinessText } from '@/lib/settings/business'
import type { EspaceCompte, EspaceSociete } from './session'

export interface DemandeInput {
  type: 'DSP' | 'REM'
  plaque: string
  marque?: string; modele?: string
  adresse: string; lat?: number | null; lng?: number | null
  destination?: string | null
  contactNom?: string | null; contactTel?: string | null
  remarques?: string | null
  quand?: string | null           // ISO ; vide = dès que possible
}

const txt = (v: unknown, n = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null }
const num = (v: unknown) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

export function lireDemande(b: any): DemandeInput | string {
  const type = String(b?.type || '').toUpperCase()
  if (type !== 'DSP' && type !== 'REM') return 'Choisissez dépannage sur place ou remorquage.'
  const plaque = String(b?.plaque || '').replace(/[\s.-]/g, '').toUpperCase().slice(0, 15)
  if (!plaque) return 'La plaque est obligatoire.'
  const adresse = txt(b?.adresse, 300)
  if (!adresse) return 'L’adresse de l’intervention est obligatoire.'
  const quand = b?.quand && !isNaN(Date.parse(b.quand)) ? new Date(b.quand).toISOString() : null
  return {
    type, plaque, adresse, lat: num(b?.lat), lng: num(b?.lng),
    marque: txt(b?.marque, 60) || undefined, modele: txt(b?.modele, 60) || undefined,
    destination: type === 'REM' ? txt(b?.destination, 300) : null,
    contactNom: txt(b?.contactNom, 120), contactTel: txt(b?.contactTel, 40),
    remarques: txt(b?.remarques, 1500), quand,
  }
}

export async function creerDemande(compte: EspaceCompte, societe: EspaceSociete, d: DemandeInput): Promise<{ id: string; mission_number: number }> {
  const sb = createAdminClient()
  const now = new Date().toISOString()
  const quand = d.quand || now
  const rdv = new Date(quand).getTime() > Date.now() + 30 * 60_000
  const remarques = [
    d.remarques,
    d.contactNom || d.contactTel ? `Contact sur place : ${[d.contactNom, d.contactTel].filter(Boolean).join(' — ')}` : null,
    `Commandé depuis l’espace client par ${compte.nom}`,
  ].filter(Boolean).join('\n')
  const { data: m, error } = await sb.from('incoming_missions').insert({
    external_id: `ESP-${Date.now().toString(36).toUpperCase()}`,
    source: societe.source_key,
    mission_type: d.type === 'DSP' ? 'depannage' : 'remorquage',
    status: 'new',
    vehicle_plate: d.plaque, vehicle_brand: d.marque || null, vehicle_model: d.modele || null,
    incident_address: d.adresse, incident_lat: d.lat ?? null, incident_lng: d.lng ?? null,
    destination_address: d.destination || null,
    client_name: societe.nom, client_phone: d.contactTel || null,
    billed_to_id: societe.odoo_partner_id, billed_to_name: societe.nom,
    amount_to_collect: null,
    remarks_general: remarques,
    espace_compte_id: compte.id,
    received_at: now, intervention_date: quand, incident_at: quand, rdv_at: rdv ? quand : null,
    created_at: now, updated_at: now,
  }).select('id, mission_number').single()
  if (error || !m) throw new Error(error?.message || 'Création impossible')
  await sb.from('mission_logs').insert({ mission_id: m.id, action: 'received', notes: `Demande passée depuis l’espace client par ${compte.nom} (${societe.nom}).` }).then(() => {}, () => {})

  // Dispatch : notification (bandeau + push) — jamais bloquant.
  const veh = [d.marque, d.modele, d.plaque].filter(Boolean).join(' ')
  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'espace_client_demande', {
    title: `${d.type === 'DSP' ? '🔧 Dépannage' : '🚛 Remorquage'} — ${societe.nom}`,
    body: `${veh} · ${d.adresse}${rdv ? ` · prévu le ${new Date(quand).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' })}` : ''} — à valider dans les commandes`,
    action_url: `/dispatch/${m.id}`, mission_id: m.id,
  }).catch(() => {})

  await appelerDepannage(m.id, societe).catch(() => {})
  return m as any
}

/** Appel de la ligne du dépannage ; le message vocal est joué au décroché (voir onEspaceCallEvent). */
export async function appelerDepannage(missionId: string, societe: EspaceSociete): Promise<void> {
  const sb = createAdminClient()
  let numero = ''
  try { numero = (await getBusinessText('espace_client_appel_numero')).replace(/[\s./-]/g, '') } catch { return }
  if (!/^\+\d{8,15}$/.test(numero)) return
  const { initiatePstnCall } = await import('@/lib/teams/call')
  const r = await initiatePstnCall({ toPhone: numero, toDisplayName: 'Dépannage' })
  await sb.from('espace_appels').insert({ mission_id: missionId, call_id: r.callId || null, audio: societe.appel_audio || 'nouvelle-mission.wav', status: r.ok ? 'lance' : 'echec', detail: r.ok ? null : String(r.error || '').slice(0, 300) })
}

/** Événements Teams : décroché → message ; message terminé → raccroché. Renvoie true si l'appel est à nous. */
export async function onEspaceCallEvent(callId: string, event: 'established' | 'prompt_completed'): Promise<boolean> {
  const sb = createAdminClient()
  const { data: a } = await sb.from('espace_appels').select('id, audio, status').eq('call_id', callId).maybeSingle()
  if (!a) return false
  const { playPromptOnCall, hangUpCall } = await import('@/lib/teams/call')
  const now = new Date().toISOString()
  if (event === 'established' && a.status === 'lance') {
    const base = process.env.NEXTAUTH_URL || 'https://app.verviersdepannage.com'
    const r = await playPromptOnCall(callId, `${base}/sounds/${a.audio}`, a.id)
    await sb.from('espace_appels').update({ status: r.ok ? 'decroche' : 'echec_message', detail: r.ok ? null : r.error || null, updated_at: now }).eq('id', a.id)
    if (!r.ok) await hangUpCall(callId)
  } else if (event === 'prompt_completed') {
    await hangUpCall(callId)
    await sb.from('espace_appels').update({ status: 'termine', updated_at: now }).eq('id', a.id)
  }
  return true
}
