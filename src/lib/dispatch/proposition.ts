// src/lib/dispatch/proposition.ts — chauffeur proposé pour une mission (nouveau Dispatch).
//
// Règles (aucune nouvelle règle métier, Olivier 11/11/2026) :
// - candidats : comptes actifs chauffeur/admin/superadmin, en service (garde jour/nuit, position
//   récente ou mission en cours). Un chauffeur en congé approuvé ou passé hors ligne n'est PAS
//   proposé (il reste choisissable dans la fenêtre « Voir tous les chauffeurs »).
// - libre : temps de route depuis sa position (camion ≤ 90 km/h), une matrice pour tous.
// - occupé : fin estimée de ce qu'il a en cours (mêmes durées prudentes que la garde de nuit :
//   chargement 25 min, dépannage 16 min, déchargement 10 min) + route jusqu'à la nouvelle mission.
//   Pas d'IA ni de Google ici : service gratuit et mémoire des trajets seulement ; sans
//   itinéraire, pas d'estimation (jamais à vol d'oiseau).
// - tri : de jour le plus rapide, de nuit l'ordre des chauffeurs fixé par le dispatch (comme
//   l'auto-dispatch, driver-eta).

import { createAdminClient } from '@/lib/supabase'
import { isInDaySchedule, isInNightSchedule, isAutoDispatchNight } from '@/lib/schedule'
import { ensureScheduleLoaded } from '@/lib/schedule-server'
import { getDrivingMatrix, getDrivingRoute, type Coord } from '@/lib/routing/ors'

const FRAIS_MIN = 30          // position « récente »
const DATEE_MIN = 120         // au-delà, pas de temps de trajet depuis cette position (« position datée » de la fenêtre de choix)
const REM_CHARGEMENT = 25, DSP_SUR_PLACE = 16, DECHARGEMENT = 10
const ACTIFS = ['assigned', 'accepted', 'in_progress', 'delivering']

const camion = (r: { minutes: number; km: number }) => { const h = r.minutes / 60, v = h > 0 ? r.km / h : 0; return v > 90 ? Math.round((r.km / 90) * 60) : Math.round(r.minutes) }
const coord = (lat: any, lng: any): Coord | null => lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null
const depuis = (iso: string | null | undefined) => iso ? (Date.now() - new Date(iso).getTime()) / 60000 : 0
const commune = (m: any, k: 'incident' | 'dest') => k === 'incident'
  ? (m.incident_city || String(m.incident_address || '').split(',').pop()?.trim().replace(/^\d{4,5}\s+/, '') || 'son intervention')
  : (String(m.destination_address || '').split(',').map((x: string) => x.trim()).filter((x: string) => !/^(BEL|Belgique|BE)$/i.test(x)).pop()?.replace(/^\d{4,5}\s+/, '') || 'sa destination')
class SansRoute extends Error {}
async function route(a: Coord, b: Coord) {
  const r = await getDrivingRoute(a, b, { googleFallback: false })
  if (r.approx || r.pending) throw new SansRoute()
  return camion(r)
}

