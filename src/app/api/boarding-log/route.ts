// src/app/api/boarding-log/route.ts
//
// Données du JOURNAL DE BORD (/boarding-log) — page publique protégée par PIN,
// pensée pour rester affichée en permanence devant Olivier (2026-08-14).
//
// Elle remplace la surveillance que je tenais dans nos échanges : au lieu de
// lire des messages perdus dans une conversation, l'information vit à l'écran.
//
// Trois blocs, du plus synthétique au plus détaillé :
//   1. la ligne de chiffres (à facturer, terminées/facturées du jour, délai
//      médian, Touring, Allianz) ;
//   2. les missions en cours ;
//   3. le JOURNAL : ce que font les chauffeurs, et surtout les ANOMALIES —
//      celles-là sont toutes nées d'un cas réel rencontré cette semaine.

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

const VALID_PINS = [
  process.env.DASHBOARD_PIN || '071000',
  process.env.DASHBOARD_PIN_DISPATCH || '019190',
]

/** Sources dont la clôture part VRAIMENT chez un tiers. Ailleurs, un dossier non
 *  clôturé n'existe pas : il n'y a personne à qui parler. */
const ENVOI_REEL = ['touring', 'vab', 'axa']

const bxlDayStartISO = (daysAgo = 0) => {
  const now = new Date()
  const bxl = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }))
  bxl.setHours(0, 0, 0, 0); bxl.setDate(bxl.getDate() - daysAgo)
  const off = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Brussels' })).getTime()
  return new Date(bxl.getTime() + off).toISOString()
}

