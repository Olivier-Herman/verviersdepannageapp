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
  /** Démarre l'observation du push-to-start token (iOS 17.2+). Optionnel (build ≥21). */
  enablePushToStart?(): Promise<void>
  addListener(ev: 'pushToken', cb: (d: { missionId: string; token: string }) => void): Promise<{ remove: () => void }>
  addListener(ev: 'pushToStartToken', cb: (d: { token: string }) => void): Promise<{ remove: () => void }>
}

let _plugin: LiveActivityPlugin | null = null
let _init = false
let _listenerAttached = false

// ⚠️ NE JAMAIS renvoyer le proxy Capacitor depuis une async fn qu'on `await` :
// registerPlugin(...) répond à N'IMPORTE quelle propriété (dont `.then`), donc
// `await plugin()` le prend pour un thenable → `proxy.then()` → HANG éternel
// (incident Franck 2026-07-26). On initialise ici (retour void) et les appelants
// lisent `_plugin` en SYNCHRONE.
async function ensurePlugin(): Promise<void> {
  if (_init) return
  _init = true
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') { _plugin = null; return }
    _plugin = registerPlugin<LiveActivityPlugin>('LiveActivity')
    // Enregistre le push token dès qu'il arrive (une seule fois). On APPELLE une
    // méthode du proxy (OK), on ne l'`await` jamais en tant que valeur.
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
      // Push-to-start token (iOS 17.2+) : permet au serveur de DÉMARRER la Live
      // Activity à distance dès l'attribution (accepter sans ouvrir l'app).
      _plugin.addListener('pushToStartToken', async ({ token }) => {
        try {
          await fetch('/api/missions/live-activity-start-token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          })
        } catch { /* best-effort */ }
      }).catch(() => {})
      // Le listener est attaché → on demande AU NATIF de démarrer l'observation
      // du push-to-start token (build ≥21). Ainsi le token n'est pas émis avant
      // que le listener existe (course qui le faisait perdre). Optionnel.
      try { _plugin.enablePushToStart?.().catch(() => {}) } catch { /* build < 21 */ }
    }
  } catch { _plugin = null }
}

export async function liveActivitySupported(): Promise<boolean> {
  await ensurePlugin(); const p = _plugin; if (!p) return false
  try { return (await p.isSupported()).supported } catch { return false }
}

/**
 * À appeler tôt (ouverture de l'app) pour attacher les listeners natifs —
 * notamment le push-to-start token, qui doit être enregistré AVANT la 1re
 * attribution pour pouvoir démarrer la Live Activity à distance. No-op hors iOS.
 */
export async function initLiveActivity(): Promise<void> {
  await ensurePlugin()
  // Écrit le token d'action dans l'App Group DÈS l'ouverture de l'app, pour que
  // les boutons (Accepter/Sur place…) marchent même sur une Live Activity
  // démarrée par PUSH (push-to-start) où startForMission n'a jamais tourné.
  if (_plugin) void ensureActionToken(_plugin)
}

/** Récupère + pousse au natif le token d'action (pour les App Intents). Best-effort. */
async function ensureActionToken(p: LiveActivityPlugin): Promise<void> {
  try {
    const r = await fetch('/api/missions/live-token', { method: 'POST' })
    const j = await r.json()
    if (r.ok && j.token) await p.setActionToken({ token: j.token })
  } catch { /* best-effort */ }
}

export async function startForMission(info: MissionLAInfo, state: MissionLAState): Promise<void> {
  await ensurePlugin(); const p = _plugin; if (!p) return
  try {
    if (!(await p.isSupported()).supported) return
    // IMPORTANT : ne PAS attendre le token (fetch qui peut bloquer via CapacitorHttp).
    void ensureActionToken(p)
    await p.start({ ...info, state })
  } catch (e) { console.warn('[liveActivity] start KO', e) }
}

export async function updateForMission(missionId: string, state: MissionLAState): Promise<void> {
  await ensurePlugin(); const p = _plugin; if (!p) return
  try { await p.update({ missionId, state }) } catch { /* silencieux */ }
}

export async function endForMission(missionId: string, state: MissionLAState): Promise<void> {
  await ensurePlugin(); const p = _plugin; if (!p) return
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
