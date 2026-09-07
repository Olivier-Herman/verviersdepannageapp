'use client'
// src/app/mission/MissionListClient.tsx
// Liste des missions du chauffeur avec bouton "+" flottant

import Link         from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Shield, Wallet, X } from 'lucide-react'
import { T }    from '@/lib/i18n/T'
import { useT } from '@/lib/i18n/I18nProvider'
import { TruckSwitcher } from '@/components/trucks/TruckSwitcher'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mission {
  id: string
  mission_number: number | null
  external_id: string
  dossier_number: string | null
  source: string
  mission_type: string | null
  status: string
  client_name: string | null
  client_phone: string | null
  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  incident_address: string | null
  incident_city: string | null
  received_at: string
  accepted_at: string | null
  on_way_at: string | null
  on_site_at: string | null
  completed_at: string | null
  assigned_at: string | null
}

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; i18nKey: string; dot: string; row: string }> = {
  assigned:    { label: 'À accepter', i18nKey: 'mission_list.status_to_accept',  dot: 'bg-blue-400',   row: 'border-l-blue-500'   },
  accepted:    { label: 'Acceptée',   i18nKey: 'mission_list.status_accepted',   dot: 'bg-indigo-400', row: 'border-l-indigo-500' },
  in_progress: { label: 'En cours',   i18nKey: 'mission_list.status_in_progress',dot: 'bg-orange-400', row: 'border-l-orange-500' },
  parked:      { label: 'En dépôt',   i18nKey: 'mission_list.status_parked',     dot: 'bg-yellow-400', row: 'border-l-yellow-500' },
  completed:   { label: 'Terminée',   i18nKey: 'mission_list.status_completed',  dot: 'bg-green-400',  row: 'border-l-green-500'  },
}

const TYPE_SHORT: Record<string, string> = {
  remorquage: 'REM', depannage: 'DSP', transport: 'Transport',
  DSP: 'DSP', REM: 'REM', Transport: 'Transport', DPR: 'DPR', VR: 'VR',
}

const SOURCE_LABELS: Record<string, string> = {
  touring: 'TOURING', ethias: 'ETHIAS', vivium: 'VIVIUM',
  axa: 'IPA', ardenne: 'ARDENNE', mondial: 'MONDIAL',
  vab: 'VAB', police: 'POLICE', prive: 'PRIVÉ', garage: 'GARAGE',
}

