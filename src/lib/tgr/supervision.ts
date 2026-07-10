// src/lib/tgr/supervision.ts
//
// Données de SUPERVISION TGR (responsable Touring) : liste des commandes +
// stats/métriques. Réutilisé par la page publique tokenisée ET le mail mensuel.
// Métriques : délai d'acceptation, date de clôture (mission dispatch liée),
// respect de l'échéance (deadline). Olivier 2026-07-11.

type Sb = { from: (t: string) => any }

export interface TgrSupervMission {
  id:            string
  reference:     string | null
  plate:         string | null
  vehicle:       string
  pickup:        string | null
  delivery:      string | null
  partner:       string | null
  priority:      number | null
  status:        string
  created_at:    string
  decided_at:    string | null   // accepted_at ou refused_at
  completed_at:  string | null   // clôture de la mission dispatch liée
  deadline_date: string | null
  on_time:       boolean | null  // clôturée avant l'échéance ?
  accept_hours:  number | null   // délai d'acceptation (h)
}

export interface TgrSupervData {
  period: { from: string | null; to: string | null }
  stats: {
    total: number; pending: number; accepted: number; refused: number
    taken: number; completed: number
    avg_accept_hours: number | null
    on_time: number; late: number; on_time_rate: number | null
  }
  missions: TgrSupervMission[]
}

const hoursBetween = (a: string, b: string): number =>
  Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000)

export async function getTgrSupervisionData(
  sb: Sb,
  opts: { from?: string | null; to?: string | null } = {},
): Promise<TgrSupervData> {
  let q = sb.from('tgr_missions')
    .select('id, reference, plate, brand, model, pickup_address, delivery_address, priority, deadline_date, status, created_at, accepted_at, refused_at, distance_km, dispatch_mission_id, partner:users!partner_id(name)')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (opts.from) q = q.gte('created_at', opts.from)
  if (opts.to)   q = q.lt('created_at', opts.to)
  const { data: rows } = await q
  const list: any[] = rows || []

  // Clôture réelle : via la mission dispatch liée (completed_at).
  const dispatchIds = Array.from(new Set(list.map(m => m.dispatch_mission_id).filter(Boolean)))
  const completedByMission = new Map<string, string | null>()
  if (dispatchIds.length > 0) {
    const { data: dm } = await sb.from('incoming_missions')
      .select('id, completed_at').in('id', dispatchIds)
    for (const d of dm || []) completedByMission.set(d.id, d.completed_at)
  }

  const missions: TgrSupervMission[] = list.map(m => {
    const decided = m.accepted_at || m.refused_at || null
    const completed_at = m.dispatch_mission_id ? (completedByMission.get(m.dispatch_mission_id) || null) : null
    const accept_hours = m.accepted_at ? Math.round(hoursBetween(m.created_at, m.accepted_at) * 10) / 10 : null
    let on_time: boolean | null = null
    if (completed_at && m.deadline_date) {
      // Échéance = fin de journée de deadline_date.
      on_time = new Date(completed_at) <= new Date(`${m.deadline_date}T23:59:59`)
    }
    return {
      id: m.id, reference: m.reference, plate: m.plate,
      vehicle: [m.brand, m.model].filter(Boolean).join(' '),
      pickup: m.pickup_address, delivery: m.delivery_address,
      partner: m.partner?.name || null, priority: m.priority, status: m.status,
      created_at: m.created_at, decided_at: decided, completed_at,
      deadline_date: m.deadline_date, on_time, accept_hours,
    }
  })

  const by = (s: string) => missions.filter(m => m.status === s).length
  const acceptHrs = missions.map(m => m.accept_hours).filter((v): v is number => v != null)
  const avg_accept_hours = acceptHrs.length
    ? Math.round((acceptHrs.reduce((a, b) => a + b, 0) / acceptHrs.length) * 10) / 10 : null
  const on_time = missions.filter(m => m.on_time === true).length
  const late    = missions.filter(m => m.on_time === false).length
  const on_time_rate = (on_time + late) > 0 ? Math.round((on_time / (on_time + late)) * 100) : null

  return {
    period: { from: opts.from || null, to: opts.to || null },
    stats: {
      total: missions.length,
      pending: by('pending'), accepted: by('accepted'), refused: by('refused'),
      taken: by('taken'), completed: by('completed'),
      avg_accept_hours, on_time, late, on_time_rate,
    },
    missions,
  }
}
