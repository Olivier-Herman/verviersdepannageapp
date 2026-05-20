// src/components/OcrScanModal.tsx
//
// Modal de scan OCR (plaque ou VIN) via la camera + reconnaissance de texte
// on-device. Pas de coût opérationnel (pas d API IA), pas de réseau requis.
//
// Stack :
//   - @capacitor/camera : capture photo
//   - @capacitor-community/image-to-text : OCR (Apple Vision sur iOS,
//     ML Kit sur Android)
//
// Web fallback : le bouton n est pas affiche cote web (ne fonctionne qu en
// app native iOS/Android). Cf hidden via Capacitor.isNativePlatform().

'use client'

import { useState } from 'react'

type Mode = 'plate' | 'vin'

interface Detection {
  text:       string
  confidence: number
}

interface Props {
  mode:    Mode
  current: string
  onPick:  (text: string) => void
  onClose: () => void
}

/**
 * Normalise un candidat selon le mode :
 *   - plate : uppercase + retire les caracteres non alphanumeriques (sauf - et espace)
 *   - vin   : uppercase + ne conserve que A-HJ-NPR-Z et 0-9 (norme ISO 3779)
 */
function normalize(raw: string, mode: Mode): string {
  const u = raw.toUpperCase().trim()
  if (mode === 'vin') return u.replace(/[^A-HJ-NPR-Z0-9]/g, '')
  return u.replace(/[^A-Z0-9\- ]/g, '').replace(/\s+/g, ' ')
}

/** True si le candidat ressemble a une plaque (mix lettre + chiffre, 4-12 chars). */
function looksLikePlate(s: string): boolean {
  const clean = s.replace(/[\s-]/g, '')
  if (clean.length < 4 || clean.length > 12) return false
  return /[A-Z]/.test(clean) && /[0-9]/.test(clean)
}

/** True si le candidat respecte la norme VIN ISO 3779. */
function looksLikeVin(s: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(s)
}

export default function OcrScanModal({ mode, current, onPick, onClose }: Props) {
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [hits,     setHits]     = useState<Detection[]>([])
  const [taken,    setTaken]    = useState(false)

  const title    = mode === 'plate' ? 'Scan plaque' : 'Scan VIN'
  const helper   = mode === 'plate'
    ? 'Cadre la plaque, prends une photo nette. Toutes les nationalités fonctionnent.'
    : 'Cadre le numéro de châssis (17 caractères). Eclairage important.'

  async function scan() {
    setError(null); setLoading(true); setHits([]); setTaken(false)
    try {
      // Dynamic imports : aucun crash si lance dans un navigateur web
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const { Ocr } = await import('@capacitor-community/image-to-text')

      const photo = await Camera.getPhoto({
        quality:        85,
        allowEditing:   false,
        resultType:     CameraResultType.Uri,
        source:         CameraSource.Camera,
        saveToGallery:  false,
        correctOrientation: true,
      })
      setTaken(true)

      const data = await Ocr.detectText({ filename: photo.path! })
      const candidates: Detection[] = (data.textDetections || [])
        .map(d => ({ text: normalize(d.text, mode), confidence: (d as any).confidence ?? 0 }))
        .filter(d => {
          if (mode === 'vin')   return looksLikeVin(d.text) || d.text.length >= 8
          return looksLikePlate(d.text)
        })
        .sort((a, b) => b.confidence - a.confidence)
        // Dedup
        .filter((d, i, arr) => arr.findIndex(x => x.text === d.text) === i)
        .slice(0, 8)

      if (candidates.length === 0) {
        setError('Aucun texte exploitable détecté — essaie de te rapprocher ou améliore l\'éclairage')
      } else {
        setHits(candidates)
      }
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (msg.includes('User cancelled') || msg.includes('canceled')) {
        // Sortie silencieuse
      } else if (msg.includes('not implemented')) {
        setError('Scan disponible uniquement dans l\'app mobile (iOS/Android)')
      } else {
        setError(`Erreur : ${msg}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-end" onClick={onClose}>
      <div className="bg-surface w-full rounded-t-3xl p-6 space-y-4 max-h-[80vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-ink font-semibold text-lg">{title}</h2>
            <p className="text-ink-muted text-xs mt-0.5">{helper}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none">×</button>
        </div>

        {current && (
          <p className="text-ink-muted text-xs">
            Valeur actuelle : <span className="font-mono font-bold text-ink">{current}</span>
          </p>
        )}

        {/* Bouton scan */}
        {!hits.length && (
          <button
            onClick={scan}
            disabled={loading}
            className="w-full py-4 bg-brand text-white font-semibold rounded-2xl text-base disabled:opacity-50"
          >
            {loading ? (taken ? '🤖 Analyse en cours…' : '📸 Capture…') : '📷 Ouvrir l\'appareil photo'}
          </button>
        )}

        {error && (
          <p className="text-red-500 text-sm bg-red-500/10 rounded-xl px-3 py-2">{error}</p>
        )}

        {/* Résultats */}
        {hits.length > 0 && (
          <div className="space-y-2">
            <p className="text-ink-muted text-xs">Choisis le bon texte :</p>
            {hits.map((d, i) => {
              const isLikely = (mode === 'plate' && looksLikePlate(d.text))
                             || (mode === 'vin' && looksLikeVin(d.text))
              return (
                <button
                  key={`${d.text}-${i}`}
                  onClick={() => { onPick(d.text); onClose() }}
                  className={`w-full text-left px-4 py-3 rounded-2xl border transition ${
                    isLikely
                      ? 'border-brand bg-brand/10 text-ink'
                      : 'border bg-surface text-ink-secondary'
                  }`}
                >
                  <div className="font-mono font-bold text-base">{d.text}</div>
                  {isLikely && (
                    <div className="text-xs text-brand mt-0.5">✓ Format probable</div>
                  )}
                </button>
              )
            })}
            <button
              onClick={scan}
              className="w-full py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm"
            >
              🔄 Refaire une photo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
