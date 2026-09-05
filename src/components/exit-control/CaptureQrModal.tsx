'use client'
// src/components/exit-control/CaptureQrModal.tsx
//
// « Photographier depuis le téléphone » : crée un jeton de capture, affiche
// le QR à scanner avec le téléphone (ouvre /capture/[token]), puis interroge
// le jeton toutes les 2,5 s ; dès que la capture est faite, onDone().
// Pas de fermeture par clic sur le fond (✕ uniquement). Olivier 2026-09-05.

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { X, Loader2, Smartphone, Check } from 'lucide-react'

export type CaptureKind = 'id_card' | 'cmr' | 'informex' | 'signature' | 'restitution'

const TITLES: Record<CaptureKind, string> = {
  id_card:   'Photographier la pièce d\'identité',
  cmr:       'Photographier le CMR',
  informex:  'Scanner le bon Informex',
  signature: 'Faire signer l\'attestation',
  restitution: 'Restituer avec le téléphone',
}
const HINTS: Record<CaptureKind, string> = {
  id_card:   'Recto puis verso. La pièce est lue automatiquement (carte ou passeport, tous pays).',
  cmr:       'Photographie le CMR complet, bien à plat. Le numéro, le transporteur et la plaque du camion sont lus automatiquement.',
  informex:  'Le téléphone décode le QR du bon et lit le document (acheteur, plaque, châssis).',
  signature: 'La personne relit le résumé et signe sur le téléphone. L\'attestation est figée à la signature.',
  restitution: 'Toute la procédure sur le téléphone : chemin, bon Informex, identité, CMR, signature. Chaque étape est passable avec motif + ton PIN. La fiche suit l\'avancement.',
}

export default function CaptureQrModal({ missionId, kind, onClose, onDone, onTick }: {
  missionId: string
  kind:      CaptureKind
  onClose:   () => void
  onDone:    () => void
  onTick?:   () => void      // à chaque interrogation du jeton (la fiche se rafraîchit)
}) {
  const [token, setToken] = useState<string | null>(null)
  const [url, setUrl]     = useState<string | null>(null)
  const [qr, setQr]       = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone]   = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone
  const onTickRef = useRef(onTick); onTickRef.current = onTick

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/capture/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission_id: missionId, kind }),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Création du lien impossible')
        if (cancelled) return
        setToken(j.token); setUrl(j.url)
        setQr(await QRCode.toDataURL(j.url, { width: 320, margin: 1, errorCorrectionLevel: 'M' }))
      } catch (e: any) { if (!cancelled) setError(e.message) }
    })()
    return () => { cancelled = true }
  }, [missionId, kind])

  useEffect(() => {
    if (!token || done) return
    timer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/capture/${token}`, { cache: 'no-store' })
        const j = await r.json()
        onTickRef.current?.()
        if (j.status === 'used') {
          setDone(true)
          if (timer.current) clearInterval(timer.current)
          onDoneRef.current()
        } else if (j.status === 'expired') {
          setError('Lien expiré (15 min). Ferme et recommence.')
          if (timer.current) clearInterval(timer.current)
        }
      } catch { /* réessaie au tick suivant */ }
    }, 2500)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [token, done])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border rounded-2xl max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-ink font-bold flex items-center gap-2"><Smartphone size={18} /> {TITLES[kind]}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-hover rounded-lg text-ink-muted hover:text-ink transition" aria-label="Fermer"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col items-center gap-4 text-center">
          {done ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <div className="w-14 h-14 rounded-full bg-success/15 text-success flex items-center justify-center"><Check size={30} /></div>
              <p className="text-ink font-semibold">Reçu sur la fiche</p>
              <button onClick={onClose} className="mt-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold">{kind === 'restitution' ? 'Fermer — la sortie est autorisée' : 'Fermer'}</button>
            </div>
          ) : error ? (
            <p className="text-critical text-sm py-6">{error}</p>
          ) : qr ? (
            <>
              <img src={qr} alt="QR à scanner avec le téléphone" className="w-64 h-64 rounded-lg border bg-white" />
              <p className="text-ink-secondary text-sm">{HINTS[kind]}</p>
              <p className="text-ink-muted text-xs flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> En attente du téléphone… (lien valable {kind === 'restitution' ? '45' : '15'} min)</p>
              {url && (
                <a href={url} target="_blank" rel="noreferrer" className="text-xs text-brand underline">Ouvrir sur cet appareil</a>
              )}
            </>
          ) : (
            <p className="text-ink-muted text-sm py-8 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Préparation du lien…</p>
          )}
        </div>
      </div>
    </div>
  )
}
