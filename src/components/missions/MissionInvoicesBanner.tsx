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

export default function MissionInvoicesBanner({ missionId }: { missionId: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/missions/${missionId}/invoices`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setInvoices(d.invoices || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [missionId])

  if (invoices.length === 0) return null

  return (
    <div className="px-4 lg:px-8 pt-6">
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
    </div>
  )
}
