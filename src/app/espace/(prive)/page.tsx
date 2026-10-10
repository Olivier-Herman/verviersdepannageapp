'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEspace } from './EspaceShell'
import { Depanneuse, IlluVide } from '../_ui/illustrations'
import { Frise, Pastille, Progression, jour, type MissionEspace } from '../_ui/suivi'

type Filtre = 'cours' | 'finies' | 'toutes'

export default function TableauDeBord() {
  const { compte, societes } = useEspace()
  const [missions, setMissions] = useState<MissionEspace[] | null>(null)
  const [err, setErr] = useState('')
  const [filtre, setFiltre] = useState<Filtre>('cours')
  const [societe, setSociete] = useState<string>('')
  const [q, setQ] = useState('')
  const [ouverte, setOuverte] = useState<MissionEspace | null>(null)
  const [maj, setMaj] = useState<number>(0)

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/espace/missions', { cache: 'no-store' })
      if (r.status === 401) { location.href = '/espace/connexion'; return }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setMissions(j.missions); setErr(''); setMaj(Date.now())
    } catch (e: any) { setErr(e.message || 'Connexion impossible') }
  }, [])
  useEffect(() => { charger(); const t = setInterval(charger, 30_000); return () => clearInterval(t) }, [charger])
  useEffect(() => { if (ouverte && missions) setOuverte(missions.find(m => m.id === ouverte.id) || null) }, [missions]) // eslint-disable-line react-hooks/exhaustive-deps

  const liste = useMemo(() => (missions || []).filter(m =>
    (!societe || m.societe?.id === societe)
    && (filtre === 'toutes' || (filtre === 'finies' ? ['fini', 'annule'].includes(m.suivi.ton) : !['fini', 'annule'].includes(m.suivi.ton)))
    && (!q || `${m.plaque} ${m.vehicule} ${m.adresse} ${m.numero} ${m.reference || ''}`.toLowerCase().includes(q.toLowerCase()))
  ), [missions, filtre, societe, q])

  const stats = useMemo(() => {
    const all = (missions || []).filter(m => !societe || m.societe?.id === societe)
    const mois = new Date(); mois.setDate(1); mois.setHours(0, 0, 0, 0)
    return {
      cours: all.filter(m => ['accepte', 'route', 'action'].includes(m.suivi.ton)).length,
      attente: all.filter(m => m.suivi.ton === 'attente').length,
      mois: all.filter(m => m.suivi.ton === 'fini' && m.suivi.termineeLe && new Date(m.suivi.termineeLe) >= mois).length,
    }
  }, [missions, societe])

  const prenom = compte.nom.split(/\s+/)[0]
  const heureJ = new Date().getHours()
  return (
    <>
      <section className="esp-hero">
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:pb-24 md:pt-12">
          <div className="esp-rise flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-sm font-semibold text-rose-200/90">{heureJ < 12 ? 'Bonjour' : heureJ < 18 ? 'Bon après-midi' : 'Bonsoir'} {prenom}</p>
              <h1 className="font-display mt-1 text-3xl font-extrabold tracking-tight md:text-4xl">Vos interventions, en direct.</h1>
              <p className="mt-2 max-w-lg text-sm text-slate-300">Suivez chaque dépannage de la demande jusqu’à la livraison, et retrouvez rapports et factures au même endroit.</p>
            </div>
            <Link href="/espace/nouvelle" className="esp-btn esp-btn-red px-5 text-[15px]">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Commander une intervention
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-3 md:max-w-2xl">
            <Tuile label="En cours" valeur={stats.cours} delai={80} />
            <Tuile label="En attente" valeur={stats.attente} delai={160} />
            <Tuile label="Terminées ce mois" valeur={stats.mois} delai={240} />
          </div>
        </div>
        <div className="esp-road" />
        <div className="esp-drive pointer-events-none absolute bottom-[14px] left-0 w-[210px] md:w-[260px]"><Depanneuse /></div>
      </section>

      <section className="mx-auto -mt-6 max-w-6xl px-4">
        <div className="esp-card esp-rise flex flex-col gap-3 p-3 md:flex-row md:items-center" style={{ animationDelay: '120ms' }}>
          <div className="flex gap-1 rounded-2xl bg-[#f6f1ec] p-1">
            {([['cours', 'En cours'], ['finies', 'Terminées'], ['toutes', 'Toutes']] as [Filtre, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setFiltre(k)} className={`min-h-[40px] flex-1 rounded-xl px-4 text-sm font-bold transition md:flex-none ${filtre === k ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-800'}`}>{l}</button>
            ))}
          </div>
          {societes.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <Puce actif={!societe} onClick={() => setSociete('')}>Toutes les sociétés</Puce>
              {societes.map(s => <Puce key={s.id} actif={societe === s.id} onClick={() => setSociete(s.id)} couleur={s.couleur}>{s.nom}</Puce>)}
            </div>
          )}
          <div className="relative md:ml-auto md:w-72">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Plaque, adresse, n°…" className="esp-input" style={{ paddingLeft: '2.6rem' }} />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-end gap-2 px-1 text-xs text-slate-500">
          {err ? <span className="font-semibold text-rose-700">{err}</span> : maj ? <><span className="esp-live text-emerald-500" style={{ width: 8, height: 8 }} /> Mis à jour en direct</> : null}
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {missions === null && [0, 1, 2].map(i => <div key={i} className="esp-card h-52 esp-shimmer" />)}
          {missions !== null && liste.map((m, k) => <Carte key={m.id} m={m} k={k} onOpen={() => setOuverte(m)} />)}
        </div>
        {missions !== null && !liste.length && (
          <div className="esp-card esp-rise mx-auto mt-6 flex max-w-lg flex-col items-center p-8 text-center">
            <IlluVide className="w-48" />
            <h3 className="font-display mt-4 text-lg font-extrabold">{filtre === 'cours' ? 'Aucune intervention en cours' : 'Rien à afficher ici'}</h3>
            <p className="mt-1 text-sm text-slate-500">{filtre === 'cours' ? 'Besoin d’un dépannage ou d’un remorquage ? Nous arrivons.' : 'Changez de filtre ou de recherche.'}</p>
            {filtre === 'cours' && <Link href="/espace/nouvelle" className="esp-btn esp-btn-red mt-5">Commander une intervention</Link>}
          </div>
        )}
      </section>

      {ouverte && <Detail m={ouverte} onClose={() => setOuverte(null)} />}
    </>
  )
}

