// src/lib/missions/busy-eta.ts
//
// Garde de nuit (Olivier 30/09/2026) : quand le 1er départ répond « Je suis déjà en
// mission », on estime à quelle heure il pourrait être sur la nouvelle mission :
//   fin de sa (ses) mission(s) en cours + trajets + déchargement + trajet vers la
//   nouvelle mission.
// - Dépannage en cours : fin à l'adresse d'intervention, SAUF si la panne a de
//   bonnes chances de finir en remorquage (lecture de la description par l'IA,
//   modèle principal Opus/Sonnet, repli sur des mots-clés) → trajet jusqu'au dépôt
//   de mise en parc (dépôt « parc par défaut » = Pepinster) + déchargement.
// - Remorquage / relivraison : trajet jusqu'à la destination + déchargement.
// - Sans fiche (appel police) : « j'en ai pour X min » + trajet depuis sa position.
// Position : GPS en direct envoyé par la page (le chauffeur vient d'ouvrir l'app),
// sinon la dernière position connue de moins de 20 min, sinon les points de la
// mission. Durées d'intervention prudentes (valeur couvrant 3 cas sur 4, missions
// terminées de juin à septembre 2026). Routage : lib/routing/ors (camion ≤ 90 km/h),
// Google en secours ; JAMAIS à vol d'oiseau (Olivier : « un camion, pas un avion ») →
// sans itinéraire routier, le calcul est déclaré impossible.

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase'
import { getDrivingRoute, type Coord } from '@/lib/routing/ors'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { aiClient } from '@/lib/ai/usage'

const BUSY_STATUSES   = ['assigned', 'accepted', 'in_progress', 'delivering']
const REM_LOAD_MIN    = 25   // sur place → chargé (remorquage), 3 cas sur 4
const DSP_ONSITE_MIN  = 16   // sur place → fin (dépannage), 3 cas sur 4
const UNLOAD_MIN      = 10   // déchargement à destination
const FRESH_GPS_MIN   = 20

export interface EtaResult {
  etaMin:     number | null          // null = calcul impossible
  arrivalAt:  string | null          // ISO
  steps:      string[]               // explication lisible, dans l'ordre
  reason?:    string                 // pourquoi le calcul est impossible
  gps:        'live' | 'recent' | 'none'
  /** Temps estimé pour TERMINER ce qu'il a en cours (sans la route vers la nouvelle
   *  mission) : comparé plus tard à la fin réelle (statistiques, rapport du matin). */
  finishMin?: number | null
  currentMissionIds?: string[]
}

const truck = (r: { minutes: number; km: number }) => {
  const h = r.minutes / 60, avg = h > 0 ? r.km / h : 0
  return avg > 90 ? Math.round((r.km / 90) * 60) : r.minutes
}
class NoRoute extends Error {}
async function drive(a: Coord, b: Coord): Promise<number> {
  const r = await getDrivingRoute(a, b, { googleFallback: true })
  if (r.approx) throw new NoRoute('itinéraire routier indisponible')   // jamais à vol d'oiseau
  return truck(r)
}
const coord = (lat: any, lng: any): Coord | null =>
  lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? { lat: Number(lat), lng: Number(lng) } : null
const minsSince = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 60000 : 0
const place = (m: any, kind: 'incident' | 'dest') => kind === 'incident'
  ? (m.incident_city || (m.incident_address || '').split(',').pop()?.trim() || 'le lieu d’intervention')
  : ((m.destination_address || '').split(',').pop()?.trim().replace(/^\d{4}\s+/, '') || 'la destination')

// ── Dépannage : finira-t-il sur place ou en remorquage ? ──────────────────────

const REM_WORDS = /accident|choc|moteur|embray|bo[iî]te|courroie|fum[ée]e|huile|surchauff|joint de culasse|cardan|transmission|roue arrach|suspension|direction|incendie|br[uû]l|eau dans|inond|immobilis|ne roule plus|bruit m[ée]tal/i

async function likelyOutcome(m: any): Promise<'dsp' | 'rem'> {
  const text = [m.incident_type, m.incident_description, m.remarks_general].filter(Boolean).join(' — ').slice(0, 800)
  if (!text.trim()) return 'dsp'
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      const client = aiClient('missions/busy-eta', { apiKey })
      const resp = await Promise.race([
        createWithModelFallback(client, ANTHROPIC_MODELS, {
          max_tokens: 5,
          messages: [{ role: 'user', content: `Dépanneur routier. Une panne est décrite ainsi : « ${text} ». Le dépanneur va-t-il probablement la réparer sur place (DSP) ou devoir remorquer le véhicule (REM) ? Réponds uniquement DSP ou REM.` }],
        }),
        new Promise<null>(r => setTimeout(() => r(null), 8000)),
      ])
      const out = String((resp as any)?.content?.[0]?.text || '').toUpperCase()
      if (out.includes('REM')) return 'rem'
      if (out.includes('DSP')) return 'dsp'
    } catch { /* repli mots-clés */ }
  }
  if (REM_WORDS.test(text)) return 'rem'
  return 'dsp'
}

// ── Estimation ───────────────────────────────────────────────────────────────

export async function estimateArrival(opts: Parameters<typeof estimateArrivalInner>[0]): Promise<EtaResult> {
  try { return await estimateArrivalInner(opts) }
  catch (e: any) {
    if (e instanceof NoRoute) return { etaMin: null, arrivalAt: null, steps: [], reason: 'l’itinéraire routier n’a pas pu être calculé', gps: opts.livePos ? 'live' : 'none' }
    throw e
  }
}