export async function GET(req: Request) {
  const pin = req.headers.get('x-dashboard-pin') || new URL(req.url).searchParams.get('pin') || ''
  if (!VALID_PINS.includes(pin)) return NextResponse.json({ error: 'PIN invalide' }, { status: 401 })

  const sb = createAdminClient()
  const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const today   = bxlDayStartISO(0)

  // ── Journal : les gestes du terrain, en clair ────────────────────────────
  const ACTIONS = [
    'accept', 'on_way', 'on_site', 'load_vehicle', 'park', 'completed',
    'flux2_closed', 'touring_closed', 'vab_closed', 'axa_closed',
    'touring_synced', 'vab_synced', 'kaze_synced',
    'kaze_sync_error', 'vab_close_failed', 'vab_onsite_failed', 'touring_sync_error',
    'force_status_to_invoice', 'force_status_parked', 'force_status_completed',
    'invoiced', 'invoice_autoposted', 'request_relivraison', 'kaze_rel_merged',
  ]
  const { data: rawLogs } = await sb.from('mission_logs')
    .select('mission_id, action, notes, created_at, actor_id')
    .in('action', ACTIONS)
    .gte('created_at', since24)
    .order('created_at', { ascending: false })
    .limit(220)

  const ids = [...new Set((rawLogs || []).map(l => l.mission_id).filter(Boolean))] as string[]
  const missions = new Map<string, any>()
  if (ids.length) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, vehicle_plate, source, mission_type, status, assigned_to, panne_motif, panne_motif_label, vab_closed_at, axa_closed_at, completed_at')
      .in('id', ids)
    for (const m of (data || [])) missions.set(m.id, m)
  }
  const { data: users } = await sb.from('users').select('id, name')
  const nameOf = (id: string | null) => (users || []).find((u: any) => u.id === id)?.name || null

  // Une même erreur qui se répète toutes les minutes (COMEX qui rend 500 sur un
  // pointage, par exemple) noierait l'écran et cacherait tout le reste. On la
  // REGROUPE : une ligne, la plus récente, avec le nombre de répétitions.
  // Constaté dès le premier essai, le 14/08 : 40 anomalies pour un seul incident.
  const groupKey = (missionId: string, action: string) => `${missionId}::${action}`
  const repeats = new Map<string, number>()
  const kept: any[] = []
  for (const l of (rawLogs || [])) {
    const k = groupKey(l.mission_id, l.action)
    const n = (repeats.get(k) || 0) + 1
    repeats.set(k, n)
    if (n === 1) kept.push(l)          // rawLogs est trié du plus récent au plus ancien
  }

  // ── La phrase ────────────────────────────────────────────────────────────
  // Olivier veut lire ce que je lui écris ici, pas un tableau d'actions
  // techniques : « Franck vient de pointer sur place et tout est ok ». On
  // fabrique donc la phrase ICI, en un seul endroit, à partir de ce qu'on sait.
  const SRC_LBL: Record<string, string> = {
    touring: 'Touring', vab: 'VAB', kaze: 'Kaze', axa: 'AXA', mondial: 'Allianz',
    anwb: 'ANWB', ethias: 'Ethias', police_snc: 'Siabis non couvert', sia_couvert: 'Siabis couvert',
  }
  const TYPE_LBL: Record<string, string> = {
    depannage: 'dépannage', remorquage: 'remorquage', trajet_vide: 'déplacement pour rien',
    relivraison: 'relivraison', 'REM+REL': 'remorquage avec relivraison',
  }

  function phrase(l: any, m: any, n: number): { text: string; ton: 'info' | 'ok' | 'alerte' } {
    const who   = nameOf(m.assigned_to) || 'Le chauffeur'
    const veh   = m.vehicle_plate ? `le ${m.vehicle_plate}` : `la mission #${m.mission_number}`
    const src   = SRC_LBL[m.source] || m.source || ''
    const type  = TYPE_LBL[String(m.mission_type || '').toLowerCase()] || TYPE_LBL[m.mission_type] || 'intervention'
    const fois  = n > 1 ? ` — ${n} tentatives` : ''
    const motif = m.panne_motif_label ? ` Motif retenu : « ${m.panne_motif_label} ».` : ''

    switch (l.action) {
      case 'accept':       return { ton: 'info', text: `${who} a accepté ${veh} — ${type}${src ? ' ' + src : ''}.` }
      case 'on_way':       return { ton: 'info', text: `${who} est en route vers ${veh}.` }
      case 'on_site':      return { ton: 'info', text: `${who} est sur place sur ${veh}.` }
      case 'load_vehicle': return { ton: 'info', text: `${who} a chargé ${veh} sur le camion.` }
      case 'park':         return { ton: 'info', text: `${who} a déposé ${veh} au parc.` }
      case 'completed':    return { ton: 'ok',   text: `${who} a terminé ${veh}. La mission part à la facturation.` }
      case 'flux2_closed': return { ton: 'ok',   text: `Clôture chauffeur sur ${veh}.${motif}` }
      case 'touring_closed': return { ton: 'ok', text: `${veh} est clôturé chez Touring — ${(l.notes || '').replace(/^Clôture Touring \(flux 2\) — /, '')}` }
      case 'vab_closed':   return { ton: 'ok',   text: `${veh} est clôturé chez VAB.` }
      case 'axa_closed':   return { ton: 'ok',   text: `${veh} est clôturé chez AXA.` }
      case 'touring_synced':
      case 'vab_synced':
      case 'kaze_synced': {
        // Les notes de synchro sont écrites pour le débogage (« ↗ en route
        // (2026-08-14T07:46:17.585Z) », « workflow avancé (statut started) »).
        // Sur un écran mural, on veut la phrase, pas la trace.
        const n0 = (l.notes || '')
        const ETAPES: [RegExp, string, string][] = [
          [/accept/i,                  'l’acceptation',      'remontée'],
          [/en route|on_way|départ/i,  'le départ',          'remonté'],
          [/sur place|on_site|arriv/i, 'l’arrivée sur place','remontée'],
          [/charg|load/i,              'le chargement',      'remonté'],
          [/park|parc/i,               'la mise en parc',    'remontée'],
          [/complet|termin/i,          'la clôture',         'remontée'],
          [/photo/i,                   'les photos',         'remontées'],
        ]
        const hit   = ETAPES.find(([re]) => re.test(n0))
        const etape = hit?.[1]
        const acc   = hit?.[2] || 'remonté'
        if (/rattachée à cette fiche/.test(n0)) return { ton: 'ok', text: `${veh} : ${n0.replace(/^Touring : /, '')}` }
        if (/auto-validé/.test(n0))             return { ton: 'info', text: `${veh} a été validé automatiquement chez ${src}.` }
        if (/échec|erreur/i.test(n0))           return { ton: 'alerte', text: `${veh} : ${n0}` }
        return { ton: 'info', text: etape
          ? `${veh} : ${etape} est ${acc} chez ${src}.`
          : `${veh} : ${n0.replace(/^\w+ ↗ /, '')}` }
      }
      case 'invoiced':
      case 'invoice_autoposted': return { ton: 'ok', text: `${veh} est facturé. ${(l.notes || '')}` }
      case 'request_relivraison': return { ton: 'info', text: `Relivraison rattachée sur ${veh}.` }
      case 'kaze_rel_merged':     return { ton: 'info', text: `Relivraison Kaze fusionnée dans la fiche en parc (${veh}).` }
      case 'force_status_to_invoice':
      case 'force_status_parked':
      case 'force_status_completed':
        return {
          ton: ENVOI_REEL.includes(m.source) ? 'alerte' : 'info',
          text: ENVOI_REEL.includes(m.source)
            ? `Statut forcé par le dispatch sur ${veh} — attention, rien n'est parti chez ${src}.`
            : `Statut forcé par le dispatch sur ${veh}.`,
        }
      default:
        if (/error|failed/i.test(l.action)) {
          return { ton: 'alerte', text: `Échec de synchronisation sur ${veh}${src ? ' (' + src + ')' : ''}${fois} : ${(l.notes || '').replace(/^.*— /, '')}` }
        }
        return { ton: 'info', text: `${veh} : ${l.notes || l.action.replace(/_/g, ' ')}` }
    }
  }

  const events = kept.map(l => {
    const m = missions.get(l.mission_id) || {}
    const n = repeats.get(groupKey(l.mission_id, l.action)) || 1
    const ph = phrase(l, m, n)
    ph.text = ph.text.charAt(0).toUpperCase() + ph.text.slice(1)
    // Source visible sur CHAQUE ligne (Olivier 2026-08-14) : on sait de quel
    // scénario on parle. On saute si déjà mentionnée (ex. « clôturé chez VAB »).
    const srcLbl = SRC_LBL[m.source] || m.source || ''
    if (srcLbl && !ph.text.includes(srcLbl)) {
      ph.text = ph.text.replace(/[.\s]*$/, '') + ` · ${srcLbl}`
    }
    return {
      at:      l.created_at,
      action:  l.action,
      text:    ph.text,
      ton:     ph.ton,
      number:  m.mission_number ?? null,
      plate:   m.vehicle_plate ?? null,
      source:  m.source ?? null,
      driver:  nameOf(m.assigned_to) || null,
      repeats: n,
      notes:   l.notes || '',
    }
  })

  // ── Anomalies ────────────────────────────────────────────────────────────
  // Chacune vient d'un incident constaté, pas d'une idée de tableau de bord.
  const anomalies: { level: 'rouge' | 'ambre'; titre: string; detail: string; at: string }[] = []

  // 1. Terminée chez nous, jamais clôturée chez l'assisteur (KRAA728, 1EYJ678).
  // Fenêtre de 7 JOURS, pas 24 h : un dossier oublié chez l'assisteur ne se
  // rappelle pas à nous le lendemain, il dort. Constaté le 14/08 — 8 dossiers
  // ouverts chez VAB, dont 6 datant de plus d'un jour. Olivier 2026-08-14.
  const since7j = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data: closedMissions } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, source, mission_type, status, completed_at, vab_closed_at, axa_closed_at')
    .in('source', ENVOI_REEL)
    .in('status', ['to_invoice', 'completed'])
    .gte('completed_at', since7j)
    .limit(300)
  const closedIds = (closedMissions || []).map(m => m.id)
  const touringClosed = new Set<string>()
  if (closedIds.length) {
    const { data: tc } = await sb.from('mission_logs')
      .select('mission_id').eq('action', 'touring_closed').in('mission_id', closedIds).limit(500)
    for (const l of (tc || [])) touringClosed.add(l.mission_id)
  }
  for (const m of (closedMissions || [])) {
    const ok = m.source === 'touring' ? touringClosed.has(m.id)
      : m.source === 'vab' ? !!m.vab_closed_at
      : !!m.axa_closed_at
    if (!ok) {
      const jours = Math.floor((Date.now() - Date.parse(m.completed_at)) / 86400000)
      anomalies.push({
        level: 'rouge',
        titre: `#${m.mission_number} ${m.vehicle_plate || ''} — pas clôturée chez ${SRC_LBL[m.source] || m.source}`
          + (jours >= 1 ? ` (depuis ${jours} j)` : ''),
        detail: `Terminée chez nous${m.mission_type ? ' en ' + (TYPE_LBL[String(m.mission_type).toLowerCase()] || m.mission_type) : ''}, le dossier reste ouvert chez l’assisteur.`,
        at: m.completed_at,
      })
    }
  }

  // 2. Statut forcé sur une source à envoi réel : le forçage ne parle à personne.
  const { data: forced } = await sb.from('mission_logs')
    .select('mission_id, action, created_at')
    .in('action', ['force_status_to_invoice', 'force_status_parked', 'force_status_completed'])
    .gte('created_at', since24).limit(100)
  for (const l of (forced || [])) {
    const m = missions.get(l.mission_id)
    if (m && ENVOI_REEL.includes(m.source)) {
      anomalies.push({
        level: 'ambre',
        titre: `#${m.mission_number} ${m.vehicle_plate || ''} — statut forcé (${m.source})`,
        detail: 'Le forçage ne prévient pas l’assisteur : à clôturer chez eux.',
        at: l.created_at,
      })
    }
  }

  // 3. Échecs de synchronisation (les 404 Kaze, les clôtures VAB en échec).
  //    Déjà dédoublonnés par le regroupement ci-dessus : une ligne par mission
  //    et par type d'échec, avec le nombre de tentatives.
  for (const e of events) {
    if (/error|failed/i.test(e.action)) {
      anomalies.push({
        level: 'rouge',
        titre: `#${e.number ?? '?'} ${e.plate || ''} — ${e.action.replace(/_/g, ' ')}`
          + (e.repeats > 1 ? ` (${e.repeats}×)` : ''),
        detail: e.notes.slice(0, 150),
        at: e.at,
      })
    }
  }

  // 4. Motif fourre-tout là où le code part vraiment chez l'assisteur.
  const { data: catchAll } = await sb.from('incoming_missions')
    .select('mission_number, vehicle_plate, source, panne_motif, panne_motif_label, completed_at')
    .in('source', ENVOI_REEL)
    .gte('completed_at', today)
    .like('panne_motif', '%autre%')
    .limit(50)
  for (const m of (catchAll || [])) {
    anomalies.push({
      level: 'ambre',
      titre: `#${m.mission_number} ${m.vehicle_plate || ''} — motif « ${m.panne_motif_label || 'Autre'} »`,
      detail: `Code fourre-tout envoyé à ${m.source}.`,
      at: m.completed_at,
    })
  }

  anomalies.sort((a, b) => String(b.at).localeCompare(String(a.at)))

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    events,
    anomalies: anomalies.slice(0, 40),
  })
}
