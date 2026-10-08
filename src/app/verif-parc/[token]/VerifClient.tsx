'use client'
// Liste des véhicules à vérifier au parc : emplacement théorique, photos, « Présent » ou « Plus là ».
import { useState } from 'react'
import type { VerifItem } from '@/lib/parc/verification'

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE') : '—'
const place = (s: VerifItem['snapshot']) => [s.zone ? `Zone ${s.zone}` : 'Zone inconnue', s.row != null ? `rangée ${s.row}` : null, s.slot != null ? `place ${s.slot}` : null].filter(Boolean).join(' · ')

export default function VerifClient({ token, title, initial }: { token: string; title: string; initial: VerifItem[] }) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<string | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const done = items.filter(i => i.answer).length

  const send = async (it: VerifItem, answer: 'present' | 'absent') => {
    setBusy(it.id); setErr(null)
    try {
      const r = await fetch(`/api/verif-parc/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: it.id, answer, note: notes[it.id] || '' }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setItems(list => list.map(x => x.id === it.id ? j.item : x))
    } catch (e: any) { setErr(e.message) } finally { setBusy(null); setConfirm(null) }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-600">Verviers Dépannage · Fourrière</p>
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-700">Pour chaque véhicule, regarde à l’emplacement indiqué s’il est encore là. « Plus là » le sort du parc dans le logiciel.</p>
          <p className="text-sm font-semibold text-slate-800">{done} / {items.length} vérifié{done > 1 ? 's' : ''}</p>
        </header>
        {err && <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        {items.map(it => {
          const s = it.snapshot
          const settled = it.answer === 'absent' && it.applied_at
          return (
            <section key={it.id} className={`rounded-xl border bg-white p-4 space-y-3 ${it.answer === 'present' ? 'border-emerald-300' : settled ? 'border-slate-300 opacity-80' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-slate-900 tracking-wide">{s.plate || 'Sans plaque'}</p>
                  <p className="text-sm text-slate-800">{s.vehicle || 'Véhicule'} · fiche {s.mission_number}</p>
                  <p className="text-sm text-slate-700">Entré le {fmt(s.entered)}{s.payment ? ` · payé : ${s.payment}` : ''}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">{place(s)}</p>
              </div>
              {s.photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {s.photos.map((u, k) => (
                    <button key={k} type="button" onClick={() => setPhoto(u)} className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Photo ${k + 1}`} className="h-20 w-28 object-cover rounded-md border border-slate-200" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              {it.answer ? (
                <p className={`text-sm font-semibold ${it.answer === 'present' ? 'text-emerald-800' : 'text-slate-800'}`}>
                  {it.answer === 'present' ? '✓ Présent au parc' : `✓ Plus là — ${it.applied_result || 'sorti du parc'}`}
                  {it.answer_note ? ` · « ${it.answer_note} »` : ''} <span className="font-normal text-slate-600">({fmt(it.answered_at)})</span>
                </p>
              ) : null}
              {!settled && (
                <>
                  <input value={notes[it.id] || ''} onChange={e => setNotes(n => ({ ...n, [it.id]: e.target.value }))} placeholder="Remarque (facultatif) : ex. trouvé zone B"
                    className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-900" />
                  {confirm === it.id ? (
                    <div className="flex flex-wrap gap-2">
                      <p className="w-full text-sm text-slate-800">Confirmer : le véhicule n’est plus au parc, il sort du logiciel.</p>
                      <button type="button" disabled={busy === it.id} onClick={() => send(it, 'absent')} className="min-h-[44px] px-4 rounded-lg bg-slate-800 text-white text-sm font-semibold disabled:opacity-50">{busy === it.id ? '…' : 'Oui, plus là'}</button>
                      <button type="button" onClick={() => setConfirm(null)} className="min-h-[44px] px-4 rounded-lg border border-slate-300 text-slate-800 text-sm">Annuler</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy === it.id} onClick={() => send(it, 'present')} className="min-h-[44px] px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">Présent</button>
                      <button type="button" disabled={busy === it.id} onClick={() => setConfirm(it.id)} className="min-h-[44px] px-4 rounded-lg border border-slate-400 text-slate-900 text-sm font-semibold disabled:opacity-50">Plus là</button>
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })}
      </div>
      {photo && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
          <button type="button" onClick={() => setPhoto(null)} className="self-end mb-2 min-h-[44px] min-w-[44px] rounded-full bg-white text-slate-900 text-lg font-bold">✕</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Photo du véhicule" className="max-h-[85vh] max-w-full rounded-lg" />
        </div>
      )}
    </main>
  )
}
