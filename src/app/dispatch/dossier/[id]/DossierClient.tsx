'use client'
// Vue DOSSIER unifiée (reconstruite, preview). Pleine largeur.
// - En-tête partagé : n° interne + véhicule + client (une fois).
// - Accordéon anté-chrono des actions ; chaque section = colonnes (Intervention /
//   Trajet / Parc) + Commentaires + Photos + Facturation (par action).
// - Colonne d'actions collante à droite : boutons workflow de la DERNIÈRE action.
// - Historique unifié (toutes actions).
// Gaté par le flag 'dossier_view'. Réutilise les endpoints existants pour les actions.

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import DriverPickerModal from '@/components/DriverPickerModal'

interface Leg {
  letter: string; kind: 'rem' | 'parc' | 'rel'; mission_id: string; mission_number: number | null
  dossier_number: string | null; status: string; title: string
  billed_to_name: string | null; billed_inherited?: boolean; driver_name: string | null
  started_at: string | null; is_last: boolean; is_card: boolean; assign_locked: boolean
  details: any
}
interface HistoryLine { letter: string; at: string | null; action: string | null; notes: string | null; actor: string | null }
interface Dossier {
  ref: string; root_id: string; dossier_number: string | null; source: string | null
  vehicle: { plate: string | null; brand: string | null; model: string | null; vin: string | null }
  client:  { name: string | null; phone: string | null }
  legs: Leg[]; history: HistoryLine[]
}

