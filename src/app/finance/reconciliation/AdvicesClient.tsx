'use client'

// Finance › Réconciliation — volet assureurs (IMA, Mondial).
//
// L'avis de paiement arrive avant le virement, d'où un état « attendu » qui
// vaut prévision de trésorerie : ce n'est pas une anomalie, c'est de l'argent
// en route.
//
// Deux façons de valider, au choix : le bouton d'une ligne, ou la case à
// cocher puis la validation groupée.

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Invoice {
  ref: string
  amount: number
  invoiceName: string | null
  invoiceTotal: number | null
  paymentState: string | null
  matchedBy: string | null
  issue: 'introuvable' | 'écart' | 'déjà soldée' | null
  /** Clé de la décision « passer en OD » — posée par le serveur. */
  linkKey?: string
  /** Ligne passée en OD sur le compte d'attente, avec son commentaire. */
  unallocated?: { amount: number; reason: string } | null
}

interface Item {
  state: 'pending' | 'ready' | 'gap' | 'miss' | 'orphan' | 'done'
  payer: string
  payerLabel: string
  advice: { subject: string; receivedAt: string; reference: string | null; total: number } | null
  bank: { lineId: number; date: string; amount: number; moveName: string } | null
  invoices: Invoice[]
  linesSum: number
  delta: number
  blocking: string[]
}

interface Report {
  items: Item[]
  totals: { pendingAmount: number; readyCount: number; readyAmount: number; orphanCount: number; orphanAmount: number; toDecide: number }
  ready: { payments: number; amount: number; invoices: number }
  cachedAt: string | null
  unreadable: { subject: string; error: string }[]
}

const eur = (n: number) =>
  n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const day = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
    .toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })

const STATE: Record<string, { label: string; cls: string; bar: string }> = {
  pending: { label: 'Attendu',           cls: 'bg-info-soft text-info',        bar: 'border-l-info' },
  ready:   { label: 'Prêt',              cls: 'bg-success-soft text-success',  bar: 'border-l-success' },
  gap:     { label: 'Écart',             cls: 'bg-alert-soft text-alert',      bar: 'border-l-alert' },
  miss:    { label: 'À trancher',        cls: 'bg-purple-soft text-purple',    bar: 'border-l-purple' },
  orphan:  { label: 'Sans avis',         cls: 'bg-warning-soft text-warning',  bar: 'border-l-warning' },
}

