'use client'

import { useEffect, useMemo, useState } from 'react'
import { MessageView, toolResults, type ActionRow, type Message } from '@/components/assistant/MessageParts'

type Conv = { id: string; title: string; user_id: string; personne: string; created_at: string; updated_at: string; actions: Record<string, number> }
const fmt = (iso: string) => new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ACT_LABEL: Record<string, string> = { en_attente: 'en attente', faite: 'faite', annulee: 'annulée', echec: 'refusée', en_cours: 'en cours' }

export default function MaxEchangesClient() {
  const [convs, setConvs] = useState<Conv[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [who, setWho] = useState('tous')
  const [active, setActive] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ messages: Message[]; actions: ActionRow[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [cout, setCout] = useState<any[] | null>(null)

  useEffect(() => {
    fetch('/api/admin/max-conversations', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j.error) setError(j.error); else setConvs(j.conversations || []) }).catch(e => setError(e.message))
  }, [])
  useEffect(() => {
    fetch('/api/admin/max-conversations?cout=1', { cache: 'no-store' }).then(r => r.json()).then(j => setCout(j.mois || [])).catch(() => setCout([]))
  }, [])
  useEffect(() => {
    if (!active) { setDetail(null); return }
    setLoading(true)
    fetch(`/api/admin/max-conversations?id=${active}`, { cache: 'no-store' }).then(r => r.json()).then(j => setDetail({ messages: j.messages || [], actions: j.actions || [] })).finally(() => setLoading(false))
  }, [active])

  const people = useMemo(() => Array.from(new Set((convs || []).map(c => c.personne))).sort(), [convs])
  const shown = (convs || []).filter(c => who === 'tous' || c.personne === who)
  const actions = Object.fromEntries((detail?.actions || []).map(a => [a.id, a]))
  const results = detail ? toolResults(detail.messages) : {}

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/max/max.jpg" alt="" className="w-12 h-12 rounded-full object-cover border-2 border-orange-500" />
        <div>
          <h1 className="text-ink font-bold text-2xl">Conversations de Max</h1>
          <p className="text-ink-muted text-sm">Toutes les conversations du bureau avec Max, en lecture seule : questions, réponses, recherches faites et corrections proposées, confirmées ou annulées.</p>
        </div>
      </div>
      <section className="bg-surface border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-ink mb-1">Coût de Max</h2>
        <p className="text-xs text-ink-muted mb-3">Coût de l’IA facturé par le fournisseur, en dollars, par mois et par personne. Le récap du mois écoulé t’arrive sur Telegram le 1er du mois.</p>
        {cout === null && <p className="text-sm text-ink-faint">Calcul…</p>}
        {cout && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-ink-secondary text-xs"><th className="py-1.5 pr-3">Mois</th><th className="py-1.5 pr-3 text-right">Coût</th><th className="py-1.5 pr-3 text-right">Questions</th><th className="py-1.5">Par personne</th></tr></thead>
              <tbody>
                {cout.map((m: any) => (
                  <tr key={m.mois} className="border-t align-top">
                    <td className="py-2 pr-3 font-medium text-ink capitalize">{m.libelle}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-ink">{m.cout_usd.toFixed(2)} $</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.questions}</td>
                    <td className="py-2 text-ink-secondary">{m.personnes.length ? m.personnes.map((p: any) => `${p.nom} ${p.cout_usd.toFixed(2)} $ (${p.questions})`).join(' · ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {error && <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Impossible de charger les conversations : {error}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="who" className="text-sm text-ink-secondary">Personne</label>
        <select id="who" value={who} onChange={e => { setWho(e.target.value); setActive(null) }} className="h-11 rounded-lg border bg-surface px-3 text-sm text-ink">
          <option value="tous">Tout le monde</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="text-xs text-ink-faint">{shown.length} conversation{shown.length > 1 ? 's' : ''}</span>
      </div>
      <div className="grid lg:grid-cols-[320px_1fr] gap-4 items-start">
        <div className="bg-surface border rounded-xl overflow-hidden max-h-[75vh] overflow-y-auto">
          {convs === null && !error && <p className="p-4 text-sm text-ink-faint">Chargement…</p>}
          {convs && shown.length === 0 && <p className="p-4 text-sm text-ink-faint">Aucune conversation pour l’instant.</p>}
          {shown.map(c => {
            const n = Object.entries(c.actions).map(([k, v]) => `${v} ${ACT_LABEL[k] || k}`).join(' · ')
            return (
              <button key={c.id} onClick={() => setActive(c.id)} className={`w-full text-left px-3 py-2.5 border-b min-h-[44px] hover:bg-surface-2 ${active === c.id ? 'bg-surface-2 border-l-4 border-l-teal-700' : ''}`}>
                <p className="text-sm font-semibold text-ink">{c.personne}</p>
                <p className="text-sm text-ink-secondary truncate">{c.title}</p>
                <p className="text-[11px] text-ink-faint">{fmt(c.updated_at)}{n ? ` · corrections : ${n}` : ''}</p>
              </button>
            )
          })}
        </div>
        <div className="bg-surface-2 border rounded-xl p-4 min-h-[300px] space-y-3 min-w-0">
          {!active && <p className="text-sm text-ink-faint">Choisis une conversation à gauche.</p>}
          {active && loading && <p className="text-sm text-ink-faint">Chargement…</p>}
          {active && detail && !loading && detail.messages.length === 0 && <p className="text-sm text-ink-faint">Conversation vide.</p>}
          {active && detail && !loading && detail.messages.map(m => (
            <MessageView key={m.id} message={m} results={results} actions={actions} deciding={null} onDecide={() => {}} readOnly />
          ))}
        </div>
      </div>
    </div>
  )
}