const fmt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function DossierClient({ id, isSuperadmin }: { id: string; isSuperadmin: boolean }) {
  const router = useRouter()
  const [data, setData]       = useState<Dossier | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [open, setOpen]       = useState<Set<string>>(new Set())
  const [flagMode, setFlagMode] = useState<string>('')
  const [busy, setBusy]       = useState(false)
  const [assignFor, setAssignFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/dossier/${id}`)
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Erreur')
      setData(j.dossier)
      setOpen(prev => prev.size ? prev : new Set([(j.dossier.legs as Leg[]).find(l => l.is_last)?.letter].filter(Boolean) as string[]))
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!isSuperadmin) return
    fetch('/api/admin/feature-flags').then(r => r.json()).then(j => {
      const f = (j.flags || []).find((x: any) => x.key === 'dossier_view'); if (f) setFlagMode(f.mode)
    }).catch(() => {})
  }, [isSuperadmin])

  const setMode = async (mode: string) => {
    setFlagMode(mode)
    await fetch('/api/admin/feature-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'dossier_view', mode }) }).catch(() => {})
  }

  const toggle = (letter: string) => setOpen(prev => { const n = new Set(prev); n.has(letter) ? n.delete(letter) : n.add(letter); return n })

  // ── Actions (réutilisent les endpoints existants) ─────────────────────────
  const doAssign = async (missionId: string, driverId: string) => {
    setBusy(true)
    try {
      const r = await fetch('/api/missions/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission_id: missionId, driver_id: driverId }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Assignation : ${j.error || r.status}`) }
      setAssignFor(null); await load()
    } finally { setBusy(false) }
  }
  const doPark = async (missionId: string) => {
    if (!confirm('Mettre ce véhicule en parc (dépôt + zone par défaut de la source) ?')) return
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/force-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'parked' }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Mise en parc : ${j.error || r.status}`) }
      await load()
    } finally { setBusy(false) }
  }
  const doRelivrer = async (missionId: string, current?: string | null) => {
    const addr = window.prompt('Adresse de relivraison :', current || '')
    if (!addr || !addr.trim()) return
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/relivrer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redelivery_address: addr.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { alert(`Relivraison : ${j.error || r.status}`); return }
      await load()
    } finally { setBusy(false) }
  }
  const doForce = async (missionId: string, status: string) => {
    if (!status) return
    if (!confirm(`Forcer le statut → ${status} ?`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/force-status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Forçage : ${j.error || r.status}`) }
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return <div className="p-8 text-ink-muted text-sm">Chargement du dossier…</div>
  if (error || !data) return <div className="p-8 text-critical text-sm">⚠ {error || 'Dossier introuvable'}</div>

  const veh = [data.vehicle.brand, data.vehicle.model].filter(Boolean).join(' ')
  const legsDisplay = [...data.legs].filter(l => l.is_card).reverse()
  const lastCard = data.legs.find(l => l.is_last) || null

  return (
    <div className="px-4 lg:px-8 py-6 space-y-4">

      {isSuperadmin && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-2.5">
          <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">🧪 Preview « Fiche dossier »</span>
          <div className="flex items-center gap-1">
            {([['off', 'Off'], ['superadmin', 'Moi'], ['all', 'Tout le monde']] as const).map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${flagMode === m ? 'bg-amber-500 text-white' : 'bg-surface border text-ink-secondary hover:text-ink'}`}>{lbl}</button>
            ))}
          </div>
        </div>
      )}

      {/* En-tête partagé (n° interne + véhicule + client) */}
      <div className="bg-surface border rounded-2xl px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="text-ink font-bold text-lg">Dossier {data.ref}</h1>
        <span className="text-ink-secondary text-sm">{veh || '—'}{data.vehicle.plate ? ` · ${data.vehicle.plate}` : ''}</span>
        {data.client.name && <span className="text-ink-muted text-sm">· {data.client.name}{data.client.phone ? ` ${data.client.phone}` : ''}</span>}
        {data.source && <span className="ml-auto text-xs font-semibold text-ink-secondary bg-surface-2 border rounded-lg px-2 py-0.5">{data.source}</span>}
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_18rem] lg:gap-4 lg:items-start">

        {/* Colonne gauche : accordéon des actions */}
        <div className="space-y-2 min-w-0">
          {legsDisplay.map((leg) => {
            const isOpen = open.has(leg.letter)
            const idx = leg.letter.charCodeAt(0) - 65
            const bg  = idx % 2 === 0 ? 'bg-zinc-100 dark:bg-zinc-800' : 'bg-white dark:bg-zinc-900'
            const d = leg.details || {}
            return (
              <div key={leg.letter} className={`${bg} border rounded-2xl overflow-hidden`}>
                <button onClick={() => toggle(leg.letter)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover/40 transition">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-ink/5 border flex items-center justify-center text-xs font-bold text-ink">-{leg.letter}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink text-sm font-semibold truncate">{leg.title} <span className="text-ink-faint font-normal">· {leg.status}</span></p>
                    <p className="text-ink-muted text-xs truncate">
                      {leg.dossier_number ? `${leg.dossier_number} · ` : ''}{leg.driver_name ? `${leg.driver_name} · ` : ''}
                      {d.gardiennage_days != null ? `🅿️ ${d.gardiennage_days} j · ` : ''}{leg.billed_to_name || ''}
                    </p>
                  </div>
                  <span className="text-ink-faint text-xs flex-shrink-0">{fmt(leg.started_at)}</span>
                  <span className="text-ink-muted text-sm flex-shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t space-y-4">
                    {/* Colonnes */}
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                      <Panel title="Intervention">
                        <Field k="Type"  v={d.mission_type} />
                        <Field k="Incident" v={d.incident_type} />
                        <Field k={leg.kind === 'rel' ? 'Départ (parc)' : 'Lieu'} v={d.incident_address} />
                        <Field k="Reçu"  v={fmt(leg.started_at)} />
                      </Panel>
                      <Panel title="Trajet">
                        <Field k="Destination" v={d.destination_address} />
                        <Field k="Chauffeur"   v={leg.driver_name} />
                        <Field k="Statut"      v={leg.status} />
                      </Panel>
                      {(d.parc_zone_key != null || d.gardiennage_days != null || d.redelivery_address) && (
                        <Panel title="Parc / gardiennage">
                          <Field k="Zone" v={d.parc_zone_key} />
                          <Field k="Jours" v={d.gardiennage_days != null ? `${d.gardiennage_days} j${d.still_parked ? ' (en cours)' : ''}` : null} />
                          <Field k="Relivraison" v={d.redelivery_address} />
                        </Panel>
                      )}
                    </div>

                    {/* Commentaires */}
                    {(d.remarks_general || d.closing_notes || (d.comments?.length > 0)) && (
                      <Panel title="Commentaires">
                        {d.remarks_general && <p className="text-ink text-sm">{d.remarks_general}</p>}
                        {d.closing_notes && <p className="text-ink-secondary text-sm mt-1">Clôture : {d.closing_notes}</p>}
                        {d.comments?.map((c: any, i: number) => (
                          <p key={i} className="text-ink-secondary text-sm border-l-2 border-ink/10 pl-2 mt-1">{c.text} <span className="text-ink-faint text-xs">· {fmt(c.at)}</span></p>
                        ))}
                      </Panel>
                    )}

                    {/* Photos */}
                    {d.photos?.length > 0 && (
                      <Panel title={`Photos (${d.photos.length})`}>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                          {d.photos.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border">
                              <img src={url} alt="" className="w-full h-full object-cover" />
                            </a>
                          ))}
                        </div>
                      </Panel>
                    )}

                    {/* Facturation — PAR action */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-ink-muted text-xs">Facturé à <b className="text-ink-secondary">{leg.billed_to_name || '—'}</b>{leg.billed_inherited ? ' (hérité)' : ''}
                        {d.invoice_number ? ` · 🧾 ${d.invoice_number}` : ''}
                        {d.amount_to_collect != null ? ` · ${Number(d.amount_to_collect).toFixed(2)} €` : ''}</span>
                      <div className="flex gap-2 ml-auto">
                        <button onClick={() => router.push(`/dispatch/${leg.mission_id}`)} className="px-3 py-1.5 bg-surface border rounded-lg text-xs font-medium text-ink-secondary hover:text-ink transition">🧾 Facturer</button>
                        <button onClick={() => router.push(`/dispatch/${leg.mission_id}`)} className="px-3 py-1.5 bg-surface border rounded-lg text-xs font-medium text-ink-secondary hover:text-ink transition">🧾 Facture partielle</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Colonne droite collante : actions de la DERNIÈRE action */}
        {lastCard && (
          <div className="mt-3 lg:mt-0 lg:sticky lg:top-4">
            <div className="bg-surface border rounded-2xl p-4 space-y-2">
              <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide">Actions · -{lastCard.letter}</p>
              <p className="text-ink-secondary text-xs mb-1">{lastCard.title} · {lastCard.status}</p>

              {lastCard.assign_locked
                ? <p className="text-ink-faint text-xs bg-surface-2 border rounded-lg px-3 py-2">👤 {lastCard.driver_name || 'Chauffeur'} · assignation verrouillée (clôturé/en parc)</p>
                : <ActBtn onClick={() => setAssignFor(lastCard.mission_id)} busy={busy}>👤 Assigner un chauffeur</ActBtn>}

              {!['parked', 'to_invoice', 'completed'].includes(lastCard.status) && (
                <ActBtn onClick={() => doPark(lastCard.mission_id)} busy={busy}>🅿️ Mettre en parc</ActBtn>
              )}
              {lastCard.status === 'parked' && (
                <ActBtn onClick={() => doRelivrer(lastCard.mission_id, lastCard.details?.redelivery_address)} busy={busy}>🚚 Relivrer</ActBtn>
              )}

              <div className="pt-1">
                <label className="text-ink-muted text-xs">⚙️ Forcer statut</label>
                <select disabled={busy} defaultValue="" onChange={e => { doForce(lastCard.mission_id, e.target.value); e.currentTarget.value = '' }}
                  className="w-full mt-1 bg-surface-2 border rounded-lg px-2 py-1.5 text-ink text-sm">
                  <option value="">— choisir —</option>
                  {['new', 'dispatching', 'assigned', 'in_progress', 'delivering', 'parked', 'to_invoice', 'completed'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Historique unifié */}
      {data.history?.length > 0 && (
        <div className="bg-surface border rounded-2xl p-5">
          <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">Historique — dossier complet</h2>
          <div className="space-y-2.5">
            {data.history.map((h, i) => (
              <div key={i} className="flex gap-2.5 text-sm">
                <span className="flex-shrink-0 mt-0.5 h-5 min-w-[26px] px-1 text-center text-[10px] font-bold text-ink-secondary bg-ink/5 border rounded flex items-center justify-center">-{h.letter}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-ink leading-snug">{h.notes || h.action}</p>
                  <p className="text-ink-faint text-xs">{h.actor ? `${h.actor} · ` : ''}{fmt(h.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {assignFor && (
        <DriverPickerModal missionId={assignFor} onPick={(driverId) => doAssign(assignFor, driverId)} onClose={() => setAssignFor(null)} />
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border rounded-xl p-3">
      <p className="text-ink-muted text-[11px] font-semibold uppercase tracking-wide mb-1.5">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
function Field({ k, v }: { k: string; v: any }) {
  if (v == null || v === '') return null
  return <div className="flex gap-2 text-sm"><span className="text-ink-muted text-xs w-24 flex-shrink-0">{k}</span><span className="text-ink">{String(v)}</span></div>
}
function ActBtn({ onClick, busy, children }: { onClick: () => void; busy: boolean; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={busy} className="w-full py-2 bg-brand hover:bg-brand-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium transition text-left px-3">{children}</button>
}
