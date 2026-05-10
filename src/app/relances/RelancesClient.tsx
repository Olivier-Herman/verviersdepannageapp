'use client'

import { useEffect, useState } from 'react'
import type { Session }         from 'next-auth'
import AppShell                 from '@/components/layout/AppShell'

type ReminderLevel = 1 | 2 | 3

interface OverdueInvoice {
  id:               number
  name:             string
  invoiceDate:      string
  dueDate:          string
  daysOverdue:      number
  amountTotal:      number
  amountResidual:   number
}

interface PartnerGroup {
  partnerId:       number
  partnerName:     string
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
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
  }).format(n)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function RelancesClient({ session }: { session: Session }) {
  const sessionUser = session.user as any

  const [groups,  setGroups]  = useState<PartnerGroup[] | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<ReminderLevel | 'all'>('all')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/relances/list', { cache: 'no-store' })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error(j.error || `HTTP ${res.status}`)
        }
        const j = await res.json()
        if (!cancelled) setGroups(j.groups || [])
      } catch (e: any) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = groups
    ? (filter === 'all' ? groups : groups.filter(g => g.level === filter))
    : []
  const counts = {
    1: groups?.filter(g => g.level === 1).length ?? 0,
    2: groups?.filter(g => g.level === 2).length ?? 0,
    3: groups?.filter(g => g.level === 3).length ?? 0,
  }
  const totalAll = groups?.reduce((s, g) => s + g.totalResidual, 0) ?? 0

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
      <div className="max-w-6xl mx-auto p-4 space-y-4">

        <div className="flex items-center justify-between gap-4">
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
        <div className="flex flex-wrap gap-2">
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

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-md bg-surface-2 border p-6 text-center text-sm text-ink-muted">
            🎉 Aucune facture échue à ce niveau. Bravo.
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map(g => (
              <article
                key={g.partnerId}
                className="rounded-lg border bg-surface-2 p-4"
              >
                <header className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink truncate">
                      {g.partnerName}
                    </div>
                    <div className="text-xs text-ink-muted truncate">
                      {g.partnerEmail || <span className="text-warning">⚠ pas d'email</span>}
                      {g.partnerVat && ` · ${g.partnerVat}`}
                    </div>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded text-xs font-medium ${LEVEL_BADGE[g.level]}`}>
                    {LEVEL_LABEL[g.level]}
                  </span>
                </header>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
                  <span className="text-ink">
                    <strong>{formatEur(g.totalResidual)}</strong> dû
                  </span>
                  <span className="text-ink-muted">
                    {g.invoices.length} facture{g.invoices.length > 1 ? 's' : ''}
                  </span>
                  <span className="text-ink-muted">
                    Retard max : {g.maxDaysOverdue} jours
                  </span>
                </div>

                {g.lastReminder && (
                  <div className="text-xs text-warning bg-warning-soft rounded px-2 py-1 inline-block mb-2">
                    ⚠ Dernière relance : L{g.lastReminder.level} il y a {g.lastReminder.daysSince}j
                    {g.lastReminder.dryRun && ' (simulation)'}
                  </div>
                )}

                <details className="text-sm">
                  <summary className="cursor-pointer text-ink-muted hover:text-ink select-none">
                    Voir les factures ({g.invoices.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {g.invoices.map(inv => (
                      <li key={inv.id} className="flex justify-between gap-3 text-xs">
                        <span className="text-ink">{inv.name}</span>
                        <span className="text-ink-muted">échéance {formatDate(inv.dueDate)}</span>
                        <span className="text-ink-muted">{inv.daysOverdue}j</span>
                        <span className="text-ink font-medium">{formatEur(inv.amountResidual)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
          </div>
        )}

        <div className="text-xs text-ink-muted text-center pt-6 pb-2">
          Phase 1 · l'envoi groupé arrive en sous-tâche 11.
        </div>
      </div>
    </AppShell>
  )
}
