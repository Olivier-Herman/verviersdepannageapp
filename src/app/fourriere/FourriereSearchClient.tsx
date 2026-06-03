'use client'
// src/app/fourriere/FourriereSearchClient.tsx
//
// Olivier 2026-06-03 : nouvelle home /fourriere = ecran de recherche.
// 6 criteres : Plaque, VIN, N PV, Marque/Modele, Date (entree parc), Rue.
// Bouton "Acceder aux parcs" en haut → modale tuiles → /fourriere/parc/[id].
// Clic sur un resultat → fiche vehicule complete (sheet a droite).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import { Search, Loader2, X, MapPin, Calendar, FileText, Car, Hash, Building2, AlertTriangle, MapIcon, ScanLine } from 'lucide-react'
import VehicleFicheSheet from './VehicleFicheSheet'
import DepotsTilesModal from './DepotsTilesModal'
import { normalizePlate } from '@/lib/plate'

interface SearchResult {
  id:               string
  mission_number:   number | null
  dossier_number:   string | null
  external_id:      string | null
  source:           string
  status:           string
  plate:            string | null
  brand:            string | null
  model:            string | null
  vin:              string | null
  client_name:      string | null
  client_address:   string | null
  incident_address: string | null
  incident_city:    string | null
  police_pv_number: string | null
  officer_name:     string | null
  police_zone:      string | null
  parc_zone_key:    string | null
  parc_row_number:  number | null
  parc_slot_index:  number | null
  parked_at:        string | null
  loaded_at:        string | null
  received_at:      string | null
  depot_id:         string | null
  depot_name:       string | null
  zone_label:       string | null
}

interface Props {
  userRole:    string
  userName:    string
  userEmail?:  string | null
  userModules: string[]
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) }
  catch { return d }
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return d }
}

function daysInParc(parked_at: string | null): number | null {
  if (!parked_at) return null
  const d = new Date(parked_at).getTime()
  if (isNaN(d)) return null
  return Math.max(0, Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24)))
}

