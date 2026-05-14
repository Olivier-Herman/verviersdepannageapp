'use client'

import { useEffect, useState } from 'react'
import { useSheetStack } from './SheetStackProvider'
import { X, ExternalLink, Loader2, FileText, User as UserIcon, Phone, Mail, Calendar, CreditCard, Receipt } from 'lucide-react'

interface Props {
  id:            number
  isTop:         boolean
  zIndex:        number
  hasOdooAccess: boolean
  onClose:       () => void
}

interface InvoiceData {
  invoice: {
    id:             number
    number:         string | null
    state:          string
    moveType:       string
    isRefund:       boolean
    paymentState:   string | null
    invoiceDate:    string | null
    invoiceDateDue: string | null
    amountUntaxed:  number
    amountTax:      number
    amountTotal:    number
    amountResidual: number
    currency:       string
    reference:      string | null
    origin:         string | null
    notes:          string | null
    salesperson:    { id: number; name: string } | null
    odooUrl:        string
    pdfUrl:         string
  }
  partner: {
    id:      number
    name:    string | null
    phone:   string | null
    email:   string | null
    vat:     string | null
    address: string | null
  } | null
  lines: Array<{
    id:          number
    label:       string | null
    productName: string | null
    quantity:    number
    unitPrice:   number
    discount:    number
    subtotal:    number
    total:       number
  }>
  payments: Array<{
    id:      number
    amount:  number
    date:    string | null
    method:  string | null
    journal: string | null
    ref:     string | null
  }>
  linkedVehicle: {
    id:    number
    plate: string | null
    brand: string | null
    model: string | null
  } | null
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const STATE_LABEL: Record<string, string> = {
  draft: 'Brouillon', posted: 'Comptabilisée', cancel: 'Annulée',
}
const PAYMENT_STATE_LABEL: Record<string, string> = {
  not_paid: 'Non payée', paid: 'Payée', in_payment: 'En paiement',
  partial: 'Partielle', reversed: 'Annulée par avoir', invoicing_legacy: 'Legacy',
}

function paymentBadge(state: string | null): { label: string; cls: string } {
  if (state === 'paid' || state === 'in_payment') return { label: 'Payée', cls: 'bg-success/15 text-success border-success/30' }
  if (state === 'partial')                        return { label: 'Partielle', cls: 'bg-warning/15 text-warning border-warning/30' }
  if (state === 'reversed')                       return { label: 'Annulée', cls: 'bg-critical/15 text-critical border-critical/30' }
  if (state === 'not_paid')                       return { label: 'Non payée', cls: 'bg-info/15 text-info border-info/30' }
  return { label: state || '—', cls: 'bg-ink-faint/15 text-ink-muted' }
}

export default function InvoiceSheet({ id, isTop, zIndex, hasOdooAccess, onClose }: Props) {
  const { openVehicle } = useSheetStack()
  const [data,    setData]    = useState<InvoiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    setLoading(true); setError(null)
    fetch(`/api/odoo/invoice/${id}`, { signal: ctl.signal })
      .then(async r => {
        const j = await r.json()
        if (!r.ok) { setError(j.error || 'Erreur'); return }
        setData(j)
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message || 'Erreur réseau') })
      .finally(() => setLoading(false))
    return () => ctl.abort()
  }, [id])

  const inv = data?.invoice
  const paymentInfo = paymentBadge(inv?.paymentState || null)
  const accentColor = inv?.isRefund ? 'from-critical via-amber-500 to-warning' : 'from-success via-brand to-purple-500'

  return (
    <div
      className="fixed inset-0 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ zIndex, animation: 'sheet-fade 180ms ease-out' }}
      onClick={isTop ? onClose : undefined}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-3xl sm:rounded-3xl sm:my-8 sm:max-h-[92vh] flex flex-col overflow-hidden border-2 border-brand/20 shadow-2xl shadow-brand/20"
        style={{ animation: 'sheet-slide 240ms ease-out' }}
      >
        {/* Bande accent top (rouge si avoir) */}
        <div className={`h-1.5 bg-gradient-to-r ${accentColor} flex-shrink-0`} />

        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-shrink-0 bg-gradient-to-br from-purple-500/5 to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${inv?.isRefund ? 'bg-gradient-to-br from-critical/20 to-amber-500/20' : 'bg-gradient-to-br from-success/20 to-brand/20'}`}>
              {inv?.isRefund ? '↩' : '🧾'}
            </div>
            <div className="min-w-0">
              <p className="text-ink-muted text-xs uppercase tracking-wider font-semibold">
                {inv?.isRefund ? 'Note de crédit' : 'Facture'}
              </p>
              <h2 className="text-ink font-bold text-lg font-mono leading-tight truncate">
                {inv?.number || (loading ? '…' : 'Inconnue')}
              </h2>
              {data?.partner?.name && (
                <p className="text-ink-secondary text-sm truncate">{data.partner.name}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-critical hover:rotate-90 transition-all p-1.5 flex-shrink-0"
            title="Fermer (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-brand" />
            </div>
          )}

          {error && (
            <div className="bg-critical-soft border border-critical rounded-2xl p-4 text-critical text-sm">⚠ {error}</div>
          )}

          {!loading && data && inv && (
            <>
              {/* Hero amount */}
              <div className="bg-gradient-to-br from-brand/10 via-purple-500/5 to-transparent border-2 border-brand/20 rounded-2xl p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-ink-muted text-xs uppercase tracking-wider font-semibold">Montant total TTC</p>
                  <p className={`text-3xl font-black ${inv.isRefund ? 'text-critical' : 'text-ink'}`}>
                    {inv.isRefund ? '-' : ''}{Math.abs(inv.amountTotal).toFixed(2)} €
                  </p>
                  {inv.amountResidual > 0 && !inv.isRefund && (
                    <p className="text-warning text-xs mt-1">Reste dû : {inv.amountResidual.toFixed(2)} €</p>
                  )}
                </div>
                <div className="text-right space-y-1">
                  <span className={`inline-block text-xs px-2.5 py-1 rounded-lg border font-semibold ${paymentInfo.cls}`}>
                    {paymentInfo.label}
                  </span>
                  <p className="text-ink-faint text-[10px] uppercase tracking-wider">
                    {STATE_LABEL[inv.state] || inv.state}
                  </p>
                </div>
              </div>

              {/* Détails */}
              <Section title="Détails" icon={<Calendar size={14} />}>
                <Grid>
                  <Field label="Date facture"   value={fmtDate(inv.invoiceDate)} />
                  <Field label="Échéance"       value={fmtDate(inv.invoiceDateDue)} />
                  <Field label="HT"              value={`${inv.amountUntaxed.toFixed(2)} €`} />
                  <Field label="TVA"             value={`${inv.amountTax.toFixed(2)} €`} />
                  {inv.reference && <Field label="Référence" mono value={inv.reference} />}
                  {inv.origin    && <Field label="Origine"    value={inv.origin} />}
                  {inv.salesperson && <Field label="Vendeur"  value={inv.salesperson.name} />}
                </Grid>
              </Section>

              {/* Véhicule lié */}
              {data.linkedVehicle && (
                <Section title="Véhicule lié" icon={<span>🚗</span>}>
                  <button
                    onClick={() => data.linkedVehicle && openVehicle(data.linkedVehicle.id)}
                    className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 bg-surface-2 hover:bg-surface-hover hover:border-brand/40 border rounded-xl transition group"
                  >
                    <div>
                      <p className="text-ink font-mono font-semibold">{data.linkedVehicle.plate || '—'}</p>
                      <p className="text-ink-muted text-xs">{[data.linkedVehicle.brand, data.linkedVehicle.model].filter(Boolean).join(' ') || '—'}</p>
                    </div>
                    <ExternalLink size={14} className="text-ink-faint group-hover:text-brand transition" />
                  </button>
                </Section>
              )}

              {/* Client */}
              {data.partner && (
                <Section title="Client" icon={<UserIcon size={14} />}>
                  <div className="space-y-1.5 px-1">
                    <p className="text-ink font-semibold">{data.partner.name || '—'}</p>
                    {data.partner.vat && <p className="text-ink-secondary text-xs font-mono">TVA {data.partner.vat}</p>}
                    {data.partner.address && <p className="text-ink-secondary text-xs">{data.partner.address}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {data.partner.phone && (
                        <a href={`tel:${data.partner.phone}`} className="inline-flex items-center gap-1 px-2 py-1 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs text-ink-secondary hover:text-ink transition">
                          <Phone size={11} /> {data.partner.phone}
                        </a>
                      )}
                      {data.partner.email && (
                        <a href={`mailto:${data.partner.email}`} className="inline-flex items-center gap-1 px-2 py-1 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs text-ink-secondary hover:text-ink transition">
                          <Mail size={11} /> {data.partner.email}
                        </a>
                      )}
                    </div>
                  </div>
                </Section>
              )}

              {/* Lignes */}
              {data.lines.length > 0 && (
                <Section title={`Lignes · ${data.lines.length}`} icon={<Receipt size={14} />}>
                  <div className="overflow-x-auto -mx-3">
                    <table className="w-full text-sm">
                      <thead className="text-ink-muted text-[10px] uppercase tracking-wider">
                        <tr className="border-b">
                          <th className="px-3 py-1.5 text-left">Description</th>
                          <th className="px-2 py-1.5 text-right">Qté</th>
                          <th className="px-2 py-1.5 text-right">PU</th>
                          {data.lines.some(l => l.discount > 0) && (
                            <th className="px-2 py-1.5 text-right">Remise</th>
                          )}
                          <th className="px-3 py-1.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {data.lines.map(l => (
                          <tr key={l.id} className="hover:bg-surface-hover">
                            <td className="px-3 py-1.5 text-ink text-xs">
                              {l.label || l.productName || '—'}
                            </td>
                            <td className="px-2 py-1.5 text-ink-secondary text-xs text-right tabular-nums">{l.quantity}</td>
                            <td className="px-2 py-1.5 text-ink-secondary text-xs text-right tabular-nums">{l.unitPrice.toFixed(2)} €</td>
                            {data.lines.some(l2 => l2.discount > 0) && (
                              <td className="px-2 py-1.5 text-ink-faint text-xs text-right tabular-nums">{l.discount ? `${l.discount}%` : '—'}</td>
                            )}
                            <td className="px-3 py-1.5 text-ink text-xs text-right font-semibold tabular-nums">{l.subtotal.toFixed(2)} €</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {/* Paiements */}
              {data.payments.length > 0 && (
                <Section title={`Paiements · ${data.payments.length}`} icon={<CreditCard size={14} />}>
                  <div className="space-y-1.5">
                    {data.payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 bg-success-soft border border-success/30 rounded-xl">
                        <div className="min-w-0">
                          <p className="text-ink text-sm font-semibold">{p.method || p.journal || 'Paiement'}</p>
                          <p className="text-ink-muted text-xs">{fmtDate(p.date)}{p.ref ? ` · ${p.ref}` : ''}</p>
                        </div>
                        <span className="text-success font-bold text-sm flex-shrink-0">{p.amount.toFixed(2)} €</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Notes */}
              {inv.notes && (
                <Section title="Notes" icon={<FileText size={14} />}>
                  <p className="text-ink-secondary text-sm whitespace-pre-wrap px-1">{inv.notes}</p>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-surface-2 flex items-center justify-between gap-2 flex-shrink-0">
          <p className="text-ink-faint text-[11px]">
            <kbd className="px-1.5 py-0.5 rounded bg-surface border font-mono">Esc</kbd> pour fermer
          </p>
          <div className="flex items-center gap-2">
            {inv && (
              <a
                href={inv.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-surface-hover border text-ink rounded-xl text-sm font-medium transition"
              >
                <FileText size={14} /> PDF
              </a>
            )}
            {inv && hasOdooAccess && (
              <a
                href={inv.odooUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-brand to-purple-500 hover:opacity-90 text-white rounded-xl text-sm font-semibold transition shadow-sm"
              >
                <ExternalLink size={14} /> Ouvrir dans Odoo
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Reusable sub-components ──────────────────────────

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-surface border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-surface-2/50">
        {icon && <span className="text-ink-muted">{icon}</span>}
        <h3 className="text-ink-muted text-xs font-bold uppercase tracking-wider">{title}</h3>
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">{children}</div>
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-ink-muted text-[10px] uppercase tracking-wider">{label}</p>
      <p className={`text-ink text-sm truncate ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-ink-faint">—</span>}
      </p>
    </div>
  )
}
