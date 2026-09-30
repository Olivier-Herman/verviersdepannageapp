'use client'
// Anomalies à traiter au bureau (Olivier 30/09/2026, maquette
// https://claude.ai/artifact/CR65AicsM7wvviuzYDZxTx) : par camion, la plus grave en
// premier ; un problème signalé plusieurs fois = une ligne en rouge ; remarques pour
// information seulement (jusqu'au check suivant). « Corrigé » prévient le chauffeur.
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CHECK_LEVELS, LEVEL_LABEL_FR } from '@/lib/truck-checks/levels'

const dt = (s: string) => new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const DOT: Record<number, string> = { 1: 'bg-info-fill', 2: 'bg-success-fill', 3: 'bg-warning-fill', 4: 'bg-alert-fill', 5: 'bg-critical-fill' }
const TXT: Record<number, string> = { 1: 'text-info', 2: 'text-success', 3: 'text-warning', 4: 'text-alert', 5: 'text-critical' }
const Dot = ({ l }: { l: number }) => <span className={`inline-block w-3 h-3 rounded-full flex-none ${DOT[l]}`} aria-hidden="true" />

export default function AnomaliesClient() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<'open' | 'fixed'>('open')
  const [fix, setFix] = useState<any>(null)          // { truck, group }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [big, setBig] = useState<string | null>(null)

  const load = useCallback(() => fetch('/api/truck-checks/anomalies', { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); setErr(null) }).catch(e => setErr(e.message || 'Chargement impossible.')), [])
  useEffect(() => { load() }, [load])

  const confirm = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/truck-checks/anomalies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: fix.group.ids, note }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setDone(`« ${fix.group.title} » corrigé${j.notified ? ` · ${fix.group.drivers.join(', ') || 'le chauffeur'} prévenu${fix.group.drivers.length > 1 ? 's' : ''}` : ''}.`)
      setFix(null); setNote(''); await load()
    } catch (e: any) { setErr(e.message || 'Enregistrement impossible.') } finally { setBusy(false) }
  }

  if (err && !d) return <div className="p-6 text-critical">{err}</div>
  if (!d) return <div className="p-6 text-ink-muted">Chargement…</div>
  const withGroups = d.trucks.filter((t: any) => t.groups.length || t.remarks.length)

  return (
    <div className="max-w-4xl mx-auto p-4 flex flex-col gap-3 pb-24">
      {err && <div className="rounded-xl border border-critical bg-critical-soft text-critical px-3 py-2 text-sm">{err}</div>}
      {done && <div className="rounded-xl border border-success bg-success-soft text-success px-3 py-2 text-sm flex justify-between gap-2"><span>✓ {done}</span><button type="button" className="font-semibold" onClick={() => setDone(null)} aria-label="Fermer">✕</button></div>}

      <div className="flex flex-wrap gap-2">
        {[5, 4, 3, 2].map(l => <span key={l} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 min-h-[40px] text-sm font-semibold text-ink"><Dot l={l} />{LEVEL_LABEL_FR[l]} <b className="text-lg">{d.counts[l] || 0}</b></span>)}
      </div>

      <div className="flex gap-2" role="tablist">
        {([['open', 'À traiter'], ['fixed', 'Corrigées récemment']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold ${tab === k ? 'bg-brand text-white' : 'border border-strong text-ink'}`}>{l}</button>)}
        <Link href="/check-vehicule" className="ml-auto self-center text-sm text-ink-secondary underline">Tous les rapports</Link>
      </div>

      {tab === 'open' && <>
        {withGroups.length === 0 && <div className="rounded-2xl border border-dashed border-border text-ink-muted text-center py-10">Aucune anomalie à traiter. Tous les camions sont en ordre.</div>}
        {withGroups.map((t: any) => <section key={t.plate} className="rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-border bg-surface-2">
            <span className="font-mono font-bold text-sm bg-white text-gray-900 rounded px-2 py-0.5 ring-1 ring-strong">{t.plate}</span>
            <span className="font-bold text-ink">{t.name}</span>
            {t.last && <span className="text-xs text-ink-muted">dernier check {dt(t.last.at)} · {Number(t.last.km).toLocaleString('fr-BE')} km · {t.last.driver || '—'}</span>}
            {t.groups.length > 0 && <span className="ml-auto text-xs font-bold rounded-full px-2.5 py-1 bg-critical-soft text-critical">{t.groups.length} à traiter</span>}
          </div>
          {t.groups.map((g: any) => { const multi = g.count > 1
            return <div key={g.key} className={`flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${multi ? 'bg-critical-soft border-l-4 border-l-critical' : ''}`}>
              <span className={`w-28 flex-none inline-flex items-center gap-2 text-sm font-bold ${TXT[g.level]}`}><Dot l={g.level} />{LEVEL_LABEL_FR[g.level]}</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">{g.title}{multi && <span className="ml-2 align-middle text-xs font-bold text-white bg-critical rounded-full px-2 py-0.5">signalé {g.count} fois</span>}</div>
                <div className="text-xs text-ink-muted">{g.description ? `${g.description} · ` : ''}{multi ? `par ${g.drivers.join(', ') || '—'} depuis le ${dt(g.first_at)}` : `signalé par ${g.reports[0].driver || '—'} le ${dt(g.reports[0].at)}`}
                  {' · '}<Link href={`/check-vehicule/rapport/${g.reports[0].check_id}`} className="underline">rapport</Link></div>
              </div>
              {g.photos.length > 0 && <div className="flex gap-1.5">{g.photos.slice(0, 3).map((u: string) =>
                // eslint-disable-next-line @next/next/no-img-element
                <button key={u} type="button" onClick={() => setBig(u)} className="w-11 h-11 rounded-lg overflow-hidden bg-surface-2" aria-label="Voir la photo"><img src={u} alt="" className="w-full h-full object-cover" /></button>)}
                {g.photos.length > 3 && <span className="w-11 h-11 rounded-lg bg-surface-2 text-xs font-bold text-ink-secondary flex items-center justify-center">+{g.photos.length - 3}</span>}</div>}
              <button type="button" onClick={() => { setFix({ truck: t, group: g }); setNote(''); setErr(null) }} className="min-h-[44px] rounded-xl bg-success-fill text-white px-4 text-sm font-bold">Corrigé</button>
            </div> })}
          {t.remarks.map((r: any) => <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-border bg-info-soft">
            <span className="w-28 flex-none inline-flex items-center gap-2 text-sm font-bold text-info"><Dot l={1} />Remarque</span>
            <div className="min-w-0 flex-1"><div className="font-semibold text-ink-secondary">{r.title}</div>
              <div className="text-xs text-ink-muted">{r.description ? `${r.description} · ` : ''}{r.driver || '—'}, {dt(r.at)} · pour information, jusqu’au prochain check</div></div>
          </div>)}
        </section>)}
        <p className="text-xs text-ink-muted">Les camions avec l’anomalie la plus grave passent en premier. Une ligne rouge = le même problème signalé plusieurs fois. Les remarques (propreté, rangement…) sont pour information : pas de bouton, et elles disparaissent au check suivant du camion.</p>
      </>}

      {tab === 'fixed' && <section className="rounded-2xl border border-border bg-surface p-3">
        {d.fixed.length === 0 && <p className="text-ink-muted text-sm py-4 text-center">Rien de corrigé pour l’instant.</p>}
        {d.fixed.map((a: any) => <div key={a.id} className="flex items-start gap-3 py-2.5 border-b border-border last:border-0 text-sm">
          <Dot l={a.level} /><div className="min-w-0 flex-1"><div className="font-semibold text-ink"><span className="font-mono">{a.check?.truck_plate}</span> · {a.title}</div>
            <div className="text-xs text-ink-muted">Corrigé le {dt(a.resolved_at)}{a.resolver?.name ? ` par ${a.resolver.name}` : ''}{a.resolution_note ? ` · ${a.resolution_note}` : ''} · {a.driver_notified_at ? `${a.check?.driver_name || 'chauffeur'} prévenu` : `${a.check?.driver_name || 'chauffeur'} non prévenu (notifications coupées sur son téléphone)`}</div></div>
        </div>)}
      </section>}

      {fix && <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-16" role="dialog" aria-modal="true" aria-label="Marquer comme corrigé">
        <div className="relative w-full max-w-lg rounded-2xl bg-surface border border-border shadow-2xl p-5 flex flex-col gap-3">
          <button type="button" onClick={() => setFix(null)} aria-label="Fermer" className="absolute top-2 right-2 w-11 h-11 text-xl text-ink-secondary">✕</button>
          <h2 className="text-lg font-bold text-ink pr-10">Marquer comme corrigé</h2>
          <div className="flex gap-3 items-center rounded-xl bg-surface-2 border border-border p-3"><Dot l={fix.group.level} />
            <div><div className="font-bold text-ink">{fix.group.title}</div><div className="text-xs text-ink-muted"><span className="font-mono font-bold">{fix.truck.plate}</span> · {LEVEL_LABEL_FR[fix.group.level]}{fix.group.count > 1 ? ` · signalé ${fix.group.count} fois` : ''}</div></div></div>
          <label htmlFor="fix-note" className="text-xs uppercase tracking-wide text-ink-muted">Ce qui a été fait (facultatif)</label>
          <textarea id="fix-note" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="ex. Pneu remplacé chez le garage" className="w-full rounded-xl border border-strong bg-surface-2 text-ink p-3" />
          <p className="rounded-xl bg-success-soft text-success text-sm p-3">{fix.group.drivers.length ? `${fix.group.drivers.join(', ')} ${fix.group.drivers.length > 1 ? 'seront prévenus' : 'sera prévenu'} sur son téléphone que c’est réparé.` : 'Le chauffeur sera prévenu sur son téléphone que c’est réparé.'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={confirm} className="min-h-[48px] rounded-xl bg-success-fill text-white px-5 font-bold disabled:opacity-50">{busy ? 'Enregistrement…' : 'Confirmer : corrigé'}</button>
            <button type="button" onClick={() => setFix(null)} className="min-h-[48px] rounded-xl border border-strong text-ink px-5 font-semibold">Annuler</button>
          </div>
        </div>
      </div>}

      {big && <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" role="dialog" aria-label="Photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={big} alt="" className="max-w-full max-h-full object-contain" />
        <button type="button" onClick={() => setBig(null)} aria-label="Fermer" className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/20 text-white text-2xl">✕</button>
      </div>}
    </div>
  )
}