export default function AdvicesClient() {
  const [report, setReport]   = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)
  const [open, setOpen]       = useState<Set<number>>(new Set())
  const [picked, setPicked]   = useState<Set<number>>(new Set())
  const [toast, setToast]     = useState<string | null>(null)

  const [rereading, setRereading] = useState(false)

  // `refresh` va rechercher les avis dans la boîte mail — lent, et donc réservé
  // à un clic explicite. L'affichage normal lit le cache rempli par le cron.
  const load = useCallback(async (refresh = false) => {
    refresh ? setRereading(true) : setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/finance/advices${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`)
      setReport(j)
      setPicked(new Set())
      setOpen(new Set(j.items.filter((i: Item) => i.state !== 'pending' && i.bank).map((i: Item) => i.bank!.lineId)))
      if (refresh && j.synced) {
        setToast(j.synced.read
          ? `${j.synced.read} nouvel${j.synced.read > 1 ? 's' : ''} avis lu${j.synced.read > 1 ? 's' : ''}`
          : 'Aucun nouvel avis dans la boîte mail')
      }
    } catch (e: any) { setError(e.message) } finally { setLoading(false); setRereading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const readyIds = useMemo(
    () => (report?.items || []).filter(i => i.state === 'ready' && i.bank).map(i => i.bank!.lineId),
    [report],
  )
  const pickedAmount = useMemo(
    () => (report?.items || [])
      .filter(i => i.bank && picked.has(i.bank.lineId))
      .reduce((s, i) => s + (i.bank?.amount ?? 0), 0),
    [report, picked],
  )

  async function reconcile(ids: number[]) {
    if (!ids.length) return
    setBusy(true)
    try {
      const r = await fetch('/api/finance/advices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankLineIds: ids }),
      })
      const j = await r.json()
      const ok = (j.results || []).filter((x: any) => x.ok)
      const ko = (j.results || []).filter((x: any) => !x.ok)
      setToast(ok.length
        ? `${ok.length} virement${ok.length > 1 ? 's' : ''} rapproché${ok.length > 1 ? 's' : ''}${ko.length ? ` · ${ko.length} en échec : ${ko[0].error}` : ''}`
        : `Échec : ${ko[0]?.error || j.error || 'raison inconnue'}`)
      await load()
    } catch (e: any) {
      setToast(`Échec : ${e.message}`)
    } finally { setBusy(false) }
  }

  const toggleOpen = (id: number) =>
    setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePick = (id: number) =>
    setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return <p className="text-ink-muted">Chargement des avis de paiement…</p>

  if (error) return (
    <div className="rounded-card border border-critical/40 bg-critical-soft p-5">
      <p className="font-semibold text-critical">Impossible de lire les avis</p>
      <p className="mt-1 text-sm text-ink-secondary">{error}</p>
      <button onClick={() => load()} className="mt-3 rounded-btn border border-strong px-4 py-2 text-sm font-semibold">Réessayer</button>
    </div>
  )

  if (!report) return null
  const t = report.totals

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="Annoncé, pas encore reçu" figure={eur(t.pendingAmount)} tone="info"
              note="Avis reçus dont le virement est en route" />
        <Tile label="Prêts à rapprocher" figure={eur(t.readyAmount)} tone="success"
              note={`${t.readyCount} virement${t.readyCount > 1 ? 's' : ''} · ${report.ready.invoices} factures`} />
        <Tile label="À trancher" figure={String(t.toDecide + t.orphanCount)} tone="alert"
              note="Écarts, références non résolues, virements sans avis" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">
          Les avis de la boîte info@ sont relus automatiquement à 5 h et à midi
          {report.cachedAt && <> — dernière lecture le {stamp(report.cachedAt)}</>}.
          {' '}Un avis sans virement n&apos;est pas une anomalie : l&apos;assureur annonce avant de payer.
        </p>
        <div className="flex gap-2">
          {readyIds.length > 0 && (
            <button onClick={() => setPicked(new Set(picked.size === readyIds.length ? [] : readyIds))}
              className="rounded-btn border border-strong px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover">
              {picked.size === readyIds.length ? 'Tout décocher' : 'Cocher tous les prêts'}
            </button>
          )}
          <button onClick={() => load()} disabled={busy || rereading}
            className="rounded-btn border border-strong px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover disabled:text-ink-faint">
            Actualiser
          </button>
          <button onClick={() => load(true)} disabled={busy || rereading}
            className="rounded-btn border border-strong px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-hover disabled:text-ink-faint">
            {rereading ? 'Lecture des mails…' : 'Relire la boîte mail'}
          </button>
        </div>
      </div>

      {report.unreadable?.length > 0 && (
        <div className="rounded-card border border-warning/40 bg-warning-soft p-4">
          <p className="text-[13px] font-semibold text-warning">
            {report.unreadable.length} avis reçu{report.unreadable.length > 1 ? 's' : ''} mais illisible{report.unreadable.length > 1 ? 's' : ''}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1 text-[12.5px] text-ink-secondary">
            {report.unreadable.map((u, i) => (
              <li key={i}>{u.subject} — {u.error}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Chaque relecture les retente. S&apos;ils persistent, le document est à joindre à la main.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {report.items.length === 0 && (
          <div className="rounded-card border border-dashed border-strong bg-surface-2 p-6 text-center text-[13.5px] text-ink-muted">
            Aucun paiement assureur en attente.
          </div>
        )}

        {report.items.map((i, idx) => {
          const st  = STATE[i.state] ?? STATE.miss
          const id  = i.bank?.lineId ?? -idx
          const isOpen = open.has(id)
          const canPick = i.state === 'ready' && !!i.bank

          return (
            <article key={id}
              className={`overflow-hidden rounded-card border border-border border-l-[3px] bg-surface shadow-sm ${st.bar}`}>
              <div className="flex items-center gap-3 p-3.5">
                {canPick ? (
                  <input type="checkbox" checked={picked.has(id)} onChange={() => togglePick(id)}
                    aria-label={`Sélectionner le virement de ${eur(i.bank!.amount)}`}
                    className="size-4 shrink-0 accent-[var(--brand)]" />
                ) : <span className="size-4 shrink-0" />}

                <button onClick={() => toggleOpen(id)} aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
                  <span className="flex flex-wrap items-baseline gap-2.5">
                    <span className="font-mono text-[17px] font-semibold tabular-nums">
                      {eur(i.bank?.amount ?? i.linesSum)}
                    </span>
                    <span className="text-[13.5px] text-ink-muted">
                      {i.bank ? `reçu le ${day(i.bank.date)}` : `annoncé le ${day(i.advice!.receivedAt.slice(0, 10))}`}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-semibold text-ink-secondary">
                      {i.payerLabel}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {i.invoices.length ? `${i.invoices.length} facture${i.invoices.length > 1 ? 's' : ''}` : 'aucun détail'}
                      {i.advice?.reference ? ` · ${i.advice.reference}` : ''}
                    </span>
                  </span>
                </button>

                {i.state === 'ready' && i.bank && (
                  <button disabled={busy} onClick={() => reconcile([i.bank!.lineId])}
                    className="shrink-0 rounded-btn bg-brand px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
                    Rapprocher
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="border-t border-border bg-surface-2 px-4 pb-3.5 pt-2">
                  {i.blocking.map((b, k) => (
                    <p key={k} className="mb-2 rounded-btn border-l-2 border-alert bg-alert-soft px-3 py-2 text-[12.5px] leading-relaxed">
                      {b}
                    </p>
                  ))}
                  {i.invoices.map((x, k) => (
                    <div key={k} className="border-b border-dashed border-border py-2 last:border-b-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <span className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-[13px] font-semibold">{x.invoiceName || x.ref}</span>
                          {x.matchedBy === 'référence interne' && (
                            <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info">
                              via {x.ref}
                            </span>
                          )}
                          {x.issue && <span className="text-xs font-semibold text-alert">{x.issue}</span>}
                        </span>
                        <span className="font-mono text-[13px] tabular-nums">{eur(x.amount)}</span>
                      </div>

                      {x.unallocated && (
                        <div className="mt-1.5 flex flex-wrap items-baseline gap-2 rounded-btn border-l-2 border-info bg-info-soft px-3 py-2 text-[12.5px]">
                          <span className="font-semibold text-info">Passée en OD — compte d&apos;attente 499000</span>
                          <span className="text-ink-secondary">« {x.unallocated.reason} »</span>
                          <button
                            onClick={async () => {
                              const r = await fetch('/api/finance/advices', {
                                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ linkKey: x.linkKey, amount: x.amount, clear: true }),
                              })
                              if (r.ok) { setToast('Passage en OD annulé'); load() }
                            }}
                            className="text-[11.5px] font-semibold text-brand hover:underline">
                            Annuler
                          </button>
                        </div>
                      )}

                      {/* Dernier recours, ligne par ligne : l'assureur a bien
                          viré l'argent, mais on ne retrouve pas la facture. */}
                      {!x.unallocated && x.issue && x.linkKey && (
                        <OdLine
                          linkKey={x.linkKey}
                          label={x.invoiceName || x.ref}
                          amount={x.amount}
                          onDone={() => { setToast('Ligne passée en OD'); load() }}
                        />
                      )}
                    </div>
                  ))}
                  {i.bank && (
                    <p className="mt-2.5 border-t border-border pt-2 font-mono text-[11px] text-ink-faint">
                      extrait {i.bank.moveName}
                    </p>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {picked.size > 0 && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-md">
          <p className="text-[13px] text-ink-secondary">
            <strong>{picked.size}</strong> virement{picked.size > 1 ? 's' : ''} sélectionné{picked.size > 1 ? 's' : ''} · {eur(pickedAmount)}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPicked(new Set())}
              className="rounded-btn border border-strong px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-hover">
              Annuler
            </button>
            <button disabled={busy} onClick={() => reconcile([...picked])}
              className="rounded-btn bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
              {busy ? 'Rapprochement…' : `Rapprocher la sélection · ${eur(pickedAmount)}`}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite"
          className="fixed bottom-6 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-center text-[13.5px] font-semibold text-page shadow-md">
          {toast}
        </div>
      )}
    </div>
  )
}

function Tile({ label, figure, note, tone }: { label: string; figure: string; note: string; tone?: 'info' | 'success' | 'alert' }) {
  const color = tone === 'info' ? 'text-info' : tone === 'success' ? 'text-success' : tone === 'alert' ? 'text-alert' : ''
  return (
    <div className="flex flex-col gap-0.5 rounded-card border border-border bg-surface p-4 shadow-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">{label}</span>
      <span className={`font-mono text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{figure}</span>
      <span className="text-[12.5px] text-ink-muted">{note}</span>
    </div>
  )
}

/**
 * Passer UNE ligne d'avis en OD sur le compte d'attente.
 *
 * Une écriture par ligne, avec son propre commentaire — pas une OD fourre-tout
 * sur tout ce qui n'a pas été rapproché. C'est ce commentaire qui permettra,
 * dans six mois, de savoir à quoi correspond le montant resté en 499000.
 */
function OdLine({ linkKey, label, amount, onDone }: {
  linkKey: string
  label: string
  amount: number
  onDone: () => void
}) {
  const [open, setOpen]     = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  const [msg, setMsg]       = useState<string | null>(null)

  async function send() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/finance/advices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkKey, amount, reason }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(j.error || `Erreur ${r.status}`); return }
      onDone()
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="mt-1.5 text-[12px] font-semibold text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink">
      Facture introuvable — passer cette ligne en OD
    </button>
  )

  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-btn border border-strong bg-surface px-3 py-2.5">
      <p className="text-[12.5px] text-ink-secondary">
        <strong>{eur(amount)}</strong> ({label}) part en attente sur <span className="font-mono">499000</span>,
        dans sa propre écriture. Le virement pourra se lettrer.
      </p>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint" htmlFor={`od-${linkKey}`}>
        Commentaire — repris dans l&apos;écriture
      </label>
      <input
        id={`od-${linkKey}`}
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && reason.trim().length >= 3) send() }}
        placeholder="Ex. : facture annulée depuis, régularisation à venir"
        className="w-full rounded-btn border border-strong bg-input px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint"
      />
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || reason.trim().length < 3} onClick={send}
          className="rounded-btn bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
          {busy ? 'Enregistrement…' : 'Passer en OD'}
        </button>
        <button disabled={busy} onClick={() => { setOpen(false); setReason(''); setMsg(null) }}
          className="rounded-btn border border-strong px-3.5 py-1.5 text-[12.5px] font-semibold text-ink-secondary hover:bg-surface-hover">
          Annuler
        </button>
      </div>
      {msg && <p className="text-[12.5px] font-semibold text-alert">{msg}</p>}
    </div>
  )
}
