'use client'

// Finance › Réconciliation — la file des versements d'un terminal carte.
//
// Un versement se déplie sur les paiements carte qui le composent. Ce qui
// demande une décision s'ouvre tout seul ; ce qui est prêt part en un clic.
// Rien n'est écrit sans ce clic : le serveur revérifie tout de son côté.
//
// Le composant sert Paynovate ET SumUp : les deux prestataires produisent le
// même rapport et acceptent le même contrat (GET / POST / PUT / DELETE), donc
// seuls l'URL et le nom affiché changent. Dupliquer l'écran aurait voulu dire
// corriger deux fois chaque détail de la file.

import { useCallback, useEffect, useState } from 'react'

interface Tx {
  merchantRef: string
  /**
   * Ce sur quoi porte le rattachement manuel. C'est la référence quand il y en
   * a une, sinon l'identifiant de la transaction chez le prestataire — une
   * transaction sans référence doit rester rattachable, et son rattachement ne
   * doit surtout pas resservir au prochain encaissement du même montant.
   */
  linkKey: string
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
  candidates: { id: number; name: string; partner: string; amount: number; date: string; payment_state?: string | null; move_type?: string | null }[]
  issue: 'lost' | 'gap' | 'miss' | null
  manual?: boolean
  by?: string | null          // qui a encaissé — SumUp seulement
  /** Ligne qu'on a décidé de passer en OD sur le compte d'attente. */
  unallocated?: { amount: number; reason: string } | null
  /** Encaissement qui ne règle qu'une partie de la facture — cas légitime. */
  partial?: boolean
  /** Écart d'arrondi signé, absorbé par l'OD. */
  rounding?: number | null
}

