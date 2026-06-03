'use client'
// src/app/mission/[id]/SncMissionFiche.tsx
//
// Fiche driver pour les missions Siabis Non Couvert (police_snc) et
// Siabis Couvert (sia_couvert) reclassifiees par le dispatch.
//
// Objectif (Olivier 2026-06-02 PM) : visuellement et fonctionnellement
// une "fiche appel police SNC completee" — meme look que PoliceClient.tsx,
// mais en mode lecture d une mission EXISTANTE (pas un formulaire de creation).
//
// Sections (mirror PoliceClient SNC) :
//   1. Header bleu/cyan (SNC = bleu, SC = cyan)
//   2. Vehicule (read-only)
//   3. Proprietaire / Client (read-only)
//   4. Lieu d intervention + bouton Naviguer
//   5. Scenario SNC (3 tuiles editables, recalcul tarif)
//   6. Toggle balisage (recalcul tarif)
//   7. Destination (autocomplete Google, REM seulement)
//   8. Preview tarif live
//   9. Bouton "Gerer les photos" (redirige vers DriverClient via ?legacy=1)
//  10. Actions principales selon scenario+status

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { Loader2 } from 'lucide-react'
import { formatEur } from '@/lib/format'
import { buildEncaissementUrl } from '@/lib/missions/encaissement-url'
import AddressField from '@/components/AddressField'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── Types (alignes sur DriverClient.tsx) ──────────────────────────────────
type NavApp = 'gmaps' | 'waze' | 'apple'

interface Mission {
  id: string; status: string; mission_type?: string
  incident_type?: string
  parent_mission_id?: string | null
  client_name?: string; client_phone?: string
  billed_to_name?: string; billed_to_id?: number | null; source?: string; dossier_number?: string; external_id?: string
  vehicle_brand?: string; vehicle_model?: string; vehicle_plate?: string; vehicle_vin?: string
  incident_address?: string; incident_city?: string; incident_lat?: number; incident_lng?: number
  incident_description?: string; remarks_general?: string
  warnings?: string[] | null
  vehicle_class?: 'car' | 'moto' | string | null
  distance_km?: number | null
  duration_min?: number | null
  snc_scenario?: 'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct' | string | null
  snc_requires_balisage?: boolean | null
  police_blocked?: boolean | null
  remarks_billing?: string | null
  destination_address?: string; destination_name?: string
  destination_lat?: number; destination_lng?: number; redelivery_address?: string
  extra_addresses?: Array<{ id?: string; label?: string; address?: string; lat?: number | null; lng?: number | null; sort_order?: number }> | null
  intervention_date?: string; received_at?: string
  accepted_at?: string; on_way_at?: string; on_site_at?: string
  loaded_at?: string
  completed_at?: string; parked_at?: string; delivering_at?: string
  amount_guaranteed?: number; amount_currency?: string; amount_to_collect?: number
  payment_collected_at?: string | null; payment_mode?: string | null; payment_amount?: number | null
  park_stage_name?: string; driver_photos?: string[]
  awaiting_payment?: boolean | null
}

interface Props {
  mission: Mission
  currentUserId?: string
  isReadOnly?: boolean
  navApp?: NavApp
}

// ── Helpers (mirror DriverClient) ─────────────────────────────────────────
const plate = (v = '') => v.replace(/[-.\s]/g, '').toUpperCase()

