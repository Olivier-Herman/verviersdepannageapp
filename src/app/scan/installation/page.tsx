'use client'

// Page PUBLIQUE (hors middleware) d'installation de l'agent Scan sur un PC de
// bureau. Même code d'accès que l'agent eID (EID_DOWNLOAD_CODE) : on peut donc
// la faire depuis un poste NON connecté. Le téléchargement passe par
// /api/scan-agent qui revalide le code côté serveur.

import { useState } from 'react'

export default function ScanInstallationPage() {
  const [code, setCode]         = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setChecking(true); setError(null)
    try {
      const r = await fetch(`/api/scan-agent?code=${encodeURIComponent(code)}`, { method: 'HEAD' })
      if (r.ok) setUnlocked(true)
      else setError('Code incorrect.')
    } catch {
      setError('Erreur réseau.')
    } finally {
      setChecking(false)
    }
  }

  const dlUrl = `/api/scan-agent?code=${encodeURIComponent(code)}`

  return (
    <div className="min-h-screen bg-surface-2 text-ink flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <header className="mb-6">
          <p className="text-ink-muted text-xs uppercase tracking-wide">VD Soft · Poste de bureau</p>
          <h1 className="text-2xl font-bold">🖨️ Installation de l&apos;agent Scan</h1>
          <p className="text-ink-secondary text-sm mt-1">
            Le petit programme qui commande un scan sur l&apos;imprimante réseau depuis une fiche.
          </p>
        </header>

        {!unlocked ? (
          <form onSubmit={unlock} className="bg-surface border rounded-2xl p-6 space-y-4">
            <label className="block">
              <span className="text-ink-muted text-xs">Code d&apos;accès</span>
              <input
                type="password" value={code} onChange={e => setCode(e.target.value)} autoFocus
                placeholder="Code fourni par l'administrateur"
                className="mt-1 w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
              />
            </label>
            {error && <p className="text-critical text-sm">⚠ {error}</p>}
            <button type="submit" disabled={checking || !code.trim()}
              className="w-full py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
              {checking ? '⏳ Vérification…' : 'Déverrouiller'}
            </button>
          </form>
        ) : (
          <div className="space-y-5">
            <a href={dlUrl} download
              className="block text-center py-3 bg-brand hover:bg-brand-hover text-white rounded-2xl text-base font-semibold transition">
              ⬇️ Télécharger l&apos;agent Scan (.zip)
            </a>

            <div className="bg-surface border rounded-2xl p-6 space-y-4 text-sm">
              <h2 className="font-semibold text-ink">Installation (une fois par PC)</h2>
              <ol className="list-decimal ml-5 space-y-2 text-ink-secondary">
                <li><strong className="text-ink">Décompresse</strong> le zip → dossier <code className="bg-surface-2 px-1 rounded">vdsoft-scan-agent</code> (ex. dans <code className="bg-surface-2 px-1 rounded">C:\VDSoft</code>).</li>
                <li>Note l&apos;<strong className="text-ink">adresse IP de l&apos;imprimante</strong> (écran de la Canon, ou Windows &gt; Imprimantes &gt; Propriétés &gt; Ports).</li>
                <li>Clic droit sur <code className="bg-surface-2 px-1 rounded">install-autostart.bat</code> → <strong className="text-ink">Exécuter en tant qu&apos;administrateur</strong>, puis saisis l&apos;IP.<br/>
                  <span className="text-ink-muted">→ démarre l&apos;agent et le fait <strong>redémarrer tout seul</strong> à chaque démarrage du PC.</span></li>
                <li>Vérifie : ouvre <code className="bg-surface-2 px-1 rounded">http://localhost:7182/health</code>.</li>
              </ol>

              <div className="bg-surface-2 border rounded-xl p-3 text-xs space-y-1.5">
                <p className="text-ink font-medium">Ce que dit /health</p>
                <p><code className="bg-surface px-1 rounded">escl: true</code> → chemin direct, aucun pilote nécessaire. Le bon cas.</p>
                <p><code className="bg-surface px-1 rounded">escl: false, wia: true</code> → l&apos;agent passera par le pilote Canon installé sur ce PC.</p>
                <p><code className="bg-surface px-1 rounded">false</code> partout → ni l&apos;IP ni le pilote ne répondent : corrige <code className="bg-surface px-1 rounded">config.json</code>.</p>
              </div>

              <h2 className="font-semibold text-ink pt-2">Utilisation</h2>
              <p className="text-ink-secondary">
                Sur la fiche, le bouton <strong className="text-ink">🖨️ Scanner</strong> apparaît dès que l&apos;agent répond.
                Pose le document dans le chargeur, clique : les pages sont annexées à la fiche.
                Sur les PC sans agent, le bouton reste invisible — rien ne casse.
              </p>

              <p className="text-ink-muted text-xs pt-2">
                Aucune dépendance à installer (pas de Node, pas de npm) : 100 % PowerShell natif de Windows.
                Journal des scans : <code className="bg-surface-2 px-0.5 rounded">agent-log.txt</code> dans le dossier de l&apos;agent.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
