'use client'

// Finance › Réconciliation — la file des versements Paynovate.
//
// Un versement se déplie sur les paiements carte qui le composent. Ce qui
// demande une décision s'ouvre tout seul ; ce qui est prêt part en un clic.
// Rien n'est écrit sans ce clic : le serveur revérifie tout de son côté.

import { useCallback, useEffect, useState } from 'react'

interface Tx {
  merchantRef: string
  amount: number
  cardBrand: string
  at: string | null
  commission: number
  confidence: string
  explanation: string
  invoiceIds: number[]
  invoiceName: string | null
  partner: string | null
  invoiceTotal: number | null
  paymentState: string | null
  candidates: { id: number; name: string; partner: string; amount: number; date: string }[]
  issue: 'lost' | 'gap' | 'miss' | null
}

interface Payout {
  state: 'ready' | 'lost' | 'gap' | 'miss'
  paymentId: number
  tid: string | null
  bankLineId: number
  bankMoveName: string
  bankDate: string
  bankAmount: number
  grossAmount: number
  commission: number
  txs: Tx[]
  blocking: string[]
}

interface Report {
  payouts: Payout[]
  unmatched: { bankLineId: number; date: string; amount: number; label: string; reason: string }[]
  totals: {
    count: number; amount: number
    byState: Record<string, { count: number; amount: number }>
    lostInvoices: number; lostAmount: number
  }
  ready: { payouts: number; net: number; commission: number; invoices: number }
}

const eur = (n: number) =>
  n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

const day = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })

const r2 = (n: number) => Math.round(n * 100) / 100

/** Retire les versements rapprochés et recalcule les compteurs, sans relire Paynovate. */
function recount(prev: Report, settled: Set<number>): Report {
  const payouts = prev.payouts.filter(p => !settled.has(p.paymentId))
  const byState: Report['totals']['byState'] = {
    ready: { count: 0, amount: 0 }, lost: { count: 0, amount: 0 },
    gap:   { count: 0, amount: 0 }, miss: { count: 0, amount: 0 },
  }
  for (const p of payouts) {
    byState[p.state].count += 1
    byState[p.state].amount = r2(byState[p.state].amount + p.bankAmount)
  }
  const lost = payouts.flatMap(p => p.txs).filter(x => x.issue === 'lost')
  const ready = payouts.filter(p => p.state === 'ready')
  return {
    ...prev,
    payouts,
    totals: {
      ...prev.totals,
      count:  payouts.length,
      amount: r2(payouts.reduce((s, p) => s + p.bankAmount, 0)),
      byState,
      lostInvoices: lost.length,
      lostAmount:   r2(lost.reduce((s, x) => s + x.amount, 0)),
    },
    ready: {
      payouts:    ready.length,
      net:        r2(ready.reduce((s, p) => s + p.bankAmount, 0)),
      commission: r2(ready.reduce((s, p) => s + p.commission, 0)),
      invoices:   new Set(ready.flatMap(p => p.txs.flatMap(x => x.invoiceIds))).size,
    },
  }
}

const STATE: Record<string, { label: string; cls: string }> = {
  ready: { label: 'Prêt',                cls: 'bg-success-soft text-success' },
  lost:  { label: 'Encaissement perdu',  cls: 'bg-warning-soft text-warning' },
  gap:   { label: 'Écart de montant',    cls: 'bg-alert-soft text-alert' },
  miss:  { label: 'À trancher',          cls: 'bg-purple-soft text-purple' },
}

const BAR: Record<string, string> = {
  ready: 'border-l-success', lost: 'border-l-warning', gap: 'border-l-alert', miss: 'border-l-purple',
}

// Le TID dit quel terminal a encaissé — donc quel site.
const SITE: Record<string, string> = { '38904065': 'Fourrière', '38912308': 'Dépannage' }