const gUrl = (app: NavApp, lat?: number, lng?: number, addr?: string) => {
  const q = lat && lng ? `${lat},${lng}` : encodeURIComponent(addr || '')
  if (!q) return null
  if (app === 'waze')  return `https://waze.com/ul?ll=${q}&navigate=yes`
  if (app === 'apple') return `https://maps.apple.com/?daddr=${q}&dirflg=d`
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`
}

// Section box (clone du composant Section de PoliceClient.tsx)
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border rounded-2xl p-4 shadow-sm space-y-3">
      <p className="text-ink-faint text-xs uppercase tracking-widest font-semibold">{title}</p>
      {children}
    </div>
  )
}

// Statut → libelle FR (sous-ensemble de STATUS_BADGE de DriverClient)
const STATUS_LABELS: Record<string, string> = {
  assigned:    'À accepter',
  accepted:    'Acceptée',
  in_progress: 'En cours',
  parked:      'En dépôt',
  delivering:  'En livraison',
  completed:   'Terminée',
  to_invoice:  'À facturer',
}

export default function SncMissionFiche({
  mission, currentUserId, isReadOnly = false, navApp = 'gmaps',
}: Props) {
  const router = useRouter()
  const [M, setM] = useState<Mission>(mission)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  // Tuile SNC selectionnee : saving in-flight + message info
  const [sncSaving, setSncSaving] = useState<string | null>(null)
  const [sncInfoMsg, setSncInfoMsg] = useState<string | null>(null)

  // Preview tarif (calcul live via /api/snc-preview-tarif)
  const [sncPreview, setSncPreview] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Destination editable (input texte + autocomplete Google → coords)
  const [destinationText, setDestinationText] = useState<string>(
    M.destination_address || M.destination_name || '',
  )
  const [savingDest, setSavingDest] = useState(false)

  const isSC      = M.source === 'sia_couvert'
  const isSNC     = M.source === 'police_snc'
  const variant   = isSC ? 'sc' : 'snc'
  const gmKey     = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

  // Header colors
  const headerBg     = isSC ? 'bg-cyan-600'  : 'bg-blue-600'
  const accentBgSoft = isSC ? 'bg-cyan-50'   : 'bg-blue-50'
  const accentBorder = isSC ? 'border-cyan-300' : 'border-blue-300'
  const accentBorder2= isSC ? 'border-cyan-500' : 'border-blue-500'
  const activeBg     = isSC ? 'bg-cyan-100'  : 'bg-blue-100'
  const activeBorder = isSC ? 'border-cyan-600' : 'border-blue-600'
  const activeRing   = isSC ? 'ring-cyan-300' : 'ring-blue-300'
  const accentText   = isSC ? 'text-cyan-900' : 'text-blue-900'
  const accentText2  = isSC ? 'text-cyan-700' : 'text-blue-700'

  // ── Realtime subscription (alignee sur DriverClient) ────────────────────
  useEffect(() => {
    const ch = sb.channel(`snc-fiche-${M.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'incoming_missions', filter: `id=eq.${M.id}` },
        payload => {
          const next = payload.new as Partial<Mission>
          setM(prev => ({ ...prev, ...next }))
        },
      )
      .subscribe()
    return () => { sb.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [M.id])

  // Sync l input destination quand la mission est mise a jour ailleurs
  useEffect(() => {
    if (savingDest) return
    setDestinationText(M.destination_address || M.destination_name || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [M.destination_address, M.destination_name])

  // ── Preview tarif live (recalcule des qu un parametre change) ───────────
  useEffect(() => {
    // Pas de scenario ou pas de coords incident → reset preview
    if (!M.snc_scenario || M.incident_lat == null || M.incident_lng == null) {
      setSncPreview(null); setPreviewError(null)
      return
    }
    // REM client / REM direct : destination obligatoire pour calcul
    if ((M.snc_scenario === 'rem_client' || M.snc_scenario === 'rem_direct')
        && (M.destination_lat == null || M.destination_lng == null)) {
      setSncPreview(null); setPreviewError(null)
      return
    }
    // REM depot : pas de tarif a encaisser, on n affiche pas la preview
    if (M.snc_scenario === 'rem_depot') {
      setSncPreview(null); setPreviewError(null)
      return
    }

    const ctrl = new AbortController()
    const handler = setTimeout(async () => {
      setPreviewLoading(true); setPreviewError(null)
      try {
        const interventionAt = M.intervention_date
          || M.received_at
          || new Date().toISOString()
        const res = await fetch('/api/snc-preview-tarif', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            scenario:          M.snc_scenario,
            variant,
            requires_balisage: Boolean(M.snc_requires_balisage),
            incident_lat:      M.incident_lat,
            incident_lng:      M.incident_lng,
            destination_lat:   M.destination_lat,
            destination_lng:   M.destination_lng,
            intervention_at:   interventionAt,
            billed_to_id:      M.billed_to_id ?? null,
            billed_to_name:    M.billed_to_name ?? null,
            stops:             Array.isArray(M.extra_addresses) ? [...M.extra_addresses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [],
          }),
          signal: ctrl.signal,
        })
        const j = await res.json()
        if (!res.ok || !j.ok) {
          setSncPreview(null)
          setPreviewError(j.error || 'Erreur calcul tarif')
        } else {
          setSncPreview(j)
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setSncPreview(null)
          setPreviewError(e.message || 'Erreur reseau')
        }
      } finally {
        setPreviewLoading(false)
      }
    }, 500)
    return () => { clearTimeout(handler); ctrl.abort() }
  }, [
    M.snc_scenario, M.snc_requires_balisage, variant,
    M.incident_lat, M.incident_lng,
    M.destination_lat, M.destination_lng,
    M.intervention_date, M.received_at,
  ])

  // ── PATCH helper ────────────────────────────────────────────────────────
  const patchMission = async (body: Record<string, any>) => {
    const r = await fetch(`/api/missions/${M.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'Erreur')
    return j
  }

  // ── Choix du scenario SNC + recalcul tarif + PATCH amount_to_collect ────
  // Reprend strictement la logique de pickSncScenario dans DriverClient.tsx
  const pickSncScenario = async (scenario: 'dsp' | 'rem_client' | 'rem_depot' | 'rem_direct') => {
    setSncInfoMsg(null)
    if ((scenario === 'rem_client' || scenario === 'rem_direct')
        && (M.destination_lat == null || M.destination_lng == null)) {
      setSncInfoMsg('Saisis d\'abord l\'adresse de destination plus bas (avec autocomplete Google).')
      return
    }
    setSncSaving(scenario); setErr('')
    try {
      const newType = scenario === 'dsp' ? 'depannage' : 'remorquage'
      // 1) PATCH scenario + type
      await patchMission({ snc_scenario: scenario, mission_type: newType })
      setM(prev => ({ ...prev, snc_scenario: scenario as any, mission_type: newType }))

      // 2) Calcul tarif SNC (sauf REM depot)
      if (scenario !== 'rem_depot' && M.incident_lat != null && M.incident_lng != null) {
        const pr = await fetch('/api/snc-preview-tarif', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            scenario, variant,
            requires_balisage: Boolean(M.snc_requires_balisage),
            incident_lat:      M.incident_lat,
            incident_lng:      M.incident_lng,
            destination_lat:   M.destination_lat,
            destination_lng:   M.destination_lng,
            intervention_at:   M.intervention_date || M.received_at || new Date().toISOString(),
            billed_to_id:      M.billed_to_id ?? null,
            billed_to_name:    M.billed_to_name ?? null,
            stops:             Array.isArray(M.extra_addresses) ? [...M.extra_addresses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [],
          }),
        })
        const pj = await pr.json().catch(() => null)
        if (pr.ok && pj?.ok && typeof pj.total_tvac === 'number') {
          // SC : facturation a l assistance, pas d encaissement client
          const amount = variant === 'sc' ? null : pj.total_tvac
          await patchMission({ amount_to_collect: amount })
          setM(prev => ({ ...prev, amount_to_collect: amount as any }))
        }
      } else if (scenario === 'rem_depot') {
        await patchMission({ amount_to_collect: null })
        setM(prev => ({ ...prev, amount_to_collect: null as any }))
      }
    } catch (e: any) {
      setErr(e.message || 'Impossible de définir le scénario')
    } finally {
      setSncSaving(null)
    }
  }

  // Toggle balisage : PATCH + recalcul tarif si scenario actif
  const toggleSncBalisage = async () => {
    const next = !M.snc_requires_balisage
    try {
      await patchMission({ snc_requires_balisage: next })
      setM(prev => ({ ...prev, snc_requires_balisage: next }))
      if (M.snc_scenario && M.snc_scenario !== 'rem_depot' && M.incident_lat != null && M.incident_lng != null) {
        const pr = await fetch('/api/snc-preview-tarif', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            scenario: M.snc_scenario, variant,
            requires_balisage: next,
            incident_lat: M.incident_lat, incident_lng: M.incident_lng,
            destination_lat: M.destination_lat, destination_lng: M.destination_lng,
            intervention_at: M.intervention_date || M.received_at || new Date().toISOString(),
            billed_to_id:    M.billed_to_id ?? null,
            billed_to_name:  M.billed_to_name ?? null,
            stops:           Array.isArray(M.extra_addresses) ? [...M.extra_addresses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [],
          }),
        })
        const pj = await pr.json().catch(() => null)
        if (pr.ok && pj?.ok && typeof pj.total_tvac === 'number' && variant !== 'sc') {
          await patchMission({ amount_to_collect: pj.total_tvac })
          setM(prev => ({ ...prev, amount_to_collect: pj.total_tvac as any }))
        }
      }
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    }
  }

  // ── Destination : selection autocomplete → PATCH coords + recalcul ──────
  const onDestinationSelect = async (addr: string, lat: number, lng: number) => {
    setSavingDest(true); setErr('')
    try {
      await patchMission({
        destination_address: addr,
        destination_lat:     lat,
        destination_lng:     lng,
      })
      setM(prev => ({
        ...prev,
        destination_address: addr,
        destination_lat:     lat,
        destination_lng:     lng,
      }))
      setDestinationText(addr)
    } catch (e: any) {
      setErr(e.message || 'Impossible de sauvegarder la destination')
    } finally {
      setSavingDest(false)
    }
  }

  // ── Actions principales ────────────────────────────────────────────────
  // Mise en parc : delegue a DriverClient (workflow complet : photos, signature,
  // discharge, zone, etc.). On bascule donc en ?legacy=1.
  const goLegacyPark = () => {
    window.location.href = `${window.location.pathname}?legacy=1&park=1`
  }
  const goLegacyPhotos = () => {
    window.location.href = `${window.location.pathname}?legacy=1&photos=1`
  }
  const goLegacyClose = () => {
    window.location.href = `${window.location.pathname}?legacy=1&close=1`
  }

  // Finalisation rapide via /api/missions/[id]/finalize (deja utilisee par DriverClient)
  const finalize = async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch(`/api/missions/${M.id}/finalize`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur finalisation')
      router.refresh()
    } catch (e: any) {
      setErr(e.message || 'Erreur finalisation')
    } finally {
      setLoading(false)
    }
  }

  // ── Calculs UI ─────────────────────────────────────────────────────────
  const scenarioLabel =
    M.snc_scenario === 'dsp'        ? 'DSP — dépannage sur place'
  : M.snc_scenario === 'rem_client' ? 'REM avec paiement immédiat'
  : M.snc_scenario === 'rem_direct' ? 'REM directe (sans passage dépôt)'
  : M.snc_scenario === 'rem_depot'  ? 'REM vers dépôt Pepinster'
  : 'Aucun scénario sélectionné'

  const required   = Number(M.amount_to_collect || 0)
  const paid       = Number(M.payment_amount    || 0)
  const remaining  = Math.max(0, required - paid)
  const isFullyPaid = required > 0 && paid + 0.01 >= required

  const showEncaisserBtn =
    (M.snc_scenario === 'dsp' || M.snc_scenario === 'rem_client')
    && variant !== 'sc'
    && remaining > 0
    && M.status !== 'completed' && M.status !== 'to_invoice'

  // SC rem_direct : pas d encaissement chauffeur (facturation assistance)
  // mais pas non plus de mise en parc (livraison directe). Le bouton Finaliser
  // suffit (geree plus bas).
  const showParkBtn =
    M.snc_scenario === 'rem_depot'
    && M.status !== 'parked'
    && M.status !== 'completed' && M.status !== 'to_invoice'

  // Olivier 2026-06-03 : pour SNC REM client / SC rem_direct, apres encaissement
  // (ou apres choix scenario pour SC), le chauffeur doit encore CHARGER + LIVRER
  // le vehicule. Les boutons de chargement/livraison sont dans DriverClient, pas
  // ici. Bascule vers DriverClient via ?legacy=1 pour continuer le flow.
  // - SNC rem_client : nécessite isFullyPaid (encaissement OK)
  // - SC rem_direct  : pas d encaissement (facturation assistance), basculer dès
  //                    que destination saisie
  const needsLoadAndDeliver =
       (M.snc_scenario === 'rem_client' && variant === 'snc' && isFullyPaid)
    || (M.snc_scenario === 'rem_direct' && variant === 'sc'
        && M.destination_lat != null && M.destination_lng != null)
  const showContinueBtn =
    needsLoadAndDeliver
    && M.status !== 'completed' && M.status !== 'to_invoice'

  // Finaliser : pour DSP (rien a faire apres paiement) ou SC dsp (pas d encaissement)
  // ou REM depot (mise en parc deja faite). PAS pour REM client / rem_direct qui
  // ont showContinueBtn.
  const showFinalizeBtn =
    M.status !== 'completed' && M.status !== 'to_invoice'
    && M.snc_scenario != null
    && !needsLoadAndDeliver               // REM client/direct → continuer via DriverClient
    && (M.snc_scenario === 'dsp'          // DSP : finalisation directe apres paiement
        || M.snc_scenario === 'rem_depot' // REM depot : pas d encaissement chauffeur
        || (variant === 'sc' && M.snc_scenario === 'dsp'))  // SC DSP

  const navUrl = gUrl(navApp, M.incident_lat, M.incident_lng,
    [M.incident_address, M.incident_city].filter(Boolean).join(', '))

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-page pb-32">
      {/* Header colore facon PoliceClient */}
      <div className={`${headerBg} px-4 pt-12 pb-5 shadow-md`}>
        <button
          onClick={() => router.push('/mission')}
          className="mb-3 text-white/80 text-sm"
        >
          ← Mes missions
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-white text-xl font-bold truncate">
              🚔 Mission {isSC ? 'Siabis couvert' : 'Siabis non couvert'}
            </h1>
            <p className="text-white/80 text-xs mt-1">
              {M.dossier_number || M.external_id ? `#${M.dossier_number || M.external_id}` : ''}
              {' · '}
              {STATUS_LABELS[M.status] || M.status}
            </p>
          </div>
          {isReadOnly && (
            <span className="bg-white/20 text-white text-[10px] uppercase tracking-wider px-2 py-1 rounded-full font-bold flex-shrink-0">
              Lecture seule
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-5 space-y-4">

        {/* 2. Vehicule (lecture seule) */}
        <Section title="Véhicule">
          <div className="space-y-1">
            {M.vehicle_plate && (
              <p className="text-ink font-mono uppercase tracking-widest text-base font-bold">
                {plate(M.vehicle_plate)}
              </p>
            )}
            <p className="text-ink text-sm">
              {[M.vehicle_brand, M.vehicle_model].filter(Boolean).join(' ') || '—'}
            </p>
            {M.vehicle_vin && (
              <p className="text-ink-muted text-xs font-mono">VIN : {M.vehicle_vin}</p>
            )}
            {M.vehicle_class === 'moto' && (
              <p className="text-ink-secondary text-xs">🏍️ Moto / 2 roues</p>
            )}
          </div>
        </Section>

        {/* 3. Proprietaire / Client */}
        {(M.client_name || M.client_phone) && (
          <Section title="Propriétaire / Client">
            <div className="space-y-1">
              <p className="text-ink text-sm font-medium">{M.client_name || '—'}</p>
              {M.client_phone && (
                <a href={`tel:${M.client_phone}`} className={`text-sm font-mono ${accentText2}`}>
                  📞 {M.client_phone}
                </a>
              )}
            </div>
          </Section>
        )}

        {/* 4. Lieu d intervention + bouton Naviguer */}
        <Section title="Lieu d'intervention">
          <div className="space-y-2">
            <p className="text-ink text-sm">
              {M.incident_address || '—'}
              {M.incident_city ? `, ${M.incident_city}` : ''}
            </p>
            {navUrl && (
              <a
                href={navUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl ${accentBgSoft} ${accentText2} text-sm font-semibold border ${accentBorder} hover:opacity-90`}
              >
                🗺️ Naviguer
              </a>
            )}
            {M.incident_description && (
              <p className="text-ink-muted text-xs mt-2 border-t border pt-2">
                {M.incident_description}
              </p>
            )}
          </div>
        </Section>

        {/* 5. Scenario SNC : tuiles editables (mirror PoliceClient lignes 1226-1250) */}
        {!isReadOnly && (
          <Section title={isSC ? 'Scénario Siabis couvert' : 'Scénario d\'intervention SNC'}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2">
                {([
                  {
                    key: 'dsp' as const,
                    label: '🔧 DSP — Dépannage sur place',
                    desc: isSC
                      ? 'Réparation sur autoroute, facturée à l\'assistance.'
                      : 'Réparation sur autoroute, client paie en direct au chauffeur.',
                  },
                  ...(isSNC ? [{
                    key: 'rem_client' as const,
                    label: '🚛 REM avec paiement immédiat',
                    desc: 'Remorquage vers destination du client, paiement immédiat.',
                  }] : []),
                  ...(isSC ? [{
                    key: 'rem_direct' as const,
                    label: '🚛 REM directe (sans dépôt)',
                    desc: 'Remorquage directement vers la destination du client. Forfait SC + km livraison depuis le dépôt (pas de seconde prise en charge).',
                  }] : []),
                  {
                    key: 'rem_depot' as const,
                    label: '🏢 REM vers dépôt Pepinster',
                    desc: isSC
                      ? 'Mise en zone Transit, relivraison ultérieure au tarif assistance.'
                      : 'Mise en zone Transit, le client passera au bureau ensuite.',
                  },
                ] as Array<{ key: 'dsp' | 'rem_client' | 'rem_direct' | 'rem_depot'; label: string; desc: string }>).map(opt => {
                  const isActive = M.snc_scenario === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => pickSncScenario(opt.key)}
                      disabled={sncSaving !== null}
                      className={`p-3 rounded-xl border-2 text-left transition disabled:opacity-50 ${
                        isActive
                          ? `${activeBg} ${activeBorder} ring-2 ${activeRing}`
                          : `bg-surface ${accentBorder} hover:${accentBorder2}`
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-ink font-semibold text-sm">{opt.label}</span>
                        {isActive && (
                          <span className={`${accentText2} text-xs font-bold`}>✓ Actif</span>
                        )}
                      </div>
                      <div className="text-ink-muted text-xs mt-0.5">{opt.desc}</div>
                      {sncSaving === opt.key && (
                        <div className={`${accentText2} text-xs mt-1`}>⏳ Application en cours…</div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 6. Toggle balisage */}
              <label className={`flex items-start gap-3 cursor-pointer p-3 bg-surface border ${accentBorder} rounded-xl`}>
                <input
                  type="checkbox"
                  checked={Boolean(M.snc_requires_balisage)}
                  onChange={toggleSncBalisage}
                  className="mt-1 w-5 h-5"
                />
                <div className="flex-1">
                  <div className="text-ink text-sm font-medium">
                    Intervention avec balisage (véhicule de sécurité)
                  </div>
                  <div className="text-ink-muted text-xs mt-1">
                    Coche si un véhicule de sécurité a dû être placé (autoroute / voie rapide). Génère un supplément SIABAL.
                  </div>
                </div>
              </label>

              {sncInfoMsg && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-2 text-amber-900 text-xs">
                  ⚠ {sncInfoMsg}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* 7. Destination
            REM client (SNC) = obligatoire
            REM direct (SC)  = obligatoire
            REM depot        = optionnelle (relivraison future) */}
        {(M.snc_scenario === 'rem_client' || M.snc_scenario === 'rem_direct' || M.snc_scenario === 'rem_depot') && !isReadOnly && (
          <Section title={
            (M.snc_scenario === 'rem_client' || M.snc_scenario === 'rem_direct')
              ? 'Adresse de destination (livraison) *'
              : 'Adresse de relivraison future (optionnelle)'
          }>
            <div className="space-y-1">
              <AddressField
                value={destinationText}
                onChange={v => {
                  setDestinationText(v)
                  // Si l user efface ou modifie sans selectionner -> clear coords
                  if (M.destination_lat != null && v !== (M.destination_address || '')) {
                    // On ne PATCH pas immediatement : on attend qu il selectionne
                    // une suggestion ou re-confirme via place_changed
                  }
                }}
                onSelect={onDestinationSelect}
                gmKey={gmKey}
                placeholder={
                  (M.snc_scenario === 'rem_client' || M.snc_scenario === 'rem_direct')
                    ? 'Ex: Rue de la Gare 10, 4800 Verviers'
                    : 'Si déjà connue (optionnel)'
                }
              />
              {savingDest && (
                <p className={`text-xs ${accentText2}`}>⏳ Enregistrement de la destination…</p>
              )}
              {(M.snc_scenario === 'rem_client' || M.snc_scenario === 'rem_direct')
                && M.destination_lat == null && destinationText.trim() && (
                <p className="text-xs text-warning">
                  ⚠ Sélectionne l&apos;adresse dans les suggestions Google pour calculer le tarif.
                </p>
              )}
              {M.destination_lat != null && M.destination_address && (
                <p className={`text-xs ${accentText2}`}>
                  ✓ Destination enregistrée : {M.destination_address}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* 8. Preview tarif live (mirror PoliceClient 1297-1340)
            Olivier 2026-06-02 PM : NE PAS afficher pour SC — c est l assistance
            qui paie, le chauffeur n a pas besoin de voir le montant. */}
        {!isSC && M.snc_scenario && M.snc_scenario !== 'rem_depot' && (
          M.incident_lat != null && M.incident_lng != null &&
          (
            (M.snc_scenario !== 'rem_client' && M.snc_scenario !== 'rem_direct')
            || (M.destination_lat != null && M.destination_lng != null)
          )
        ) && (
          <div className={`${accentBgSoft} border-2 ${accentBorder} rounded-xl p-3 space-y-2`}>
            <div className="flex items-center justify-between">
              <div className={`text-sm font-bold ${accentText}`}>💰 Tarif estimé</div>
              {previewLoading && (
                <Loader2 size={14} className={`animate-spin ${accentText2}`} />
              )}
            </div>
            {previewError && (
              <div className="text-xs text-red-700">{previewError}</div>
            )}
            {sncPreview && sncPreview.ok && (
              <>
                <div className="space-y-1 text-xs">
                  {sncPreview.lines.map((l: any, i: number) => (
                    <div key={i} className={`flex justify-between ${accentText}`}>
                      <span className="truncate flex-1">{l.name}</span>
                      <span className="font-mono ml-2 flex-shrink-0">
                        {l.qty} × {l.price_unit.toFixed(4)} = <strong>{(l.qty * l.price_unit).toFixed(2)} €</strong>
                      </span>
                    </div>
                  ))}
                </div>
                <div className={`border-t ${accentBorder} pt-2 space-y-0.5 text-xs`}>
                  <div className={`flex justify-between ${accentText2}`}>
                    <span>Total HTVA</span>
                    <span className="font-mono">{sncPreview.total_htva.toFixed(2)} €</span>
                  </div>
                  <div className={`flex justify-between font-bold ${accentText} text-sm`}>
                    <span>Total TVAC à encaisser</span>
                    <span className="font-mono">{sncPreview.total_tvac.toFixed(2)} €</span>
                  </div>
                </div>
                {sncPreview.metrics?.is_majored && (
                  <div className="text-xs text-orange-700 font-medium">⏰ Plage horaire majorée appliquée</div>
                )}
                {sncPreview.metrics?.note && (
                  <div className={`text-[10px] ${accentText2} italic`}>{sncPreview.metrics.note}</div>
                )}
              </>
            )}
            {variant === 'sc' && (
              <p className={`text-[11px] ${accentText2} italic`}>
                💡 SC : facturation à l&apos;assistance — pas d&apos;encaissement client.
              </p>
            )}
          </div>
        )}

        {/* Recap mission (lecture seule) */}
        <Section title="Récapitulatif">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-muted">Scénario</span>
              <span className="text-ink font-medium">{scenarioLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">Balisage</span>
              <span className="text-ink font-medium">
                {M.snc_requires_balisage ? '🚧 Oui' : 'Non'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">Facturé à</span>
              <span className="text-ink font-medium truncate ml-2">
                {M.billed_to_name || (isSC ? 'Assistance' : M.source) || '—'}
              </span>
            </div>
            {required > 0 && (
              <div className={`flex justify-between pt-1 mt-1 border-t border ${accentText}`}>
                <span className="font-semibold">À encaisser</span>
                <span className="font-mono font-bold">
                  {formatEur(required)}
                  {paid > 0 && (
                    <span className="text-ink-muted text-xs ml-1">
                      (déjà {formatEur(paid, { suffix: false })} €)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* 9. Photos : redirige vers DriverClient (wizard complet) via ?legacy=1 */}
        <Section title="Photos">
          <button
            onClick={goLegacyPhotos}
            className="w-full py-3 border-2 border-dashed border-strong rounded-xl text-ink-faint text-sm hover:border-gray-400"
          >
            📷 Gérer les photos ({(M.driver_photos || []).length})
          </button>
          <p className="text-ink-muted text-[11px]">
            💡 Ouvre le wizard photos guidé par catégorie.
          </p>
        </Section>

        {/* Remarques facturation */}
        {M.remarks_billing && (
          <Section title="Remarques facturation">
            <p className="text-ink text-sm">📝 {M.remarks_billing}</p>
          </Section>
        )}

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-critical text-sm">
            ⚠ {err}
          </div>
        )}
      </div>

      {/* 10. Bottom bar : actions principales */}
      {!isReadOnly && (
        <div className="fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur border-t border px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] space-y-2 z-30">
          {!M.snc_scenario && (
            <p className="text-ink-muted text-xs text-center">
              👆 Sélectionne un scénario d&apos;intervention pour activer les actions.
            </p>
          )}

          {showEncaisserBtn && (
            <a
              href={buildEncaissementUrl(M as any, { amount: remaining, returnTo: `/mission/${M.id}` })}
              className={`w-full block text-center py-4 ${headerBg} text-white font-bold rounded-2xl text-base`}
            >
              💰 Encaisser ({formatEur(remaining, { suffix: false })} €)
            </a>
          )}

          {showParkBtn && (
            <button
              onClick={goLegacyPark}
              disabled={loading}
              className="w-full py-4 bg-amber-600 disabled:opacity-50 text-white font-bold rounded-2xl text-base"
            >
              🏢 Mettre en parc Transit
            </button>
          )}

          {/* Olivier 2026-06-03 : SNC REM client / SC rem_direct apres encaissement
              → basculer sur DriverClient pour le flow chargement + livraison. */}
          {showContinueBtn && (
            <button
              onClick={() => router.push(`/mission/${M.id}?legacy=1`)}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-base"
            >
              🚛 Charger le véhicule et livrer →
            </button>
          )}

          {showFinalizeBtn && (
            <button
              onClick={M.awaiting_payment ? finalize : goLegacyClose}
              disabled={loading}
              className="w-full py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-2xl text-base"
            >
              {loading ? '⏳ Finalisation…' : '✅ Finaliser la mission'}
            </button>
          )}

          {(M.status === 'completed' || M.status === 'to_invoice') && (
            <div className="text-center text-green-700 text-sm font-bold py-2">
              ✅ Mission terminée
            </div>
          )}
        </div>
      )}
    </div>
  )
}
