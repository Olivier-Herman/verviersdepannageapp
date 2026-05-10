'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Session }                 from 'next-auth'
import AppShell                         from '@/components/layout/AppShell'

type ReminderLevel = 1 | 2 | 3
type SendLevel     = ReminderLevel | 'AUTO'

interface OverdueInvoice {
  id:               number
  name:             string
  invoiceDate:      string
  dueDate:          string
  daysOverdue:      number
  level:            ReminderLevel
  amountTotal:      number
  amountResidual:   number
  plate:            string | null
  vehicleLabel:     string | null
}

interface PartnerGroup {
  partnerId:       number
  partnerName:     string
  partnerRef:      string | null
  partnerEmail:    string | null
  partnerVat:      string | null
  partnerPhone:    string | null
  invoices:        OverdueInvoice[]
  totalResidual:   number
  maxDaysOverdue:  number
  level:           ReminderLevel
  lastReminder:    {
    level:     ReminderLevel
    sentAt:    string
    daysSince: number
    dryRun:    boolean
  } | null
}

interface SendResultRow {
  partnerId:    number
  partnerName?: string
  level?:       ReminderLevel
  ok:           boolean
  error?:       string
  reference?:   string
  totalDue?:    number
  invoiceCount?: number
  reminderId?:  string
  dryRun:       boolean
}

interface HistoryItem {
  id:               string
  partner_id_odoo:  number
  partner_name:     string
  level:            ReminderLevel
  sent_at:          string
  sent_by_name:     string | null
  email_to:         string
  invoice_count:    number
  total_amount:     number
  graph_message_id: string | null
  dry_run:          boolean
  pdf_signed_url:   string | null
  xlsx_signed_url:  string | null
}

const LEVEL_LABEL: Record<ReminderLevel, string> = {
  1: 'L1 — Amical',
  2: 'L2 — Ferme',
  3: 'L3 — Mise en demeure',
}

const LEVEL_BADGE: Record<ReminderLevel, string> = {
  1: 'bg-info-soft text-info',
  2: 'bg-warning-soft text-warning',
  3: 'bg-critical-soft text-critical',
}