function Tuile({ label, valeur, delai }: { label: string; valeur: number; delai: number }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0; const t0 = performance.now()
    const step = (t: number) => { const p = Math.min(1, (t - t0) / 700); setV(Math.round(valeur * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step) }
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf)
  }, [valeur])
  return (
    <div className="esp-glass esp-rise rounded-2xl px-4 py-3" style={{ animationDelay: `${delai}ms` }}>
      <div className="font-display text-2xl font-extrabold tabular-nums md:text-3xl">{v}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{label}</div>
    </div>
  )
}

function Puce({ actif, onClick, couleur, children }: { actif: boolean; onClick: () => void; couleur?: string | null; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition ${actif ? 'border-slate-900 bg-slate-900 text-white' : 'border-[#e5ddd4] bg-white text-slate-700 hover:border-slate-300'}`}>
      {couleur && <span className="h-2.5 w-2.5 rounded-full" style={{ background: couleur }} />}{children}
    </button>
  )
}

function Plaque({ v }: { v: string | null }) {
  if (!v) return null
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-md border-2 border-[#b91c1c] bg-white font-mono text-[13px] font-bold leading-none text-[#b91c1c] shadow-sm">
      <span className="grid w-4 place-items-center bg-[#1d4ed8] text-[8px] text-white">B</span>
      <span className="px-2 py-1.5 tracking-wider">{v}</span>
    </span>
  )
}

function TypeIcone({ type }: { type: string }) {
  const dsp = type === 'DSP'
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${dsp ? 'bg-sky-50 text-sky-600' : 'bg-rose-50 text-rose-600'}`}>
      {dsp
        ? <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.4-.4-2.6z" /></svg>
        : <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h2m12 0h4v-4l-3-4h-5v8M3 17V7h10v10" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg>}
    </span>
  )
}

const typeLibelle = (t: string) => t === 'DSP' ? 'Dépannage sur place' : t === 'REM+REL' ? 'Remorquage et livraison' : t === 'REM' ? 'Remorquage' : 'Intervention'

