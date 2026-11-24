'use client'
// Encadré « Appels » sur la fiche (Olivier 24/11/2026) : appels Teams rattachés à la fiche (et à ses étapes), numéros
// retenus. Rien d'affiché tant qu'aucun appel ni numéro n'est lié. Cf src/lib/appels-fiches.ts.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Phone, X, Loader2 } from 'lucide-react'
import { dureeTxt, quandTxt, pastilleSens } from '@/components/appels/format'

interface A { id: string; debut: string; sens: string; perdu: boolean; service: string | null; numero_lisible: string; duree_s: number; resume: string; lien: string }

export default function AppelsFiche({ missionId }: { missionId: string }) {
  const [d, setD] = useState<{ appels: A[]; numeros: { numero8: string; numero: string }[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirme, setConfirme] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const charger = useCallback(async () => {
    try {
      const r = await fetch(`/api/appels?mission=${missionId}`, { cache: 'no-store' })
      if (r.status === 403) { setD({ appels: [], numeros: [] }); return }
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

  if (err && !d) return <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">Appels : {err}</p>
  if (!d || (!d.appels.length && !d.numeros.length)) return null
  const total = d.appels.filter(a => !a.perdu).reduce((s, a) => s + a.duree_s, 0)

  return (
    <section className="bg-surface border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold text-ink"><Phone size={18} /> Appels ({d.appels.length})</h3>
        {total > 0 && <span className="text-sm text-ink-secondary">Au téléphone sur ce dossier : {dureeTxt(total)}</span>}
      </div>
      {err && <p className="text-sm text-red-800 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      {d.appels.length > 0 && (
        <div className="flex flex-col">
          {d.appels.map(a => { const p = pastilleSens(a.sens, a.perdu); return (
            <div key={a.id} className="grid grid-cols-[96px_64px_minmax(0,1fr)_auto] gap-2.5 items-start py-2.5 border-t text-sm">
              <span className="text-ink-secondary">{quandTxt(a.debut)}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full justify-self-start ${p.cls}`}>{p.txt}</span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-ink">{a.numero_lisible}{a.service ? ` · ${a.service}` : ''}</span>
                <span className="text-xs text-ink-secondary">{a.resume} · {a.lien}</span>
              </span>
              <span className="flex items-center gap-1 justify-end">
                <span className="text-ink-secondary">{a.perdu ? '—' : dureeTxt(a.duree_s)}</span>
                {confirme === a.id ? (
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
    </section>
  )
}
