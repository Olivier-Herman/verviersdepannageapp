'use client'

// Onglet « À regarder » de Max (Olivier 14/10/2026, maquette validée) : une carte par mission
// figée, avec l'explicatif détaillé (faits, raisonnement, points à vérifier), les réponses en
// boutons et « ✍️ Autre chose » qui passe la main à la discussion. Les commandes « à trier »
// (Car Parts) sont regroupées dans une seule liste « À faire / Déjà fait ».
import { useState } from 'react'

export interface VeilleCardData {
  id: string; kind: 'figee_attribuee' | 'figee_sans_chauffeur' | 'tri_commandes'
  mission: { id: string; numero: number | null; plaque: string | null; type: string | null; source: string | null; statut: string; lieu: string | null; destination: string | null; chauffeur: string | null; recue: string | null }
  depuis_h: number; attribuee_par: string | null; pour_moi: boolean
  titre: string; message: string; faits: string[]; raisonnement: string[]; alertes: string[]; verifie: string[]
  reponses: { id: string; libelle: string; effet: string; principale?: boolean }[]
}

const Face = ({ size = 8 }: { size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/max/max.jpg" alt="" className={`rounded-full object-cover flex-none ${size === 8 ? 'w-8 h-8' : 'w-7 h-7'}`} />
)

export default function MaxVeille({ cards, onAnswer, onOther }: {
  cards: VeilleCardData[]
  onAnswer: (card: VeilleCardData, reponse: string) => Promise<string>
  onOther: (card: VeilleCardData, texte: string) => Promise<void>
}) {
  const [done, setDone] = useState<Record<string, { label: string; msg: string; error?: boolean }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [explain, setExplain] = useState<Record<string, string | undefined>>({})
  const answer = async (c: VeilleCardData, r: { id: string; libelle: string }) => {
    if (busy) return
    setBusy(c.id)
    try { const msg = await onAnswer(c, r.id); setDone(d => ({ ...d, [c.id]: { label: r.libelle, msg } })) }
    catch (e: any) { setDone(d => ({ ...d, [c.id]: { label: r.libelle, msg: `😕 ${e.message}`, error: true } })) }
    finally { setBusy(null) }
  }
  const figees = cards.filter(c => c.kind !== 'tri_commandes')
  const tri = cards.filter(c => c.kind === 'tri_commandes')

  return (
    <div className="space-y-3">
      {figees.length === 0 && tri.length === 0 && <p className="text-sm text-ink-muted px-1">Rien à regarder pour l’instant 👌</p>}
      {figees.map(c => {
        const d = done[c.id]
        return (
          <section key={c.id} className={`rounded-2xl border bg-surface-2 p-3 ${c.pour_moi && !d ? 'border-2 border-red-600' : ''}`}>
            <p className="text-[12.5px] text-ink-secondary flex flex-wrap gap-x-1.5">
              <span className="font-mono font-semibold text-ink">{c.mission.plaque || `#${c.mission.numero}`}</span>
              <span>· {c.titre}</span>
            </p>
            <div className="flex gap-2 mt-2">
              <Face />
              <p className="text-sm text-ink">{c.message}</p>
            </div>
            <details className="mt-2 ml-10 rounded-xl border bg-surface px-3 py-2 text-[13px] text-ink" open>
              <summary className="cursor-pointer font-semibold min-h-[28px]">📋 Ce que j’ai trouvé</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">{c.faits.map((f, i) => <li key={i}>{f}</li>)}</ul>
              {c.raisonnement.length > 0 && <>
                <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-secondary">Ce que j’en pense</p>
                <ul className="list-disc pl-4 space-y-0.5">{c.raisonnement.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </>}
              {c.alertes.map((a, i) => <p key={i} className="mt-2 rounded-lg bg-amber-50 text-amber-900 px-2 py-1.5">⚠️ {a}</p>)}
              {!d && <>
                <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-secondary">Ce que chaque réponse va faire</p>
                <ul className="list-disc pl-4 space-y-0.5">{c.reponses.map(r => <li key={r.id}><b>{r.libelle}</b> : {r.effet}</li>)}<li><b>✍️ Autre chose</b> : tu m’expliques, je te dis ce que j’ai compris et je te propose l’action à confirmer.</li></ul>
              </>}
              <p className="mt-2 text-[12px] text-green-800">✔ vérifié : {c.verifie.join(' · ')}</p>
            </details>
            {!d && explain[c.id] === undefined && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-10">
                {c.reponses.map(r => (
                  <button key={r.id} disabled={!!busy} onClick={() => answer(c, r)}
                    className={`min-h-[44px] px-3 rounded-xl text-[13.5px] font-semibold border disabled:opacity-50 ${r.principale ? 'bg-teal-700 text-white border-teal-700' : 'bg-surface text-teal-800 border-teal-700'}`}>{r.libelle}</button>
                ))}
                <button disabled={!!busy} onClick={() => setExplain(e => ({ ...e, [c.id]: '' }))} className="min-h-[44px] px-3 rounded-xl text-[13.5px] font-semibold border bg-surface text-teal-800 border-teal-700">✍️ Autre chose</button>
              </div>
            )}
            {!d && explain[c.id] !== undefined && (
              <form className="flex gap-1.5 mt-2 ml-10" onSubmit={async e => { e.preventDefault(); const t = (explain[c.id] || '').trim(); if (!t) return; setBusy(c.id); try { await onOther(c, t); setDone(x => ({ ...x, [c.id]: { label: '✍️ Autre chose', msg: 'Je t’ai répondu dans la discussion 👉' } })) } finally { setBusy(null) } }}>
                <textarea autoFocus value={explain[c.id]} onChange={e => setExplain(x => ({ ...x, [c.id]: e.target.value }))} placeholder="Explique-moi ce qui se passe, je m’en occupe…"
                  className="flex-1 min-w-0 min-h-[64px] rounded-xl border border-teal-700 bg-surface px-3 py-2 text-sm text-ink" />
                <button disabled={!!busy} aria-label="Envoyer" className="w-12 rounded-xl bg-teal-700 text-white text-lg disabled:opacity-50">➤</button>
              </form>
            )}
            {d && (
              <div className="mt-2 ml-10">
                <p className={`text-[13px] font-semibold ${d.error ? 'text-red-700' : 'text-green-800'}`}>{d.error ? '✗' : '✓'} {d.label}</p>
                <div className="flex gap-2 mt-1"><Face size={7} /><p className="text-sm text-ink">{d.msg}</p></div>
              </div>
            )}
            {!d && <p className="mt-1.5 ml-10 text-[12px] text-ink-muted">{c.pour_moi ? `Pourquoi toi : c’est toi qui l’as attribuée${c.mission.chauffeur ? ` à ${c.mission.chauffeur}` : ''}.` : 'Pourquoi toi : personne ne l’a attribuée, tu es au bureau maintenant.'}</p>}
          </section>
        )
      })}

      {tri.length > 0 && (
        <section className="rounded-2xl border bg-surface-2 p-3">
          <div className="flex gap-2"><Face /><p className="text-sm text-ink"><b>{tri.length} commande{tri.length > 1 ? 's' : ''} {tri[0].mission.source ? 'garage' : ''} en attente</b>, parfois depuis des semaines. Tu me dis lesquelles sont encore à faire ? <b>Déjà fait</b> la passe en « à facturer ».</p></div>
          <ul className="mt-2 ml-10 divide-y rounded-xl border bg-surface">
            {tri.map(c => {
              const d = done[c.id]
              return (
                <li key={c.id} className="px-3 py-2 text-[13px] flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-[160px]"><b>#{c.mission.numero}</b> · {c.mission.plaque || '—'} · {c.mission.type} · {c.mission.lieu || '—'}{c.mission.destination ? ` → ${c.mission.destination}` : ''} <span className="text-ink-muted">· depuis {Math.round(c.depuis_h / 24)} j</span></span>
                  {d ? <span className={`font-semibold ${d.error ? 'text-red-700' : 'text-green-800'}`}>{d.error ? d.msg : `✓ ${d.label}`}</span> : (
                    <span className="flex gap-1.5">
                      {c.reponses.map(r => <button key={r.id} disabled={!!busy} onClick={() => answer(c, r)} className={`min-h-[40px] px-3 rounded-lg text-[12.5px] font-semibold border disabled:opacity-50 ${r.principale ? 'bg-teal-700 text-white border-teal-700' : 'bg-surface text-teal-800 border-teal-700'}`}>{r.libelle}</button>)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
