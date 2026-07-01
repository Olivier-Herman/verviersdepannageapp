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
  amountUntaxed?: number
  amountTotal:  number
  invoiceDate:  string | null
  lines?:       { name: string; subtotal: number }[]
  description?: string | null
  odooUrl:      string
  pdfUrl:       string
}

interface BilledItem { label: string; amount_htva: number; period_from: string | null; period_to: string | null; odoo_quote_id: number | null; invoice_number?: string | null }
interface QuoteInfo {
  invoice_number: string | null; state: string | null; payment_state?: string | null; quote_url: string; invoice_url: string | null
  amount_untaxed?: number | null; amount_total?: number | null
  lines?: { name: string; subtotal: number }[]
  description?: string | null
}

function invoiceStatus(state?: string | null, payment?: string | null): { label: string; cls: string } | null {
  if (!state) return null
  if (state === 'draft')  return { label: 'Brouillon', cls: 'bg-gray-100 text-gray-700' }
  if (state === 'cancel') return { label: 'Annulée',   cls: 'bg-gray-100 text-gray-700' }
  switch (payment) {
    case 'paid':       return { label: '✅ Payée',              cls: 'bg-green-100 text-green-800' }
    case 'in_payment': return { label: 'En paiement',          cls: 'bg-blue-100 text-blue-800' }
    case 'partial':    return { label: 'Partiellement payée',  cls: 'bg-amber-100 text-amber-800' }
    case 'reversed':   return { label: 'Extournée',            cls: 'bg-gray-100 text-gray-700' }
    default:           return { label: 'Non payée',            cls: 'bg-amber-100 text-amber-800' }
  }
}

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
              // Si la vraie facture Odoo existe (lignes + montants), on l'affiche ;
              // sinon on retombe sur le registre app.
              const useOdoo = !!(info && info.lines && info.lines.length && info.amount_untaxed != null)
              const total = useOdoo ? Number(info!.amount_untaxed) : list.reduce((s, b) => s + Number(b.amount_htva || 0), 0)
              const manualNum = list.find(b => b.invoice_number)?.invoice_number || null
              const invNum = info?.invoice_number || manualNum
              return (
                <div key={k}>
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-ink text-xs font-semibold">
                        🧾 Facture partielle — {total.toFixed(2)} € HTVA
                        {useOdoo && info!.amount_total != null ? ` · ${Number(info!.amount_total).toFixed(2)} € TVAC` : ''}
                      </span>
                      {(() => {
                        const st = useOdoo ? invoiceStatus(info!.state, info!.payment_state) : null
                        return st ? <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span> : null
                      })()}
                    </span>
                    <span className="flex items-center gap-2">
                      {invNum ? (
                        <span
                          className="inline-block border-[3px] border-green-600 text-green-600 font-black uppercase tracking-widest px-5 py-2 rounded-md text-xl sm:text-2xl bg-surface/40 shadow-sm"
                          style={{ transform: 'rotate(-8deg)', letterSpacing: '0.12em' }}
                        >
                          {invNum}
                        </span>
                      ) : (
                        <span className="text-ink-faint text-xs italic">facture Odoo à émettre</span>
                      )}
                      {info?.invoice_url
                        ? <a href={info.invoice_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 dark:text-amber-300 underline whitespace-nowrap">Facture ↗</a>
                        : info?.quote_url
                          ? <a href={info.quote_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 dark:text-amber-300 underline whitespace-nowrap">Devis ↗</a>
                          : null}
                    </span>
                  </div>
                  <div className="space-y-0.5 pl-1">
                    {useOdoo && info!.description && (
                      <p className="text-ink-faint text-xs italic mb-0.5">{info!.description}</p>
                    )}
                    {useOdoo
                      ? info!.lines!.map((l, i) => (
                          <p key={i} className="text-ink-secondary text-xs">✓ {l.name} — {l.subtotal.toFixed(2)} € HTVA</p>
                        ))
                      : list.map((b, i) => (
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
          {invoices.map(inv => {
            const st = invoiceStatus(inv.state, inv.paymentState)
            return (
            <div key={inv.id} className="bg-surface/60 rounded-xl px-3 py-2">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                <span className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="text-ink font-mono font-semibold text-sm">
                    {inv.isRefund ? 'Avoir ' : ''}{inv.number || '(brouillon)'}
                  </span>
                  <span className="text-ink-secondary text-xs">
                    — {Number(inv.amountUntaxed ?? 0).toFixed(2)} € HTVA · {Number(inv.amountTotal).toFixed(2)} € TVAC
                  </span>
                  {st && <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>}
                  {inv.invoiceDate && <span className="text-ink-faint text-xs">· {new Date(inv.invoiceDate).toLocaleDateString('fr-BE')}</span>}
                </span>
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
              {inv.description && <p className="text-ink-faint text-xs italic mb-0.5 pl-1">{inv.description}</p>}
              {inv.lines && inv.lines.length > 0 && (
                <div className="space-y-0.5 pl-1">
                  {inv.lines.map((l, i) => (
                    <p key={i} className="text-ink-secondary text-xs">✓ {l.name} — {l.subtotal.toFixed(2)} € HTVA</p>
                  ))}
                </div>
              )}
            </div>
            )
          })}
        </div>
      </div>
      )}
    </div>
  )
}
