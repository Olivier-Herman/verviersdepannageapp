'use client'
// Encadré « Appels » sur la fiche (Olivier 24/11/2026) : appels Teams rattachés à la fiche (et à ses étapes), notes
// « En appel », numéros retenus. Réservé au bureau (l'API répond 403 aux autres : rien d'affiché).
// Bouton « En appel » : pendant un appel, noter le motif ; le numéro arrive tout de suite s'il a été transmis par Teams
// au décroché, sinon environ 30 min après la fin (cf completerNotes dans src/lib/appels-fiches.ts).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, PhoneCall, X, Loader2 } from 'lucide-react'
import { dureeTxt, quandTxt, pastilleSens } from '@/components/appels/format'

interface A { id: string; debut: string; sens: string; perdu: boolean; service: string | null; numero_lisible: string; duree_s: number; resume: string; lien: string; motif?: string; note?: boolean }
interface D { appels: A[]; numeros: { numero8: string; numero: string }[]; motifs: string[]; numero_decroche: string | null }

function FenetreEnAppel({ missionId, motifs, numero, onFerme, onFait }: { missionId: string; motifs: string[]; numero: string | null; onFerme: () => void; onFait: (msg: string) => void }) {
  const [motif, setMotif] = useState<string | null>(null)
  const [texte, setTexte] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const enregistrer = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/appels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'noter', mission_id: missionId, motif, texte }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Enregistrement impossible')
      onFait(j.numero
        ? `Appel noté avec le ${j.numero}${j.fiche === 'rempli' ? ', recopié comme téléphone du client' : ''}.`
        : 'Appel noté. Le numéro sera ajouté environ 30 minutes après la fin de l’appel.')
    } catch (e: any) { setErr(e.message); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Noter l’appel en cours">
      <div className="w-full max-w-lg bg-surface rounded-2xl border shadow-xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-ink">Appel en cours</h3>
            <p className="text-sm text-ink-secondary">{numero ? `Numéro : ${numero}` : 'Numéro : il sera ajouté après l’appel (environ 30 min).'}</p>
          </div>
          <button type="button" onClick={onFerme} aria-label="Fermer" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-ink-muted hover:bg-surface-hover"><X size={18} /></button>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Motif</span>
          <div className="flex flex-wrap gap-2">
            {motifs.map(m => (
              <button key={m} type="button" onClick={() => setMotif(motif === m ? null : m)}
                className={`min-h-[44px] px-3 rounded-full text-sm font-medium ${motif === m ? 'bg-blue-700 text-white border border-blue-700' : 'border bg-surface text-ink hover:bg-surface-hover'}`}>{m}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Détails (facultatif)</span>
          <textarea value={texte} onChange={e => setTexte(e.target.value)} rows={3} placeholder="Ce que l’appelant demande, ce qui a été convenu…"
            className="rounded-lg border bg-surface-2 px-3 py-2 text-sm text-ink outline-none" />
        </label>
        {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onFerme} className="min-h-[44px] px-4 rounded-lg border bg-surface text-sm font-medium text-ink hover:bg-surface-hover">Annuler</button>
          <button type="button" disabled={busy || (!motif && !texte.trim())} onClick={enregistrer}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-700">
            {busy && <Loader2 size={15} className="animate-spin" />}Enregistrer sur la fiche
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AppelsFiche({ missionId }: { missionId: string }) {
  const [d, setD] = useState<D | null>(null)
  const [cache, setCache] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirme, setConfirme] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [fenetre, setFenetre] = useState(false)
  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/appels?mission=${missionId}`, { cache: 'no-store' })
      if (r.status === 403) { setCache(true); return }
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Chargement impossible')
      setD(j); setErr(null)
    } catch (e: any) { setErr(e.message) }
  }, [missionId])
  useEffect(() => { charger() }, [charger])

  const agir = async (corps: any, cle: string) => {
    setBusy(cle)
    try {
      const r = await fetch('/api/appels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Action impossible')
      setConfirme(null); await charger()
    } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  // Ouvrir la fenêtre relit le dernier numéro transmis au décroché.
  const ouvrir = async () => { await charger(); setMsg(null); setFenetre(true) }

  if (cache) return null
  if (err && !d) return <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">Appels : {err} <button type="button" onClick={charger} className="underline font-semibold">Réessayer</button></p>
  if (!d) return null
  const appels = d.appels.filter(a => !a.note)
  const total = appels.filter(a => !a.perdu).reduce((s, a) => s + a.duree_s, 0)

  return (
    <section className="bg-surface border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold text-ink"><Phone size={18} /> Appels ({appels.length})</h3>
        <div className="flex flex-wrap items-center gap-3">
          {total > 0 && <span className="text-sm text-ink-secondary">Au téléphone sur ce dossier : {dureeTxt(total)}</span>}
          <button type="button" onClick={ouvrir} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-sm font-semibold bg-green-700 text-white hover:bg-green-800">
            <PhoneCall size={16} /> En appel
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-green-800 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}
      {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      {!d.appels.length && <p className="text-sm text-ink-muted">Aucun appel sur cette fiche. Pendant un appel, touchez « En appel » pour noter le motif.</p>}
      {d.appels.length > 0 && (
        <div className="flex flex-col">
          {d.appels.map(a => { const p = pastilleSens(a.sens, a.perdu); return (
            <div key={a.id} className="grid grid-cols-[96px_64px_minmax(0,1fr)_auto] gap-2.5 items-start py-2.5 border-t text-sm">
              <span className="text-ink-secondary">{quandTxt(a.debut)}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full justify-self-start ${p.cls}`}>{p.txt}</span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-ink">{a.numero_lisible}{a.service ? ` · ${a.service}` : ''}</span>
                {a.motif && <span className="text-ink font-medium">{a.motif}</span>}
                <span className="text-xs text-ink-secondary">{a.resume} · {a.lien}</span>
              </span>
              <span className="flex items-center gap-1 justify-end">
                <span className="text-ink-secondary">{a.note || a.perdu ? '—' : dureeTxt(a.duree_s)}</span>
                {a.note ? null : confirme === a.id ? (
                  <>
                    <button type="button" disabled={!!busy} onClick={() => agir({ action: 'detacher', appel_id: a.id }, a.id)} className="min-h-[44px] px-3 rounded-lg bg-red-700 text-white text-xs font-semibold disabled:opacity-40">
                      {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : 'Détacher'}
                    </button>
                    <button type="button" onClick={() => setConfirme(null)} className="min-h-[44px] px-3 rounded-lg border text-xs font-semibold text-ink">Garder</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirme(a.id)} aria-label="Détacher cet appel de la fiche" title="Détacher cet appel de la fiche"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-ink-muted hover:bg-surface-hover hover:text-ink"><X size={16} /></button>
                )}
              </span>
            </div>
          ) })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/appels" className="inline-flex items-center min-h-[44px] px-4 rounded-lg border bg-surface text-sm font-medium text-ink hover:bg-surface-hover">Rattacher un autre appel</Link>
      </div>
      {d.numeros.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
          <span>Numéros retenus pour cette fiche (leurs prochains appels s’y rattachent tout seuls) :</span>
          {d.numeros.map(n => (
            <span key={n.numero8} className="inline-flex items-center gap-1 rounded-full border bg-surface-2 pl-2.5">
              {n.numero}
              <button type="button" disabled={!!busy} onClick={() => agir({ action: 'oublier', numero8: n.numero8, mission_id: missionId }, n.numero8)}
                aria-label={`Ne plus retenir ${n.numero}`} title="Ne plus retenir ce numéro" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-full hover:bg-surface-hover"><X size={14} /></button>
            </span>
          ))}
        </div>
      )}
      {fenetre && <FenetreEnAppel missionId={missionId} motifs={d.motifs || []} numero={d.numero_decroche}
        onFerme={() => setFenetre(false)} onFait={m => { setFenetre(false); setMsg(m); charger() }} />}
    </section>
  )
}
