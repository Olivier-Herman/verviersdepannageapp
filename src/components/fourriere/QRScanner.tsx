'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { X, Camera, RefreshCw } from 'lucide-react'
import { playBeep } from '@/lib/sounds'

interface Props {
  /** Appele a chaque QR detecte. Le scanner reste actif (continue scan). */
  onScan:  (qrText: string) => void
  /** Pause externe pendant traitement asynchrone (re-ouvre apres). */
  paused?: boolean
  onClose: () => void
}

const SCANNER_ID = 'qr-scanner-region'
const DEDUP_MS   = 3500   // ignorer le meme QR scanné plusieurs fois en 3.5s

export default function QRScanner({ onScan, paused, onClose }: Props) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'paused' | 'error'>('idle')
  const [error, setError]   = useState<string | null>(null)
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([])
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const lastScansRef = useRef<Map<string, number>>(new Map())  // dedup

  // Init : enumere cameras, lance la 1ere (preference back camera)
  useEffect(() => {
    let canceled = false
    setStatus('starting')
    setError(null)

    Html5Qrcode.getCameras()
      .then(devices => {
        if (canceled) return
        if (!devices || devices.length === 0) {
          setError('Aucune caméra détectée')
          setStatus('error')
          return
        }
        setCameras(devices.map(d => ({ id: d.id, label: d.label || `Caméra ${d.id.slice(0, 6)}` })))
        // Préférence : back camera (libellé contient "back" ou "environnement")
        const back = devices.find(d => /back|environment|arri|rear/i.test(d.label)) || devices[devices.length - 1]
        setCurrentCameraId(back.id)
      })
      .catch(e => {
        if (canceled) return
        setError(e?.message || 'Permission caméra refusée')
        setStatus('error')
      })

    return () => {
      canceled = true
      stopScanner()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Demarre / restart le scanner quand la camera change ou quand on sort de paused
  useEffect(() => {
    if (!currentCameraId) return
    if (paused) {
      setStatus('paused')
      pauseScanner()
      return
    }
    startScanner(currentCameraId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCameraId, paused])

  async function startScanner(cameraId: string) {
    if (scannerRef.current) {
      await stopScanner()
    }
    try {
      const scanner = new Html5Qrcode(SCANNER_ID, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      })
      scannerRef.current = scanner
      await scanner.start(
        cameraId,
        {
          fps: 8,
          qrbox: (vw: number, vh: number) => {
            const min = Math.min(vw, vh)
            const side = Math.floor(min * 0.7)
            return { width: side, height: side }
          },
        },
        (decodedText) => {
          // Dedup : ignorer si meme QR scanné dans les DEDUP_MS dernieres ms
          const now = Date.now()
          const last = lastScansRef.current.get(decodedText) || 0
          if (now - last < DEDUP_MS) return
          lastScansRef.current.set(decodedText, now)
          // Garbage collect anciens enregistrements
          for (const [k, t] of lastScansRef.current.entries()) {
            if (now - t > DEDUP_MS * 2) lastScansRef.current.delete(k)
          }
          // Bip neutre court : indique simplement que le QR est detecte.
          // Le composant parent jouera ensuite le son WIN ou LOSE selon le
          // resultat du traitement async.
          playBeep()
          onScan(decodedText)
        },
        () => {}  // ignore scan failures
      )
      setStatus('running')
    } catch (e: any) {
      console.error('[QRScanner] start fail:', e)
      setError(e?.message || 'Caméra inaccessible')
      setStatus('error')
    }
  }

  async function pauseScanner() {
    if (scannerRef.current) {
      try { await scannerRef.current.pause(true) } catch {}
    }
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState()
        if (state === 2 || state === 3) {   // 2=SCANNING, 3=PAUSED
          await scannerRef.current.stop()
        }
        await scannerRef.current.clear()
      } catch {}
      scannerRef.current = null
    }
  }

  async function switchCamera() {
    if (cameras.length < 2) return
    const idx = cameras.findIndex(c => c.id === currentCameraId)
    const next = cameras[(idx + 1) % cameras.length]
    setCurrentCameraId(next.id)
  }

  async function handleClose() {
    await stopScanner()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-3 bg-black/60 text-white">
        <button onClick={handleClose} className="p-2 hover:bg-white/10 rounded-lg">
          <X size={20} />
        </button>
        <div className="text-sm font-medium flex items-center gap-2">
          <Camera size={16} />
          Scan QR — Inventaire
        </div>
        {cameras.length > 1 ? (
          <button onClick={switchCamera} className="p-2 hover:bg-white/10 rounded-lg" title="Changer de caméra">
            <RefreshCw size={20} />
          </button>
        ) : (
          <div className="w-9" />
        )}
      </div>

      {/* Video region */}
      <div className="flex-1 relative overflow-hidden bg-black">
        <div id={SCANNER_ID} className="absolute inset-0" />

        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
            Démarrage caméra…
          </div>
        )}
        {status === 'paused' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
            ⏳ Traitement en cours…
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center text-center p-6">
            <div className="bg-critical-soft border border-critical rounded-2xl p-4 text-critical text-sm max-w-xs">
              ⚠ {error || 'Erreur caméra'}
              <button onClick={handleClose} className="block mt-3 mx-auto px-4 py-2 bg-critical text-white rounded-xl text-sm">
                Fermer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom hint */}
      <div className="p-4 bg-black/60 text-white/70 text-xs text-center">
        Pointe la caméra vers un QR · scan automatique avec bip · même QR : ignoré pendant 3 sec
      </div>
    </div>
  )
}
