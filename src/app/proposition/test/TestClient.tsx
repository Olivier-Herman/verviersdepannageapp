'use client'
import { useState }  from 'react'
import { useRouter } from 'next/navigation'

export default function TestClient({ phoneEnd }: { phoneEnd: string | null }) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    if (sending) return
    setSending(true); setError(null)
    try {
      const r = await fetch('/api/market-proposals/test', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.id) throw new Error(j.error || 'Test non lancé, réessaie.')
      router.push(`/proposition/${j.id}`)
    } catch (e: any) {
      setError(e?.message || 'Pas de connexion : réessaie.'); setSending(false)
    }
  }

  return (
    <div className="p-4 max-w-xl mx-auto space-y-4">
      <div>
        <h1 className="text-ink font-bold text-xl">🧪 Tester la garde de nuit</h1>
        <p className="text-ink-muted text-sm mt-1">Vérifie sur ton téléphone ce que reçoit un chauffeur de garde quand une mission lui est proposée la nuit.</p>
      </div>
      <div className="bg-surface border rounded-2xl p-4 space-y-2">
        <p className="text-ink font-semibold text-sm">Ce qui va se passer</p>
        <ol className="list-decimal pl-5 space-y-1 text-ink-secondary text-sm">
          <li>Tout de suite : une notification « 🧪 TEST — mission proposée ». Tape-la, ou reste sur la page qui s’ouvre.</li>
          <li>Si tu ne réponds pas dans les 2 minutes : ton téléphone sonne et, quand tu décroches, tu entends le message vocal.</li>
          <li>Après 4 minutes sans réponse : le test se termine. En vrai, la mission partirait chez la réserve.</li>
        </ol>
        <p className="text-ink-muted text-xs">Mission fictive : aucune vraie mission n’est créée, la réserve et le dispatch ne reçoivent rien.</p>
      </div>
      {phoneEnd
        ? <p className="text-ink-secondary text-sm">📞 L’appel partira vers ton numéro qui finit par <strong className="font-mono">{phoneEnd}</strong>.</p>
        : <p className="text-amber-800 dark:text-amber-300 text-sm bg-amber-50 dark:bg-amber-500/10 border border-amber-300 rounded-xl px-3 py-2">⚠️ Aucun numéro de téléphone sur ton compte : tu recevras la notification, mais pas l’appel.</p>}
      <button type="button" onClick={start} disabled={sending}
        className="w-full min-h-[56px] rounded-2xl bg-brand hover:bg-brand-hover disabled:opacity-60 text-white font-bold text-base">
        {sending ? '⏳ Lancement…' : '🧪 Lancer le test sur mon téléphone'}
      </button>
      {error && <p className="text-red-700 dark:text-red-300 text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 rounded-xl px-3 py-2">⚠️ {error}</p>}
      <p className="text-ink-faint text-xs text-center">Pour tester l’appel, ne réponds pas tout de suite : attends qu’il sonne (2 à 3 minutes).</p>
    </div>
  )
}
