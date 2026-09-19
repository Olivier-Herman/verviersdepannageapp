'use client'
// src/components/encaissement/ClientQrModal.tsx
//
// « QR client » (Olivier 19/09/2026) : le chauffeur affiche un QR lié à la
// transaction ; le client le scanne, remplit ses coordonnées dans sa langue
// (/c/[token]) ; dès qu'il valide, onDone(data) remplit le formulaire du
// chauffeur. NE BLOQUE PAS le chauffeur : la modale se ferme d'un ✕ et la
// réponse arrive quand même (le jeton reste écouté par le formulaire).
// Réception : realtime Supabase sur la ligne du jeton + repli par interrogation
// toutes les 3 s (au cas où le realtime ne passe pas — 4G, cache, etc.).

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { createClient } from '@supabase/supabase-js'
import { X, Loader2, Smartphone, Check } from 'lucide-react'

export interface ClientCaptureData {
  first_name: string; last_name: string; street: string; zip: string; city: string; country_code: string
  address: string; email: string; phone: string
}

/** Écoute un jeton QR client jusqu'à sa validation (realtime + repli). Rend une fonction d'arrêt. */
export function watchClientCapture(token: string, onDone: (d: ClientCaptureData) => void): () => void {
  let stopped = false
  const finish = (d: ClientCaptureData) => { if (stopped) return; stopped = true; cleanup(); onDone(d) }
  const poll = async () => {
    try { const j = await fetch(`/api/client-capture/${token}`, { cache: 'no-store' }).then(r => r.json()); if (j?.status === 'done' && j.data) finish(j.data) } catch {}
  }
  const iv = setInterval(poll, 3000)
  let ch: any = null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    ch = sb.channel('client-capture-' + token)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'client_capture', filter: `id=eq.${token}` }, (p: any) => { if (p.new?.status === 'done' && p.new?.data) finish(p.new.data) })
      .subscribe()
  } catch { /* realtime indisponible : le repli suffit */ }
  const cleanup = () => { clearInterval(iv); try { ch?.unsubscribe() } catch {} }
  return () => { stopped = true; cleanup() }
}

export default function ClientQrModal({ missionId, plate, onClose, onToken, onDone }: {
  missionId?: string | null; plate?: string | null
  onClose: () => void
  onToken: (token: string) => void            // le formulaire garde le jeton et continue de l'écouter après fermeture
  onDone: (d: ClientCaptureData) => void
}) {
  const [qr, setQr] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const stopRef = useRef<() => void>()
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/client-capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: missionId || null, plate: plate || null }) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Création du lien impossible')
        if (cancelled) return
        setUrl(j.url); onToken(j.token)
        setQr(await QRCode.toDataURL(j.url, { width: 360, margin: 1, errorCorrectionLevel: 'M' }))
        stopRef.current = watchClientCapture(j.token, d => { setDone(true); onDoneRef.current(d) })
      } catch (e: any) { if (!cancelled) setError(e.message) }
    })()
    return () => { cancelled = true; stopRef.current?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-sm bg-surface border rounded-2xl shadow-xl p-5 text-center">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-ink font-bold text-base flex items-center gap-2"><Smartphone size={18} /> Le client remplit ses coordonnées</h3>
          <button onClick={onClose} className="p-1.5 text-ink-faint hover:text-ink" aria-label="Fermer"><X size={18} /></button>
        </div>
        {error ? <p className="text-critical text-sm py-6">⚠ {error}</p>
          : done ? <div className="py-8"><Check size={44} className="mx-auto text-success" /><p className="text-ink font-semibold mt-2">Coordonnées reçues</p><p className="text-ink-muted text-sm">Le formulaire est rempli.</p></div>
          : qr ? (
            <>
              <img src={qr} alt="QR client" className="mx-auto w-64 h-64 rounded-xl border bg-white" />
              <p className="text-ink-secondary text-sm mt-3">Fais scanner ce QR par le client. Il choisit sa langue (FR · NL · EN · DE) et complète nom, adresse, e-mail.</p>
              <p className="text-ink-faint text-xs mt-2 flex items-center justify-center gap-1.5"><Loader2 size={12} className="animate-spin" /> En attente de sa réponse — tu peux fermer et continuer, elle arrivera quand même.</p>
              {url && <p className="text-[10px] text-ink-faint mt-2 break-all">{url}</p>}
            </>
          ) : <p className="text-ink-muted text-sm py-10 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Préparation du QR…</p>}
        {done && <button onClick={onClose} className="mt-2 px-4 py-2 bg-brand text-white rounded-xl text-sm font-semibold">Continuer</button>}
      </div>
    </div>
  )
}
