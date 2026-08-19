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
  const [ready, setReady]         = useState(true)   // un chemin de scan est joignable
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  // Sonde l'agent au montage : pas d'agent → pas de bouton.
  //
  // On N'EXIGE PAS que l'imprimante reponde pour afficher le bouton. Une
  // imprimante en veille, en redemarrage ou momentanement occupee fait echouer
  // la sonde — et un bouton qui disparait n'apprend rien a personne, alors
  // qu'un bouton qui explique se repare tout seul. Il s'affiche donc en jaune
  // avec la raison. La sonde est relancee toutes les 15 s : quand l'imprimante
  // revient, le bouton redevient normal sans recharger la page.
  useEffect(() => {
    let alive = true
    const probe = () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500)
      fetch(`${AGENT_URL}/health`, { signal: ctrl.signal, cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (!alive) return; setAvailable(!!j?.ok); setReady(!!j?.escl || !!j?.wia) })
        .catch(() => { if (alive) setAvailable(false) })
        .finally(() => clearTimeout(t))
    }
    probe()
    const i = setInterval(probe, 15_000)
    return () => { alive = false; clearInterval(i) }
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
          title={ready ? "Scanner le document posé dans le chargeur de l'imprimante" : "L'imprimante ne répond pas — clique quand même pour réessayer"}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5 border ${
            ready ? 'bg-surface border-app text-ink hover:border-brand' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
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
      {!busy && !ready && (
        <p className="text-amber-700 text-[11px] mt-1">
          Imprimante injoignable (veille, redémarrage, ou adresse à corriger) — le scan réessaiera.
        </p>
      )}
      {err && <p className="text-critical text-xs mt-1">⚠ {err}</p>}
    </div>
  )
}

// Les codes de l'agent sont techniques : on les traduit en langage d'accueil.
function errorLabel(code?: string): string {
  switch (String(code || '')) {
    case 'ESCL_UNAVAILABLE':   return 'Imprimante injoignable — sort-elle de veille ? Réessaie dans 10 secondes.'
    case 'ESCL_BUSY':          return 'Le scanner refuse les demandes : retire les feuilles du chargeur, reviens à l\'écran d\'accueil de l\'imprimante, puis réessaie.'
    case 'ESCL_NO_PAGE':
    case 'WIA_NO_PAGE':        return 'Aucune page détectée — le chargeur est-il vide ?'
    case 'WIA_NO_DEVICE':      return 'Aucun scanner trouvé sur ce PC.'
    case 'WIA_TRANSFER_FAILED':return 'L\'imprimante a refusé le scan — bourrage ou capot ouvert ?'
    default:                   return 'Scan impossible — voir agent-log.txt sur le PC.'
  }
}
