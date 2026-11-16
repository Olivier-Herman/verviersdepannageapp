// src/lib/allianz/poll-nouvelles.ts
//
// Nouvelles missions Allianz (Mondial) lues directement dans Hexalite (Olivier 13/11/2026, panne Microsoft
// MO1550821) : une mission Mondial n'arrivait chez nous QUE par le mail « Nieuwe toewijzing ». Mails coupés =
// missions invisibles. Toutes les 5 min, on lit l'onglet « À accepter » d'Hexalite et on crée la fiche de toute
// affectation inconnue, avec les mêmes données que le flux mail (allianzFetchMissionData + allianzExtractMissionData).
// Le mail qui arrive ensuite retrouve la fiche par son n° d'affectation (external_id) : pas de doublon.
// Sans accès Hexalite valide (le code de connexion arrive aussi par mail), on ne fait rien.

import { createAdminClient } from '@/lib/supabase'
import { getValidAllianzToken } from '@/lib/allianz/closure'
import { allianzFetchMissionData, allianzExtractMissionData } from '@/lib/missions/allianz'
import { sendPushToRole } from '@/lib/push'

const BASE_URL = 'https://global.allianzpartners-providerplatform.com'

export interface PollAllianzResult { ok: boolean; a_accepter: number; creees: string[]; connues: number; erreur?: string }

export async function pollAllianzNouvelles(): Promise<PollAllianzResult> {
  let token: string
  try { token = await getValidAllianzToken() } catch (e: any) { return { ok: false, a_accepter: 0, creees: [], connues: 0, erreur: e?.message || 'accès Hexalite absent' } }

  const from = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const to   = new Date(Date.now() + 31 * 86_400_000).toISOString()
  const url = `${BASE_URL}/hexalite-job-monitoring/v2.0/search/assignments`
    + `?estimatedDispatchTimeFrom=${encodeURIComponent(from)}&estimatedDispatchTimeTo=${encodeURIComponent(to)}`
    + `&sort=estimatedDispatchTime,asc&tabType=TO_ACCEPT&fromCache=false&size=50&cache_buster=${Date.now()}`
  const res = await fetch(url, {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: {
      'guac-authorization': `Bearer ${token}`, 'subscriptioncountry': 'BEL',
      origin: 'https://www.allianzpartners-providerplatform.com', referer: 'https://www.allianzpartners-providerplatform.com/',
      accept: 'application/json, text/plain, */*', 'content-type': 'application/json',
    },
  })
  if (!res.ok) return { ok: false, a_accepter: 0, creees: [], connues: 0, erreur: `Hexalite ${res.status}` }
  const liste: any[] = (await res.json())?.assignmentJobDataPage?.content || []

  const sb = createAdminClient()
  const creees: string[] = []
  let connues = 0
  for (const a of liste) {
    const num = String(a?.assignmentNumber || '').trim()
    if (!/^\d{8,20}$/.test(num) || !a?.assignmentId) continue
    const { data: deja } = await sb.from('incoming_missions').select('id').or(`external_id.eq.${num},dossier_number.eq.${num}`).limit(1)
    if (deja?.length) { connues++; continue }

    const data = await allianzFetchMissionData(token, a.assignmentId).catch(() => null)
    const x: Record<string, any> = data ? allianzExtractMissionData(data.jobData, data.caseData) : {}
    const now = new Date().toISOString()
    const fiche: Record<string, any> = {
      external_id: num, source: 'mondial', source_format: 'hexalite_api', status: 'new',
      received_at: now, intervention_date: now,
      parsed_data: { ...x, hexalite_poll: true, assignment_id: a.assignmentId, case_id: a.assistanceCaseId || null },
    }
    for (const k of ['dossier_number', 'mission_type', 'incident_type', 'incident_description', 'client_name', 'client_phone', 'client_address',
      'vehicle_plate', 'vehicle_brand', 'vehicle_model', 'vehicle_vin', 'vehicle_fuel', 'vehicle_gearbox',
      'incident_address', 'incident_city', 'incident_country', 'incident_lat', 'incident_lng', 'incident_at']) {
      const v = x[k]
      if (v !== null && v !== undefined && v !== '') fiche[k] = v
    }
    if (!fiche.vehicle_plate && a.customerLicensePlate) fiche.vehicle_plate = a.customerLicensePlate
    const { data: ins, error } = await sb.from('incoming_missions').insert(fiche).select('id').maybeSingle()
    if (error || !ins?.id) { console.warn('[allianz-poll] création KO', num, error?.message); continue }
    await sb.from('mission_logs').insert({
      mission_id: ins.id, action: 'received',
      notes: `Mission Allianz lue directement dans Hexalite (affectation ${num}) — sans attendre le mail d'Allianz.`,
      metadata: { source: 'hexalite_poll', assignment_id: a.assignmentId },
    }).then(() => {}, () => {})
    const vehicule = [fiche.vehicle_brand, fiche.vehicle_model, fiche.vehicle_plate].filter(Boolean).join(' ')
    await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
      title: '📋 Mission — MONDIAL', body: vehicule || fiche.client_name || 'Nouvelle mission Allianz à accepter',
      url: '/dispatch', tag: `mission-${ins.id}`, icon: '/icons/apple-touch-icon.png',
    }, 'dispatch_new_mission').catch(() => {})
    try { const { notifyMarketNewMission } = await import('@/lib/missions/market-notify'); await notifyMarketNewMission(ins.id) } catch {}
    creees.push(num)
  }
  return { ok: true, a_accepter: liste.length, creees, connues }
}
