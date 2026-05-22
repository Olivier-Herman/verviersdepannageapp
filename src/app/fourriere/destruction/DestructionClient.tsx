'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import {
  Trash2, Camera, RefreshCw, ArrowLeft, Check, Loader2, AlertTriangle, Mail,
} from 'lucide-react'

const QRScanner = dynamic(() => import('@/components/fourriere/QRScanner'), { ssr: false })

interface Eligible {
  id:                string
  external_id:       string | null
  dossier_number:    string | null
  vehicle_plate:     string | null
  vehicle_brand:     string | null
  vehicle_model:     string | null
  vehicle_vin:       string | null
  client_name:       string | null
  parc_zone_key:     string | null
  parc_row_number:   number | null
  parc_slot_index:   number | null
  intervention_date: string | null
  received_at:       string | null
  driver_photos:     string[] | null
  odoo_helpdesk_id:  number | null
  days_in_parc:      number
  photo_count:       number
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch { return iso }
}

export default function DestructionClient({ userRole, userName, userEmail, userModules }: Props) {
  const [eligibles, setEligibles] = useState<Eligible[]>([])
  const [checked, setChecked]     = useState<Set<string>>(new Set())
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState<string | null>(null)
  const [villeEmail, setVilleEmail] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ count: number; emailSent: boolean; emailTo: string | null } | null>(null)

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch('/api/fourriere/destruction')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      setEligibles(j.eligible || [])
      setVilleEmail(j.ville_destruction_email || null)
    } catch (e: any) {
      setErr(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function toggleChecked(id: string) {
    setChecked(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function checkAll() {
    setChecked(new Set(eligibles.map(e => e.id)))
  }
  function uncheckAll() {
    setChecked(new Set())
  }

  /** Scan QR : extract helpdesk_id depuis l URL /v/<id>, retrouve la mission dans la liste, coche. */
  function handleQrScan(payload: string) {
    const text = (payload || '').trim()
    // Patterns possibles : "https://app.../v/123", "/v/123", "123"
    let helpdeskId: number | null = null
    const matchUrl = text.match(/\/v\/(\d+)/)
    if (matchUrl) helpdeskId = parseInt(matchUrl[1], 10)
    else if (/^\d+$/.test(text)) helpdeskId = parseInt(text, 10)

    if (!helpdeskId) {
      alert(`QR non reconnu : ${text.slice(0, 100)}`)
      return
    }

    const found = eligibles.find(e => e.odoo_helpdesk_id === helpdeskId)
    if (!found) {
      alert(`Ticket #${helpdeskId} non trouvé dans la liste des AVP éligibles à la destruction.`)
      return
    }

    if (checked.has(found.id)) {
      alert(`${found.vehicle_plate || '?'} déjà coché.`)
      return
    }

    setChecked(prev => new Set(prev).add(found.id))
  }

  async function validateDestruction() {
    if (checked.size === 0) return
    if (!confirming) { setConfirming(true); return }

    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch('/api/fourriere/destruction', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mission_ids: Array.from(checked) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur')
      setDone({ count: j.count, emailSent: Boolean(j.email_sent), emailTo: j.email_to })
      setChecked(new Set())
      // Refresh la liste (les véhicules détruits ont disparu)
      await load()
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setSubmitting(false)
      setConfirming(false)
    }
  }

  const allChecked = useMemo(() => eligibles.length > 0 && eligibles.every(e => checked.has(e.id)), [eligibles, checked])

  return (
    <AppShell title="Destruction AVP" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
        <div className="p-4 lg:p-6 space-y-4 ambient-fade-up max-w-4xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Link href="/fourriere"
                className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition">
                <ArrowLeft size={14} />
                Fourrière
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-ink flex items-center gap-2">
                  <Trash2 size={18} className="text-critical" />
                  Destruction AVP fin de mois
                </h1>
                <p className="text-ink-muted text-sm">
                  Véhicules AVP non récupérés depuis ≥ 60 jours, éligibles à l&apos;envoi en destruction.
                </p>
              </div>
            </div>
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm transition disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Rafraîchir
            </button>
          </div>

          {/* Alerte si pas d email Ville configure */}
          {!villeEmail && !loading && (
            <div className="bg-warning/10 border border-warning/40 rounded-2xl p-3 text-sm text-warning">
              ⚠ Email de la Ville de Verviers non configuré. Va dans <Link href="/admin/parc" className="underline font-medium">/admin/parc</Link> pour le définir avant de valider la destruction.
            </div>
          )}

          {/* Succès dernier envoi */}
          {done && (
            <div className="bg-success/10 border border-success/40 rounded-2xl p-3 text-sm text-success space-y-1">
              ✅ <strong>{done.count}</strong> véhicule{done.count > 1 ? 's' : ''} envoyé{done.count > 1 ? 's' : ''} en destruction.
              {done.emailSent
                ? <> Rapport envoyé à <code>{done.emailTo}</code>.</>
                : <> ⚠️ Rapport NON envoyé par mail (config manquante ou erreur).</>}
              <button onClick={() => setDone(null)} className="ml-2 text-xs underline">Fermer</button>
            </div>
          )}

          {err && (
            <div className="bg-critical/10 border border-critical/40 rounded-2xl p-3 text-sm text-critical">
              {err}
            </div>
          )}

          {/* Actions bulk */}
          {eligibles.length > 0 && (
            <div className="bg-surface border rounded-2xl p-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm text-ink-secondary">
                <strong>{checked.size}</strong> / {eligibles.length} cochés
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCameraOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-medium transition"
                >
                  <Camera size={14} /> Scanner QR
                </button>
                <button
                  onClick={allChecked ? uncheckAll : checkAll}
                  className="flex items-center gap-1.5 px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm transition"
                >
                  {allChecked ? 'Tout décocher' : 'Tout cocher'}
                </button>
              </div>
            </div>
          )}

          {/* Tableau eligibles */}
          {loading ? (
            <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">
              Chargement…
            </div>
          ) : eligibles.length === 0 ? (
            <div className="bg-surface border rounded-2xl p-8 text-center">
              <div className="text-3xl mb-2">✨</div>
              <p className="text-ink font-medium">Aucun véhicule éligible à la destruction</p>
              <p className="text-ink-muted text-sm mt-1">
                Aucune AVP n&apos;a dépassé les 60 jours de gardiennage à ce jour.
              </p>
            </div>
          ) : (
            <div className="bg-surface border rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 border-b">
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2.5 w-10"></th>
                      <th className="px-3 py-2.5 font-medium">Plaque / VIN</th>
                      <th className="px-3 py-2.5 font-medium">Véhicule</th>
                      <th className="px-3 py-2.5 font-medium">Emplacement</th>
                      <th className="px-3 py-2.5 font-medium">Date entrée</th>
                      <th className="px-3 py-2.5 font-medium text-right">Jours</th>
                      <th className="px-3 py-2.5 font-medium">📷</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {eligibles.map(e => {
                      const isChecked = checked.has(e.id)
                      return (
                        <tr
                          key={e.id}
                          onClick={() => toggleChecked(e.id)}
                          className={`hover:bg-surface-hover cursor-pointer transition ${
                            isChecked ? 'bg-success/5' : ''
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <input type="checkbox" checked={isChecked} onChange={() => toggleChecked(e.id)} className="w-4 h-4" />
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-mono font-bold text-ink">{e.vehicle_plate || '—'}</span>
                            {e.vehicle_vin && (
                              <div className="text-[10px] text-ink-muted font-mono">{e.vehicle_vin}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary">
                            {[e.vehicle_brand, e.vehicle_model].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center px-2 py-0.5 bg-info/15 border border-info/40 text-info text-xs font-mono font-semibold rounded-md">
                              {e.parc_zone_key}{e.parc_row_number || ''}-{e.parc_slot_index || ''}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-ink-secondary text-xs">{fmtDate(e.intervention_date || e.received_at)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`font-bold ${e.days_in_parc >= 90 ? 'text-critical' : 'text-warning'}`}>
                              {e.days_in_parc} j
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {e.photo_count > 0 ? (
                              <a href={e.driver_photos?.[0] || '#'} target="_blank" rel="noopener" onClick={ev => ev.stopPropagation()}
                                className="text-brand hover:underline text-xs">
                                {e.photo_count} photo{e.photo_count > 1 ? 's' : ''}
                              </a>
                            ) : (
                              <span className="text-ink-muted text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer : valider + envoi rapport */}
          {eligibles.length > 0 && (
            <div className="sticky bottom-0 bg-surface border rounded-2xl p-3 shadow-lg space-y-2">
              {!confirming ? (
                <button
                  onClick={validateDestruction}
                  disabled={checked.size === 0 || submitting}
                  className="w-full py-3 bg-critical hover:bg-critical/90 text-white rounded-xl text-sm font-bold transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Trash2 size={16} />
                  Valider la destruction de {checked.size} véhicule{checked.size > 1 ? 's' : ''}
                </button>
              ) : (
                <>
                  <div className="bg-warning/10 border border-warning/40 rounded-lg p-3 text-warning text-sm flex items-start gap-2">
                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <strong>Action irréversible.</strong> Les {checked.size} véhicule{checked.size > 1 ? 's' : ''} sortiront du parc, passeront en &quot;completed&quot; avec motif &quot;destroyed_avp&quot;.
                      {villeEmail && <> Un rapport sera envoyé à <code>{villeEmail}</code>.</>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setConfirming(false)}
                      disabled={submitting}
                      className="py-2.5 bg-surface-2 hover:bg-surface-hover border text-ink-secondary hover:text-ink rounded-xl text-sm transition"
                    >
                      Annuler
                    </button>
                    <button
                      onClick={validateDestruction}
                      disabled={submitting}
                      className="py-2.5 bg-critical hover:bg-critical/90 text-white rounded-xl text-sm font-bold transition disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Oui, détruire + email Ville
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </AmbientBackground>

      {cameraOpen && (
        <QRScanner
          paused={false}
          onClose={() => setCameraOpen(false)}
          onScan={(payload) => {
            setCameraOpen(false)
            handleQrScan(payload)
          }}
        />
      )}
    </AppShell>
  )
}
