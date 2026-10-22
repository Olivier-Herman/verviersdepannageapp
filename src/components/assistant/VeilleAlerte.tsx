'use client'

// Alerte du bureau SANS Max (Olivier 22/10/2026) : Momo, Axel et Matthieu n'ont plus Max mais
// reçoivent toujours ses questions (missions figées, commandes à trier) en alerte au milieu de
// l'écran. Réponses en boutons + « Je traite ça plus tard » : reproposée le jour ouvrable suivant
// vers 10 h 30. Fermeture uniquement par un bouton, jamais au clic sur le fond.
import { useEffect, useState } from 'react'
import type { VeilleCardData } from '@/components/assistant/MaxVeille'

export default function VeilleAlerte() {
  const [cards, setCards] = useState<VeilleCardData[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ label: string; msg: string; error?: boolean } | null>(null)

  useEffect(() => {
    let off = false
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const j = await fetch('/api/assistant/veille', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
        if (off || !j) return
        setCards(j.heures ? (j.cartes || []) : [])
      } catch {}
    }
    const first = setTimeout(load, 5000)
    const t = setInterval(load, 180_000)
    return () => { off = true; clearTimeout(first); clearInterval(t) }
  }, [])

  const figee = cards.find(c => c.kind !== 'tri_commandes')
  const tri = figee ? [] : cards.filter(c => c.kind === 'tri_commandes')
  if (!figee && !tri.length) return null

  const post = async (c: VeilleCardData, reponse: string): Promise<string> => {
    const r = await fetch(`/api/assistant/veille/${c.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reponse }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Erreur')
    return j.message || 'C’est noté.'
  }
  const answer = async (targets: VeilleCardData[], reponse: string, label: string) => {
    if (busy) return
    setBusy(true)
    try { const msgs = await Promise.all(targets.map(c => post(c, reponse))); setDone({ label, msg: msgs[0] }) }
    catch (e: any) { setDone({ label, msg: e.message, error: true }) }
    finally { setBusy(false) }
  }
  const next = () => {
    const gone = new Set((figee ? [figee] : tri).map(c => c.id))
    setCards(cs => cs.filter(c => !gone.has(c.id)))
    setDone(null)
  }
  const triAnswer = async (c: VeilleCardData, r: { id: string; libelle: string }) => {
    if (busy) return
    setBusy(true)
    try { await post(c, r.id); setCards(cs => cs.filter(x => x.id !== c.id)) }
    catch (e: any) { setDone({ label: r.libelle, msg: e.message, error: true }) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-surface border-2 border-amber-500 shadow-xl p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-amber-800">⚠️ À régler{cards.length > 1 ? ` · ${cards.length} en attente` : ''}</p>

        {figee && (
          <>
            <p className="mt-1 text-[13px] text-ink-secondary"><span className="font-mono font-semibold text-ink">{figee.mission.plaque || `#${figee.mission.numero}`}</span> · {figee.titre}</p>
            <p className="mt-2 text-[15px] text-ink">{figee.message}</p>
            <ul className="mt-2 list-disc pl-5 space-y-0.5 text-[13px] text-ink">{figee.faits.map((f, i) => <li key={i}>{f}</li>)}</ul>
            {figee.alertes.map((a, i) => <p key={i} className="mt-2 rounded-lg bg-amber-50 text-amber-900 px-2 py-1.5 text-[13px]">⚠️ {a}</p>)}
            {!done && (
              <ul className="mt-3 list-disc pl-5 space-y-0.5 text-[12.5px] text-ink-secondary">
                {figee.reponses.map(r => <li key={r.id}><b className="text-ink">{r.libelle}</b> : {r.effet}</li>)}
                <li><b className="text-ink">Je traite ça plus tard</b> : je te la repropose le jour ouvrable suivant vers 10 h 30.</li>
              </ul>
            )}
          </>
        )}

        {tri.length > 0 && (
          <>
            <p className="mt-2 text-[15px] text-ink"><b>{tri.length} commande{tri.length > 1 ? 's' : ''} en attente</b>, parfois depuis des semaines. Lesquelles sont encore à faire ?</p>
            <ul className="mt-2 divide-y rounded-xl border bg-surface-2">
              {tri.map(c => (
                <li key={c.id} className="px-3 py-2 text-[13px] text-ink flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-[160px]"><b>#{c.mission.numero}</b> · {c.mission.plaque || '—'} · {c.mission.lieu || '—'}{c.mission.destination ? ` → ${c.mission.destination}` : ''} <span className="text-ink-muted">· depuis {Math.round(c.depuis_h / 24)} j</span></span>
                  <span className="flex gap-1.5">
                    {c.reponses.map(r => <button key={r.id} disabled={busy} onClick={() => triAnswer(c, r)} className={`min-h-[44px] px-3 rounded-lg text-[12.5px] font-semibold border disabled:opacity-50 ${r.principale ? 'bg-teal-700 text-white border-teal-700' : 'bg-surface text-teal-800 border-teal-700'}`}>{r.libelle}</button>)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {done ? (
          <div className="mt-3">
            <p className={`text-[13px] font-semibold ${done.error ? 'text-red-700' : 'text-green-800'}`}>{done.error ? '✗' : '✓'} {done.label}</p>
            <p className="mt-1 text-sm text-ink">{done.msg}</p>
            <button onClick={next} className="mt-3 w-full min-h-[44px] rounded-xl bg-teal-700 text-white font-semibold">{cards.length > 1 ? 'Suivante' : 'Fermer'}</button>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {figee?.reponses.map(r => (
              <button key={r.id} disabled={busy} onClick={() => answer([figee], r.id, r.libelle)}
                className={`min-h-[44px] px-3 rounded-xl text-[13.5px] font-semibold border disabled:opacity-50 ${r.principale ? 'bg-teal-700 text-white border-teal-700' : 'bg-surface text-teal-800 border-teal-700'}`}>{r.libelle}</button>
            ))}
            <button disabled={busy} onClick={() => answer(figee ? [figee] : tri, 'plus_tard_demain', 'Je traite ça plus tard')}
              className="min-h-[44px] px-3 rounded-xl text-[13.5px] font-semibold border bg-surface text-ink-secondary border-ink-muted disabled:opacity-50">⏰ Je traite ça plus tard</button>
          </div>
        )}
      </div>
    </div>
  )
}
