'use client'

// Écran « Demandes du site » : ce que les visiteurs du site public ont laissé.
//   · Rappelez-moi : GSM + temps restant avant le rappel promis (heures ouvrables) ;
//   · Candidatures chauffeur : permis, expérience, CV.
// « Traité » range la demande dans l'historique (30 jours) ; « Remettre » la ressort.
// Olivier 10/11/2026.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Req = {
  id: string; kind: 'rappel' | 'candidature'; created_at: string
  name: string | null; phone: string | null; email: string | null; lang: string
  details: { motif?: string; permis?: string[]; experience?: string; message?: string }
  file_path: string | null; file_name: string | null; due_at: string | null
  status: 'nouveau' | 'traite'; handled_at: string | null; handled_note: string | null; handled_by_name?: string | null
}

const quand = (iso: string) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

function reste(due: string, now: number) {
  const ms = Date.parse(due) - now
  const h = Math.floor(Math.abs(ms) / 3600e3), m = Math.floor(Math.abs(ms) % 3600e3 / 60e3)
  const txt = h >= 24 ? `${Math.floor(h / 24)} j ${h % 24} h` : `${h} h ${String(m).padStart(2, '0')}`
  if (ms < 0) return { txt: `En retard de ${txt}`, cls: 'bg-red-100 text-red-800 border-red-300' }
  if (ms < 4 * 3600e3) return { txt: `Reste ${txt}`, cls: 'bg-amber-100 text-amber-900 border-amber-300' }
  return { txt: `Reste ${txt}`, cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
}

export default function DemandesSiteClient() {
  const [ouvertes, setOuvertes] = useState<Req[] | null>(null)
  const [traitees, setTraitees] = useState<Req[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/demandes-site', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Lecture impossible')
      setOuvertes(j.ouvertes); setTraitees(j.traitees); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [])

  useEffect(() => {
    load()
    const a = setInterval(() => setNow(Date.now()), 30e3)
    const b = setInterval(load, 120e3)
    return () => { clearInterval(a); clearInterval(b) }
  }, [load])

  async function marquer(id: string, traite: boolean) {
    setBusy(id)
    try {
      const r = await fetch('/api/admin/demandes-site', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, traite }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Enregistrement impossible')
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function ouvrirCv(id: string) {
    // Onglet ouvert DANS le clic : un window.open après un await est bloqué.
    const w = window.open('', '_blank')
    try {
      const r = await fetch(`/api/admin/demandes-site?cv=${id}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'CV introuvable')
      if (w) w.location.href = j.url; else window.location.href = j.url
    } catch (e: any) { w?.close(); setError(e.message) }
  }

  const rappels = (ouvertes || []).filter(r => r.kind === 'rappel')
  const cands = (ouvertes || []).filter(r => r.kind === 'candidature')

  const Carte = ({ r }: { r: Req }) => {
    const enRetard = r.kind === 'rappel' && r.due_at && r.status === 'nouveau' ? reste(r.due_at, now) : null
    return (
      <li className="bg-surface-2 border border-app rounded-2xl p-4 space-y-2">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-ink font-semibold text-sm">{r.name || 'Sans nom'}{r.lang !== 'fr' && <span className="ml-2 text-[11px] font-bold text-ink-muted">{r.lang.toUpperCase()}</span>}</p>
            <p className="text-ink-muted text-xs">Reçu {quand(r.created_at)}{r.due_at && r.kind === 'rappel' ? ` · à rappeler avant ${quand(r.due_at)}` : ''}</p>
          </div>
          {enRetard && <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${enRetard.cls}`}>{enRetard.txt}</span>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="text-ink font-mono font-semibold underline">{r.phone}</a>}
          {r.email && <a href={`mailto:${r.email}`} className="text-ink-secondary underline">{r.email}</a>}
        </div>
        {r.kind === 'candidature' && (
          <p className="text-ink-secondary text-sm">
            Permis <b className="text-ink">{(r.details.permis || []).join(', ') || '—'}</b>
            {' · '}{r.details.experience === 'oui' ? 'A déjà fait du dépannage' : 'Pas encore de dépannage, motivé'}
          </p>
        )}
        {(r.details.motif || r.details.message) && (
          <p className="text-ink-secondary text-sm bg-surface rounded-xl px-3 py-2 whitespace-pre-wrap">{r.details.motif || r.details.message}</p>
        )}
        {r.status === 'traite' && (
          <p className="text-ink-muted text-xs">Traité {r.handled_at ? quand(r.handled_at) : ''}{r.handled_by_name ? ` par ${r.handled_by_name}` : ''}</p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {r.file_path && (
            <button onClick={() => ouvrirCv(r.id)} className="min-h-[44px] px-4 rounded-xl border border-strong text-ink text-sm font-semibold">Voir le CV</button>
          )}
          {r.status === 'nouveau'
            ? <button disabled={busy === r.id} onClick={() => marquer(r.id, true)} className="min-h-[44px] px-4 rounded-xl bg-brand text-white text-sm font-semibold disabled:opacity-50">{r.kind === 'rappel' ? 'Rappelé' : 'Traité'}</button>
            : <button disabled={busy === r.id} onClick={() => marquer(r.id, false)} className="min-h-[44px] px-4 rounded-xl border border-strong text-ink-secondary text-sm disabled:opacity-50">Remettre à traiter</button>}
        </div>
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-surface max-w-3xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border-app px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">Demandes du site</h1>
            <p className="text-ink-muted text-xs">Ce que les visiteurs du site ont laissé. Le délai de rappel ne compte que les jours ouvrables.</p>
          </div>
          <button onClick={load} className="min-h-[44px] px-3 rounded-xl border border-strong text-ink-secondary text-sm">Actualiser</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-8">
        {error && <p className="text-red-800 text-sm bg-red-50 border border-red-300 rounded-xl px-3 py-2">{error}</p>}
        {ouvertes === null && !error && <p className="text-ink-muted text-sm">Chargement…</p>}

        {ouvertes !== null && (
          <>
            <section className="space-y-3">
              <h2 className="text-ink font-semibold text-sm">Rappelez-moi · {rappels.length}</h2>
              {rappels.length ? <ul className="space-y-2">{rappels.map(r => <Carte key={r.id} r={r} />)}</ul>
                : <p className="text-ink-muted text-sm">Personne n’attend de rappel.</p>}
            </section>
            <section className="space-y-3">
              <h2 className="text-ink font-semibold text-sm">Candidatures chauffeur · {cands.length}</h2>
              {cands.length ? <ul className="space-y-2">{cands.map(r => <Carte key={r.id} r={r} />)}</ul>
                : <p className="text-ink-muted text-sm">Aucune candidature en attente.</p>}
            </section>
            {traitees.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-ink-muted font-semibold text-sm">Traitées ces 30 derniers jours · {traitees.length}</h2>
                <ul className="space-y-2 opacity-80">{traitees.map(r => <Carte key={r.id} r={r} />)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
