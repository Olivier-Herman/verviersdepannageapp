'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Printer, RefreshCw, Truck, Building2, AlertOctagon, ExternalLink, MapPin, Calendar, FileText, Loader2 } from 'lucide-react'
import { FOURRIERE_ZONES, SCRATCH_STATE_ID } from '@/lib/fourriere'

interface VehicleInfo {
  id:           number
  plate:        string
  vin:          string
  brand:        string
  model:        string
  driver:       string | null
  stateId:      number | null
  stateName:    string | null
  zoneCode:     string | null
  zoneLabel:    string | null
  zoneFullName: string | null
}

interface TicketInfo {
  id:              number
  name:            string
  dateEntree:      string | null
  missionTowsoft:  string | null
  noteEtiquette:   string
  motif:           string
  tagNames:        string[]
  createdAt:       string | null
}

interface Props {
  ticketId:  string
  userName:  string
  userEmail: string
  canEdit:   boolean   // false → mode lecture seule (pas d'actions, pas d'impression)
}

const DOMAINE_STATE_ID = 13   // Zone I — Domaine (cf FOURRIERE_ZONES)

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return '—' }
}

export default function VehicleFourriereClient({ ticketId, userName, canEdit }: Props) {
  const router = useRouter()
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null)
  const [ticket, setTicket]   = useState<TicketInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [actionMenu, setActionMenu] = useState<null | 'transfer' | 'domaine' | 'scratch'>(null)
  const [selectedState, setSelectedState] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const [printing, setPrinting] = useState(false)

  // ── Suggestion auto rangee + slot pour la zone cible du transfert ──────
  interface RowAvail {
    row_number: number
    capacity:   number
    next_slot:  number
    is_full:    boolean
    used_count: number
  }
  const [availRows, setAvailRows] = useState<RowAvail[]>([])
  const [suggestion, setSuggestion] = useState<{ row_number: number; slot_index: number; label: string } | null>(null)
  const [targetRow,  setTargetRow]  = useState<number | null>(null)
  const [showRowPicker, setShowRowPicker] = useState(false)
  const [loadingAvail, setLoadingAvail] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/helpdesk/${encodeURIComponent(ticketId)}`)
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setError(j.error || 'Erreur de chargement')
        return
      }
      setVehicle(j.vehicle)
      setTicket(j.ticket)
    } catch (e: any) {
      setError(e?.message || 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [ticketId])

  function showToast(kind: 'ok' | 'err', msg: string) {
    setToast({ kind, msg })
    setTimeout(() => setToast(null), 3500)
  }

  /** Fetch availabilites des rangees de la zone cible + auto-suggestion. */
  async function loadAvailability(stateId: number) {
    const zone = FOURRIERE_ZONES.find(z => z.state_id === stateId)
    if (!zone) {
      setAvailRows([]); setSuggestion(null); setTargetRow(null); return
    }
    setLoadingAvail(true)
    try {
      const res = await fetch(`/api/inventaire/suggest-row?zone_key=${encodeURIComponent(zone.code)}`)
      const j = await res.json()
      if (res.ok) {
        setAvailRows(j.rows || [])
        setSuggestion(j.suggestion || null)
        setTargetRow(j.suggestion?.row_number ?? null)
      } else {
        setAvailRows([])
        setSuggestion(null)
        setTargetRow(null)
      }
    } catch {
      setAvailRows([])
      setSuggestion(null)
      setTargetRow(null)
    } finally {
      setLoadingAvail(false)
    }
  }

  // Recalcule la suggestion quand l user choisit/change de zone cible
  useEffect(() => {
    if (selectedState != null) loadAvailability(selectedState)
    else { setAvailRows([]); setSuggestion(null); setTargetRow(null); setShowRowPicker(false) }
  }, [selectedState])

  // Slot cible = next_slot de la rangee selectionnee
  const targetSlot = (() => {
    if (targetRow == null) return null
    const r = availRows.find(x => x.row_number === targetRow)
    return r?.is_full ? null : (r?.next_slot ?? null)
  })()

  async function doMove(toStateId: number) {
    setSubmitting(true)
    try {
      const body: any = { to_state_id: toStateId }
      // Si suggestion + selection rangee, on envoie pour placement precis
      if (targetRow && targetSlot) {
        body.target_row  = targetRow
        body.target_slot = targetSlot
      }
      const res = await fetch(`/api/helpdesk/${encodeURIComponent(ticketId)}/move`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const j = await res.json()
      if (!res.ok) {
        showToast('err', j.error || 'Erreur transfert')
        return
      }
      if (j.skipped) {
        showToast('ok', j.message || 'Aucun changement')
      } else {
        const place = (body.target_row && body.target_slot)
          ? ` en ${j.to_state_name?.match(/\b[A-Z\*]+\b/)?.[0] || ''}${body.target_row}-${body.target_slot}`
          : ''
        showToast('ok', `Véhicule transféré : ${j.to_state_name}${place}`)
      }
      setActionMenu(null)
      setSelectedState(null)
      setTargetRow(null)
      setShowRowPicker(false)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  async function doPrint() {
    setPrinting(true)
    try {
      const res = await fetch(`/api/helpdesk/${encodeURIComponent(ticketId)}/print`, {
        method: 'POST',
      })
      const j = await res.json()
      if (!res.ok) {
        showToast('err', j.error || 'Erreur impression')
        return
      }
      showToast('ok', `Étiquette envoyée à l'imprimante`)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-2 to-surface text-ink pb-24">
      {/* Top bar minimaliste mobile */}
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-surface-hover">
        <div className="px-4 py-3 flex items-center justify-between gap-3 max-w-md mx-auto">
          <button
            onClick={() => router.push('/fourriere')}
            className="p-2 -ml-2 text-ink-muted hover:text-ink rounded-lg"
            title="Retour fourrière"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="text-center min-w-0">
            <div className="text-xs text-ink-faint uppercase tracking-wider">Fourrière · ticket #{ticketId}</div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 -mr-2 text-ink-muted hover:text-ink rounded-lg disabled:opacity-50"
            title="Actualiser"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-4">
        {loading && (
          <div className="bg-surface border rounded-2xl p-6 text-center text-ink-muted text-sm">
            <Loader2 className="inline animate-spin mr-2" size={16} /> Chargement…
          </div>
        )}

        {error && (
          <div className="bg-critical-soft border border-critical rounded-2xl p-4 text-critical text-sm">
            ⚠ {error}
          </div>
        )}

        {vehicle && ticket && (
          <>
            {/* Header véhicule */}
            <div className="bg-surface border rounded-2xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xl font-display font-bold text-ink tracking-wide">
                    {vehicle.plate || '— pas de plaque —'}
                  </div>
                  <div className="text-ink-secondary text-sm mt-0.5">
                    {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || '—'}
                  </div>
                </div>
                {vehicle.zoneCode && (
                  <div className="flex-shrink-0 text-center">
                    <div className="text-3xl font-display font-extrabold text-brand">{vehicle.zoneCode}</div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint">Zone</div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-surface-hover">
                <Field icon={<MapPin size={12} />} label="Zone actuelle" value={vehicle.zoneFullName || vehicle.stateName || '—'} />
                <Field icon={<Calendar size={12} />} label="Entrée" value={fmtDate(ticket.dateEntree || ticket.createdAt)} />
                {vehicle.vin && <Field icon={<FileText size={12} />} label="VIN" value={vehicle.vin} mono />}
                {ticket.motif && <Field icon={<AlertOctagon size={12} />} label="Motif" value={ticket.motif} />}
                {ticket.missionTowsoft && <Field icon={<FileText size={12} />} label="Mission Towsoft" value={ticket.missionTowsoft} mono />}
                {ticket.noteEtiquette && <Field icon={<FileText size={12} />} label="Note étiquette" value={ticket.noteEtiquette} />}
              </div>
            </div>

            {/* Actions principales — visible seulement si canEdit */}
            {canEdit && (
              <div className="bg-surface border rounded-2xl p-4 space-y-2">
                <ActionButton
                  icon={<Truck size={18} />}
                  label="Transférer vers une zone"
                  accent="brand"
                  onClick={() => setActionMenu('transfer')}
                />
                <ActionButton
                  icon={<Building2 size={18} />}
                  label="Envoyer au Domaine"
                  accent="warning"
                  onClick={() => setActionMenu('domaine')}
                />
                <ActionButton
                  icon={<AlertOctagon size={18} />}
                  label="Scratch / Mettre en épave"
                  accent="critical"
                  onClick={() => setActionMenu('scratch')}
                />
              </div>
            )}

            {/* Bandeau mode lecture seule (sans le module fourriere) */}
            {!canEdit && (
              <div className="bg-surface-2 border rounded-2xl p-4 text-xs text-ink-muted text-center">
                Consultation seule — contacter un dispatcher pour déplacer ce véhicule.
              </div>
            )}

            {/* Impression + lien Odoo */}
            <div className="bg-surface border rounded-2xl p-4 space-y-2">
              {canEdit && (
                <ActionButton
                  icon={printing ? <Loader2 size={18} className="animate-spin" /> : <Printer size={18} />}
                  label={printing ? 'Impression en cours…' : 'Imprimer une étiquette'}
                  accent="default"
                  onClick={doPrint}
                  disabled={printing}
                />
              )}
              <a
                href={`https://verviers-depannage.odoo.com/web#id=${ticket.id}&model=helpdesk.ticket&view_type=form`}
                target="_blank"
                rel="noopener"
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 hover:bg-surface-hover transition border text-ink-secondary hover:text-ink"
              >
                <ExternalLink size={18} />
                <span className="text-sm font-medium flex-1">Ouvrir dans Odoo</span>
              </a>
            </div>

            <div className="text-center text-[10px] text-ink-faint pt-2">
              Connecté en tant que <span className="font-medium text-ink-muted">{userName}</span>
            </div>
          </>
        )}
      </main>

      {/* Sheet : selection zone + suggestion auto rangee + slot */}
      {actionMenu === 'transfer' && (
        <BottomSheet onClose={() => { setActionMenu(null); setSelectedState(null); setShowRowPicker(false) }} title="Transférer vers…">
          <div className="grid grid-cols-3 gap-2 mb-4">
            {FOURRIERE_ZONES.map(z => (
              <button
                key={z.state_id}
                onClick={() => { setSelectedState(z.state_id); setShowRowPicker(false) }}
                disabled={z.state_id === vehicle?.stateId}
                className={`p-3 rounded-xl border text-center transition ${
                  selectedState === z.state_id
                    ? 'bg-brand text-white border-brand shadow-md'
                    : z.state_id === vehicle?.stateId
                      ? 'bg-surface-2 border-surface-hover opacity-40'
                      : 'bg-surface-2 hover:bg-surface-hover border-surface-hover'
                }`}
              >
                <div className="font-display font-bold text-lg">{z.code}</div>
                <div className="text-[10px] text-ink-faint truncate">{z.description || z.label}</div>
              </button>
            ))}
          </div>

          {/* Suggestion rangee + slot pour la zone selectionnee */}
          {selectedState != null && (
            <div className="mb-4">
              {loadingAvail ? (
                <div className="text-center text-ink-muted text-sm py-2">
                  <Loader2 className="inline animate-spin mr-2" size={14} /> Recherche de place…
                </div>
              ) : availRows.length === 0 ? (
                <div className="bg-surface-2 border rounded-xl p-3 text-ink-secondary text-sm text-center">
                  Cette zone n&apos;a pas de rangées configurées. Le véhicule sera transféré sans placement précis.
                </div>
              ) : suggestion == null ? (
                <div className="bg-critical/10 border border-critical/40 rounded-xl p-3 text-critical text-sm text-center">
                  ⚠ Toutes les rangées sont pleines pour cette zone.
                </div>
              ) : showRowPicker ? (
                <div className="bg-surface-2 border rounded-xl p-3 space-y-2">
                  <div className="text-xs text-ink-muted mb-1">Choisis une rangée :</div>
                  <div className="grid grid-cols-3 gap-2">
                    {availRows.map(r => {
                      const code = FOURRIERE_ZONES.find(z => z.state_id === selectedState)?.code || ''
                      return (
                        <button
                          key={r.row_number}
                          onClick={() => { setTargetRow(r.row_number); setShowRowPicker(false) }}
                          disabled={r.is_full}
                          className={`p-2 rounded-lg border text-center transition ${
                            targetRow === r.row_number && !r.is_full
                              ? 'bg-brand text-white border-brand'
                              : r.is_full
                                ? 'bg-surface border-ink/15 opacity-40 cursor-not-allowed'
                                : 'bg-surface hover:bg-surface-hover border-ink/15'
                          }`}>
                          <div className="font-mono font-bold text-sm">{code}{r.row_number}</div>
                          <div className="text-[10px] opacity-80">
                            {r.is_full ? 'plein' : `slot ${r.next_slot} libre`}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-success/10 border border-success/30 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-ink-muted">Place suggérée :</div>
                    <div className="text-ink font-bold font-mono">
                      {(() => {
                        const code = FOURRIERE_ZONES.find(z => z.state_id === selectedState)?.code || ''
                        return `${code}${targetRow}-${targetSlot}`
                      })()}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowRowPicker(true)}
                    className="text-xs text-brand hover:underline">
                    Changer de rangée
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            disabled={!selectedState || submitting || (availRows.length > 0 && (!targetRow || !targetSlot))}
            onClick={() => selectedState && doMove(selectedState)}
            className="w-full py-3 bg-brand text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <><Loader2 className="animate-spin" size={16} /> En cours…</> : 'Confirmer le transfert'}
          </button>
        </BottomSheet>
      )}

      {actionMenu === 'domaine' && (
        <BottomSheet onClose={() => setActionMenu(null)} title="Envoyer au Domaine ?">
          <p className="text-sm text-ink-secondary mb-4">
            Le véhicule passera en zone <strong className="text-ink">Domaine</strong>. Cette action est tracée.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setActionMenu(null)}
              disabled={submitting}
              className="flex-1 py-3 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition"
            >
              Annuler
            </button>
            <button
              onClick={() => doMove(DOMAINE_STATE_ID)}
              disabled={submitting}
              className="flex-1 py-3 bg-warning text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <><Loader2 className="animate-spin" size={16} /> …</> : 'Confirmer Domaine'}
            </button>
          </div>
        </BottomSheet>
      )}

      {actionMenu === 'scratch' && (
        <BottomSheet onClose={() => setActionMenu(null)} title="Scratch / Épave ?">
          <p className="text-sm text-ink-secondary mb-4">
            Le véhicule passera en statut <strong className="text-critical">Scratch</strong>.
            Cette action est tracée et difficile à inverser.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setActionMenu(null)}
              disabled={submitting}
              className="flex-1 py-3 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition"
            >
              Annuler
            </button>
            <button
              onClick={() => doMove(SCRATCH_STATE_ID)}
              disabled={submitting}
              className="flex-1 py-3 bg-critical text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <><Loader2 className="animate-spin" size={16} /> …</> : 'Confirmer Scratch'}
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-4 right-4 max-w-md mx-auto z-50">
          <div className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium border ${
            toast.kind === 'ok'
              ? 'bg-success-soft border-success/40 text-success'
              : 'bg-critical-soft border-critical/40 text-critical'
          }`}>
            {toast.kind === 'ok' ? '✅ ' : '⚠ '}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ icon, label, value, mono = false }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-ink-faint flex items-center gap-1">{icon} {label}</div>
      <div className={`text-ink mt-0.5 break-words ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</div>
    </div>
  )
}

function ActionButton({
  icon, label, accent, onClick, disabled,
}: {
  icon: React.ReactNode
  label: string
  accent: 'brand' | 'warning' | 'critical' | 'default'
  onClick: () => void
  disabled?: boolean
}) {
  const cls = {
    brand:    'bg-brand hover:bg-brand-hover text-white',
    warning:  'bg-warning hover:bg-warning/90 text-white',
    critical: 'bg-critical hover:bg-critical/90 text-white',
    default:  'bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink',
  }[accent]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition disabled:opacity-50 ${cls}`}
    >
      {icon}
      <span className="text-sm font-medium flex-1 text-left">{label}</span>
    </button>
  )
}

function BottomSheet({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50">
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface w-full max-w-md rounded-t-2xl border-t border-l border-r p-5 pb-8 shadow-2xl"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
      >
        <div className="w-12 h-1 bg-ink-faint/40 rounded-full mx-auto mb-4" />
        <h2 className="text-ink font-semibold mb-4 text-center">{title}</h2>
        {children}
      </div>
    </div>
  )
}
