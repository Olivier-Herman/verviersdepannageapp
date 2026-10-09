'use client'
// Suivi des tailles (module temporaire, 09/10/2026) : qui a répondu à Sam, totaux par
// taille, relance, exclusion d'une personne (ex. fin de contrat), clôture de la demande.
import { Fragment, useEffect, useState } from 'react'

type Row = { id: string; name: string; role: string; excluded: boolean; tshirt: string | null; pull: string | null; answered_at: string | null }
type State = { campagne: { active: boolean }; rows: Row[]; totals: { size: string; tshirt: number; pull: number }[] }

export default function VetementsClient() {
  const [s, setS] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const load = () => fetch('/api/vetements/admin', { cache: 'no-store' }).then(r => r.json()).then(setS).catch(() => setMsg('Chargement impossible.'))
  useEffect(() => { load() }, [])
  const act = async (action: string, user_id?: string) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/vetements/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, user_id }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur')
      setS(j); if (action === 'remind') setMsg(`Relance envoyée à ${j.reminded} personne(s).`)
    } catch (e: any) { setMsg(e?.message || 'Erreur') } finally { setBusy(false) }
  }
  if (!s) return <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-ink-muted">{msg || 'Chargement…'}</div>
  const active = s.rows.filter(r => !r.excluded)
  const answered = active.filter(r => r.tshirt)
  const waiting = active.filter(r => !r.tshirt)
  const order = () => {
    const lines = ['Commande Verviers Dépannage — pulls et t-shirts', '', 'T-shirts : ' + s.totals.filter(t => t.tshirt).map(t => `${t.tshirt} × ${t.size}`).join(', '), 'Pulls : ' + s.totals.filter(t => t.pull).map(t => `${t.pull} × ${t.size}`).join(', '), '', ...answered.map(r => `${r.name} : t-shirt ${r.tshirt}, pull ${r.pull}`)]
    const txt = lines.join('\n')
    navigator.clipboard?.writeText(txt).then(() => setMsg('Commande copiée : colle-la dans ton mail au fournisseur.'), () => setMsg(txt))
  }
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">Module temporaire</p>
          <h1 className="text-2xl font-extrabold text-ink">Commande pulls et t-shirts</h1>
          <p className="text-sm text-ink-secondary">Sam demande la taille de t-shirt et de pull à chaque membre du personnel à l’ouverture de l’app. Réponse obligatoire.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" disabled={busy || !waiting.length || !s.campagne.active} onClick={() => act('remind')} className="min-h-[44px] px-4 rounded-xl border border-strong bg-surface font-bold text-sm text-ink disabled:opacity-50">Relancer ceux qui n’ont pas répondu</button>
          <button type="button" disabled={!answered.length} onClick={order} className="min-h-[44px] px-4 rounded-xl bg-brand text-white font-extrabold text-sm disabled:opacity-50">Copier la commande pour le fournisseur</button>
        </div>
      </div>
      {msg && <p className="rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm text-ink-secondary whitespace-pre-wrap">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="bg-surface border border-border rounded-2xl p-4"><p className="text-sm text-ink-muted">Ont répondu</p><p className="text-3xl font-extrabold text-ink">{answered.length} / {active.length}</p></div>
        <div className="bg-surface border border-border rounded-2xl p-4"><p className="text-sm text-ink-muted">En attente</p><p className="text-3xl font-extrabold text-red-700">{waiting.length}</p></div>
        <div className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-2">
          <p className="text-sm text-ink-muted">Demande</p>
          <p className="font-bold text-ink">{s.campagne.active ? 'Ouverte : Sam la pose à l’ouverture de l’app' : 'Clôturée : plus affichée'}</p>
          <button type="button" disabled={busy} onClick={() => act(s.campagne.active ? 'close' : 'open')} className="self-start min-h-[40px] px-3 rounded-lg border border-strong text-sm font-semibold text-ink">{s.campagne.active ? 'Clôturer la demande' : 'Rouvrir la demande'}</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 items-start">
        <div className="flex-[999_1_520px] min-w-0 bg-surface border border-border rounded-2xl overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-ink-muted"><th className="px-4 py-3">Personne</th><th className="px-4 py-3">T-shirt</th><th className="px-4 py-3">Pull</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>
              {s.rows.map(r => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-semibold text-ink">{r.name}</td>
                  <td className="px-4 py-2.5 font-extrabold text-ink">{r.tshirt || '—'}</td>
                  <td className="px-4 py-2.5 font-extrabold text-ink">{r.pull || '—'}</td>
                  <td className="px-4 py-2.5">{r.excluded ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">Pas concerné</span> : r.tshirt ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800">Répondu</span> : <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800">En attente</span>}</td>
                  <td className="px-4 py-2.5 text-right"><button type="button" disabled={busy} onClick={() => act(r.excluded ? 'include' : 'exclude', r.id)} className="min-h-[36px] px-3 rounded-lg border border-strong text-xs font-semibold text-ink">{r.excluded ? 'Inclure' : 'Pas concerné'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex-[1_1_260px] bg-surface border border-border rounded-2xl p-4 space-y-3">
          <p className="font-extrabold text-ink">Total à commander</p>
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1.5 text-sm">
            <span className="text-xs font-bold text-ink-muted">TAILLE</span><span className="text-xs font-bold text-ink-muted">T-SHIRTS</span><span className="text-xs font-bold text-ink-muted">PULLS</span>
            {s.totals.map(t => <Fragment key={t.size}><span className="font-bold text-ink">{t.size}</span><span className="text-right text-ink">{t.tshirt}</span><span className="text-right text-ink">{t.pull}</span></Fragment>)}
          </div>
          <p className="text-xs text-ink-muted">Les personnes en attente ne sont pas encore comptées.</p>
        </div>
      </div>
    </div>
  )
}
