'use client'
// Rapport d'un check camion (Olivier 30/09/2026) : lu par le bureau (fenêtre, mail,
// liste) et par le chauffeur qui l'a envoyé. Le bureau marque les anomalies réglées.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CHECK_LEVELS, LEVEL_LABEL_FR } from '@/lib/truck-checks/levels'

const dt = (s: string) => new Date(s).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })

export default function RapportClient({ id }: { id: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [big, setBig] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { fetch(`/api/truck-checks/${id}`, { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j) }).catch(e => setErr(e.message || 'Rapport introuvable')) }, [id])
  const resolve = async (anomalyId: string, resolved: boolean) => {
    setBusy(anomalyId)
    try { const j = await (await fetch(`/api/truck-checks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anomaly_id: anomalyId, resolved }) })).json(); if (j.check) setD((p: any) => ({ ...p, check: j.check })) }
    finally { setBusy(null) }
  }
  if (err) return <div className="p-6 text-critical">{err}</div>
  if (!d) return <div className="p-6 text-ink-muted">Chargement…</div>
  const c = d.check
  const open = c.anomalies.filter((a: any) => !a.resolved_at).length
  return (
    <div className="max-w-3xl mx-auto p-4 flex flex-col gap-3 pb-20">
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h1 className="text-xl font-bold text-ink">{c.truck_name} <span className="font-mono">{c.truck_plate}</span></h1>
        <p className="text-sm text-ink-secondary mt-1">{Number(c.mileage).toLocaleString('fr-BE')} km · {c.driver_name || '—'} · {dt(c.created_at)}</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {c.anomalies.length === 0 && <span className="rounded-full bg-success-soft text-success text-xs font-semibold px-2.5 py-1">✅ Rien à signaler</span>}
          {CHECK_LEVELS.slice().reverse().map(l => { const n = c.anomalies.filter((a: any) => a.level === l.level).length; return n ? <span key={l.level} className="rounded-full bg-surface-2 border border-border text-ink text-xs font-semibold px-2.5 py-1">{l.emoji} {n} {LEVEL_LABEL_FR[l.level].toLowerCase()}</span> : null })}
          {c.anomalies.length > 0 && <span className="rounded-full bg-surface-2 border border-border text-ink-secondary text-xs px-2.5 py-1">{open ? `${open} à régler` : 'tout est réglé'}</span>}
        </div>
        {c.comment && <p className="mt-3 rounded-xl bg-surface-2 border border-border p-3 text-ink">💬 {c.comment}</p>}
        {d.viewer && c.mail_error && <p className="mt-2 text-xs text-warning">Le mail n’est pas parti : {c.mail_error}</p>}
      </section>

      {c.anomalies.map((a: any) => { const l = CHECK_LEVELS.find(x => x.level === a.level)!
        return <section key={a.id} className={`rounded-2xl border bg-surface p-4 ${a.resolved_at ? 'border-border opacity-70' : a.level >= 4 ? 'border-critical' : 'border-border'}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><div className="font-bold text-ink">{l.emoji} {a.title}</div><div className="text-xs text-ink-muted">{LEVEL_LABEL_FR[a.level]}{a.resolved_at ? ` · réglée le ${dt(a.resolved_at)}` : ''}</div></div>
            {d.viewer && <button type="button" disabled={busy === a.id} onClick={() => resolve(a.id, !a.resolved_at)}
              className={`min-h-[44px] rounded-xl px-3 text-sm font-semibold ${a.resolved_at ? 'border border-strong text-ink' : 'bg-success text-white'}`}>{a.resolved_at ? 'Rouvrir' : '✓ Anomalie réglée'}</button>}
          </div>
          {a.description && <p className="text-ink mt-2 whitespace-pre-wrap">{a.description}</p>}
          {a.photo_urls.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{a.photo_urls.map((u: string) =>
            // eslint-disable-next-line @next/next/no-img-element
            <button key={u} type="button" onClick={() => setBig(u)} className="w-24 h-24 rounded-lg overflow-hidden bg-surface-2"><img src={u} alt={a.title} className="w-full h-full object-cover" /></button>)}</div>}
        </section> })}

      {d.history.length > 0 && <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="font-semibold text-ink mb-2">Checks précédents de {c.truck_plate}</h2>
        {d.history.map((h: any) => <Link key={h.id} href={`/check-vehicule/rapport/${h.id}`} className="flex justify-between gap-2 min-h-[44px] items-center border-b border-border last:border-0 text-sm">
          <span className="text-ink">{dt(h.created_at)} · {Number(h.mileage).toLocaleString('fr-BE')} km · {h.driver_name || '—'}</span>
          <span className="text-ink-secondary">{h.anomaly_count ? `${CHECK_LEVELS.find(l => l.level === h.max_level)?.emoji || ''} ${h.anomaly_count}` : '✅'}</span></Link>)}
      </section>}

      {big && <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" role="dialog" aria-label="Photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={big} alt="" className="max-w-full max-h-full object-contain" />
        <button type="button" onClick={() => setBig(null)} aria-label="Fermer" className="absolute top-4 right-4 w-12 h-12 rounded-full bg-white/20 text-white text-2xl">✕</button>
      </div>}
    </div>
  )
}
