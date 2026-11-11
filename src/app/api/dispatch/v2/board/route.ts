// GET /api/dispatch/v2/board — données du nouveau Dispatch (préversion dispatch_v2, Olivier seul).
//
// Une seule lecture pour la colonne « À traiter » (En commande, En attente, Alertes)
// et la liste des missions lancées. Mêmes exclusions que /api/missions/list
// (entrées parasites, archivées, volets gardiennage, Touring absente de COMEX,
// plaques TEST hors superadmin) pour que rien n'apparaisse ici qui manque là-bas,
// et inversement. Lecture seule : les actions passent par les routes existantes.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'
import { VHU_SOURCE }        from '@/lib/missions/vhu'

export const dynamic = 'force-dynamic'

const ACTIFS = ['new', 'dispatching', 'assigned', 'accepted', 'in_progress', 'delivering']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  if (!(await isPreviewOn('dispatch_v2', u.role, u.id))) return NextResponse.json({ error: 'Préversion non activée' }, { status: 403 })

  const sb = createAdminClient()
  const maintenant = Date.now()
  const seuilRdv = new Date(maintenant + 12 * 3600_000).toISOString()

  let q = sb.from('incoming_missions')
    .select(`
      id, mission_number, external_id, dossier_number, source, source_format,
      mission_type, incident_type, incident_description, warnings,
      client_name, client_phone, assisted_name, assisted_phone,
      vehicle_plate, vehicle_brand, vehicle_model,
      incident_address, incident_city, incident_lat, incident_lng,
      destination_name, destination_address,
      received_at, intervention_date, status,
      assigned_to, assigned_at, accepted_at, on_way_at, on_site_at, loaded_at, delivering_at,
      accept_call_at, kaze_cancelled_after_accept, needs_siabis_decision,
      paused_at, pause_until, pause_reason, pause_released_at, transfer_to,
      address_change, truck_id,
      assigned_user:users!assigned_to(id, name, phone)
    `)
    .in('status', ACTIFS)
    .not('external_id', 'like', 'PROCESSING_%')
    .not('external_id', 'like', 'UNKNOWN_SENDER_%')
    .or('parse_confidence.is.null,parse_confidence.gte.0.3,assigned_to.not.is.null')
    .is('archived_at', null)
    .eq('dossier_leg', false)
    .or('touring_missing_since.is.null,status.not.in.(new,dispatching)')
    .neq('source', VHU_SOURCE)
    .or(`intervention_date.is.null,intervention_date.lte.${seuilRdv},status.eq.new`)
    .order('id', { ascending: true })
    .range(0, 299)
  if ((u.role || '') !== 'superadmin') q = q.not('vehicle_plate', 'ilike', 'TEST')

  const { data: missions, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ms = (missions || []) as any[]
  const ids = ms.map(m => m.id)

  // Dérogations de paiement en attente, et la notification « adresse modifiée »
  // de CET utilisateur (la décision passe par elle : le premier qui répond décide).
  const [{ data: derogs }, { data: notifsAdresse }] = await Promise.all([
    ids.length ? sb.from('payment_derogations').select('mission_id, requested_at, motive').eq('status', 'pending').in('mission_id', ids) : Promise.resolve({ data: [] as any[] }),
    sb.from('notifications_log').select('id, payload').eq('user_id', u.id).eq('notif_type', 'mission_address_changed').is('responded_at', null).order('created_at', { ascending: false }).limit(50),
  ])
  const derogPar = new Map<string, any>((derogs || []).map((d: any) => [d.mission_id, d]))
  const notifPar = new Map<string, string>()
  for (const n of notifsAdresse || []) {
    const d = (n as any).payload?.data || {}
    if (d.role === 'dispatch' && d.mission_id && !notifPar.has(d.mission_id)) notifPar.set(d.mission_id, (n as any).id)
  }

  const cmd: any[] = [], att: any[] = [], alertes: any[] = [], lances: any[] = []
  for (const m of ms) {
    const carte = { ...m, assigned_user: m.assigned_user || null }
    if (m.status === 'new') {
      // Touring COMEX : 7 minutes pour accepter (sinon masquée puis annulée).
      const limite = m.source_format === 'comex' && m.received_at ? new Date(new Date(m.received_at).getTime() + 7 * 60_000).toISOString() : null
      cmd.push({ ...carte, limite })
    } else if (m.status === 'dispatching') {
      att.push(carte)
    } else {
      lances.push(carte)
    }

    // Alertes : tout ce qui attend un geste sur une mission (y compris déjà lancée).
    if (m.status === 'assigned' && !m.accepted_at && m.assigned_at)
      alertes.push({ type: 'pas_acceptee', depuis: m.assigned_at, appel_fait: !!m.accept_call_at, mission: carte })
    const ac = m.address_change || {}
    if (ac.new_address && !ac.decided_at)
      alertes.push({ type: 'adresse', depuis: ac.detected_at || null, notif_id: notifPar.get(m.id) || null, ancienne: ac.old_address || null, nouvelle: ac.new_address, nouveau_nom: ac.new_name || null, mission: carte })
    if (derogPar.has(m.id)) {
      const d = derogPar.get(m.id)
      alertes.push({ type: 'derogation', depuis: d.requested_at, motif: d.motive || null, mission: carte })
    }
    if (m.needs_siabis_decision)
      alertes.push({ type: 'autoroute', depuis: m.received_at, mission: carte })
    if (m.paused_at && !m.pause_released_at && m.pause_until && new Date(m.pause_until).getTime() < maintenant)
      alertes.push({ type: 'pause_depassee', depuis: m.pause_until, motif: m.pause_reason || null, mission: carte })
    if (m.kaze_cancelled_after_accept)
      alertes.push({ type: 'annulee_ima', depuis: null, mission: carte })
  }

  // Le plus récent en haut (Olivier 11/11). Seule exception : une mission Touring dont le
  // délai d'acceptation (7 min) court encore reste en tête — passé ce délai, elle est annulée.
  const t = (x: string | null | undefined) => (x ? new Date(x).getTime() : maintenant)
  const delaiCourt = (m: any) => !!m.limite && t(m.limite) > maintenant
  cmd.sort((a, b) => (Number(delaiCourt(b)) - Number(delaiCourt(a))) || (delaiCourt(a) ? t(a.limite) - t(b.limite) : t(b.received_at) - t(a.received_at)))
  att.sort((a, b) => t(b.received_at) - t(a.received_at))
  const poids: Record<string, number> = { autoroute: 0, adresse: 1, pas_acceptee: 2, derogation: 3, pause_depassee: 4, annulee_ima: 5 }
  alertes.sort((a, b) => (poids[a.type] - poids[b.type]) || (t(a.depuis) - t(b.depuis)))
  lances.sort((a, b) => t(a.assigned_at || a.received_at) - t(b.assigned_at || b.received_at))

  // Planning des chauffeurs : tout ce qui a été attribué aujourd'hui (heure belge), terminé ou non.
  const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(maintenant))
  // Minuit à Bruxelles tombe entre 22 h et 23 h en temps universel : on part de 22 h (au pire une heure de la veille au soir).
  const debutJour = new Date(new Date(`${jour}T00:00:00Z`).getTime() - 2 * 3600_000).toISOString()
  let qj = sb.from('incoming_missions')
    .select('id, assigned_to, status, source, mission_type, incident_type, vehicle_plate, incident_city, incident_address, destination_name, destination_address, received_at, assigned_at, accepted_at, on_way_at, on_site_at, loaded_at, delivering_at, parked_at, completed_at, paused_at, pause_released_at')
    .not('assigned_to', 'is', null)
    .gte('assigned_at', debutJour)
    .eq('dossier_leg', false)
    .not('status', 'in', '(cancelled,ignored)')
    .order('id', { ascending: true })
    .range(0, 499)
  if ((u.role || '') !== 'superadmin') qj = qj.not('vehicle_plate', 'ilike', 'TEST')
  const { data: journee } = await qj
  // Missions lancées hier soir et encore en cours aujourd'hui : déjà dans `lances`, on les ajoute au planning.
  const ids2 = new Set((journee || []).map((m: any) => m.id))
  const planning = [...(journee || []), ...lances.filter(m => !ids2.has(m.id))]

  return NextResponse.json({ cmd, att, alertes, lances, planning, now: new Date(maintenant).toISOString() })
}
