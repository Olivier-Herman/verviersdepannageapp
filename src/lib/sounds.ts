// src/lib/sounds.ts
//
// Sons UI cote client via Web Audio API (pas d assets externes).
// Utilises notamment par le mode inventaire fourriere pour donner un
// feedback audio fort lors d un scan reussi (win) ou rate (lose).

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
  if (!Ctx) return null
  try { return new Ctx() } catch { return null }
}

/** Joue une note simple. duration en secondes. */
function note(audio: AudioContext, freq: number, startOffset: number, duration: number, type: OscillatorType = 'sine', volume = 0.25) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.type = type
  osc.frequency.value = freq
  const t0 = audio.currentTime + startOffset
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

/** Vibration courte (mobile). */
function vibrate(pattern: number | number[]) {
  try { (navigator as any).vibrate?.(pattern) } catch {}
}

/** Son de réussite : 3 notes ascendantes (C - E - G). Volume soutenu. */
export function playWinSound() {
  const audio = ctx()
  if (!audio) return
  note(audio, 523, 0.00, 0.12, 'square', 0.3)   // C5
  note(audio, 659, 0.10, 0.12, 'square', 0.3)   // E5
  note(audio, 784, 0.20, 0.22, 'square', 0.35)  // G5
  vibrate(60)
  setTimeout(() => audio.close().catch(() => {}), 600)
}

/** Son d'échec : 2 notes descendantes (E - C) + buzz. Volume soutenu. */
export function playLoseSound() {
  const audio = ctx()
  if (!audio) return
  note(audio, 392, 0.00, 0.15, 'sawtooth', 0.3)  // G4
  note(audio, 196, 0.15, 0.30, 'sawtooth', 0.35) // G3
  vibrate([80, 60, 80])
  setTimeout(() => audio.close().catch(() => {}), 700)
}

/** Bip neutre court : utilise quand l action est en cours, sans verdict. */
export function playBeep() {
  const audio = ctx()
  if (!audio) return
  note(audio, 880, 0.00, 0.08, 'sine', 0.18)
  vibrate(30)
  setTimeout(() => audio.close().catch(() => {}), 200)
}