function fmt(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function MissionListClient({
  missions: initialMissions,
  navApp,
  currentUserId,
}: {
  missions: Mission[]
  navApp: string
  currentUserId?: string
}) {
  const router = useRouter()
  const { t } = useT()
  const [missions, setMissions] = useState<Mission[]>(initialMissions)
  const [showChoice, setShowChoice] = useState(false)
  // ── PARC DE RELIVRAISON ───────────────────────────────────────────────────
  // « Il n'a pas la possibilité de sortir la voiture du parc pour la mettre en
  // relivraison, sauf en scannant le QR — qui à ce moment-là n'est pas encore
  // collé sur le véhicule » (Olivier 2026-09-07). Franck, de nuit et sans
  // mission, veut pouvoir écouler le parc qu'il a lui-même rempli pendant le
  // rush. Le QR est un raccourci quand on est devant la voiture ; il ne doit pas
  // être le SEUL chemin.
  const [showParc, setShowParc] = useState(false)
  const [parc, setParc] = useState<any[] | null>(null)
  const [parcBusy, setParcBusy] = useState<string | null>(null)
  const [parcErr, setParcErr] = useState('')
  useEffect(() => {
    if (!showParc || parc) return
    fetch('/api/relivraison/list?zone=K', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setParc(d.missions || d.rows || []))
      .catch(() => setParc([]))
  }, [showParc, parc])

  /** Prendre un véhicule du parc : crée (ou reprend) la relivraison et se
   *  l'attribue. Même chemin serveur que le scan du QR — on ne double pas la
   *  règle métier, on lui ouvre une seconde porte. */
  const prendreRelivraison = async (m: any, confirmer = false) => {
    setParcBusy(m.id); setParcErr('')
    try {
      const r = await fetch(`/api/missions/${m.id}/qr-rel-action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_reassign: confirmer }),
      })
      const j = await r.json()
      if (r.status === 409 && j.needs_confirm) {
        const qui = j.current_assignee_name || 'un autre chauffeur'
        if (confirm(`Cette relivraison est déjà attribuée à ${qui}. La reprendre ?`)) return prendreRelivraison(m, true)
        setParcBusy(null); return
      }
      if (!r.ok || !j.ok) { setParcErr(j.error || 'Impossible de lancer la relivraison'); setParcBusy(null); return }
      router.push(j.redirect_url || `/mission/${j.mission_id}`)
    } catch (e: any) {
      setParcErr(e?.message || 'Erreur'); setParcBusy(null)
    }
  }

  // Force refresh à l'ouverture — données toujours fraîches
  useEffect(() => {
    router.refresh()
  }, [])

  // Realtime — écoute les nouvelles missions assignées
  useEffect(() => {
    if (!currentUserId) return
    const ch = sb.channel('mission-list')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'incoming_missions',
        filter: `assigned_to=eq.${currentUserId}`,
      }, () => {
        window.location.reload()
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [currentUserId])

  // Filtrage des completed cote serveur deja, ici on a uniquement les actives
  const active = missions

  return (
    <div className="relative pb-24">
      <div className="px-4 py-4 space-y-2">

        {/* Olivier 2026-06-02 : selecteur de depanneuse en haut de la liste.
            Permet au chauffeur de changer rapidement sans attendre le modal
            de seuil 7h/17h. */}
        <div className="mb-3">
          <TruckSwitcher />
        </div>

        {active.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-ink-muted">
            <p className="text-5xl mb-4">🚗</p>
            <p className="text-lg font-semibold text-ink mb-1"><T k="mission_list.empty_title" /></p>
            <p className="text-sm mb-6"><T k="mission_list.empty_subtitle" /></p>
            <button type="button" onClick={() => setShowChoice(true)}
              className="flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-semibold">
              <T k="mission_list.new_intervention" />
            </button>
          </div>
        )}

        {active.length > 0 && (
          <>
            <p className="text-ink-muted text-xs font-semibold uppercase tracking-wide px-1 mb-3">
              <T k="mission_list.section_in_progress" /> · {active.length}
            </p>
            {active.map(m => <MissionRow key={m.id} mission={m} router={router} />)}
          </>
        )}
      </div>

      {/* ── Parc de relivraison ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowParc(true)}
        className="fixed bottom-6 left-5 h-16 px-5 bg-surface border-2 border-brand rounded-2xl shadow-2xl flex items-center gap-2 text-ink font-semibold transition active:scale-95 z-20">
        <span className="text-xl">🅿️</span>
        <span className="text-sm leading-tight text-left">Parc de<br />relivraison</span>
      </button>

      {showParc && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col">
            <div className="px-5 pt-4 pb-3 border-b border flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-ink font-bold">🅿️ Parc de relivraison</p>
                <p className="text-ink-muted text-xs">{parc == null ? 'chargement…' : `${parc.length} véhicule(s) en attente`}</p>
              </div>
              <button onClick={() => setShowParc(false)} className="text-ink-muted text-2xl px-2">×</button>
            </div>
            {parcErr && <p className="px-5 pt-3 text-red-500 text-sm">⚠ {parcErr}</p>}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {parc != null && parc.length === 0 && (
                <p className="text-ink-muted text-sm text-center py-10">Aucun véhicule à relivrer pour l’instant.</p>
              )}
              {(parc || []).map((m: any) => (
                <div key={m.id} className="border rounded-2xl p-3 bg-surface-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-bold text-ink">{m.vehicle_plate || '—'}</span>
                    <span className="text-ink-secondary text-sm truncate">
                      {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}
                    </span>
                  </div>
                  <p className="text-ink-muted text-xs mt-1">
                    {m.redelivery_address
                      ? `→ ${m.redelivery_address}`
                      : '→ adresse de relivraison pas encore connue'}
                  </p>
                  <button
                    type="button"
                    disabled={parcBusy === m.id || !m.redelivery_address}
                    onClick={() => prendreRelivraison(m)}
                    className="mt-2 w-full py-2.5 bg-brand disabled:opacity-40 text-white rounded-xl text-sm font-bold">
                    {parcBusy === m.id ? 'Création…' : m.redelivery_address ? '🚚 Relivrer ce véhicule' : 'Adresse manquante'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── FAB Nouvelle intervention ────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowChoice(true)}
        className="fixed bottom-6 right-5 w-16 h-16 bg-brand rounded-full shadow-2xl flex items-center justify-center text-ink text-3xl font-bold transition active:scale-95 z-20"
        title={t('mission_list.new_intervention_title')}>
        +
      </button>

      {/* ── Modal choix type d'intervention ────────────────────────────── */}
      {showChoice && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowChoice(false)}>
          <div onClick={e => e.stopPropagation()}
            className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-ink font-bold text-lg"><T k="mission_list.choice_modal_title" /></h3>
              <button type="button" onClick={() => setShowChoice(false)}
                className="text-ink-muted hover:text-ink p-1">
                <X size={20} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => router.push('/mission/police')}
              className="w-full flex items-start gap-3 p-4 bg-surface-2 hover:bg-surface-hover border rounded-2xl text-left transition active:scale-[0.98]">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                <Shield size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold"><T k="mission_list.choice_police" /></p>
                <p className="text-ink-muted text-xs mt-0.5"><T k="mission_list.choice_police_desc" /></p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => router.push('/encaissement')}
              className="w-full flex items-start gap-3 p-4 bg-surface-2 hover:bg-surface-hover border rounded-2xl text-left transition active:scale-[0.98]">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-success/10 text-success flex items-center justify-center">
                <Wallet size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-ink font-semibold"><T k="mission_list.choice_with_cash" /></p>
                <p className="text-ink-muted text-xs mt-0.5"><T k="mission_list.choice_with_cash_desc" /></p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Mission Row ───────────────────────────────────────────────────────────────

function MissionRow({ mission, router }: { mission: Mission; router: ReturnType<typeof useRouter> }) {
  const cfg = STATUS_CONFIG[mission.status] || STATUS_CONFIG.assigned

  return (
    <div
      onClick={() => router.push(`/mission/${mission.id}`)}
      className={`bg-surface border border border-l-4 rounded-2xl p-4 cursor-pointer hover:bg-surface-2 transition active:scale-[0.99] ${cfg.row}`}
    >
      <div className="flex items-start justify-between gap-3">

        {/* Infos principales */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <span className="text-ink-secondary text-xs font-medium"><T k={cfg.i18nKey} /></span>
            {mission.mission_type && (
              <span className="bg-surface-hover text-ink-secondary text-xs px-1.5 py-0.5 rounded font-medium">
                {TYPE_SHORT[mission.mission_type] || mission.mission_type}
              </span>
            )}
            <span className="text-ink-faint text-xs">{SOURCE_LABELS[mission.source] || mission.source}</span>
          </div>

          <p className="text-ink font-bold text-base leading-tight truncate">
            {mission.client_name || <T k="mission_list.unknown_client" />}
          </p>

          {(mission.vehicle_plate || mission.vehicle_brand) && (
            <p className="text-ink-secondary text-sm mt-0.5">
              {mission.vehicle_plate && (
                <span className="font-mono font-bold text-ink-secondary">{mission.vehicle_plate} · </span>
              )}
              {[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ')}
            </p>
          )}

          {(mission.incident_address || mission.incident_city) && (
            <p className="text-ink-muted text-xs mt-1 truncate">
              📍 {mission.incident_address}{mission.incident_city ? `, ${mission.incident_city}` : ''}
            </p>
          )}
        </div>

        {/* Heure + flèche */}
        <div className="text-right flex-shrink-0">
          <p className="text-ink-muted text-xs">{fmt(mission.received_at)}</p>
          <p className="text-ink-faint text-xl mt-2">›</p>
        </div>
      </div>

      {/* Timeline compacte pour missions actives */}
      {mission.status !== 'completed' && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border overflow-x-auto">
          {[
            { i18nKey: 'mission_list.timeline_accepted', ts: mission.accepted_at, dot: 'bg-indigo-400' },
            { i18nKey: 'mission_list.timeline_on_way',   ts: mission.on_way_at,   dot: 'bg-amber-400'  },
            { i18nKey: 'mission_list.timeline_on_site',  ts: mission.on_site_at,  dot: 'bg-orange-400' },
          ].map(step => (
            <div key={step.i18nKey} className={`flex items-center gap-1.5 flex-shrink-0 ${step.ts ? 'opacity-100' : 'opacity-30'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${step.ts ? step.dot : 'bg-ink-faint'}`} />
              <span className="text-xs text-ink-muted"><T k={step.i18nKey} /></span>
              {step.ts && <span className="text-xs text-ink-secondary">{fmt(step.ts)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
