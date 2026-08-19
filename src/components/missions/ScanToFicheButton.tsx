'use client'

// Bouton « 🖨️ Scanner » — commande un scan sur l'imprimante réseau et rend les
// pages au formulaire qui les annexe à la fiche.
//
// La fiche est en HTTPS sur Vercel et ne peut pas parler à une imprimante en
// HTTP sur le LAN ; le navigateur, lui, a le droit d'appeler http://localhost.
// D'où l'agent local (infra/scan-agent, port 7182), même principe que l'agent
// eID. Sur un PC sans agent, /health ne répond pas → le bouton ne s'affiche
// pas du tout, et le champ « fichier » habituel reste seul. Olivier 2026-08-19.

import { useEffect, useState } from 'react'

const AGENT_URL = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('scan')
    if (q) return q.replace(/\/$/, '')
  } catch { /* SSR */ }
  return (process.env.NEXT_PUBLIC_SCAN_AGENT_URL || 'http://localhost:7182').replace(/\/$/, '')
})()

const b64ToFile = (b64: string, name: string, mime: string): File => {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new File([buf], name, { type: mime })
}

export default function ScanToFicheButton({
  onScanned, label = '🖨️ Scanner', className,
}: {
  /** Pages scannées, prêtes à partir dans un FormData. */
  onScanned: (files: File[]) => void
  label?:     string
  className?: string
}) {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  // Sonde l'agent au montage : pas d'agent → pas de bouton. On exige aussi un
  // chemin de scan disponible (escl ou wia), sinon on afficherait un bouton qui
  // ne peut qu'echouer. L'agent tient cet etat a jour en tache de fond, la
  // reponse est donc immediate.
  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    fetch(`${AGENT_URL}/health`, { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => setAvailable(!!j?.ok && (!!j.escl || !!j.wia)))
      .catch(() => setAvailable(false))
      .finally(() => clearTimeout(t))
    return () => { clearTimeout(t); ctrl.abort() }
  }, [])

  const scan = async (source: 'adf' | 'flatbed') => {
    setBusy(true); setErr(null)
    try {
      // Un scan ADF de plusieurs pages peut durer : pas de timeout serré ici.
      const r = await fetch(`${AGENT_URL}/scan?source=${source}&color=color&dpi=300`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.ok) throw new Error(errorLabel(j?.error))
      const files: File[] = (j.files || []).map((f: any) => b64ToFile(f.b64, f.name, f.mime))
      if (!files.length) throw new Error('Aucune page scannée.')
      onScanned(files)
    } catch (e: any) {
      setErr(e?.name === 'TypeError' ? 'Agent de scan injoignable.' : (e?.message || 'Scan impossible.'))
    } finally { setBusy(false) }
  }

  if (!available) return null

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => scan('adf')} disabled={busy}
          title="Scanner le document posé dans le chargeur de l'imprimante"
          className="px-3 py-1.5 bg-surface border border-app rounded-lg text-xs font-semibold text-ink hover:border-brand disabled:opacity-50 flex items-center gap-1.5">
          {busy
            ? <><span className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" /> Scan en cours…</>
            : label}
        </button>
        {!busy && (
          <button type="button" onClick={() => scan('flatbed')}
            className="text-ink-muted text-[11px] hover:text-brand hover:underline"
            title="Scanner depuis la vitre au lieu du chargeur">
            depuis la vitre
          </button>
        )}
      </div>
      {busy && <p className="text-ink-muted text-[11px] mt-1">Ne retire pas les feuilles du chargeur.</p>}
      {err && <p className="text-critical text-xs mt-1">⚠ {err}</p>}
    </div>
  )
}

// Les codes de l'agent sont techniques : on les traduit en langage d'accueil.
function errorLabel(code?: string): string {
  switch (String(code || '')) {
    case 'ESCL_UNAVAILABLE':   return 'Imprimante injoignable — vérifie son adresse dans config.json.'
    case 'ESCL_NO_PAGE':
    case 'WIA_NO_PAGE':        return 'Aucune page détectée — le chargeur est-il vide ?'
    case 'WIA_NO_DEVICE':      return 'Aucun scanner trouvé sur ce PC.'
    case 'WIA_TRANSFER_FAILED':return 'L\'imprimante a refusé le scan — bourrage ou capot ouvert ?'
    default:                   return 'Scan impossible — voir agent-log.txt sur le PC.'
  }
}