export type Proposition = { id: string; nom: string; telephone: string | null; eta_min: number | null; occupe: boolean; priorite: number | null; raison: string }
export async function proposerChauffeurs(missionId: string): Promise<{ propositions: Proposition[]; tri: string; raison: string | null } | { erreur: string }> {
  await ensureScheduleLoaded()

  const sb = createAdminClient()
  const maintenant = new Date()
  const aujourdhui = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(maintenant)
  const debutJour = new Date(`${aujourdhui}T00:00:00`).toISOString()

  const { data: cible } = await sb.from('incoming_missions').select('id, incident_lat, incident_lng, incident_address').eq('id', missionId).maybeSingle()
  if (!cible) return { erreur: 'Mission introuvable' }
  const but = coord(cible.incident_lat, cible.incident_lng)
  if (!but) return { propositions: [], tri: '', raison: 'L\'adresse de la mission n\'est pas encore localisée : vérifiez-la dans la fiche complète.' }

  const [{ data: users }, { data: conges }, { data: enCours }, { data: duJour }] = await Promise.all([
    sb.from('users').select('id, name, phone, last_location_lat, last_location_lng, location_updated_at, schedule_day, schedule_night, priority_order, manual_offline, current_truck_id')
      .eq('active', true).or('role.in.(driver,admin,superadmin),roles.ov.{driver,admin,superadmin}'),
    sb.from('conge_requests').select('user_id').eq('status', 'approved').lte('start_date', aujourdhui).gte('end_date', aujourdhui),
    sb.from('incoming_missions').select('id, assigned_to, mission_type, status, on_site_at, loaded_at, incident_lat, incident_lng, incident_city, incident_address, destination_lat, destination_lng, destination_address, assigned_at, paused_at, pause_released_at')
      .in('status', ACTIFS).neq('id', missionId).not('assigned_to', 'is', null).order('assigned_at'),
    sb.from('incoming_missions').select('assigned_to').gte('assigned_at', debutJour).not('assigned_to', 'is', null),
  ])
  const enConge = new Set((conges || []).map((c: any) => c.user_id))
  const missionsDe = new Map<string, any[]>()
  for (const m of enCours || []) {
    if (m.paused_at && !m.pause_released_at) continue   // en pause : le chauffeur est libre
    missionsDe.set(m.assigned_to, [...(missionsDe.get(m.assigned_to) || []), m])
  }
  const nbJour = new Map<string, number>()
  for (const m of duJour || []) nbJour.set((m as any).assigned_to, (nbJour.get((m as any).assigned_to) || 0) + 1)

  const deGarde = (d: any) => (!!d.schedule_day && isInDaySchedule(maintenant)) || (!!d.schedule_night && isInNightSchedule(maintenant))
  const candidats = (users || []).filter((d: any) => {
    if (enConge.has(d.id) || d.manual_offline === true) return false
    const frais = d.location_updated_at && depuis(d.location_updated_at) < FRAIS_MIN
    return frais || deGarde(d) || missionsDe.has(d.id)
  })

  // Libres : une matrice pour tous ceux qui ont une position.
  const libres = candidats.filter((d: any) => !missionsDe.has(d.id) && coord(d.last_location_lat, d.last_location_lng) && depuis(d.location_updated_at) < DATEE_MIN)
  const etaLibre = new Map<string, number>()
  if (libres.length) {
    try {
      const mx = await getDrivingMatrix(libres.map((d: any) => coord(d.last_location_lat, d.last_location_lng)!), but)
      libres.forEach((d: any, i: number) => { const r = mx[i]; if (r && !r.approx) etaLibre.set(d.id, camion(r)) })
    } catch { /* sans matrice : pas d'estimation pour les libres */ }
  }

  // Occupés : fin estimée de ses missions en cours, puis route vers la nouvelle mission.
  async function etaOccupe(d: any): Promise<{ eta: number; finit: string; libreA: number } | null> {
    try {
      let t = 0
      let curseur: Coord | null = coord(d.last_location_lat, d.last_location_lng)
      let finit = ''
      for (const m of missionsDe.get(d.id) || []) {
        const inc = coord(m.incident_lat, m.incident_lng), dest = coord(m.destination_lat, m.destination_lng)
        const type = String(m.mission_type || '').toLowerCase()
        const dsp = type === 'depannage' || type === 'dsp' || type === 'reparation_place'
        const charge = !!m.loaded_at || m.status === 'delivering'
        if (!charge) {
          if (!m.on_site_at) {
            if (!inc) return null
            if (curseur) t += await route(curseur, inc)
            t += dsp ? DSP_SUR_PLACE : REM_CHARGEMENT
          } else {
            t += Math.max(5, (dsp ? DSP_SUR_PLACE : REM_CHARGEMENT) - depuis(m.on_site_at))
          }
          curseur = inc || curseur
          finit = commune(m, 'incident')
        }
        if (!dsp) {
          const de = charge ? (coord(d.last_location_lat, d.last_location_lng) || inc) : (inc || curseur)
          if (!dest || !de) return null
          t += await route(de, dest) + DECHARGEMENT
          curseur = dest
          finit = commune(m, 'dest')
        }
      }
      if (!curseur) return null
      const libreA = Math.round(t)
      return { eta: libreA + await route(curseur, but!), finit, libreA }
    } catch (e) {
      if (e instanceof SansRoute) return null
      throw e
    }
  }

  const resultats = await Promise.all(candidats.map(async (d: any) => {
    const occupe = missionsDe.has(d.id)
    const o = occupe ? await etaOccupe(d) : null
    const eta = occupe ? (o?.eta ?? null) : (etaLibre.get(d.id) ?? null)
    const morceaux: string[] = []
    if (occupe) morceaux.push(o ? `finit à ${o.finit} vers ${new Date(Date.now() + o.libreA * 60000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).replace(':', ' h ')} (estimation)` : 'en mission, fin impossible à estimer')
    else if (!coord(d.last_location_lat, d.last_location_lng)) morceaux.push('libre, position inconnue')
    else if (d.location_updated_at && depuis(d.location_updated_at) >= FRAIS_MIN) {
      const t = new Date(d.location_updated_at), jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(t)
      const quand = jour === aujourdhui ? 'à' : jour === new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(Date.now() - 86400000)) ? 'hier à' : `le ${t.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Brussels' })} à`
      morceaux.push(`libre, dernière position ${quand} ${t.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).replace(':', ' h ')}`)
    }
    else morceaux.push('libre')
    if (deGarde(d)) morceaux.push('de garde')
    const n = nbJour.get(d.id) || 0
    morceaux.push(n ? `${n} mission${n > 1 ? 's' : ''} aujourd'hui` : 'aucune mission aujourd\'hui')
    return { id: d.id, nom: d.name, telephone: d.phone || null, eta_min: eta, occupe, priorite: d.priority_order ?? null, raison: morceaux.join(', ') }
  }))

  const nuit = isAutoDispatchNight(maintenant)
  const prio = (x: any) => x.priorite ?? Number.MAX_SAFE_INTEGER
  const avec = resultats.filter(r => r.eta_min != null).sort((a, b) => nuit ? (prio(a) - prio(b)) || (a.eta_min! - b.eta_min!) : (a.eta_min! - b.eta_min!) || (prio(a) - prio(b)))
  const sans = resultats.filter(r => r.eta_min == null).sort((a, b) => prio(a) - prio(b))
  const liste = [...avec, ...sans]
  if (liste[0] && !nuit && liste[0].eta_min != null && !liste[0].occupe) liste[0].raison = liste[0].raison.replace(/^libre/, 'libre, le plus proche')

  return {
    propositions: liste.slice(0, 3),
    tri: nuit ? 'nuit : ordre des chauffeurs fixé par le dispatch' : 'jour : le plus rapide sur place',
    raison: liste.length ? null : 'Aucun chauffeur en service pour l\'instant (congé, hors ligne ou pas de garde).',
  }
}
