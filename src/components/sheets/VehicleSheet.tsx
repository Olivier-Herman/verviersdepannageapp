'use client'

import { useEffect, useState } from 'react'
import { useSheetStack } from './SheetStackProvider'
import { X, ExternalLink, Loader2, FileText, Calendar, User as UserIcon, MapPin, Gauge, Fuel, Settings, FileCheck, Wrench } from 'lucide-react'

interface Props {
  id:            number
  isTop:         boolean
  zIndex:        number
  hasOdooAccess: boolean
  onClose:       () => void
}

interface VehicleData {
  vehicle: {
    id:               number
    plate:            string | null
    vin:              string | null
    brand:            string | null
    model:            string | null
    color:            string | null
    fuel:             string | null
    gearbox:          string | null
    modelYear:        number | null
    acquisitionDate:  string | null
    odometer:         number | null
    odometerUnit:     string
    nextAssignation:  string | null
    currentDriver:    { id: number; name: string } | null
    state:            { id: number; name: string } | null
    fourriereZone:    { label: string; fullName: string } | null
    image128:         string | null
    odooUrl:          string
  }
  driverHistory: Array<{
    id:        number
    driver:    { id: number; name: string } | null
    dateStart: string | null
    dateEnd:   string | null
  }>
  invoices: Array<{
    id:             number
    number:         string | null
    partnerName:    string | null
    amountTotal:    number
    amountResidual: number
    invoiceDate:    string | null
    invoiceDateDue: string | null
    state:          string
    moveType:       string
    paymentState:   string | null
  }>
  contracts: Array<{
    id:         number
    name:       string | null
    startDate:  string | null
    expiryDate: string | null
    state:      string | null
    amount:     number
  }>
  services: Array<{
    id:          number
    description: string | null
    date:        string | null
    amount:      number
    type:        string | null
    state:       string | null
  }>
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const FUEL_LABEL: Record<string, string> = {
  diesel: 'Diesel', gasoline: 'Essence', electric: 'Électrique',
  hybrid: 'Hybride', lpg: 'LPG', cng: 'CNG', full_hybrid: 'Hybride',
  plug_in_hybrid_diesel: 'Hybride rechargeable D', plug_in_hybrid_gasoline: 'Hybride rechargeable E',
}
const GEARBOX_LABEL: Record<string, string> = {
  manual: 'Manuelle', automatic: 'Automatique',
}

export default function VehicleSheet({ id, isTop, zIndex, hasOdooAccess, onClose }: Props) {
  const { openInvoice } = useSheetStack()
  const [data,    setData]    = useState<VehicleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    setLoading(true); setError(null)
    fetch(`/api/odoo/vehicle/${id}`, { signal: ctl.signal })
      .then(async r => {
        const j = await r.json()
        if (!r.ok) { setError(j.error || 'Erreur'); return }
        setData(j)
      })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message || 'Erreur réseau') })
      .finally(() => setLoading(false))
    return () => ctl.abort()
  }, [id])

  const v = data?.vehicle
  const fourriere = v?.fourriereZone

  return (
    <div
      className="fixed inset-0 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity"
      style={{ zIndex, animation: 'sheet-fade 180ms ease-out' }}
      onClick={isTop ? onClose : undefined}
    >
      <style>{`
        @keyframes sheet-fade  { from { opacity: 0; }                                  to { opacity: 1; } }
        @keyframes sheet-slide { from { opacity: 0; transform: translateY(16px); }      to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface w-full sm:max-w-3xl sm:rounded-3xl sm:my-8 sm:max-h-[92vh] flex flex-col overflow-hidden border-2 border-brand/20 shadow-2xl shadow-brand/20"
        style={{ animation: 'sheet-slide 240ms ease-out' }}
      >
        {/* Bande accent top */}
        <div className="h-1.5 bg-gradient-to-r from-brand via-purple-500 to-info flex-shrink-0" />

        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-shrink-0 bg-gradient-to-br from-brand/5 to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            {v?.image128 ? (
              <img src={v.image128} alt="" className="w-14 h-14 rounded-xl object-cover border flex-shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand/20 to-purple-500/20 flex items-center justify-center text-2xl flex-shrink-0">
                🚗
              </div>
            )}
            <div className="min-w-0">
              <p className="text-ink-muted text-xs uppercase tracking-wider font-semibold">Véhicule</p>
              <h2 className="text-ink font-bold text-lg font-mono leading-tight truncate">
                {v?.plate || (loading ? '…' : 'Inconnu')}
              </h2>
              {(v?.brand || v?.model) && (
                <p className="text-ink-secondary text-sm truncate">{[v.brand, v.model].filter(Boolean).join(' ')}</p>
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

          {fourriere && (
            <div className="bg-critical-soft border-2 border-critical/30 rounded-2xl p-3 flex items-center gap-2.5">
              <span className="text-2xl">🚓</span>
              <div>
                <p className="text-critical font-bold text-sm uppercase tracking-wider">En fourrière · {fourriere.label}</p>
                <p className="text-critical text-xs">{fourriere.fullName}</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-brand" />
            </div>
          )}

          {error && (
            <div className="bg-critical-soft border border-critical rounded-2xl p-4 text-critical text-sm">
              <p className="font-semibold mb-1">⚠ Impossible de charger la fiche</p>
              <p className="text-xs opacity-80">Détail technique : {(error.length > 200 ? error.slice(0, 200) + '…' : error)}</p>
            </div>
          )}

          {!loading && data && v && (
            <>
              {/* Identite */}
              <Section title="Identité" icon={<Settings size={14} />}>
                <Grid>
                  <Field label="Plaque"      mono value={v.plate} />
                  <Field label="VIN"         mono value={v.vin} />
                  <Field label="Marque"           value={v.brand} />
                  <Field label="Modèle"           value={v.model} />
                  <Field label="Couleur"          value={v.color} />
                  <Field label="Année modèle"     value={v.modelYear?.toString() || null} />
                  <Field label="Carburant"        value={v.fuel ? (FUEL_LABEL[v.fuel] || v.fuel) : null} icon={<Fuel size={12} />} />
                  <Field label="Boîte"            value={v.gearbox ? (GEARBOX_LABEL[v.gearbox] || v.gearbox) : null} />
                  <Field label="Kilométrage"      value={v.odometer ? `${v.odometer.toLocaleString('fr-BE')} ${v.odometerUnit === 'kilometers' ? 'km' : 'mi'}` : null} icon={<Gauge size={12} />} />
                  <Field label="Acquisition"      value={fmtDate(v.acquisitionDate)} icon={<Calendar size={12} />} />
                </Grid>
              </Section>

              {/* Conducteur + historique */}
              <Section title="Conducteur" icon={<UserIcon size={14} />}>
                {v.currentDriver ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-success-soft border border-success/30 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-success/20 flex items-center justify-center text-success font-bold">
                      {v.currentDriver.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-success text-xs uppercase tracking-wider font-semibold">Conducteur actuel</p>
                      <p className="text-ink font-semibold truncate">{v.currentDriver.name}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-ink-faint text-sm italic px-3 py-2">Aucun conducteur attribué</p>
                )}
                {data.driverHistory.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-ink-muted text-xs uppercase tracking-wider font-semibold pl-3">Historique récent</p>
                    {data.driverHistory.map(h => (
                      <div key={h.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                        <span className="text-ink-secondary truncate">{h.driver?.name || '—'}</span>
                        <span className="text-ink-faint flex-shrink-0">{fmtDate(h.dateStart)} → {fmtDate(h.dateEnd)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Factures */}
              <Section title={`Factures · ${data.invoices.length}`} icon={<FileText size={14} />}>
                {data.invoices.length === 0 ? (
                  <p className="text-ink-faint text-sm italic px-3 py-2">Aucune facture liée</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.invoices.map(inv => {
                      const isRefund = inv.moveType === 'out_refund'
                      const paid = inv.paymentState === 'paid' || inv.paymentState === 'in_payment'
                      return (
                        <button
                          key={inv.id}
                          onClick={() => openInvoice(inv.id)}
                          className="w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 bg-surface-2 hover:bg-surface-hover hover:border-brand/40 border rounded-xl transition group"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-ink text-sm font-mono font-semibold truncate">
                              {isRefund ? '↩ ' : ''}{inv.number || '—'}
                            </p>
                            <p className="text-ink-muted text-xs truncate">{inv.partnerName || '—'} · {fmtDate(inv.invoiceDate)}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-semibold ${isRefund ? 'text-critical' : 'text-ink'}`}>
                              {isRefund ? '-' : ''}{Math.abs(Number(inv.amountTotal)).toFixed(2)} €
                            </p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${paid ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'}`}>
                              {paid ? 'Payée' : inv.state === 'posted' ? 'Comptabilisée' : inv.state}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </Section>

              {/* Contrats */}
              {data.contracts.length > 0 && (
                <Section title={`Contrats · ${data.contracts.length}`} icon={<FileCheck size={14} />}>
                  <div className="space-y-1.5">
                    {data.contracts.map(c => (
                      <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-surface-2 border rounded-xl">
                        <div className="min-w-0">
                          <p className="text-ink text-sm font-medium truncate">{c.name || '—'}</p>
                          <p className="text-ink-muted text-xs">{fmtDate(c.startDate)} → {fmtDate(c.expiryDate)}</p>
                        </div>
                        <span className="text-xs text-ink-faint flex-shrink-0">{Number(c.amount || 0).toFixed(2)} €</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Services */}
              {data.services.length > 0 && (
                <Section title={`Services · ${data.services.length}`} icon={<Wrench size={14} />}>
                  <div className="space-y-1.5">
                    {data.services.map(s => (
                      <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-surface-2 border rounded-xl">
                        <div className="min-w-0">
                          <p className="text-ink text-sm font-medium truncate">{s.description || s.type || '—'}</p>
                          <p className="text-ink-muted text-xs">{fmtDate(s.date)}</p>
                        </div>
                        <span className="text-xs text-ink-faint flex-shrink-0">{Number(s.amount || 0).toFixed(2)} €</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-surface-2 flex items-center justify-between gap-3 flex-shrink-0">
          <p className="text-ink-faint text-[11px]">
            <kbd className="px-1.5 py-0.5 rounded bg-surface border font-mono">Esc</kbd> pour fermer
          </p>
          {v && hasOdooAccess && (
            <a
              href={v.odooUrl}
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
  )
}

// ── Petits composants reusables ──────────────────────────────

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

function Field({ label, value, mono, icon }: { label: string; value: string | null | undefined; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-ink-muted text-[10px] uppercase tracking-wider flex items-center gap-1">
        {icon && <span>{icon}</span>}{label}
      </p>
      <p className={`text-ink text-sm truncate ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-ink-faint">—</span>}
      </p>
    </div>
  )
}
