'use client'
// src/app/admin/bureau-du-jour/BureauClient.tsx — Bureau du jour (Olivier 17/10/2026).
// Les 10 étapes de la réunion bureau, en direct (rafraîchi chaque minute) : chaque bloc résume, liste et renvoie
// vers l'écran où l'on agit. Les décisions des agents se valident d'ici (même circuit que « Propositions des agents »).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw } from 'lucide-react'

type Niveau = 'ok' | 'info' | 'attention' | 'urgent'
type Ligne = { texte: string; detail?: string; montant?: number | null; niveau?: Niveau; lien?: string; id?: string; kind?: string; choix?: { key: string; label: string }[] }
type Bloc = { cle: string; titre: string; resume: string; niveau: Niveau; lignes: Ligne[]; lien?: string; erreur?: string }

const PASTILLE: Record<Niveau, string> = {
  ok: 'bg-green-50 text-green-800', info: 'bg-blue-50 text-blue-800', attention: 'bg-amber-50 text-amber-800', urgent: 'bg-red-50 text-red-800',
}
const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export default function BureauClient() {
  const [blocs, setBlocs] = useState<Bloc[] | null>(null)
  const [at, setAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [cur, setCur] = useState('agents')
  const [busy, setBusy] = useState<string | null>(null)
  const [refus, setRefus] = useState<{ id: string; texte: string } | null>(null)
  const [msg, setMsg] = useState('')

  const charger = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/admin/bureau-du-jour', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Chargement impossible')
      setBlocs(j.blocs); setAt(j.at)
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { charger(); const t = setInterval(charger, 60_000); return () => clearInterval(t) }, [charger])

  async function decide(body: any, ok: string) {
    setBusy(body.id); setMsg('')
    try {
      const r = await fetch('/api/admin/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'Action impossible')
      setMsg(j.note || ok); setRefus(null); charger()
    } catch (e: any) { setMsg(`Erreur : ${e.message}`) } finally { setBusy(null) }
  }

  const bloc = blocs?.find(b => b.cle === cur)
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Bureau du jour <span className="ml-1 rounded-full bg-surface-hover px-2 py-0.5 align-middle text-xs font-semibold text-ink-secondary">🔒 Mobi seul</span></h1>
          <p className="mt-1 text-sm text-ink-secondary">La réunion bureau en un écran, mise à jour chaque minute. Chaque bloc t’emmène là où on agit.</p>
        </div>
        <button onClick={charger} disabled={loading} className="flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-sm font-semibold text-ink disabled:opacity-50">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {at ? `Mis à jour à ${new Date(at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}` : 'Actualiser'}
        </button>
      </div>

      {err && <div className="mt-4 rounded-card bg-red-50 p-3 text-sm text-red-800">{err}</div>}
      {msg && <div className="mt-4 rounded-card bg-blue-50 p-3 text-sm text-blue-900">{msg}</div>}

      {!blocs ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-ink-muted"><Loader2 className="animate-spin" size={18} /> Les agents rassemblent le bureau du jour…</div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[260px_1fr]">
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {blocs.map((b, i) => (
              <button key={b.cle} onClick={() => setCur(b.cle)}
                className={`min-h-[52px] shrink-0 rounded-xl border px-3 py-2 text-left ${cur === b.cle ? 'border-brand bg-surface ring-1 ring-brand' : 'bg-surface'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">{i + 1}. {b.titre}</span>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${b.niveau === 'urgent' ? 'bg-red-600' : b.niveau === 'attention' ? 'bg-amber-500' : b.niveau === 'info' ? 'bg-blue-500' : 'bg-green-600'}`} />
                </div>
                <div className="mt-0.5 whitespace-nowrap text-xs text-ink-secondary lg:whitespace-normal">{b.resume}</div>
              </button>
            ))}
          </nav>

          {bloc && (
            <section className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-ink">{bloc.titre}</h2>
                {bloc.lien && <Link href={bloc.lien} className="min-h-[40px] rounded-lg border px-3 py-2 text-sm font-semibold text-brand">Ouvrir l’écran →</Link>}
              </div>
              {bloc.erreur && <div className="rounded-card bg-red-50 p-3 text-sm text-red-800">Bloc indisponible : {bloc.erreur}</div>}
              {!bloc.erreur && !bloc.lignes.length && <div className="rounded-card border border-dashed p-4 text-sm text-ink-muted">Rien à signaler.</div>}
              {bloc.lignes.map((l, i) => (
                <div key={l.id || i} className="grid gap-2 rounded-card border bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{l.texte}</div>
                      {l.detail && <div className="mt-0.5 whitespace-pre-line text-sm text-ink-secondary">{l.detail}</div>}
                    </div>
                    <div className="grid shrink-0 justify-items-end gap-1">
                      {l.montant != null && <span className="font-mono font-semibold tabular-nums text-ink">{eur(l.montant)}</span>}
                      {l.niveau && l.niveau !== 'info' && <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${PASTILLE[l.niveau]}`}>{l.niveau === 'urgent' ? 'Urgent' : l.niveau === 'attention' ? 'À voir' : 'OK'}</span>}
                    </div>
                  </div>
                  {bloc.cle === 'decisions' && l.id && (
                    <div className="flex flex-wrap gap-2">
                      {l.kind === 'question_olivier'
                        ? (l.choix || []).map(c => <button key={c.key} disabled={!!busy} onClick={() => decide({ op: 'answer', id: l.id, choix: c.key }, 'Réponse enregistrée')} className="min-h-[44px] rounded-lg border px-3 text-sm font-semibold text-ink disabled:opacity-50">{c.label}</button>)
                        : <>
                            <button disabled={!!busy} onClick={() => decide({ op: 'decide', id: l.id, action: 'valider' }, 'Validé : l’agent exécute')} className="flex min-h-[44px] items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white disabled:opacity-50">{busy === l.id && <Loader2 size={14} className="animate-spin" />}Valider</button>
                            <button disabled={!!busy} onClick={() => setRefus({ id: l.id!, texte: '' })} className="min-h-[44px] rounded-lg border px-3 text-sm font-semibold text-red-800">Refuser…</button>
                          </>}
                    </div>
                  )}
                  {refus && refus.id === l.id && (
                    <div className="flex flex-wrap gap-2">
                      <input value={refus.texte} onChange={e => setRefus({ id: refus.id, texte: e.target.value })} placeholder="Motif du refus (appris par l’agent)" className="min-h-[44px] flex-1 rounded-lg border bg-surface px-3 text-sm text-ink" />
                      <button disabled={!refus.texte.trim() || !!busy} onClick={() => decide({ op: 'decide', id: l.id, action: 'refuser', text: refus?.texte }, 'Refusé')} className="min-h-[44px] rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50">Confirmer le refus</button>
                      <button onClick={() => setRefus(null)} className="min-h-[44px] rounded-lg border px-3 text-sm font-semibold text-ink">Annuler</button>
                    </div>
                  )}
                  {l.lien && bloc.cle !== 'decisions' && <Link href={l.lien} className="justify-self-start text-sm font-semibold text-brand">Ouvrir →</Link>}
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
