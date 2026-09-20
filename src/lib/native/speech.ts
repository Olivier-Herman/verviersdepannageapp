// src/lib/native/speech.ts
//
// Pont vers la reconnaissance vocale Apple du wrapper iOS (plugin custom
// SpeechRec, build ≥ 25). Même précaution que liveActivity.ts : on ne renvoie
// JAMAIS le proxy Capacitor depuis une fonction async (proxy thenable → hang).
// Hors app iOS (ou build < 25 sans le plugin), `nativeSpeechAvailable()` rend
// false et l'écran vocal retombe sur la reconnaissance du navigateur ou la
// transcription serveur.

interface SpeechRecPlugin {
  available(): Promise<{ available: boolean; permission: 'granted' | 'denied' | 'prompt'; onDevice?: boolean }>
  request(): Promise<{ granted: boolean }>
  start(o: { language?: string; silenceMs?: number; maxMs?: number }): Promise<{ text: string }>
  stop(): Promise<{ text: string }>
}

let _plugin: SpeechRecPlugin | null = null
let _init = false

async function ensure(): Promise<void> {
  if (_init) return
  _init = true
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') { _plugin = null; return }
    _plugin = registerPlugin<SpeechRecPlugin>('SpeechRec')
  } catch { _plugin = null }
}

/** Vrai si le plugin natif répond (build ≥ 25). Demande les autorisations si besoin. */
export async function nativeSpeechAvailable(): Promise<boolean> {
  await ensure()
  if (!_plugin) return false
  try {
    const a = await Promise.race([_plugin.available(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))])
    if (!a?.available) return false
    if (a.permission === 'granted') return true
    const r = await _plugin.request()
    return !!r?.granted
  } catch { return false }   // build sans le plugin : la méthode n'existe pas → timeout / erreur
}

/** Écoute une phrase et rend le texte (vide si rien entendu). */
export async function nativeListen(opts: { silenceMs?: number; maxMs?: number } = {}): Promise<string> {
  await ensure()
  if (!_plugin) return ''
  try { const r = await _plugin.start({ language: 'fr-BE', silenceMs: opts.silenceMs ?? 1500, maxMs: opts.maxMs ?? 12000 }); return String(r?.text || '') }
  catch { return '' }
}

export async function nativeStop(): Promise<void> {
  await ensure()
  try { await _plugin?.stop() } catch { /* rien */ }
}