async function estimateArrivalInner(opts: {
  driverId: string
  newMissionId: string
  livePos?: Coord | null
  declaredMinutes?: number | null   // sans fiche : « j'en ai pour X min »
}): Promise<EtaResult> {
  const sb = createAdminClient()
  const [{ data: target }, { data: u }, { data: current }] = await Promise.all([
    sb.from('incoming_missions').select('incident_lat, incident_lng, incident_city, incident_address').eq('id', opts.newMissionId).maybeSingle(),
    sb.from('users').select('last_location_lat, last_location_lng, location_updated_at').eq('id', opts.driverId).maybeSingle(),
    sb.from('incoming_missions')
      .select('id, mission_type, status, assigned_at, on_way_at, on_site_at, loaded_at, incident_lat, incident_lng, incident_city, incident_address, destination_lat, destination_lng, destination_address, incident_type, incident_description, remarks_general')
      .eq('assigned_to', opts.driverId).in('status', BUSY_STATUSES).order('assigned_at'),
  ])
  const goal = coord(target?.incident_lat, target?.incident_lng)
  const goalName = target?.incident_city || 'la nouvelle mission'
  let pos: Coord | null = opts.livePos || null
  let gps: EtaResult['gps'] = pos ? 'live' : 'none'
  if (!pos && u?.location_updated_at && minsSince(u.location_updated_at) <= FRESH_GPS_MIN) {
    pos = coord(u.last_location_lat, u.last_location_lng); if (pos) gps = 'recent'
  }
  const fail = (reason: string): EtaResult => ({ etaMin: null, arrivalAt: null, steps: [], reason, gps })
  if (!goal) return fail('l’adresse de la nouvelle mission n’est pas localisée')

  // Dépôt de mise en parc (réglage « parc par défaut » des dépôts = Pepinster) :
  // destination d'un dépannage qui finirait en remorquage sans destination.
  const { data: parc } = await sb.from('depots').select('name, lat, lng').eq('active', true).eq('is_default_parc', true).limit(1).maybeSingle()
  const parcDepot = parc && coord(parc.lat, parc.lng) ? { name: parc.name as string, c: coord(parc.lat, parc.lng)! } : null

  const steps: string[] = []
  let t = 0
  let cursor: Coord | null = pos

  if (opts.declaredMinutes != null) {
    // Sans fiche (appel police…) : le temps annoncé, puis la route depuis sa position.
    if (!cursor) return fail('ta position n’est pas disponible')
    t += opts.declaredMinutes
    steps.push(`fin de ton intervention ≈ ${opts.declaredMinutes} min`)
  } else {
    if (!current?.length) return fail('aucune mission en cours trouvée')
    for (const m of current) {
      const inc = coord(m.incident_lat, m.incident_lng)
      const dest = coord(m.destination_lat, m.destination_lng)
      const type = String(m.mission_type || '').toLowerCase()
      const isDsp = type === 'depannage' || type === 'dsp' || type === 'reparation_place'
      const outcome: 'dsp' | 'rem' = isDsp ? await likelyOutcome(m) : 'rem'
      const loaded = !!m.loaded_at || m.status === 'delivering'
      const onSite = !!m.on_site_at

      if (!loaded) {
        if (!onSite) {
          // Pas encore sur place : route jusqu'au lieu d'intervention.
          if (!inc) return fail('le lieu de ta mission en cours n’est pas localisé')
          if (cursor) { const d = await drive(cursor, inc); t += d; steps.push(`route jusqu’à ${place(m, 'incident')} ≈ ${d} min`) }
          else steps.push(`déjà en route vers ${place(m, 'incident')}`)
          const work = outcome === 'dsp' ? DSP_ONSITE_MIN : REM_LOAD_MIN
          t += work; steps.push(`${outcome === 'dsp' ? 'dépannage' : 'chargement'} sur place ≈ ${work} min`)
        } else {
          const work = Math.max(5, Math.round((outcome === 'dsp' ? DSP_ONSITE_MIN : REM_LOAD_MIN) - minsSince(m.on_site_at)))
          t += work; steps.push(`fin ${outcome === 'dsp' ? 'du dépannage' : 'du chargement'} à ${place(m, 'incident')} ≈ ${work} min`)
        }
        cursor = inc || cursor
      }

      if (outcome === 'rem') {
        // Remorquage (ou dépannage qui tournera en remorquage) : destination + déchargement.
        const from = loaded ? (pos || inc) : (inc || cursor)
        if (dest && from) {
          const d = await drive(from, dest); t += d + UNLOAD_MIN
          steps.push(`route jusqu’à ${place(m, 'dest')} ≈ ${d} min + déchargement ${UNLOAD_MIN} min`)
          cursor = dest
        } else if (isDsp && from) {
          // Dépannage qui tournerait en remorquage, sans destination : dépôt de mise en parc.
          const dep = parcDepot
          if (dep) {
            const d = await drive(from, dep.c); t += d + UNLOAD_MIN
            steps.push(`la panne pourrait finir en remorquage : dépôt de ${dep.name} ≈ ${d} min + déchargement ${UNLOAD_MIN} min`)
            cursor = dep.c
          } else steps.push('la panne pourrait finir en remorquage : destination inconnue, compté comme fin sur place')
        } else {
          return fail('la destination de ta mission en cours n’est pas localisée')
        }
      }
      // Dépannage qui se termine sur place : il repart de l'adresse d'intervention.
    }
  }

  if (!cursor) return fail('ta position n’est pas disponible')
  const finishMin = Math.round(t)
  const last = await drive(cursor, goal); t += last
  steps.push(`puis ${goal ? `route jusqu’à ${goalName}` : 'route'} ≈ ${last} min`)
  const etaMin = Math.round(t)
  return { etaMin, arrivalAt: new Date(Date.now() + etaMin * 60000).toISOString(), steps, gps, finishMin, currentMissionIds: (current || []).map((m: any) => m.id) }
}
