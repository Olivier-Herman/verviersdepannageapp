// src/lib/fines/suggest-driver.ts
//
// Helper : trouve le chauffeur qui roulait sur un vehicule donne a une date
// donnee, en se basant sur les missions actives a ce moment.
//
// Algorithme :
// 1. Recherche toutes les missions sur cette plaque dans une fenetre +/- 6h
//    autour de la date d infraction
// 2. Pour chaque mission avec un chauffeur assigne, on score :
//    - HIGH (100) : date entre on_way_at et completed_at/parked_at
//    - MEDIUM (60) : mission assigned avant la date mais on_way_at proche (<3h)
//    - LOW (30) : mission existante mais pas activement en cours
// 3. Retourne la meilleure correspondance + tous les candidats pour edit manuel
//
// Olivier 2026-06-01.

import { createAdminClient } from '@/lib/supabase'

export interface DriverCandidate {
  driver_id:    string
  driver_name:  string
  mission_id:   string
  mission_ref:  string
  match_score:  number
  match_reason: string
  on_way_at:    string | null
  completed_at: string | null
}

export interface SuggestDriverResult {
  driver_id:    string | null
  driver_name:  string | null
  mission_id:   string | null
  confidence:   'high' | 'medium' | 'low' | 'none'
  candidates:   DriverCandidate[]
}

/**
 * Suggere le chauffeur qui etait au volant d un vehicule a une date donnee.
 *
 * @param plate    Plaque du vehicule (sera normalisee : trim + uppercase + retrait espaces/tirets)
 * @param date     Date+heure de l infraction
 */
export async function suggestDriverForFine(
  plate: string,
  date:  Date,
): Promise<SuggestDriverResult> {
  const sb = createAdminClient()
  const normalizedPlate = plate.replace(/[-.\s]/g, '').toUpperCase().trim()

  // Fenetre de recherche : +/- 6h autour de l infraction
  // Captures les missions qui couvraient ce moment OU qui ont commence/fini juste autour.
  const sixHoursMs = 6 * 3600 * 1000
  const before = new Date(date.getTime() - sixHoursMs).toISOString()
  const after  = new Date(date.getTime() + sixHoursMs).toISOString()

  // Toutes les missions sur cette plaque autour de la date.
  // On large pour capter aussi les missions completed_at <= date+6h.
  const { data: missions } = await sb
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, vehicle_plate,
      assigned_to,
      assigned_at, on_way_at, on_site_at, loaded_at, parked_at,
      delivering_at, completed_at, intervention_date, received_at,
      assigned_user:users!incoming_missions_assigned_to_fkey(id, name)
    `)
    .ilike('vehicle_plate', normalizedPlate)
    .or(`completed_at.gte.${before},and(completed_at.is.null,received_at.gte.${before})`)
    .lte('received_at', after)
    .limit(20)

  const candidates: DriverCandidate[] = []
  const dateMs = date.getTime()

  for (const m of (missions || [])) {
    if (!m.assigned_to) continue

    // Bornes temporelles de la mission active
    const startCandidate = m.on_way_at || m.assigned_at || m.received_at
    const endCandidate   = m.completed_at || m.parked_at || m.delivering_at || null  // null = encore en cours
    const startMs = startCandidate ? new Date(startCandidate).getTime() : null
    const endMs   = endCandidate   ? new Date(endCandidate).getTime()   : Number.MAX_SAFE_INTEGER

    let score = 30
    let reason = 'mission proche dans le temps'

    if (startMs != null && dateMs >= startMs && dateMs <= endMs) {
      score = 100
      reason = `mission active du ${new Date(startMs).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${endCandidate ? ' au ' + new Date(endMs).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ' (en cours)'}`
    } else if (startMs != null) {
      const diffMs = Math.abs(dateMs - startMs)
      const diffMin = Math.round(diffMs / 60000)
      if (diffMs < 3 * 3600 * 1000) {
        score = 60
        reason = diffMin < 60
          ? `mission commencée ${diffMin} min ${dateMs < startMs ? 'après' : 'avant'} l infraction`
          : `mission ${Math.round(diffMin / 60)}h ${dateMs < startMs ? 'après' : 'avant'} l infraction`
      } else {
        score = 30
        reason = `mission ${Math.round(diffMs / 3600000)}h d écart`
      }
    }

    candidates.push({
      driver_id:    m.assigned_to,
      driver_name:  (m.assigned_user as any)?.name || 'Sans nom',
      mission_id:   m.id,
      mission_ref:  m.mission_number != null ? `#${m.mission_number}` : (m.external_id || m.id.slice(0, 8)),
      match_score:  score,
      match_reason: reason,
      on_way_at:    m.on_way_at,
      completed_at: m.completed_at,
    })
  }

  // Tri decroissant : meilleur match en premier
  candidates.sort((a, b) => b.match_score - a.match_score)

  const best = candidates[0]
  const confidence: 'high' | 'medium' | 'low' | 'none' =
    !best                       ? 'none'
    : best.match_score >= 80    ? 'high'
    : best.match_score >= 50    ? 'medium'
    :                              'low'

  return {
    driver_id:   best?.driver_id   || null,
    driver_name: best?.driver_name || null,
    mission_id:  best?.mission_id  || null,
    confidence,
    candidates,
  }
}