export default function ReconciliationClient({ userName }: { userName: string }) {
  const [report, setReport]   = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState<number[]>([])
  const [open, setOpen]       = useState<Set<number>>(new Set())
  const [toast, setToast]     = useState<string | null>(null)
  const [tab, setTab]         = useState<'queue' | 'lost'>('queue')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/finance/reconciliation', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`)
      setReport(j)
      // Tout est déplié d'office : on ne valide pas ce qu'on ne voit pas.
      // Le bouton « Tout replier » reste là pour scanner la file de haut en bas.
      setOpen(new Set(j.payouts.map((p: Payout) => p.paymentId)))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function reconcile(ids: number[]) {
    setBusy(ids)
    try {
      const r = await fetch('/api/finance/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payoutIds: ids }),
      })
      const j = await r.json()
      const ok = (j.results || []).filter((x: any) => x.ok)
      const ko = (j.results || []).filter((x: any) => !x.ok)
      setToast(ok.length
        ? `${ok.length} versement${ok.length > 1 ? 's' : ''} rapproché${ok.length > 1 ? 's' : ''}${ko.length ? ` · ${ko.length} en échec` : ''}`
        : `Échec : ${ko[0]?.error || j.error || 'raison inconnue'}`)

      // On retire les versements traités de la file sans tout relire chez
      // Paynovate : une relecture complète, c'est dix secondes d'attente pour
      // un résultat qu'on connaît déjà. Le bouton « Actualiser » reste là.
      if (ok.length) {
        const settled = new Set<number>(ok.map((x: any) => Number(x.payoutId)))
        setReport(prev => (prev ? recount(prev, settled) : prev))
      }
    } catch (e: any) {
      setToast(`Échec : ${e.message}`)
    } finally {
      setBusy([])
    }
  }

  const toggle = (id: number) =>
    setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return <Shell><p className="text-ink-muted">Lecture des versements chez Paynovate…</p></Shell>

  if (error) return (
    <Shell>
      <div className="rounded-card border border-critical/40 bg-critical-soft p-5">
        <p className="font-semibold text-critical">Impossible de lire les versements</p>
        <p className="mt-1 text-sm text-ink-secondary">{error}</p>
        <button onClick={load} className="mt-3 rounded-btn border border-strong px-4 py-2 text-sm font-semibold">Réessayer</button>
      </div>
    </Shell>
  )

  if (!report) return null

  const t = report.totals
  const lostTxs = report.payouts.flatMap(p => p.txs.filter(x => x.issue === 'lost').map(x => ({ p, x })))
  const readyIds = report.payouts.filter(p => p.state === 'ready').map(p => p.paymentId)
  const shown = tab === 'queue' ? report.payouts : []

  return (
    <Shell>
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">VD Soft · Finance</span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Réconciliation</h1>
        <p className="max-w-[62ch] text-sm text-ink-muted">
          Les versements Paynovate arrivés sur le compte, rapprochés des factures qu&apos;ils paient.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="En attente" figure={eur(t.amount)} note={`${t.count} versements`} />
        <Tile label="Encaissements perdus" figure={eur(t.lostAmount)} tone="warning"
              note={`${t.lostInvoices} facture${t.lostInvoices > 1 ? 's' : ''} ouverte${t.lostInvoices > 1 ? 's' : ''} alors qu'elle est payée`} />
        <Tile label="À trancher" tone="alert"
              figure={String((t.byState.gap?.count || 0) + (t.byState.miss?.count || 0))}
              note="Écarts et références non résolues" />
      </section>

      <div className="flex items-end justify-between gap-3 border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          <Tab on={tab === 'queue'} onClick={() => setTab('queue')} count={report.payouts.length}>À rapprocher</Tab>
          <Tab on={tab === 'lost'}  onClick={() => setTab('lost')}  count={lostTxs.length}>Encaissements perdus</Tab>
        </div>
        <div className="mb-2 flex shrink-0 gap-2">
          {tab === 'queue' && report.payouts.length > 0 && (
            <button
              onClick={() => setOpen(open.size ? new Set() : new Set(report.payouts.map(p => p.paymentId)))}
              className="rounded-btn border border-strong px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover">
              {open.size ? 'Tout replier' : 'Tout déplier'}
            </button>
          )}
          <button onClick={load} disabled={busy.length > 0}
            title="Relit les versements chez Paynovate — une dizaine de secondes"
            className="rounded-btn border border-strong px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover disabled:text-ink-faint">
            Actualiser
          </button>
        </div>
      </div>

      {tab === 'lost' && (
        <div className="flex flex-col gap-3">
          {lostTxs.length === 0 && <Empty>Aucune facture ouverte alors qu&apos;elle est payée.</Empty>}
          {lostTxs.map(({ p, x }) => (
            <div key={`${p.paymentId}-${x.merchantRef}`} className="rounded-card border border-border bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{x.invoiceName}</span>
                <span className="font-mono text-sm font-semibold">{eur(x.amount)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">{x.partner}</p>
              <p className="mt-2 text-xs text-ink-muted">
                Payé le {x.at ? day(x.at.slice(0, 10)) : '—'} par {x.cardBrand} · terminal {SITE[p.tid || ''] || p.tid}
                {' · '}la facture est encore ouverte dans Odoo.
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === 'queue' && (
        <div className="flex flex-col gap-2.5">
          {shown.length === 0 && <Empty>Tout est rapproché. Rien ne traîne.</Empty>}

          {shown.map(p => {
            const st = STATE[p.state]
            const isOpen = open.has(p.paymentId)
            const working = busy.includes(p.paymentId)
            return (
              <article key={p.paymentId}
                className={`overflow-hidden rounded-card border border-border border-l-[3px] bg-surface shadow-sm ${BAR[p.state]}`}>
                <button onClick={() => toggle(p.paymentId)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-surface-hover">
                  <span className={`text-ink-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex flex-wrap items-baseline gap-2.5">
                      <span className="font-mono text-[17px] font-semibold tabular-nums">{eur(p.bankAmount)}</span>
                      <span className="text-[13.5px] text-ink-muted">reçu le {day(p.bankDate)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${st.cls}`}>{st.label}</span>
                      <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-secondary">
                        {SITE[p.tid || ''] || `TID ${p.tid || '?'}`}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {p.txs.length} paiement{p.txs.length > 1 ? 's' : ''} carte
                      </span>
                    </span>
                  </span>
                  {p.state === 'ready' && (
                    <span
                      role="button" tabIndex={0}
                      onClick={e => { e.stopPropagation(); if (!working) reconcile([p.paymentId]) }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); reconcile([p.paymentId]) } }}
                      className="shrink-0 rounded-btn bg-brand px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-hover">
                      {working ? 'En cours…' : 'Rapprocher'}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-surface-2 px-4 pb-3.5 pt-1">
                    {p.txs.map((x, i) => (
                      <div key={i} className="border-b border-dashed border-border py-3 last:border-b-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <span className="font-mono text-xs text-ink-muted">
                            {x.at ? `${day(x.at.slice(0, 10))} · ${x.at.slice(11, 16)}` : '—'}
                            <span className="ml-2 uppercase tracking-wider text-ink-faint">{x.cardBrand}</span>
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums">{eur(x.amount)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-[13px] font-semibold">{x.invoiceName || x.merchantRef}</span>
                          {x.partner && <span className="text-[13.5px] text-ink-secondary">{x.partner}</span>}
                          {!x.issue && <span className="text-xs font-semibold text-success">✓ facture soldée</span>}
                        </div>
                        {x.issue && (
                          <p className={`mt-2 rounded-btn border-l-2 px-3 py-2 text-[12.5px] leading-relaxed ${
                            x.issue === 'lost' ? 'border-warning bg-warning-soft'
                            : x.issue === 'gap' ? 'border-alert bg-alert-soft'
                            : 'border-purple bg-purple-soft'}`}>
                            {x.issue === 'lost'
                              ? <>Cette facture est encore ouverte dans Odoo alors que le client a payé. Le rapprochement va la solder.</>
                              : x.explanation}
                          </p>
                        )}
                        {x.issue === 'miss' && (
                          <Linker tx={x} onLinked={load} />
                        )}
                      </div>
                    ))}
                    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-2.5 text-[12.5px] text-ink-muted">
                      <span>Frais Paynovate <span className="font-mono font-semibold text-ink-secondary">{eur(p.commission)}</span> — passés en OD sur le compte fournisseur</span>
                      <span className="font-mono text-[11px] text-ink-faint">versement {p.paymentId} · extrait {p.bankMoveName}</span>
                    </div>
                  </div>
                )}
              </article>
            )
          })}

          {readyIds.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-sm">
              <p className="max-w-[52ch] text-[13px] text-ink-muted">
                Les versements où tout concorde peuvent partir ensemble. Ceux qui portent une anomalie restent à trancher un par un.
              </p>
              <button
                disabled={busy.length > 0}
                onClick={() => reconcile(readyIds)}
                className="rounded-btn bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
                {busy.length > 1 ? 'Rapprochement en cours…' : `Rapprocher les ${readyIds.length} versements prêts · ${eur(report.ready.net)}`}
              </button>
            </div>
          )}
        </div>
      )}

      {report.unmatched.length > 0 && (
        <section className="rounded-card border border-border bg-surface p-4">
          <h2 className="font-display text-sm font-bold">À traiter à la main</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Ces lignes bancaires ne portent pas d&apos;identifiant de versement exploitable.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {report.unmatched.map(u => (
              <li key={u.bankLineId} className="text-[13px] text-ink-secondary">
                <span className="font-mono">{u.date}</span> · <span className="font-mono">{eur(u.amount)}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {toast && (
        <div role="status" aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-[13.5px] font-semibold text-page shadow-md">
          {toast}
        </div>
      )}
    </Shell>
  )
}

// ── Petits blocs ────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex max-w-5xl flex-col gap-7 px-5 py-8">{children}</div>
}

function Tile({ label, figure, note, tone }: { label: string; figure: string; note: string; tone?: 'warning' | 'alert' }) {
  const color = tone === 'warning' ? 'text-warning' : tone === 'alert' ? 'text-alert' : ''
  return (
    <div className="flex flex-col gap-0.5 rounded-card border border-border bg-surface p-4 shadow-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">{label}</span>
      <span className={`font-mono text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{figure}</span>
      <span className="text-[12.5px] text-ink-muted">{note}</span>
    </div>
  )
}

function Tab({ on, onClick, count, children }: { on: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-selected={on} role="tab"
      className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold ${
        on ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
      {children}
      <span className={`rounded-full px-1.5 py-px font-mono text-[11px] ${on ? 'bg-brand-soft text-brand' : 'border border-border bg-surface-hover text-ink-secondary'}`}>
        {count}
      </span>
    </button>
  )
}

/**
 * Rattacher une référence à sa facture. Les propositions sont cliquables, et
 * si aucune ne convient on saisit le numéro à la main — plusieurs si le
 * paiement couvre plusieurs factures.
 */
function Linker({ tx, onLinked }: { tx: Tx; onLinked: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState<string | null>(null)

  async function link(names: string[]) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/finance/reconciliation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantRef: tx.merchantRef, amount: tx.amount, invoiceNames: names }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(j.error || `Erreur ${r.status}`); return }
      setMsg(j.warning || `Rattachée à ${j.names.join(' + ')} — actualisation…`)
      if (!j.warning) setTimeout(onLinked, 700)
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {tx.candidates.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Propositions</p>
          {tx.candidates.slice(0, 4).map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-btn border border-border bg-surface px-3 py-2 text-[13px]">
              <span><span className="font-mono">{c.name}</span> · {c.partner} · <span className="font-mono">{eur(c.amount)}</span></span>
              <button disabled={busy} onClick={() => link([c.name])}
                className="shrink-0 text-[12.5px] font-semibold text-brand hover:underline disabled:text-ink-faint">
                C&apos;est celle-là
              </button>
            </div>
          ))}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-btn border border-dashed border-strong bg-surface px-3 py-2.5">
        <label className="text-[12.5px] text-ink-secondary" htmlFor={`inv-${tx.merchantRef}`}>
          {tx.candidates.length > 0 ? 'Aucune ne convient — numéro de facture :' : 'Numéro de facture :'}
        </label>
        <input
          id={`inv-${tx.merchantRef}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) link(value.split(/[\s,;+]+/).filter(Boolean)) }}
          placeholder="2026/07/123"
          className="w-40 rounded-btn border border-strong bg-input px-2.5 py-1.5 font-mono text-[13px] text-ink placeholder:text-ink-faint"
        />
        <button
          disabled={busy || !value.trim()}
          onClick={() => link(value.split(/[\s,;+]+/).filter(Boolean))}
          className="rounded-btn bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
          {busy ? 'Rattachement…' : 'Rattacher'}
        </button>
        <span className="w-full text-[11.5px] text-ink-faint">
          Plusieurs factures ? Sépare-les par un espace. Le rattachement est mémorisé pour la prochaine fois.
        </span>
      </div>

      {msg && <p className="text-[12.5px] font-semibold text-ink-secondary">{msg}</p>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-strong bg-surface-2 p-6 text-center text-[13.5px] text-ink-muted">
      {children}
    </div>
  )
}
