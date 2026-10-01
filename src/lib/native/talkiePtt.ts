// src/lib/native/talkiePtt.ts
//
// Pont JS ↔ plugin natif « TalkiePTT » (iOS, cadre Push to Talk d'Apple) : talkie
// téléphone verrouillé / app fermée (Olivier 01/10/2026).
//  - iOS n'autorise qu'UN canal talkie système : les clés (garde, direct:…) sont des
//    salles du serveur vocal mémorisées par le plugin ; la clé « principale » est
//    celle qu'iOS affiche et vers laquelle part la voix du bouton de l'écran verrouillé.
//  - join({ key, name, url, token, primary }) : mémorise (ou met à jour) les accès
//    d'une clé ; leave({ key }) l'oublie ; plus aucune clé → canal système quitté.
//  - Événement pttToken { token } : jeton de réveil du téléphone, à remettre au
//    serveur (/api/talkie/ptt-token) qui s'en sert quand quelqu'un parle.
//
// No-op complet hors app iPhone, et sur un build qui n'a pas encore le plugin
// (isPluginAvailable) → sûr à appeler partout.

export interface TalkiePttState {
  joined: boolean
  activeKey: string | null
  keys: string[]
  transmitting: boolean
  speaker: string | null
  pttToken: string | null
  /** Build ≥ 32 : autorisation micro (le natif ne peut pas la demander téléphone verrouillé). */
  micPermission?: 'granted' | 'denied' | 'restricted' | 'prompt'
  version?: string
}

interface TalkiePttPlugin {
  join(o: { key: string; name: string; url: string; token: string; primary?: boolean }): Promise<void>
  leave(o: { key: string }): Promise<void>
  setActive(o: { key: string }): Promise<void>
  getState(): Promise<TalkiePttState>
  requestMicPermission?(): Promise<{ micPermission?: string } | void>
  addListener(ev: 'pttToken', cb: (d: { token: string }) => void): Promise<{ remove: () => void }>
  addListener(ev: 'transmitState', cb: (d: { key: string; active: boolean }) => void): Promise<{ remove: () => void }>
  addListener(ev: 'receiveState', cb: (d: { key: string; speaker: string | null }) => void): Promise<{ remove: () => void }>
}

let _plugin: TalkiePttPlugin | null = null
let _init = false

// ⚠️ Jamais renvoyer le proxy Capacitor depuis une async fn qu'on `await` (il répond à
// `.then` → blocage éternel, incident 2026-07-26). On initialise ici (retour void) et
// on lit `_plugin` en synchrone.
async function ensurePlugin(): Promise<void> {
  if (_init) return
  _init = true
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('TalkiePTT')) { _plugin = null; return }
    _plugin = registerPlugin<TalkiePttPlugin>('TalkiePTT')
  } catch { _plugin = null }
}

/** Le module talkie natif est-il présent (app iPhone récente) ? */
export async function talkiePttAvailable(): Promise<boolean> {
  await ensurePlugin()
  return !!_plugin
}

/** Plugin (après talkiePttAvailable() === true), lu en synchrone. */
export function talkiePtt(): TalkiePttPlugin | null {
  return _plugin
}
