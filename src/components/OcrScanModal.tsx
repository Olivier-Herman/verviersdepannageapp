// src/components/OcrScanModal.tsx
//
// Modal de scan OCR (plaque ou VIN) via la camera + reconnaissance de texte
// on-device. Pas de coût opérationnel (pas d API IA), pas de réseau requis.
//
// Stack :
//   - @capacitor/camera : capture photo
//   - iOS     : plugin Swift custom `TextRecognition` (App/App/TextRecognitionPlugin.swift)
//               base sur Apple Vision (VNRecognizeTextRequest)
//   - Android : @capacitor-community/image-to-text (ML Kit Text Recognition v2)
//               Necessite google-services.json dans android/app/
//
// Web fallback : le bouton n est pas affiche cote web (ne fonctionne qu en
// app native iOS/Android). Cf hidden via Capacitor.isNativePlatform().

'use client'

import { useState } from 'react'

type Mode = 'plate' | 'vin' | 'any'

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
// Caracteres autorises pour un VIN ISO 3779 : A-Z sans I, O, Q + chiffres.
// "A-HJ-NPR-Z" inclut Q par erreur (P-R = P, Q, R). On enumere explicitement.
const VIN_ALLOWED_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

function normalize(raw: string, mode: Mode): string {
  const u = raw.toUpperCase().trim()
  if (mode === 'vin') {
    return [...u].filter(c => VIN_ALLOWED_CHARS.includes(c)).join('')
  }
  return u.replace(/[^A-Z0-9\- ]/g, '').replace(/\s+/g, ' ')
}

/** True si le candidat ressemble a une plaque (mix lettre + chiffre, 4-12 chars). */
function looksLikePlate(s: string): boolean {
  const clean = s.replace(/[\s-]/g, '')
  if (clean.length < 4 || clean.length > 12) return false
  return /[A-Z]/.test(clean) && /[0-9]/.test(clean)
}

/** True si le candidat respecte la norme VIN ISO 3779 (17 chars sans I/O/Q). */
function looksLikeVin(s: string): boolean {
  if (s.length !== 17) return false
  for (const c of s) if (!VIN_ALLOWED_CHARS.includes(c)) return false
  return true
}

export default function OcrScanModal({ mode, current, onPick, onClose }: Props) {
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [hits,     setHits]     = useState<Detection[]>([])
  const [taken,    setTaken]    = useState(false)

  const title  = mode === 'plate' ? 'Scan plaque'
               : mode === 'vin'   ? 'Scan VIN'
               : 'Scan plaque ou VIN'
  const helper = mode === 'plate'
    ? 'Cadre la plaque, prends une photo nette. Toutes les nationalités fonctionnent.'
    : mode === 'vin'
    ? 'Rogne pour isoler les 17 caractères du VIN (l\'app proposera le crop après la photo).'
    : 'Photographie la plaque ou la plaquette du VIN — l\'app détecte les deux formats.'

  async function scan() {
    setError(null); setLoading(true); setHits([]); setTaken(false)
    try {
      // Dynamic imports : aucun crash si lance dans un navigateur web
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      const { Capacitor, registerPlugin } = await import('@capacitor/core')
      const platform = Capacitor.getPlatform()

      const photo = await Camera.getPhoto({
        quality:        85,
        // Crop iOS seulement quand on cible explicitement le VIN (besoin
        // d isoler sur plaquette de portiere). Pour 'plate' et 'any' on
        // garde rapide — l user peut toujours refaire une photo si besoin.
        // Sur Android, allowEditing peut etre instable selon les versions
        // de la Camera Intent — on desactive pour fiabilite.
        allowEditing:   mode === 'vin' && platform === 'ios',
        resultType:     CameraResultType.Uri,
        source:         CameraSource.Camera,
        saveToGallery:  false,
        correctOrientation: true,
      })
      setTaken(true)

      // Branching plateforme :
      //  - iOS     : plugin Swift custom 'TextRecognition' (Apple Vision)
      //  - Android : @capacitor-community/image-to-text (ML Kit v2, confidence
      //              non fournie — on met 0.8 par defaut pour le ranking)
      let rawDetections: { text: string; confidence?: number }[] = []
      if (platform === 'android') {
        const { Ocr } = await import('@capacitor-community/image-to-text')
        const data = await Ocr.detectText({ filename: photo.path! })
        rawDetections = (data.textDetections || []).map(d => ({ text: d.text, confidence: 0.8 }))
      } else {
        const TextRecognition = registerPlugin<{
          detectText(opts: { filename: string }): Promise<{ textDetections: { text: string; confidence: number }[] }>
        }>('TextRecognition')
        const data = await TextRecognition.detectText({ filename: photo.path! })
        rawDetections = data.textDetections || []
      }

      // Normalisation : pour 'any' on tente les 2 modes (plate puis vin).
      const candidates: Detection[] = []
      for (const d of rawDetections) {
        const conf = d.confidence ?? 0
        if (mode === 'plate' || mode === 'any') {
          const np = normalize(d.text, 'plate')
          if (looksLikePlate(np)) candidates.push({ text: np, confidence: conf })
        }
        if (mode === 'vin' || mode === 'any') {
          const nv = normalize(d.text, 'vin')
          if (looksLikeVin(nv) || (mode === 'vin' && nv.length >= 8)) {
            candidates.push({ text: nv, confidence: conf })
          }
        }
      }

      // Mode VIN ou 'any' : on cherche aussi des sous-chaines de 17 chars dans
      // le texte complet (utile quand l OCR decoupe le VIN en plusieurs morceaux
      // a cause des espaces ou bruits sur la plaquette de portiere).
      if (mode === 'vin' || mode === 'any') {
        const fullText = rawDetections
          .map(d => normalize(d.text, 'vin'))
          .join('')
        for (let i = 0; i <= fullText.length - 17; i++) {
          const sub = fullText.substring(i, i + 17)
          if (looksLikeVin(sub) && !candidates.some(c => c.text === sub)) {
            candidates.push({ text: sub, confidence: 0.85 })
          }
        }
      }

      const final = candidates
        .sort((a, b) => b.confidence - a.confidence)
        .filter((d, i, arr) => arr.findIndex(x => x.text === d.text) === i)
        .slice(0, 8)

      if (final.length === 0) {
        setError(mode === 'vin'
          ? 'Aucun VIN de 17 caractères trouvé. Rapproche-toi de la plaquette et rogne pour isoler uniquement le VIN.'
          : mode === 'any'
          ? 'Rien détecté — essaie de te rapprocher ou rogne pour isoler la plaque/VIN.'
          : 'Aucune plaque détectée — essaie de te rapprocher ou améliore l\'éclairage'
        )
      } else {
        setHits(final)
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
                             || (mode === 'vin'   && looksLikeVin(d.text))
                             || (mode === 'any'   && (looksLikePlate(d.text) || looksLikeVin(d.text)))
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
