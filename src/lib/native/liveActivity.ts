// src/lib/native/liveActivity.ts
//
// Pont JS ↔ plugin natif « LiveActivity » (iOS). Pilote la Live Activity /
// Dynamic Island « mission chauffeur » depuis le web app Capacitor.
//
//  - startForMission / updateForMission / endForMission : cycle de vie.
//  - À la première prise en charge, récupère un token d'action signé
//    (/api/missions/live-token) et le passe au natif (setActionToken) pour que
//    les boutons App Intent (Sur place, etc.) appellent /api/missions/live-action
//    SANS ouvrir l'app.
//  - Écoute l'event 'pushToken' du natif → l'enregistre côté serveur
//    (/api/missions/live-activity-token) pour les mises à jour temps réel quand
//    l'app est suspendue.
//
// No-op complet hors Capacitor iOS (web classique / Android) → sûr à appeler
// partout. Olivier 2026-07-28.

type Accent = 'red' | 'green' | 'amber' | 'neutral'
export interface MissionLAState {
  step: string          // assigned | enroute | onsite | loaded | done | cancelled | addr_changed
  title: string
  address: string
  etaMinutes?: number | null
  badgeText: string
  accent: Accent
}
export interface MissionLAInfo {
  missionId: string
  missionNumber: string
  vehicle: string
  clientName: string
  clientPhone: string   // format tel: (+32…)
  isRem: boolean
}

interface LiveActivityPlugin {
  isSupported(): Promise<{ supported: boolean }>
  start(o: MissionLAInfo & { state: MissionLAState }): Promise<{ id: string; reused?: boolean }>
  update(o: { missionId: string; state: MissionLAState }): Promise<void>
  end(o: { missionId: string; state: MissionLAState }): Promise<void>
  setActionToken(o: { token: string }): Promise<void>
  addListener(ev: 'pushToken', cb: (d: { missionId: string; token: string }) => void): Promise<{ remove: () => void }>
}

let _plugin: LiveActivityPlugin | null = null
let _init = false
let _listenerAttached = false

async function plugin(): Promise<LiveActivityPlugin | null> {
  if (_init) return _plugin
  _init = true
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return (_plugin = null)
    const { registerPlugin } = await import('@capacitor/core')
    _plugin = registerPlugin<LiveActivityPlugin>('LiveActivity')
    // Enregistre le push token dès qu'il arrive (une seule fois).
    if (!_listenerAttached && _plugin) {
      _listenerAttached = true
      _plugin.addListener('pushToken', async ({ missionId, token }) => {
        try {
          await fetch('/api/missions/live-activity-token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mission_id: missionId, token }),
          })
        } catch { /* best-effort */ }
      }).catch(() => {})
    }
  } catch { _plugin = null }
  return _plugin
}

export async function liveActivitySupported(): Promise<boolean> {
  const p = await plugin(); if (!p) return false
  try { return (await p.isSupported()).supported } catch { return false }
}

/** Récupère + pousse au natif le token d'action (pour les App Intents). Best-effort. */
async function ensureActionToken(p: LiveActivityPlugin): Promise<void> {
  try {
    const r = await fetch('/api/missions/live-token', { method: 'POST' })
    const j = await r.json()
    if (r.ok && j.token) await p.setActionToken({ token: j.token })
  } catch { /* best-effort */ }
}

// Traceur temporaire (diagnostic device chauffeur). sendBeacon = fiable + non
// intercepté par CapacitorHttp. On poste la séquence CUMULÉE à chaque étape :
// la dernière trace persistée montre jusqu'où on est allé.
function laBeacon(missionId: string, trace: string[]) {
  try {
    const payload = JSON.stringify({ stage: trace.join(' → '), missionId })
    const blob = new Blob([payload], { type: 'application/json' })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/missions/live-activity-debug', blob)
    } else {
      fetch('/api/missions/live-activity-debug', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
    }
  } catch { /* ignore */ }
}

// Résout une promesse avec un marqueur TIMEOUT si elle traîne (pour isoler un hang).
function withTO<T>(p: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> {
  return Promise.race([p, new Promise<'TIMEOUT'>(r => setTimeout(() => r('TIMEOUT'), ms))])
}

export async function startForMission(info: MissionLAInfo, state: MissionLAState): Promise<void> {
  const trace: string[] = []
  const step = (s: string) => { trace.push(s); laBeacon(info.missionId, trace) }

  let plat = 'unknown'
  try {
    const { Capacitor } = await import('@capacitor/core')
    plat = `native=${Capacitor.isNativePlatform()},platform=${Capacitor.getPlatform()}`
  } catch (e: any) { plat = `import-err:${e?.message}` }
  step(`entry(${plat})`)

  const p = await withTO(plugin(), 5000)
  step(`plugin=${p === 'TIMEOUT' ? 'TIMEOUT' : !!p}`)
  if (p === 'TIMEOUT' || !p) return

  try {
    const sup = await withTO(p.isSupported(), 5000)
    step(`isSupported=${JSON.stringify(sup)}`)
    if (sup === 'TIMEOUT' || !sup.supported) return
    void ensureActionToken(p)
    const res = await withTO(p.start({ ...info, state }), 8000)
    step(`start=${JSON.stringify(res)}`)
  } catch (e: any) {
    step(`ERROR:${e?.message || String(e)}`)
    console.warn('[liveActivity] start KO', e)
  }
}

export async function updateForMission(missionId: string, state: MissionLAState): Promise<void> {
  const p = await plugin(); if (!p) return
  try { await p.update({ missionId, state }) } catch { /* silencieux */ }
}

export async function endForMission(missionId: string, state: MissionLAState): Promise<void> {
  const p = await plugin(); if (!p) return
  try { await p.end({ missionId, state }) } catch { /* silencieux */ }
}

// ── Mapping mission → état Live Activity ─────────────────────────────────────
// Traduit une fiche mission (statut, on_site, chargé, ETA…) en état affichable.
export function missionToLAState(m: {
  status: string
  on_site_at?: string | null
  loaded_at?: string | null
  mission_type?: string | null
  incident_address?: string | null
  destination_address?: string | null
  driver_eta_minutes?: number | null
}): MissionLAState {
  const onSite = !!m.on_site_at
  const loaded = !!m.loaded_at || m.status === 'delivering' || m.status === 'parked'
  const eta = m.driver_eta_minutes ?? null

  if (m.status === 'assigned')
    return { step: 'assigned', title: 'Nouvelle mission', address: m.incident_address || '', badgeText: 'ASSIGNÉE', accent: 'red' }
  if (loaded)
    return { step: 'loaded', title: 'En route vers la destination', address: m.destination_address || '', etaMinutes: eta, badgeText: 'LIVRAISON', accent: 'green' }
  if (onSite)
    return { step: 'onsite', title: 'Sur place — chargez le véhicule', address: m.incident_address || '', badgeText: 'SUR PLACE', accent: 'amber' }
  // accepted / on_way / in_progress avant arrivée
  return { step: 'enroute', title: "En route vers l'intervention", address: m.incident_address || '', etaMinutes: eta, badgeText: 'EN ROUTE', accent: 'green' }
}

export function isActiveMissionStatus(status: string): boolean {
  return ['assigned', 'accepted', 'on_way', 'on_site', 'in_progress', 'delivering'].includes(status)
}