function Carte({ m, k, onOpen }: { m: MissionEspace; k: number; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="esp-card esp-card-hover esp-rise relative w-full overflow-hidden p-5 text-left" style={{ animationDelay: `${Math.min(k, 8) * 60}ms` }}>
      {m.societe?.couleur && <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: m.societe.couleur }} />}
      <div className="flex items-start gap-3">
        <TypeIcone type={m.suivi.type} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><Plaque v={m.plaque} /><span className="truncate text-sm font-semibold text-slate-700">{m.vehicule}</span></div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{typeLibelle(m.suivi.type)} · n° {m.numero}</div>
        </div>
      </div>
      <div className="mt-4 flex items-start gap-2 text-sm text-slate-600">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
        <span className="line-clamp-2">{m.adresse}</span>
      </div>
      <div className="mt-4"><Progression etapes={m.suivi.etapes} /></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Pastille ton={m.suivi.ton} libelle={m.suivi.libelle} />
        <span className="text-xs text-slate-500">{m.suivi.termineeLe ? `Terminée ${jour(m.suivi.termineeLe)}` : `Demandée ${jour(m.recueLe)}`}</span>
      </div>
      {(m.rapport || m.facture) && (
        <div className="mt-3 flex gap-2 border-t border-[#f3eee8] pt-3 text-xs font-bold">
          {m.rapport && <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-700">Rapport</span>}
          {m.facture && <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-800">Facture {m.facture.numero}</span>}
        </div>
      )}
    </button>
  )
}

function Detail({ m, onClose }: { m: MissionEspace; onClose: () => void }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-sm">
      <aside className="esp-rise flex h-full w-full max-w-xl flex-col overflow-y-auto bg-[#f6f3ef] shadow-2xl" style={{ animationDuration: '.35s' }}>
        <div className="esp-hero px-5 pb-6 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[.18em] text-rose-200">{typeLibelle(m.suivi.type)} · n° {m.numero}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2"><Plaque v={m.plaque} /><span className="font-display text-lg font-extrabold">{m.vehicule}</span></div>
            </div>
            <button onClick={onClose} aria-label="Fermer" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-white hover:bg-white/20">✕</button>
          </div>
          <div className="mt-4"><Pastille ton={m.suivi.ton} libelle={m.suivi.libelle} /></div>
        </div>
        <div className="space-y-4 p-5">
          <div className="esp-card p-5"><h3 className="mb-4 text-sm font-extrabold uppercase tracking-wider text-slate-500">Suivi</h3><Frise etapes={m.suivi.etapes} /></div>
          <div className="esp-card divide-y divide-[#f3eee8]">
            <Ligne label="Lieu d’intervention" v={m.adresse} />
            {m.destination && <Ligne label="Livraison" v={m.destination} />}
            {m.prevuLe && <Ligne label="Prévue" v={jour(m.prevuLe)} />}
            <Ligne label="Demandée" v={jour(m.recueLe)} />
            {m.reference && <Ligne label="Votre référence" v={m.reference} />}
            {m.commandePar && <Ligne label="Commandée par" v={m.commandePar} />}
            {m.societe && <Ligne label="Société" v={m.societe.nom} />}
          </div>
          <div className="esp-card p-5">
            <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-slate-500">Documents</h3>
            <div className="grid gap-2">
              <Doc actif={m.rapport} href={`/api/espace/missions/${m.id}/rapport`} titre="Rapport d’intervention" sous={m.rapport ? 'Photos, constat et signature' : 'Disponible à la fin de l’intervention'} />
              <Doc actif={!!m.facture} href={`/api/espace/missions/${m.id}/facture`} titre={m.facture ? `Facture ${m.facture.numero}` : 'Facture'} sous={m.facture ? 'PDF' : 'Disponible dès son envoi'} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function Ligne({ label, v }: { label: string; v: string | null }) {
  return <div className="flex gap-4 px-5 py-3 text-sm"><span className="w-36 shrink-0 text-slate-500">{label}</span><span className="font-semibold text-slate-800">{v || '—'}</span></div>
}

function Doc({ actif, href, titre, sous }: { actif: boolean; href: string; titre: string; sous: string }) {
  const corps = (
    <>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${actif ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 12v6m-3-3 3 3 3-3" /></svg>
      </span>
      <span className="min-w-0"><span className={`block truncate text-sm font-bold ${actif ? 'text-slate-900' : 'text-slate-400'}`}>{titre}</span><span className="block text-xs text-slate-500">{sous}</span></span>
    </>
  )
  return actif
    ? <div className="flex items-center gap-3 rounded-2xl border border-[#ece6df] bg-white p-3"><a href={href} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-3">{corps}</a><a href={`${href}?dl=1`} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Télécharger"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 4v11m-4-4 4 4 4-4M5 20h14" /></svg></a></div>
    : <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[#e5ddd4] bg-white/60 p-3">{corps}</div>
}
