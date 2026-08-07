'use client'

// Page PUBLIQUE (hors middleware) d'installation de l'agent eID sur un PC
// comptoir. Protégée par un CODE (EID_DOWNLOAD_CODE) : on peut donc la faire
// depuis un poste NON connecté. Le téléchargement réel passe par /api/eid-agent
// qui revalide le code côté serveur.

import { useState } from 'react'

export default function EidInstallationPage() {
  const [code, setCode]         = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault()
    setChecking(true); setError(null)
    try {
      const r = await fetch(`/api/eid-agent?code=${encodeURIComponent(code)}`, { method: 'HEAD' })
      if (r.ok) setUnlocked(true)
      else setError('Code incorrect.')
    } catch {
      setError('Erreur réseau.')
    } finally {
      setChecking(false)
    }
  }

  const dlUrl = `/api/eid-agent?code=${encodeURIComponent(code)}`

  return (
    <div className="min-h-screen bg-surface-2 text-ink flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <header className="mb-6">
          <p className="text-ink-muted text-xs uppercase tracking-wide">VD Soft · Poste comptoir</p>
          <h1 className="text-2xl font-bold">🪪 Installation de l'agent eID</h1>
          <p className="text-ink-secondary text-sm mt-1">
            Le petit programme qui lit la carte d'identité sur le lecteur du PC comptoir.
          </p>
        </header>

        {!unlocked ? (
          <form onSubmit={unlock} className="bg-surface border rounded-2xl p-6 space-y-4">
            <label className="block">
              <span className="text-ink-muted text-xs">Code d'accès</span>
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
              ⬇️ Télécharger l'agent eID (.zip)
            </a>

            <div className="bg-surface border rounded-2xl p-6 space-y-4 text-sm">
              <h2 className="font-semibold text-ink">Installation (une fois)</h2>
              <ol className="list-decimal ml-5 space-y-2 text-ink-secondary">
                <li><strong className="text-ink">Décompresse</strong> le zip → dossier <code className="bg-surface-2 px-1 rounded">vdsoft-eid-agent</code> (ex. dans <code className="bg-surface-2 px-1 rounded">C:\EidAgent</code>).</li>
                <li>Branche le <strong className="text-ink">lecteur de carte</strong> (USB) sur ce PC.</li>
                <li>Clic droit sur <code className="bg-surface-2 px-1 rounded">install-autostart.bat</code> → <strong className="text-ink">Exécuter en tant qu'administrateur</strong>.<br/>
                  <span className="text-ink-muted">→ installe les dépendances, démarre l'agent, et le fait <strong>redémarrer tout seul</strong> à chaque ouverture de session.</span></li>
                <li>Vérifie : ouvre <code className="bg-surface-2 px-1 rounded">http://localhost:7181/health</code> (carte insérée → <code className="bg-surface-2 px-1 rounded">cardPresent: true</code>).</li>
              </ol>

              <h2 className="font-semibold text-ink pt-2">Écran client (kiosque)</h2>
              <p className="text-ink-secondary">Ouvre Chrome en plein écran sur cette adresse (le <code className="bg-surface-2 px-1 rounded">?eid=…</code> active le vrai lecteur) :</p>
              <code className="block bg-surface-2 border rounded-lg p-3 text-xs break-all">
                https://app.verviersdepannage.com/caisse/ecran/facturation?eid=http://localhost:7181/read
              </code>

              <p className="text-ink-muted text-xs pt-2">
                Prérequis : Node.js installé (déjà présent si le PC fait tourner l'agent d'impression Zebra).
                Sans le <code className="bg-surface-2 px-0.5 rounded">?eid=…</code>, l'écran utilise une lecture de démonstration.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