interface Payout {
  state: 'ready' | 'lost' | 'gap' | 'miss'
  paymentId: number
  tid: string | null
  terminal?: string | null    // libellé du compte marchand, quand il y en a un
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

/** État d'un versement = le pire de ses transactions. Même règle que le serveur. */
function stateOf(txs: Tx[]): Payout['state'] {
  const live = txs.filter(x => !x.unallocated)   // une ligne passée en OD ne bloque plus
  if (live.some(x => x.issue === 'miss')) return 'miss'
  if (live.some(x => x.issue === 'gap'))  return 'gap'
  if (live.some(x => x.issue === 'lost')) return 'lost'
  return 'ready'
}

/**
 * Applique une décision « passer en OD » sans relire le prestataire. Comme pour
 * les rattachements, c'est de l'affichage : le serveur revérifie tout au clic.
 */
function applyOd(
  prev: Report,
  payoutId: number,
  keys: Set<string>,
  od: { amount: number; reason: string } | null,
): Report {
  const payouts = prev.payouts.map(p => {
    if (p.paymentId !== payoutId) return p
    const txs = p.txs.map(x => {
      if (!keys.has(x.linkKey || x.merchantRef)) return x
      return od
        ? { ...x, unallocated: { amount: x.amount, reason: od.reason }, issue: null,
            invoiceIds: [], invoiceName: null, partner: null, invoiceTotal: null, paymentState: null }
        : { ...x, unallocated: null, issue: 'miss' as const }
    })
    const blocking = txs.filter(x => x.issue).map(x => x.explanation || `${x.merchantRef} à trancher`)
    return { ...p, txs, blocking, state: stateOf(txs) }
  })
  return recount({ ...prev, payouts }, new Set())
}

/**
 * Applique un rattachement manuel sans relire Paynovate. C'est de l'affichage :
 * le serveur revérifie tout au moment du rapprochement, donc une estimation
 * optimiste ici ne peut rien laisser passer.
 */
function applyLink(
  prev: Report,
  payoutId: number,
  txIndex: number,
  res: {
    names: string[]; invoiceIds: number[]; total: number; partner: string
    paymentState: string | null
    confidence?: string; explanation?: string; manual?: boolean; partial?: boolean
    candidates?: Tx['candidates']
  },
): Report {
  const payouts = prev.payouts.map(p => {
    if (p.paymentId !== payoutId) return p
    const txs = p.txs.map((x, i) => {
      if (i !== txIndex) return x
      const linked = res.invoiceIds.length > 0
      const sure   = res.confidence ? ['exact', 'corrige', 'plaque'].includes(res.confidence) : true
      // « fits » vaut aussi pour un règlement partiel : la facture vaut plus que
      // l'encaissement, mais un paiement du montant exact existe. Le serveur l'a
      // vérifié — sans ça l'écran annonçait un blocage qui n'en était pas un.
      const fits   = Math.abs(res.total - x.amount) < 0.005 || !!res.partial
      const paid   = res.paymentState === 'paid' || res.paymentState === 'in_payment'
      const issue: Tx['issue'] =
        (!linked || !sure) ? 'miss'
        : !fits            ? 'gap'
        : (res.paymentState && !paid) ? 'lost'
        : null
      return {
        ...x,
        confidence:   res.confidence ?? 'exact',
        explanation:  res.explanation ?? `Rattachée à la main : ${res.names.join(' + ')}`,
        manual:       res.manual ?? true,
        invoiceIds:   res.invoiceIds,
        invoiceName:  res.names.length ? res.names.join(' + ') : null,
        partner:      res.partner || null,
        invoiceTotal: linked ? res.total : null,
        paymentState: res.paymentState,
        candidates:   res.candidates ?? [],
        partial:      !!res.partial,
        issue,
      }
    })
    const blocking = txs.filter(x => x.issue).map(x => x.explanation || `${x.merchantRef} à trancher`)
    return { ...p, txs, blocking, state: stateOf(txs) }
  })
  return recount({ ...prev, payouts }, new Set())
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

// Le TID dit quel terminal a encaissé — donc quel site. Chez SumUp il n'y a
// qu'un compte marchand : le serveur envoie directement le libellé.
const SITE: Record<string, string> = { '38904065': 'Fourrière', '38912308': 'Dépannage' }

const terminalOf = (p: Payout) => p.terminal || SITE[p.tid || ''] || (p.tid ? `TID ${p.tid}` : null)

export default function ReconciliationClient({
  userName,
  embedded = false,
  endpoint = '/api/finance/reconciliation',
  provider = 'Paynovate',
}: {
  userName: string
  embedded?: boolean
  /** Route qui sert le rapport et reçoit les validations. */
  endpoint?: string
  /** Nom du prestataire, tel qu'il apparaît à l'écran. */
  provider?: string
}) {
  const [report, setReport]   = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState<number[]>([])
  const [open, setOpen]       = useState<Set<number>>(new Set())
  const [toast, setToast]     = useState<string | null>(null)
  const [tab, setTab]         = useState<'queue' | 'lost'>('queue')
  const [picked, setPicked]   = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(endpoint, { cache: 'no-store' })
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
  }, [endpoint])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function reconcile(ids: number[]) {
    setBusy(ids)
    try {
      const r = await fetch(endpoint, {
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

      // On retire les versements traités de la file sans tout relire chez le
      // prestataire : une relecture complète, c'est dix secondes d'attente pour
      // un résultat qu'on connaît déjà. Le bouton « Actualiser » reste là.
      if (ok.length) {
        const settled = new Set<number>(ok.map((x: any) => Number(x.payoutId)))
        setReport(prev => (prev ? recount(prev, settled) : prev))
        setPicked(prev => { const n = new Set(prev); settled.forEach(id => n.delete(id)); return n })
      }
    } catch (e: any) {
      setToast(`Échec : ${e.message}`)
    } finally {
      setBusy([])
    }
  }

  const toggle = (id: number) =>
    setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading) return <Shell bare={embedded}><p className="text-ink-muted">Lecture des versements chez {provider}…</p></Shell>

  if (error) return (
    <Shell bare={embedded}>
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
    <Shell bare={embedded}>
      {!embedded && <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-faint">VD Soft · Finance</span>
        <h1 className="font-display text-2xl font-bold tracking-tight">Réconciliation</h1>
        <p className="max-w-[62ch] text-sm text-ink-muted">
          Les versements {provider} arrivés sur le compte, rapprochés des factures qu&apos;ils paient.
        </p>
      </header>}

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
            title={`Relit les versements chez ${provider} — une dizaine de secondes`}
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
                Payé le {x.at ? day(x.at.slice(0, 10)) : '—'} par {x.cardBrand || 'carte'}
                {x.by ? ` · encaissé par ${x.by}` : (terminalOf(p) ? ` · ${terminalOf(p)}` : '')}
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
            // « lost » est actionnable au même titre que « ready » : le module
            // crée le paiement manquant avant de lettrer. Ne montrer le bouton
            // que sur « ready » laissait ces versements sans aucune action.
            const actionable = p.state === 'ready' || p.state === 'lost'
            const lostCount  = p.txs.filter(t => t.issue === 'lost').length
            return (
              <article key={p.paymentId}
                className={`overflow-hidden rounded-card border border-border border-l-[3px] bg-surface shadow-sm ${BAR[p.state]}`}>
                <div className="flex w-full items-center gap-3 p-3.5">
                  {actionable ? (
                    <input type="checkbox" checked={picked.has(p.paymentId)}
                      onChange={() => setPicked(s => { const n = new Set(s); n.has(p.paymentId) ? n.delete(p.paymentId) : n.add(p.paymentId); return n })}
                      aria-label={`Sélectionner le versement de ${eur(p.bankAmount)}`}
                      className="size-4 shrink-0 accent-[var(--brand)]" />
                  ) : <span className="size-4 shrink-0" />}
                <button onClick={() => toggle(p.paymentId)}
                  aria-expanded={isOpen}
                  className="flex flex-1 items-center gap-3 text-left">
                  <span className={`text-ink-faint transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex flex-wrap items-baseline gap-2.5">
                      <span className="font-mono text-[17px] font-semibold tabular-nums">{eur(p.bankAmount)}</span>
                      <span className="text-[13.5px] text-ink-muted">reçu le {day(p.bankDate)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${st.cls}`}>{st.label}</span>
                      {terminalOf(p) && (
                        <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-[11.5px] font-semibold text-ink-secondary">
                          {terminalOf(p)}
                        </span>
                      )}
                      <span className="text-xs text-ink-muted">
                        {p.txs.length} paiement{p.txs.length > 1 ? 's' : ''} carte
                      </span>
                    </span>
                  </span>
                </button>

                {actionable && (
                  <button
                    disabled={working}
                    onClick={() => reconcile([p.paymentId])}
                    title={p.state === 'lost'
                      ? `Enregistre ${lostCount} paiement${lostCount > 1 ? 's' : ''} carte manquant${lostCount > 1 ? 's' : ''}, solde la ou les factures, puis lettre le versement`
                      : undefined}
                    className="shrink-0 rounded-btn bg-brand px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
                    {working ? 'En cours…' : p.state === 'lost' ? 'Rapprocher et solder' : 'Rapprocher'}
                  </button>
                )}
                </div>

                {isOpen && (
                  <div className="border-t border-border bg-surface-2 px-4 pb-3.5 pt-1">
                    {p.txs.map((x, i) => (
                      <div key={i} className="border-b border-dashed border-border py-3 last:border-b-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-3">
                          <span className="font-mono text-xs text-ink-muted">
                            {x.at ? `${day(x.at.slice(0, 10))} · ${x.at.slice(11, 16)}` : '—'}
                            <span className="ml-2 uppercase tracking-wider text-ink-faint">{x.cardBrand}</span>
                            {x.by && <span className="ml-2 text-ink-faint">par {x.by}</span>}
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums">{eur(x.amount)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-[13px] font-semibold">
                            {x.invoiceName || x.merchantRef || <span className="text-ink-faint italic">sans référence</span>}
                          </span>
                          {x.partner && <span className="text-[13.5px] text-ink-secondary">{x.partner}</span>}
                          {!x.issue && !x.partial && !x.rounding && <span className="text-xs font-semibold text-success">✓ facture soldée</span>}
                          {!x.issue && !!x.rounding && (
                            <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info">
                              arrondi {x.rounding > 0 ? '+' : ''}{x.rounding.toFixed(2)} € — absorbé par l&apos;OD
                            </span>
                          )}
                          {!x.issue && x.partial && (
                            <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info">
                              règlement partiel · {eur(x.amount)} sur {eur(x.invoiceTotal ?? x.amount)}
                            </span>
                          )}
                          {x.manual && (
                            <Detacher
                              endpoint={endpoint}
                              tx={x}
                              onDetached={res => {
                                setReport(prev => (prev ? applyLink(prev, p.paymentId, i, res) : prev))
                                setToast(res.removed ? 'Rattachement défait' : 'Aucun rattachement à défaire')
                              }}
                            />
                          )}
                        </div>
                        {x.unallocated && (
                          <div className="mt-2 flex flex-wrap items-baseline gap-2 rounded-btn border-l-2 border-info bg-info-soft px-3 py-2 text-[12.5px]">
                            <span className="font-semibold text-info">Passée en OD — compte d&apos;attente 499000</span>
                            <span className="text-ink-secondary">« {x.unallocated.reason} »</span>
                            <button
                              onClick={async () => {
                                const r = await fetch(endpoint, {
                                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ linkKey: x.linkKey || x.merchantRef, amount: x.amount, clear: true }),
                                })
                                if (r.ok) {
                                  setReport(prev => (prev ? applyOd(prev, p.paymentId, new Set([x.linkKey || x.merchantRef]), null) : prev))
                                  setToast('Passage en OD annulé')
                                }
                              }}
                              className="text-[11.5px] font-semibold text-brand hover:underline">
                              Annuler
                            </button>
                          </div>
                        )}
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
                        {/* Dès qu'il y a un souci, on doit pouvoir désigner la
                            bonne facture — une note de crédit suivie d'une
                            refacturation rend la facture d'origine caduque. */}
                        {x.issue && (
                          <>
                            <Linker
                              endpoint={endpoint}
                              tx={x}
                              onLinked={res => {
                                setReport(prev => (prev ? applyLink(prev, p.paymentId, i, res) : prev))
                                setToast(`Rattachée à ${res.names.join(' + ')}`)
                              }}
                            />
                            {/* Dernier recours quand la facture est introuvable :
                                l'argent est bien arrivé, la ligne bancaire doit
                                pouvoir se lettrer. Le montant part en attente. */}
                            <OdEscape
                              endpoint={endpoint}
                              lines={[x]}
                              onDone={res => {
                                setReport(prev => (prev ? applyOd(prev, p.paymentId, new Set([x.linkKey || x.merchantRef]), res) : prev))
                                setToast('Ligne passée en OD sur le compte d\'attente')
                              }}
                            />
                          </>
                        )}
                      </div>
                    ))}
                    {p.txs.filter(x => x.issue).length > 1 && (
                      <div className="mt-3 rounded-btn border border-dashed border-strong bg-surface p-3">
                        <p className="text-[12.5px] font-semibold text-ink-secondary">
                          {p.txs.filter(x => x.issue).length} lignes bloquées sur ce versement
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-ink-muted">
                          Si aucune n&apos;est retrouvable, elles peuvent partir ensemble en OD avec le même commentaire.
                        </p>
                        <OdEscape
                          endpoint={endpoint}
                          lines={p.txs.filter(x => x.issue)}
                          label={`Tout passer en OD · ${eur(p.txs.filter(x => x.issue).reduce((s, x) => s + x.amount, 0))}`}
                          onDone={res => {
                            const keys = new Set(p.txs.filter(x => x.issue).map(x => x.linkKey || x.merchantRef))
                            setReport(prev => (prev ? applyOd(prev, p.paymentId, keys, res) : prev))
                            setToast(`${keys.size} lignes passées en OD`)
                          }}
                        />
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-2.5 text-[12.5px] text-ink-muted">
                      <span>Frais {provider} <span className="font-mono font-semibold text-ink-secondary">{eur(p.commission)}</span> — passés en OD sur le compte fournisseur</span>
                      <span className="font-mono text-[11px] text-ink-faint">versement {p.paymentId} · extrait {p.bankMoveName}</span>
                    </div>
                  </div>
                )}
              </article>
            )
          })}

          {picked.size > 0 && (
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-md">
              <p className="text-[13px] text-ink-secondary">
                <strong>{picked.size}</strong> versement{picked.size > 1 ? 's' : ''} sélectionné{picked.size > 1 ? 's' : ''} ·{' '}
                {eur(shown.filter(p => picked.has(p.paymentId)).reduce((s, p) => s + p.bankAmount, 0))}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPicked(new Set())}
                  className="rounded-btn border border-strong px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-hover">
                  Annuler
                </button>
                <button disabled={busy.length > 0} onClick={() => reconcile([...picked])}
                  className="rounded-btn bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
                  {busy.length ? 'Rapprochement…' : `Rapprocher la sélection · ${eur(shown.filter(p => picked.has(p.paymentId)).reduce((s, p) => s + p.bankAmount, 0))}`}
                </button>
              </div>
            </div>
          )}

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

