'use client'

// Bandeau "Factures liées" dans la fiche d'intervention : liste les factures
// Odoo rattachées à la mission (numéro + montant + état) avec un bouton PDF
// pour visualiser chaque document. Olivier 2026-06-17.

import { useEffect, useState } from 'react'

interface Invoice {
  id:           number
  number:       string | null
  state:        string
  isRefund:     boolean
  paymentState: string | null
  amountTotal:  number
  invoiceDate:  string | null
  odooUrl:      string
  pdfUrl:       string
}

const STATE_LABEL: Record<string, string> = { draft: 'Brouillon', posted: 'Émise', cancel: 'Annulée' }
const PAY_LABEL:   Record<string, string> = { paid: 'Payée', partial: 'Partielle', not_paid: 'Non payée', in_payment: 'En paiement', reversed: 'Extournée' }

interface BilledItem { label: string; amount_htva: number; period_from: string | null; period_to: string | null; odoo_quote_id: number | null; invoice_number?: string | null }
interface QuoteInfo { invoice_number: string | null; state: string | null; quote_url: string; invoice_url: string | null }

export default function MissionInvoicesBanner({ missionId }: { missionId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [billed, setBilled]     = useState<BilledItem[]>([])
  const [quotesInfo, setQuotesInfo] = useState<Record<number, QuoteInfo>>({})

  useEffect(() => {
    let cancelled = false
    fetch(`/api/missions/${missionId}/invoices`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setInvoices(d.invoices || []) })
      .catch(() => {})
    fetch(`/api/missions/${missionId}/billed-items`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setBilled(d.items || []); setQuotesInfo(d.quotes_info || {}) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [missionId])

  if (invoices.length === 0 && billed.length === 0) return null

  return (
    <div className="px-4 lg:px-8 pt-6 space-y-3">
      {/* Partiellement facturée : postes déjà émis, groupés par facture partielle
          (devis Odoo) avec le n° de facture récupéré automatiquement. */}
      {billed.length > 0 && (() => {
        // Groupage par odoo_quote_id (1 facture partielle = 1 devis).
        const groups = new Map<string, BilledItem[]>()
        for (const b of billed) {
          const k = b.odoo_quote_id != null ? String(b.odoo_quote_id) : 'sans'
          const arr = groups.get(k) || []; arr.push(b); groups.set(k, arr)
        }
        return (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-4">
          <p className="text-amber-700 dark:text-amber-300 text-sm font-semibold mb-2">⏳ Partiellement facturée</p>
          <div className="space-y-3">
            {[...groups.entries()].map(([k, list]) => {
              const qid  = k !== 'sans' ? Number(k) : null
              const info = qid != null ? quotesInfo[qid] : undefined
              const total = list.reduce((s, b) => s + Number(b.amount_htva || 0), 0)
              const manualNum = list.find(b => b.invoice_number)?.invoice_number || null
              const invNum = info?.invoice_number || manualNum
              return (
                <div key={k}>
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-0.5">
                    <span className="text-ink text-xs font-semibold">
                      🧾 Facture partielle{qid != null ? '' : ''} — {total.toFixed(2)} € HTVA
                    </span>
                    <span className="flex items-center gap-2">
                      {invNum
                        ? <span className="text-emerald-700 dark:text-emerald-300 text-xs font-mono font-semibold">N° {invNum}</span>
                        : <span className="text-ink-faint text-xs italic">facture Odoo à émettre</span>}
                      {info?.invoice_url
                        ? <a href={info.invoice_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 dark:text-amber-300 underline">Facture ↗</a>
                        : info?.quote_url
                          ? <a href={info.quote_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 dark:text-amber-300 underline">Devis ↗</a>
                          : null}
                    </span>
                  </div>
                  <div className="space-y-0.5 pl-1">
                    {list.map((b, i) => (
                      <p key={i} className="text-ink-secondary text-xs">
                        ✓ {b.label} — {Number(b.amount_htva).toFixed(2)} € HTVA
                        {b.period_from && b.period_to ? ` (du ${new Date(b.period_from).toLocaleDateString('fr-BE')} au ${new Date(b.period_to).toLocaleDateString('fr-BE')})` : ''}
                      </p>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-ink-faint text-xs mt-2">Ces postes seront exclus du solde à la facturation finale.</p>
        </div>
        )
      })()}

      {invoices.length > 0 && (
      <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-2xl p-4">
        <p className="text-emerald-800 dark:text-emerald-300 text-sm font-semibold mb-2">
          🧾 {invoices.length > 1 ? `${invoices.length} factures liées` : 'Facture liée'}
        </p>
        <div className="space-y-2">
          {invoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between gap-3 flex-wrap bg-surface/60 rounded-xl px-3 py-2">
              <div className="min-w-0">
                <span className="text-ink font-mono font-semibold text-sm">
                  {inv.isRefund ? 'Avoir ' : ''}{inv.number || '(brouillon)'}
                </span>
                <span className="text-ink-secondary text-xs ml-2">{Number(inv.amountTotal).toFixed(2)} € TVAC</span>
                {inv.invoiceDate && <span className="text-ink-faint text-xs ml-2">· {new Date(inv.invoiceDate).toLocaleDateString('fr-BE')}</span>}
                <span className="text-ink-faint text-xs ml-2">· {STATE_LABEL[inv.state] || inv.state}</span>
                {inv.paymentState && inv.state === 'posted' && (
                  <span className={`text-xs ml-2 font-medium ${inv.paymentState === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>
                    · {PAY_LABEL[inv.paymentState] || inv.paymentState}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold whitespace-nowrap">
                  📄 PDF
                </a>
                <a href={inv.odooUrl} target="_blank" rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-surface-2 hover:bg-surface border rounded-lg text-ink-secondary hover:text-ink text-xs whitespace-nowrap">
                  Odoo ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