export default function FourriereSearchClient({ userRole, userName, userEmail, userModules }: Props) {
  const [plate,    setPlate]    = useState('')
  const [vin,      setVin]      = useState('')
  const [pv,       setPv]       = useState('')
  const [vehicle,  setVehicle]  = useState('')
  const [address,  setAddress]  = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [includeHistory, setIncludeHistory] = useState(false)
  const [results,  setResults]  = useState<SearchResult[]>([])
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)
  const [showDepots, setShowDepots] = useState(false)
  const [openMissionId, setOpenMissionId] = useState<string | null>(null)

  const hasAnyFilter = !!(plate || vin || pv || vehicle || address || dateFrom || dateTo)

  // Debounce auto-recherche dès qu'au moins un critère est tapé
  useEffect(() => {
    if (!hasAnyFilter) { setResults([]); setSearched(false); return }
    const t = setTimeout(() => { runSearch() }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, vin, pv, vehicle, address, dateFrom, dateTo, includeHistory])

  async function runSearch() {
    setLoading(true); setSearched(true)
    try {
      const sp = new URLSearchParams()
      if (plate)    sp.set('plate', plate)
      if (vin)      sp.set('vin', vin)
      if (pv)       sp.set('pv', pv)
      if (vehicle)  sp.set('vehicle', vehicle)
      if (address)  sp.set('address', address)
      if (dateFrom) sp.set('date_from', dateFrom)
      if (dateTo)   sp.set('date_to', dateTo)
      if (includeHistory) sp.set('include_history', '1')
      const r = await fetch(`/api/fourriere/search?${sp.toString()}`)
      const j = await r.json()
      setResults(j.results || [])
    } catch (e) {
      console.error(e)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function clearAll() {
    setPlate(''); setVin(''); setPv(''); setVehicle(''); setAddress('')
    setDateFrom(''); setDateTo(''); setIncludeHistory(false)
    setResults([]); setSearched(false)
  }

  return (
    <AppShell title="Fourrière" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
        <div className="p-4 lg:p-6 space-y-4 ambient-fade-up max-w-5xl mx-auto">

          {/* Header + bouton parcs */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Search size={20} className="text-brand" />
              <h1 className="font-display text-xl font-bold text-ink">Recherche fourrière</h1>
            </div>
            <button
              onClick={() => setShowDepots(true)}
              className="flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-semibold shadow-sm transition">
              <MapIcon size={16} />
              Accéder aux parcs
            </button>
          </div>

          {/* Formulaire de recherche */}
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

              <Field label="Plaque" icon={<Hash size={14} />}>
                <input value={plate} onChange={e => setPlate(normalizePlate(e.target.value))}
                  placeholder="ex : 1ABC123" autoFocus
                  className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm text-ink uppercase placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              </Field>

              <Field label="N° de PV" icon={<FileText size={14} />}>
                <input value={pv} onChange={e => setPv(e.target.value)}
                  placeholder="ex : VE.32.LA.12345"
                  className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              </Field>

              <Field label="VIN" icon={<Car size={14} />}>
                <input value={vin} onChange={e => setVin(e.target.value)}
                  placeholder="châssis (3 derniers chars suffisent)"
                  className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm text-ink uppercase placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              </Field>

              <Field label="Marque / Modèle" icon={<Car size={14} />}>
                <input value={vehicle} onChange={e => setVehicle(e.target.value)}
                  placeholder="ex : Berlingo, Mazda, …"
                  className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              </Field>

              <Field label="Morceau de rue / ville" icon={<MapPin size={14} />}>
                <input value={address} onChange={e => setAddress(e.target.value)}
                  placeholder="ex : Müllendorff"
                  className="w-full bg-surface-2 border rounded-md px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-brand" />
              </Field>

              <Field label="Date d'entrée parc" icon={<Calendar size={14} />}>
                <div className="flex items-center gap-1">
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="w-full bg-surface-2 border rounded-md px-2 py-2 text-sm text-ink focus:outline-none focus:border-brand" />
                  <span className="text-ink-muted text-xs">→</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="w-full bg-surface-2 border rounded-md px-2 py-2 text-sm text-ink focus:outline-none focus:border-brand" />
                </div>
              </Field>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
                <input type="checkbox" checked={includeHistory} onChange={e => setIncludeHistory(e.target.checked)}
                  className="w-4 h-4 accent-brand" />
                Inclure l'historique (véhicules déjà sortis)
              </label>
              {hasAnyFilter && (
                <button onClick={clearAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-ink-muted hover:text-ink text-xs transition">
                  <X size={12} /> Effacer
                </button>
              )}
            </div>
          </div>

          {/* Résultats */}
          {!hasAnyFilter && (
            <div className="bg-surface border rounded-2xl p-10 text-center">
              <Search size={32} className="mx-auto text-ink-faint mb-3" />
              <p className="text-ink-muted text-sm">Saisis un critère pour démarrer la recherche.</p>
              <p className="text-ink-faint text-xs mt-1">Tu peux combiner plusieurs champs.</p>
            </div>
          )}

          {hasAnyFilter && loading && (
            <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
              <Loader2 size={24} className="mx-auto animate-spin mb-3 text-brand" />
              Recherche en cours…
            </div>
          )}

          {hasAnyFilter && !loading && searched && results.length === 0 && (
            <div className="bg-surface border rounded-2xl p-10 text-center">
              <AlertTriangle size={32} className="mx-auto text-warning mb-3" />
              <p className="text-ink-muted text-sm">Aucun véhicule ne correspond aux critères.</p>
              {!includeHistory && (
                <p className="text-ink-faint text-xs mt-2">
                  Coche « Inclure l'historique » pour chercher aussi dans les véhicules déjà sortis.
                </p>
              )}
            </div>
          )}

          {hasAnyFilter && !loading && results.length > 0 && (
            <>
              <p className="text-ink-muted text-xs px-1">
                {results.length} résultat{results.length > 1 ? 's' : ''}
                {results.length >= 100 && <span className="text-warning ml-1">· limite 100, affine ta recherche</span>}
              </p>
              <div className="space-y-2">
                {results.map(r => (
                  <ResultCard key={r.id} r={r} onOpen={() => setOpenMissionId(r.id)} />
                ))}
              </div>
            </>
          )}
        </div>
      </AmbientBackground>

      {showDepots && (
        <DepotsTilesModal onClose={() => setShowDepots(false)} />
      )}

      {openMissionId && (
        <VehicleFicheSheet
          missionId={openMissionId}
          onClose={() => setOpenMissionId(null)}
        />
      )}
    </AppShell>
  )
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-ink-muted text-xs font-semibold mb-1 uppercase tracking-wide">
        {icon} {label}
      </label>
      {children}
    </div>
  )
}

function ResultCard({ r, onOpen }: { r: SearchResult; onOpen: () => void }) {
  const days = daysInParc(r.parked_at)
  const isOut = !['parked', 'delivering', 'unlocated', 'awaiting_payment'].includes(r.status)
  return (
    <button onClick={onOpen}
      className="w-full text-left bg-surface border rounded-card p-3 hover:bg-surface-hover hover:border-brand/40 transition">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Car size={20} className={isOut ? 'text-ink-faint' : 'text-brand'} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-ink font-bold">{r.plate || '—'}</span>
            <span className="text-ink-muted text-sm">{[r.brand, r.model].filter(Boolean).join(' ') || '—'}</span>
            {isOut && <span className="text-xs px-1.5 py-0.5 bg-ink/10 text-ink-muted rounded">Sortie</span>}
            {!isOut && r.parc_zone_key && (
              <span className="text-xs px-1.5 py-0.5 bg-brand/15 text-brand rounded font-semibold">
                {r.parc_zone_key}
                {r.parc_row_number != null && r.parc_slot_index != null && (
                  <span className="ml-1 font-mono opacity-70">R{r.parc_row_number}·E{r.parc_slot_index}</span>
                )}
              </span>
            )}
            {r.depot_name && <span className="text-xs px-1.5 py-0.5 bg-ink/5 text-ink-muted rounded flex items-center gap-1">
              <Building2 size={10} /> {r.depot_name}
            </span>}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-ink-muted">
            {r.vin && <span className="font-mono">VIN <span className="text-ink-secondary">…{r.vin.slice(-6)}</span></span>}
            {r.police_pv_number && <span className="font-mono">PV {r.police_pv_number}</span>}
            {r.client_name && <span>{r.client_name}</span>}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-ink-muted">
            {r.incident_address && (
              <span className="flex items-center gap-1">
                <MapPin size={10} /> {r.incident_address}{r.incident_city ? `, ${r.incident_city}` : ''}
              </span>
            )}
          </div>
          {r.parked_at && (
            <p className="text-xs text-ink-faint mt-1">
              Entrée parc : {fmtDateTime(r.parked_at)}
              {days != null && !isOut && <span className="ml-1.5 text-warning font-medium">· {days} j</span>}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}