function Shell({ children, bare }: { children: React.ReactNode; bare?: boolean }) {
  // Embarqué dans SourceTabs, le conteneur et l'en-tête sont déjà posés.
  if (bare) return <div className="flex flex-col gap-7">{children}</div>
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
function Linker({ tx, endpoint, onLinked }: { tx: Tx; endpoint: string; onLinked: (res: any) => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState<string | null>(null)

  async function link(names: string[]) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantRef: tx.linkKey || tx.merchantRef, amount: tx.amount, invoiceNames: names }),
      })
      const j = await r.json()
      if (!r.ok) { setMsg(j.error || `Erreur ${r.status}`); return }
      // Mise à jour sur place : pas de relecture du prestataire pour un rattachement.
      if (j.warning) setMsg(j.warning)
      onLinked(j)
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
              <span>
                <span className="font-mono">{c.name}</span> · {c.partner} ·{' '}
                <span className="font-mono">{eur(c.amount)}</span>
                {c.move_type === 'out_refund' && (
                  <span className="ml-2 rounded-full bg-info-soft px-2 py-0.5 text-[10.5px] font-semibold text-info">note de crédit</span>
                )}
              </span>
              <button disabled={busy} onClick={() => link([c.name])}
                className="shrink-0 text-[12.5px] font-semibold text-brand hover:underline disabled:text-ink-faint">
                C&apos;est celle-là
              </button>
            </div>
          ))}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-btn border border-dashed border-strong bg-surface px-3 py-2.5">
        <label className="text-[12.5px] text-ink-secondary" htmlFor={`inv-${tx.linkKey || tx.merchantRef}`}>
          {tx.invoiceName
            ? 'Ce n\'est pas la bonne facture ? Indique le bon numéro :'
            : tx.candidates.length > 0
              ? 'Aucune ne convient — numéro de facture :'
              : 'Numéro de facture :'}
        </label>
        <input
          id={`inv-${tx.linkKey || tx.merchantRef}`}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) link(value.split(/[\s,;+]+/).filter(Boolean)) }}
          placeholder="2026/07/123 2026-0221"
          className="w-64 rounded-btn border border-strong bg-input px-2.5 py-1.5 font-mono text-[13px] text-ink placeholder:text-ink-faint"
        />
        <button
          disabled={busy || !value.trim()}
          onClick={() => link(value.split(/[\s,;+]+/).filter(Boolean))}
          className="rounded-btn bg-brand px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-hover disabled:bg-surface-hover disabled:text-ink-faint">
          {busy ? 'Rattachement…' : 'Rattacher'}
        </button>
        <span className="w-full text-[11.5px] text-ink-faint">
          Plusieurs documents ? Sépare-les par un espace — et une note de crédit vient
          automatiquement en déduction. Le rattachement est mémorisé pour la prochaine fois.
        </span>
      </div>

      {msg && <p className="text-[12.5px] font-semibold text-ink-secondary">{msg}</p>}
    </div>
  )
}

