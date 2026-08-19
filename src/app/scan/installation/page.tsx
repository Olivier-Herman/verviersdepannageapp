'use client'

// Page PUBLIQUE (hors middleware) d'installation de l'agent Scan sur un PC de
// bureau. Même code d'accès que l'agent eID (EID_DOWNLOAD_CODE) : on peut donc
// la faire depuis un poste NON connecté. Le téléchargement passe par
// /api/scan-agent qui revalide le code côté serveur.

import { useEffect, useState } from 'react'

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

            <AgentStatus />

            <div className="bg-surface border rounded-2xl p-6 space-y-4 text-sm">
              <h2 className="font-semibold text-ink">Installation Windows (une fois par PC)</h2>
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

              <h2 className="font-semibold text-ink pt-2">Installation macOS</h2>
              <p className="text-ink-secondary">
                Le paquet Windows ne s&apos;applique pas : sur Mac c&apos;est la version Node du même dossier
                qui tourne — même port, même comportement. Node 18+ requis, rien d&apos;autre.
              </p>
              <code className="block bg-surface-2 border rounded-lg p-3 text-xs break-all">
                cd vdsoft-scan-agent<br/>./install-mac.sh 192.168.1.50
              </code>
              <p className="text-ink-muted text-xs">
                Sans argument, l&apos;IP est demandée. Installe un LaunchAgent (démarrage à l&apos;ouverture de session).
                Sur Mac, l&apos;imprimante doit parler eSCL — si elle apparaît dans <em>Transfert d&apos;images</em>, c&apos;est bon.
                Utilise <strong className="text-ink">Chrome</strong> : Safari est plus strict sur l&apos;appel de <code className="bg-surface-2 px-0.5 rounded">http://localhost</code> depuis une page HTTPS.
              </p>

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

// ── État de l'agent sur CE poste ────────────────────────────────────────────
// Le bouton « Scanner » se cache tout seul quand l'agent ne répond pas : bien
// pour l'utilisateur, aveugle pour celui qui installe. Ce bloc dit ce que le
// navigateur voit vraiment, et permet d'essayer un scan sans quitter la page.
function AgentStatus() {
  const [state, setState] = useState<'checking' | 'off' | 'on'>('checking')
  const [info, setInfo]   = useState<any>(null)
  const [test, setTest]   = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)

  const probe = () => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2000)
    fetch('http://localhost:7182/health', { signal: ctrl.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.ok) { setInfo(j); setState('on') } else setState('off') })
      .catch(() => setState('off'))
      .finally(() => clearTimeout(t))
  }
  useEffect(() => { probe(); const i = setInterval(probe, 5000); return () => clearInterval(i) }, [])

  const tryScan = async () => {
    setBusy(true); setTest(null)
    try {
      const r = await fetch('http://localhost:7182/scan?source=flatbed&color=color&dpi=200', { cache: 'no-store' })
      const j = await r.json()
      setTest(j?.ok
        ? `✅ Scan réussi : ${j.files.length} fichier(s) — ${j.files[0]?.name}`
        : `❌ ${j?.error || 'échec'}`)
    } catch { setTest('❌ Agent injoignable.') } finally { setBusy(false) }
  }

  const canScan = !!(info?.escl || info?.wia)

  return (
    <div className="bg-surface border rounded-2xl p-5 space-y-3 text-sm">
      <h2 className="font-semibold text-ink">État sur ce poste</h2>

      {state === 'checking' && <p className="text-ink-muted">Recherche de l&apos;agent…</p>}

      {state === 'off' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <p className="text-amber-900 font-medium">Agent non détecté sur ce poste.</p>
          <p className="text-amber-800 text-xs">
            Rien n&apos;écoute sur <code className="bg-white/60 px-1 rounded">localhost:7182</code>. Dans l&apos;ordre, ce qui
            explique 9 cas sur 10 :
          </p>
          <ol className="list-decimal ml-5 text-xs text-amber-900 space-y-1">
            <li>Le zip a été <strong>ouvert sans être décompressé</strong> : Windows lance alors les fichiers depuis un
              dossier temporaire qui disparaît. Décompresse d&apos;abord dans <code className="bg-white/60 px-1 rounded">C:\VDSoft</code>.</li>
            <li><code className="bg-white/60 px-1 rounded">install-autostart.bat</code> lancé <strong>sans « Exécuter en tant qu&apos;administrateur »</strong> :
              la tâche de démarrage n&apos;est pas créée.</li>
            <li>Un antivirus a bloqué PowerShell.</li>
          </ol>
          <p className="text-amber-800 text-xs">
            Pour voir l&apos;erreur réelle : double-clique sur <strong>diagnostic.bat</strong> (fourni dans le zip). Il lance
            l&apos;agent dans une fenêtre visible et affiche ce qui coince. Laisse la fenêtre ouverte et recharge cette page.
          </p>
          <p className="text-amber-800 text-xs">
            Test direct dans le navigateur de ce poste :{' '}
            <a href="http://localhost:7182/health" target="_blank" rel="noreferrer" className="underline font-medium">http://localhost:7182/health</a>
          </p>
        </div>
      )}

      {state === 'on' && (
        <div className={`${canScan ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'} border rounded-xl p-3 space-y-1`}>
          <p className={canScan ? 'text-emerald-900 font-medium' : 'text-amber-900 font-medium'}>
            {canScan ? '✅ Agent actif — le bouton Scanner s’affiche dans les fiches.' : '⚠ Agent actif, mais aucun scanner joignable.'}
          </p>
          <p className="text-xs text-ink-secondary">
            Imprimante : <strong>{info?.printer || '— non configurée —'}</strong> ·
            {' '}eSCL : {info?.escl ? 'oui' : 'non'} · WIA : {info?.wia ? 'oui' : 'non'}
          </p>
          {!canScan && (
            <p className="text-amber-800 text-xs">
              Vérifie l&apos;adresse dans <code className="bg-surface-2 px-1 rounded">config.json</code>, et que l&apos;imprimante est allumée.
            </p>
          )}
          {canScan && (
            <div className="pt-1">
              <button onClick={tryScan} disabled={busy}
                className="px-3 py-1.5 bg-surface-2 border rounded-lg text-xs font-semibold text-ink hover:border-brand disabled:opacity-50">
                {busy ? '⏳ Scan en cours…' : '🧪 Tester un scan (depuis la vitre)'}
              </button>
              {test && <p className="text-xs mt-2 text-ink-secondary">{test}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