function formatEur(n: number): string {
  const fixed = Math.abs(n).toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}${intGrouped},${decPart} €`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// ============================================================
// Composant principal
// ============================================================

export default function RelancesClient({ session }: { session: Session }) {
  const sessionUser = session.user as any

  const [groups,    setGroups]    = useState<PartnerGroup[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [fetched,   setFetched]   = useState(0)
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState<ReminderLevel | 'all'>('all')

  // Selection multiple
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Send options
  const [sendLevel, setSendLevel] = useState<SendLevel>('AUTO')
  const [dryRun,    setDryRun]    = useState(true)   // dry-run par defaut, securite

  // Modals
  const [previewing,        setPreviewing]    = useState<number | null>(null)
  const [confirmOpen,       setConfirmOpen]   = useState(false)
  const [sendingProgress,   setSendingProgress] = useState<{ done: number; total: number } | null>(null)
  const [sendResults,       setSendResults]   = useState<SendResultRow[] | null>(null)

  // Historique
  const [historyOpen,    setHistoryOpen]    = useState(false)
  const [historyItems,   setHistoryItems]   = useState<HistoryItem[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError,   setHistoryError]   = useState<string | null>(null)

  // Load list
  const loadList = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/relances/list', { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const j = await res.json()
      setGroups(j.groups || [])
      setTruncated(!!j.truncated)
      setFetched(j.fetched || 0)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadList() }, [])

  // Load history (lazy : seulement quand la section est ouverte)
  const loadHistory = async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch('/api/relances/history?limit=50', { cache: 'no-store' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${res.status}`)
      }
      const j = await res.json()
      setHistoryItems(j.items || [])
    } catch (e: any) {
      setHistoryError(e.message)
    } finally {
      setHistoryLoading(false)
    }
  }
  useEffect(() => {
    if (historyOpen && historyItems === null) loadHistory()
  }, [historyOpen, historyItems])

  const filtered = groups
    ? (filter === 'all' ? groups : groups.filter(g => g.level === filter))
    : []
  const counts = {
    1: groups?.filter(g => g.level === 1).length ?? 0,
    2: groups?.filter(g => g.level === 2).length ?? 0,
    3: groups?.filter(g => g.level === 3).length ?? 0,
  }
  const totalAll = groups?.reduce((s, g) => s + g.totalResidual, 0) ?? 0

  // Selection helpers
  const toggleOne = (partnerId: number, hasEmail: boolean) => {
    if (!hasEmail) return  // pas d email = pas selectionnable
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(partnerId)) next.delete(partnerId)
      else next.add(partnerId)
      return next
    })
  }
  const toggleAllVisible = () => {
    const eligible = filtered.filter(g => !!g.partnerEmail).map(g => g.partnerId)
    const allOn = eligible.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allOn) eligible.forEach(id => next.delete(id))
      else       eligible.forEach(id => next.add(id))
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const selectedGroups = useMemo(
    () => (groups || []).filter(g => selectedIds.has(g.partnerId)),
    [groups, selectedIds],
  )
  const selectedTotal = selectedGroups.reduce((s, g) => s + g.totalResidual, 0)
  const eligibleVisibleCount = filtered.filter(g => !!g.partnerEmail).length
  const allVisibleSelected   = eligibleVisibleCount > 0
                            && filtered.filter(g => !!g.partnerEmail)
                                       .every(g => selectedIds.has(g.partnerId))

  // ── Envoi ──
  const doSend = async () => {
    setConfirmOpen(false)
    setSendingProgress({ done: 0, total: selectedIds.size })
    setSendResults(null)
    try {
      const res = await fetch('/api/relances/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          partnerIds: Array.from(selectedIds),
          level:      sendLevel,
          dryRun,
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        setSendResults([{
          partnerId: 0, ok: false, dryRun,
          error: j.error || `HTTP ${res.status}`,
        }])
      } else {
        setSendResults(j.results || [])
      }
    } catch (e: any) {
      setSendResults([{ partnerId: 0, ok: false, dryRun, error: e.message }])
    } finally {
      setSendingProgress(null)
    }
  }

  return (
    <AppShell
      title="Relance Client"
      backHref="/dashboard"
      userRole={sessionUser.role || ''}
      userName={session.user?.name ?? ''}
      userEmail={session.user?.email ?? undefined}
      userId={sessionUser.id}
      userModules={sessionUser.modules || []}
    >
      <div className="max-w-6xl mx-auto p-4 pb-32 space-y-4">

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-ink-muted">
            Factures Odoo échues, regroupées par client, prêtes à être relancées.
          </p>
          {groups && (
            <div className="text-sm text-ink-muted whitespace-nowrap">
              {groups.length} client{groups.length > 1 ? 's' : ''} · {formatEur(totalAll)}
            </div>
          )}
        </div>

        {/* Filtres niveau */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
              filter === 'all'
                ? 'bg-brand text-white border-brand'
                : 'bg-surface-2 text-ink border'
            }`}
          >
            Tous ({groups?.length ?? 0})
          </button>
          {([1, 2, 3] as ReminderLevel[]).map(lvl => (
            <button
              key={lvl}
              onClick={() => setFilter(lvl)}
              className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                filter === lvl
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface-2 text-ink border'
              }`}
            >
              {LEVEL_LABEL[lvl]} ({counts[lvl]})
            </button>
          ))}

          {/* Tout sélectionner */}
          {filtered.length > 0 && eligibleVisibleCount > 0 && (
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="w-4 h-4 accent-brand"
              />
              Tout sélectionner ({eligibleVisibleCount})
            </label>
          )}
        </div>

        {loading && (
          <div className="text-sm text-ink-muted py-12 text-center">
            Chargement des factures échues…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-critical-soft text-critical p-3 text-sm">
            ❌ {error}
          </div>
        )}

        {truncated && (
          <div className="rounded-md bg-warning-soft text-warning p-3 text-sm">
            ⚠ Plus de {fetched} factures échues — la liste est tronquée. Certains
            clients peuvent manquer.
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-md bg-surface-2 border p-6 text-center text-sm text-ink-muted">
            🎉 Aucune facture échue à ce niveau. Bravo.
          </div>
        )}

        {/* Bouton ouverture historique (en-tete) */}
        {!loading && !error && (
          <div className="flex justify-end">
            <button
              onClick={() => {
                setHistoryOpen(o => !o)
                if (!historyOpen && historyItems !== null) loadHistory()  // refresh si re-ouverture
              }}
              className="text-sm text-brand hover:underline"
            >
              {historyOpen ? '▲ Masquer l\'historique' : '📜 Voir l\'historique des relances envoyées'}
            </button>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map(g => {
              const selected = selectedIds.has(g.partnerId)
              const noEmail  = !g.partnerEmail
              const warnDup  = g.lastReminder
                            && g.lastReminder.daysSince < 7
                            && g.lastReminder.level === g.level

              return (
                <article
                  key={g.partnerId}
                  className={`rounded-lg border bg-surface-2 p-4 transition-colors ${
                    selected ? 'ring-2 ring-brand border-brand' : ''
                  } ${noEmail ? 'opacity-60' : ''}`}
                >
                  <header className="flex items-start gap-3 mb-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={noEmail}
                      onChange={() => toggleOne(g.partnerId, !noEmail)}
                      className="mt-1 w-4 h-4 accent-brand cursor-pointer disabled:cursor-not-allowed"
                      title={noEmail ? 'Pas d\'email — non sélectionnable' : ''}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink truncate">
                        {g.partnerName}
                        {g.partnerRef && (
                          <span className="ml-2 text-xs text-ink-muted font-normal">
                            [{g.partnerRef}]
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        {g.partnerEmail || <span className="text-warning">⚠ pas d'email — appel téléphone requis</span>}
                        {g.partnerVat && ` · ${g.partnerVat}`}
                      </div>
                    </div>
                    <span className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${LEVEL_BADGE[g.level]}`}>
                      {LEVEL_LABEL[g.level]}
                    </span>
                  </header>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2 ml-7">
                    <span className="text-ink">
                      <strong>{formatEur(g.totalResidual)}</strong> dû
                    </span>
                    <span className="text-ink-muted">
                      {g.invoices.length} facture{g.invoices.length > 1 ? 's' : ''}
                    </span>
                    <span className="text-ink-muted">
                      Retard max : {g.maxDaysOverdue} jours
                    </span>
                    <button
                      onClick={() => setPreviewing(g.partnerId)}
                      disabled={noEmail}
                      className="ml-auto text-xs text-brand hover:underline disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed"
                    >
                      🔍 Aperçu
                    </button>
                  </div>

                  {g.lastReminder && (
                    <div className={`text-xs rounded px-2 py-1 inline-block mb-2 ml-7 ${
                      warnDup ? 'bg-critical-soft text-critical font-medium' : 'bg-warning-soft text-warning'
                    }`}>
                      {warnDup ? '🚨' : '⚠'} Dernière relance : L{g.lastReminder.level} il y a {g.lastReminder.daysSince}j
                      {g.lastReminder.dryRun && ' (simulation)'}
                      {warnDup && ' — éviter le doublon'}
                    </div>
                  )}

                  <details className="text-sm ml-7">
                    <summary className="cursor-pointer text-ink-muted hover:text-ink select-none">
                      Voir les factures ({g.invoices.length})
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-ink-muted border-b">
                          <tr className="text-left">
                            <th className="py-1 pr-2 font-medium">Date facture</th>
                            <th className="py-1 pr-2 font-medium">N° facture</th>
                            <th className="py-1 pr-2 font-medium">Réf. client</th>
                            <th className="py-1 pr-2 font-medium">Véhicule</th>
                            <th className="py-1 pr-2 font-medium">Échéance</th>
                            <th className="py-1 pr-2 font-medium text-right">Jours</th>
                            <th className="py-1 pr-2 font-medium text-right">Montant TVAC</th>
                            <th className="py-1 pr-2 font-medium text-right">Reste dû</th>
                            <th className="py-1 font-medium">Niveau</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.invoices.map(inv => (
                            <tr key={inv.id} className="border-b last:border-0">
                              <td className="py-1 pr-2 text-ink whitespace-nowrap">{formatDate(inv.invoiceDate)}</td>
                              <td className="py-1 pr-2 text-ink font-mono whitespace-nowrap">{inv.name}</td>
                              <td className="py-1 pr-2 text-ink-muted whitespace-nowrap">{g.partnerRef || '—'}</td>
                              <td className="py-1 pr-2 text-ink-muted whitespace-nowrap">
                                {inv.plate
                                  ? <>{inv.plate}{inv.vehicleLabel && <span className="text-ink-muted ml-1">· {inv.vehicleLabel}</span>}</>
                                  : '—'}
                              </td>
                              <td className="py-1 pr-2 text-ink-muted whitespace-nowrap">{formatDate(inv.dueDate)}</td>
                              <td className="py-1 pr-2 text-ink-muted text-right whitespace-nowrap">{inv.daysOverdue}j</td>
                              <td className="py-1 pr-2 text-ink-muted text-right whitespace-nowrap">{formatEur(inv.amountTotal)}</td>
                              <td className="py-1 pr-2 text-ink font-medium text-right whitespace-nowrap">{formatEur(inv.amountResidual)}</td>
                              <td className="py-1">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${LEVEL_BADGE[inv.level]}`}>
                                  L{inv.level}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </article>
              )
            })}
          </div>
        )}

        {/* ── Section Historique (collapsible) ── */}
        {historyOpen && (
          <section className="mt-6 rounded-lg border bg-surface-2">
            <header className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-ink">Historique des relances</h3>
                <p className="text-xs text-ink-muted">
                  Les 50 dernières relances envoyées (dry-run inclus)
                </p>
              </div>
              <button
                onClick={loadHistory}
                disabled={historyLoading}
                className="text-xs text-brand hover:underline disabled:text-ink-muted"
              >
                {historyLoading ? 'Chargement…' : '↻ Rafraîchir'}
              </button>
            </header>

            {historyError && (
              <div className="m-4 rounded bg-critical-soft text-critical p-3 text-sm">
                ❌ {historyError}
              </div>
            )}

            {historyItems && historyItems.length === 0 && !historyLoading && (
              <div className="p-6 text-center text-sm text-ink-muted">
                Aucune relance envoyée pour l'instant.
              </div>
            )}

            {historyItems && historyItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-ink-muted text-xs uppercase">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Client</th>
                      <th className="px-3 py-2 font-medium">Niveau</th>
                      <th className="px-3 py-2 font-medium text-right">Factures</th>
                      <th className="px-3 py-2 font-medium text-right">Montant</th>
                      <th className="px-3 py-2 font-medium">Mode</th>
                      <th className="px-3 py-2 font-medium">Par</th>
                      <th className="px-3 py-2 font-medium text-right">Fichiers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyItems.map(it => {
                      const sentAt = new Date(it.sent_at)
                      const sentAtStr = sentAt.toLocaleDateString('fr-BE', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                      }) + ' ' + sentAt.toLocaleTimeString('fr-BE', {
                        hour: '2-digit', minute: '2-digit',
                      })
                      return (
                        <tr key={it.id} className="border-t">
                          <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{sentAtStr}</td>
                          <td className="px-3 py-2 text-ink">{it.partner_name}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${LEVEL_BADGE[it.level]}`}>
                              L{it.level}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-ink-muted text-right">{it.invoice_count}</td>
                          <td className="px-3 py-2 text-ink font-medium text-right whitespace-nowrap">
                            {formatEur(it.total_amount)}
                          </td>
                          <td className="px-3 py-2">
                            {it.dry_run
                              ? <span className="text-warning text-xs">🧪 simulation</span>
                              : <span className="text-success text-xs">✉ envoyé</span>}
                          </td>
                          <td className="px-3 py-2 text-ink-muted text-xs whitespace-nowrap">
                            {it.sent_by_name || '—'}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {it.pdf_signed_url && (
                              <a href={it.pdf_signed_url} target="_blank" rel="noopener noreferrer"
                                 className="text-xs text-brand hover:underline mr-2">PDF</a>
                            )}
                            {it.xlsx_signed_url && (
                              <a href={it.xlsx_signed_url} target="_blank" rel="noopener noreferrer"
                                 className="text-xs text-brand hover:underline">XLSX</a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {/* ── Sticky bottom bar (apparait quand selection > 0) ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-surface border-t shadow-lg z-30">
          <div className="max-w-6xl mx-auto p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">
                {selectedIds.size} client{selectedIds.size > 1 ? 's' : ''} sélectionné{selectedIds.size > 1 ? 's' : ''}
              </div>
              <div className="text-xs text-ink-muted">
                Total : {formatEur(selectedTotal)}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-muted">Niveau :</span>
              <select
                value={String(sendLevel)}
                onChange={e => {
                  const v = e.target.value
                  setSendLevel(v === 'AUTO' ? 'AUTO' : (parseInt(v, 10) as ReminderLevel))
                }}
                className="bg-surface-2 border rounded px-2 py-1.5 text-sm text-ink"
              >
                <option value="AUTO">AUTO (selon retard)</option>
                <option value="1">L1 — Amical</option>
                <option value="2">L2 — Ferme</option>
                <option value="3">L3 — Mise en demeure</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={e => setDryRun(e.target.checked)}
                className="w-4 h-4 accent-warning"
              />
              <span className={dryRun ? 'text-warning font-medium' : 'text-ink-muted'}>
                {dryRun ? '🧪 Mode simulation' : '✉ Envoi réel'}
              </span>
            </label>

            <button
              onClick={clearSelection}
              className="text-sm text-ink-muted hover:text-ink px-3 py-1.5"
            >
              Annuler
            </button>
            <button
              onClick={() => setConfirmOpen(true)}
              className="bg-brand text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90"
            >
              {dryRun ? 'Tester' : 'Envoyer'}
            </button>
          </div>
        </div>
      )}

      {/* ── Modal Aperçu ── */}
      {previewing !== null && (
        <PreviewModal
          partnerId={previewing}
          group={groups?.find(g => g.partnerId === previewing) || null}
          defaultLevel={(groups?.find(g => g.partnerId === previewing)?.level || 1) as ReminderLevel}
          onClose={() => setPreviewing(null)}
        />
      )}

      {/* ── Modal Confirmation ── */}
      {confirmOpen && (
        <ConfirmModal
          count={selectedIds.size}
          totalDue={selectedTotal}
          level={sendLevel}
          dryRun={dryRun}
          partners={selectedGroups}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doSend}
        />
      )}

      {/* ── Modal Envoi en cours ── */}
      {sendingProgress && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-lg p-6 max-w-md w-full text-center">
            <div className="text-2xl mb-2">{dryRun ? '🧪' : '📨'}</div>
            <div className="text-lg font-semibold text-ink mb-2">
              {dryRun ? 'Simulation en cours…' : 'Envoi en cours…'}
            </div>
            <div className="text-sm text-ink-muted mb-3">
              {sendingProgress.total} relance{sendingProgress.total > 1 ? 's' : ''} en traitement.
              <br />
              Cela peut prendre jusqu'à 30 secondes.
            </div>
            <div className="w-full h-2 bg-surface-2 rounded overflow-hidden">
              <div className="h-full bg-brand animate-pulse" style={{ width: '100%' }} />
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Résultats ── */}
      {sendResults && (
        <ResultModal
          results={sendResults}
          dryRun={dryRun}
          onClose={() => {
            setSendResults(null)
            clearSelection()
            loadList()  // refresh la liste pour voir lastReminder mis a jour
          }}
        />
      )}
    </AppShell>
  )
}

// ============================================================
// Modal : Aperçu PDF + XLSX d'un partner réel
// ============================================================
function PreviewModal({
  partnerId, group, defaultLevel, onClose,
}: {
  partnerId:    number
  group:        PartnerGroup | null
  defaultLevel: ReminderLevel
  onClose:      () => void
}) {
  const [level, setLevel]     = useState<ReminderLevel>(defaultLevel)
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ pdf: { signedUrl: string }; xlsx: { signedUrl: string }; reference: string } | null>(null)
  const [error,  setError]    = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/relances/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ partnerId, level }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      setResult(j)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-ink">Aperçu relance</h2>
            <p className="text-sm text-ink-muted">{group?.partnerName || `Partner #${partnerId}`}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-sm text-ink-muted block mb-1">Niveau de relance à prévisualiser</span>
            <select
              value={level}
              onChange={e => setLevel(parseInt(e.target.value, 10) as ReminderLevel)}
              className="bg-surface-2 border rounded px-3 py-2 text-sm text-ink w-full"
            >
              <option value={1}>L1 — Rappel amical</option>
              <option value={2}>L2 — Relance ferme</option>
              <option value={3}>L3 — Mise en demeure</option>
            </select>
          </label>

          <button
            onClick={generate}
            disabled={loading}
            className="w-full bg-brand text-white py-2 rounded-md font-medium hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Génération…' : 'Générer l\'aperçu'}
          </button>

          {error && (
            <div className="rounded bg-critical-soft text-critical p-3 text-sm">❌ {error}</div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded bg-success-soft text-success p-3 text-sm">
                ✅ Aperçu généré · Réf : <span className="font-mono">{result.reference}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a href={result.pdf.signedUrl} target="_blank" rel="noopener noreferrer"
                   className="bg-surface-2 border rounded p-3 text-center hover:bg-surface text-sm">
                  📄 Voir le PDF
                </a>
                <a href={result.xlsx.signedUrl} target="_blank" rel="noopener noreferrer"
                   className="bg-surface-2 border rounded p-3 text-center hover:bg-surface text-sm">
                  📊 Télécharger XLSX
                </a>
              </div>
              <p className="text-xs text-ink-muted">
                Ces liens sont valides 24h. Aucun email n'a été envoyé, aucun tracking.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Modal : Confirmation avant envoi
// ============================================================
function ConfirmModal({
  count, totalDue, level, dryRun, partners, onCancel, onConfirm,
}: {
  count:     number
  totalDue:  number
  level:     SendLevel
  dryRun:    boolean
  partners:  PartnerGroup[]
  onCancel:  () => void
  onConfirm: () => void
}) {
  const noEmailCount = partners.filter(p => !p.partnerEmail).length
  const dupCount     = partners.filter(p =>
    p.lastReminder
    && p.lastReminder.daysSince < 7
    && (level === 'AUTO' ? p.lastReminder.level === p.level : p.lastReminder.level === level)
  ).length

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b">
          <h2 className="text-lg font-semibold text-ink">
            {dryRun ? '🧪 Confirmer la simulation' : '✉ Confirmer l\'envoi'}
          </h2>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-muted">Clients :</span>
            <span className="font-semibold">{count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Total dû :</span>
            <span className="font-semibold">{formatEur(totalDue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Niveau :</span>
            <span className="font-semibold">
              {level === 'AUTO' ? 'AUTO (selon retard)' : LEVEL_LABEL[level]}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">Mode :</span>
            <span className={dryRun ? 'text-warning font-semibold' : 'text-success font-semibold'}>
              {dryRun ? 'Simulation (aucun email envoyé)' : 'Envoi réel'}
            </span>
          </div>

          {dupCount > 0 && (
            <div className="rounded bg-warning-soft text-warning p-3 text-xs mt-2">
              ⚠ {dupCount} client{dupCount > 1 ? 's ont' : ' a'} déjà reçu une relance de
              ce niveau il y a moins de 7 jours.
            </div>
          )}

          {noEmailCount > 0 && (
            <div className="rounded bg-critical-soft text-critical p-3 text-xs">
              🚨 {noEmailCount} client{noEmailCount > 1 ? 's n\'ont' : ' n\'a'} pas d'email — la relance ne pourra pas être envoyée
              (mais les fichiers seront générés et trackés).
            </div>
          )}

          {!dryRun && (
            <p className="text-xs text-ink-muted pt-2">
              Cliquer sur Envoyer va déclencher l'envoi des emails immédiatement.
            </p>
          )}
        </div>
        <div className="p-5 border-t flex gap-2">
          <button onClick={onCancel} className="flex-1 bg-surface-2 text-ink py-2 rounded-md text-sm">
            Annuler
          </button>
          <button onClick={onConfirm} className="flex-1 bg-brand text-white py-2 rounded-md text-sm font-medium">
            {dryRun ? 'Lancer la simulation' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Modal : Résultat de l'envoi
// ============================================================
function ResultModal({
  results, dryRun, onClose,
}: {
  results: SendResultRow[]
  dryRun:  boolean
  onClose: () => void
}) {
  const ok     = results.filter(r => r.ok).length
  const failed = results.length - ok

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b">
          <h2 className="text-lg font-semibold text-ink">
            {dryRun ? '🧪 Résultats simulation' : '📨 Résultats envoi'}
          </h2>
          <p className="text-sm text-ink-muted">
            ✅ {ok} réussi{ok > 1 ? 's' : ''} · {failed > 0 && <span className="text-critical">❌ {failed} échec{failed > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="p-5">
          <ul className="space-y-2 text-sm">
            {results.map((r, i) => (
              <li key={i} className={`rounded p-3 ${r.ok ? 'bg-success-soft' : 'bg-critical-soft'}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {r.ok ? '✅' : '❌'} {r.partnerName || `Partner #${r.partnerId}`}
                  </span>
                  {r.level && (
                    <span className="text-xs">L{r.level}</span>
                  )}
                </div>
                {r.reference && (
                  <div className="text-xs font-mono text-ink-muted mt-1">{r.reference}</div>
                )}
                {r.totalDue !== undefined && (
                  <div className="text-xs text-ink-muted">
                    {r.invoiceCount} facture{(r.invoiceCount || 0) > 1 ? 's' : ''} · {formatEur(r.totalDue)}
                  </div>
                )}
                {r.error && (
                  <div className="text-xs text-critical mt-1">{r.error}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="p-5 border-t">
          <button onClick={onClose} className="w-full bg-brand text-white py-2 rounded-md text-sm font-medium">
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