/**
 * Passer une ou plusieurs lignes en OD sur le compte d'attente.
 *
 * Dernier recours : la facture est introuvable, mais l'argent est bien arrivé
 * sur le compte et la ligne bancaire doit pouvoir se lettrer. Le montant part
 * en 499000 en attendant d'être affecté.
 *
 * Le commentaire est obligatoire — c'est la seule chose lisible que le
 * comptable aura en face du montant, et il est repris tel quel dans le libellé
 * des lignes d'écriture.
 */
function OdEscape({ endpoint, lines, label, onDone }: {
  endpoint: string
  lines: Tx[]
  label?: string
  onDone: (res: { amount: number; reason: string }) => void
}) {
  const [open, setOpen]   = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState<string | null>(null)

  const total = lines.reduce((s, x) => s + x.amount, 0)

  async function send() {
    setBusy(true); setMsg(null)
    try {
      for (const x of lines) {
        const r = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linkKey: x.linkKey || x.merchantRef, amount: x.amount, reason }),
        })
        const j = await r.json()
        if (!r.ok) { setMsg(j.error || `Erreur ${r.status}`); return }
      }
      onDone({ amount: total, reason: reason.trim() })
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)}
      className="mt-2 self-start text-[12px] font-semibold text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink">
      {label || 'Facture introuvable — passer en OD'}
    </button>
  )

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-btn border border-strong bg-surface px-3 py-2.5">
      <p className="text-[12.5px] text-ink-secondary">
        <strong>{eur(total)}</strong> {lines.length > 1 ? `sur ${lines.length} lignes ` : ''}
        part en attente sur <span className="font-mono">499000</span>. La ligne bancaire pourra se lettrer,
        et le montant restera visible tant qu&apos;il n&apos;est pas affecté.
      </p>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint" htmlFor={`od-${lines[0]?.linkKey}`}>
        Commentaire — repris dans l&apos;écriture
      </label>
      <input
        id={`od-${lines[0]?.linkKey}`}
        value={reason}
        onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && reason.trim().length >= 3) send() }}
        placeholder="Ex. : encaissement terminal sans référence, facture non retrouvée"
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

/** Défait un rattachement fait à la main, et rend la main à la résolution auto. */
function Detacher({ tx, endpoint, onDetached }: { tx: Tx; endpoint: string; onDetached: (res: any) => void }) {
  const [busy, setBusy] = useState(false)

  async function detach() {
    setBusy(true)
    try {
      const r = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantRef: tx.linkKey || tx.merchantRef, amount: tx.amount, at: tx.at }),
      })
      const j = await r.json()
      if (r.ok) onDetached(j)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="rounded-full bg-info-soft px-2 py-0.5 text-[11px] font-semibold text-info">
        rattachée à la main
      </span>
      <button onClick={detach} disabled={busy}
        title="Supprime le rattachement et refait la recherche automatique"
        className="text-[11.5px] font-semibold text-brand hover:underline disabled:text-ink-faint">
        {busy ? '…' : 'Détacher'}
      </button>
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-strong bg-surface-2 p-6 text-center text-[13.5px] text-ink-muted">
      {children}
    </div>
  )
}
