'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Car, AlertCircle } from 'lucide-react'
import { isPlateLookupReady } from '@/lib/plate'
import type { VehicleMatch, LookupByPlateResponse } from '@/types/vehicles'

/**
 * Modal de sélection véhicule par plaque, avec support multi-match
 * (propriétaires successifs avec même plaque côté Odoo).
 *
 * Comportement :
 * - Quand `open` passe false → true, le composant fetch /api/vehicles/lookup-by-plate
 *   avec la plaque + flags optionnels (withPreviousClients, includeArchived).
 * - Si 0 résultat actif (et includeArchived désactivé) : appelle onCreateNew()
 *   directement, pas de modal vide. L'utilisateur voit s'il peut activer
 *   `includeArchived` via lien interne (re-fetch avec includeArchived=true).
 * - Si 1 résultat exact non-archivé : skip modal, appelle onSelect(vehicle)
 *   directement (UX rapide cas nominal).
 * - Sinon (2+ résultats OU 1 archivé) : modal liste avec sélection + bouton
 *   "Aucun de ceux-là, créer nouveau".
 *
 * Le composant est agnostique du trigger : c'est le parent qui contrôle `open`
 * (via bouton, onBlur, etc.). AbortController gère les race conditions si
 * la plaque change rapidement.
 */
export default function VehiclePlateLookup({
  plate,
  open,
  withPreviousClients = false,
  confirmAlways = false,
  onSelect,
  onCreateNew,
  onCancel,
}: {
  plate:                string
  open:                 boolean
  withPreviousClients?: boolean
  /** Si true : même 1 seul résultat est affiché dans le modal pour confirmation
   *  (pas d'auto-sélection). Olivier 2026-06-24 (Francofolies). */
  confirmAlways?:       boolean
  onSelect:             (vehicle: VehicleMatch) => void
  onCreateNew:          () => void
  onCancel?:            () => void
}) {
  type Status = 'idle' | 'loading' | 'error' | 'list'
  const [status, setStatus]   = useState<Status>('idle')
  const [error,  setError]    = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<VehicleMatch[]>([])
  const [includedArchived, setIncludedArchived] = useState(false)
  /** Compteur d'archivés restants si user veut élargir la recherche */
  const [archivedCount, setArchivedCount] = useState<number | null>(null)

  /** Garde une réf de l'AbortController pour annuler les fetches précédents. */
  const abortRef = useRef<AbortController | null>(null)

  // ── Fetch lookup ────────────────────────────────────────────────────────────
  const fetchLookup = async (plate: string, archived: boolean) => {
    // Annuler le fetch précédent s'il y en a un
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setStatus('loading')
    setError(null)

    try {
      const params = new URLSearchParams({ plate })
      if (withPreviousClients) params.set('withPreviousClients', '1')
      if (archived)            params.set('includeArchived',     '1')

      const res = await fetch(`/api/vehicles/lookup-by-plate?${params}`, {
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `HTTP ${res.status}`)
      }

      const data: LookupByPlateResponse = await res.json()
      if (ac.signal.aborted) return

      const list = data.vehicles || []
      setVehicles(list)

      // Skip modal cases
      if (list.length === 0) {
        // Si 0 résultat actif et qu'on n'a pas encore tenté les archivés,
        // afficher la modal vide avec lien "voir archivés" (sans appeler
        // onCreateNew tout de suite — laisser le user choisir).
        // Si déjà incluArchived ET 0 résultat → vraiment rien → onCreateNew direct.
        if (archived) {
          onCreateNew()
        } else {
          // Tenter une recherche élargie en arrière-plan pour savoir s'il y
          // a des archivés disponibles à proposer.
          await peekArchivedCount(plate)
          if (ac.signal.aborted) return
        }
        return
      }

      if (list.length === 1 && !list[0].archived && !confirmAlways) {
        // Skip modal : 1 résultat exact non-archivé → sélection directe
        // (sauf confirmAlways : on garde le modal pour confirmation).
        onSelect(list[0])
        return
      }

      // Sinon (2+ résultats OU 1 archivé OU confirmAlways) : modal liste
      setStatus('list')
    } catch (e: any) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return
      setError(e?.message || 'Erreur de chargement')
      setStatus('error')
    }
  }

  /** Cherche en parallèle s'il y a des véhicules archivés disponibles. */
  const peekArchivedCount = async (plate: string) => {
    try {
      const params = new URLSearchParams({ plate, includeArchived: '1' })
      const res    = await fetch(`/api/vehicles/lookup-by-plate?${params}`)
      if (!res.ok) {
        // Pas grave, on bypass juste vers onCreateNew
        onCreateNew()
        return
      }
      const data: LookupByPlateResponse = await res.json()
      if ((data.vehicles?.length || 0) === 0) {
        // Vraiment rien, même archivé → onCreateNew
        onCreateNew()
      } else {
        // Il y a des archivés ; afficher modal vide avec lien proposer recherche
        setArchivedCount(data.vehicles.length)
        setStatus('list')
      }
    } catch {
      onCreateNew()
    }
  }

  // ── Effets : open/plate triggers fetch ──────────────────────────────────────
  useEffect(() => {
    if (!open) {
      // Cleanup à la fermeture
      abortRef.current?.abort()
      setStatus('idle')
      setVehicles([])
      setError(null)
      setIncludedArchived(false)
      setArchivedCount(null)
      return
    }
    if (!isPlateLookupReady(plate)) {
      // Plaque trop courte → bypass direct vers création nouvelle
      onCreateNew()
      return
    }
    fetchLookup(plate, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plate])

  // ── Cleanup : abort à l'unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // ── Escape ferme ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  // ── Lock body scroll quand modal visible ────────────────────────────────────
  useEffect(() => {
    if (!open || status === 'idle') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open, status])

  // ── Handlers internes ───────────────────────────────────────────────────────
  const handleArchivedRetry = () => {
    setIncludedArchived(true)
    fetchLookup(plate, true)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  // Affichage modal uniquement si status='list' OU 'loading' OU 'error'
  // (les bypass onSelect/onCreateNew sont gérés dans fetchLookup).
  if (!open || status === 'idle') return null
  if (typeof window === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-lookup-title"
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface border-t sm:border rounded-t-2xl sm:rounded-card w-full sm:max-w-lg max-h-[90vh] sm:max-h-[80vh] overflow-y-auto shadow-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h2 id="vehicle-lookup-title" className="font-display text-ink font-bold text-lg flex items-center gap-2">
              <Car size={20} className="text-brand" /> Véhicule trouvé
            </h2>
            <p className="text-ink-muted text-xs mt-0.5">
              Plaque : <span className="font-mono">{plate}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="w-8 h-8 flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {status === 'loading' && (
            <p className="text-ink-muted text-sm text-center py-6">⏳ Recherche dans Odoo…</p>
          )}

          {status === 'error' && (
            <div className="bg-critical-soft border border-critical rounded-xl px-4 py-3 text-critical text-sm flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">Erreur de chargement</p>
                <p className="text-xs mt-1 opacity-80">{error}</p>
                <button
                  type="button"
                  onClick={() => fetchLookup(plate, includedArchived)}
                  className="mt-2 text-xs font-semibold underline hover:no-underline"
                >
                  Réessayer
                </button>
              </div>
            </div>
          )}

          {status === 'list' && vehicles.length === 0 && archivedCount != null && archivedCount > 0 && (
            <div className="space-y-3">
              <p className="text-ink-muted text-sm text-center">
                Aucun véhicule actif trouvé pour cette plaque.
              </p>
              <button
                type="button"
                onClick={handleArchivedRetry}
                className="w-full px-4 py-3 bg-info-soft border border-info rounded-xl text-info text-sm font-semibold hover:bg-info-soft transition"
              >
                🔍 Voir aussi les véhicules archivés ({archivedCount})
              </button>
            </div>
          )}

          {status === 'list' && vehicles.length > 0 && (
            <>
              {includedArchived && (
                <p className="text-ink-muted text-xs flex items-center gap-1.5">
                  <span>⚠</span>
                  <span>Inclut les véhicules archivés côté Odoo</span>
                </p>
              )}
              {vehicles.map(v => (
                <VehicleCard key={v.id} vehicle={v} onSelect={() => onSelect(v)} />
              ))}
            </>
          )}

          {/* Bouton "créer nouveau" toujours présent quand modal liste affichée */}
          {status === 'list' && (
            <button
              type="button"
              onClick={onCreateNew}
              className="w-full px-4 py-3 bg-surface-2 border border-dashed rounded-xl text-ink-secondary hover:text-ink hover:border-ink-faint text-sm font-medium transition"
            >
              ➕ Aucun de ceux-là — créer un nouveau véhicule
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Sous-composant : card véhicule ───────────────────────────────────────────

function VehicleCard({
  vehicle,
  onSelect,
}: {
  vehicle:  VehicleMatch
  onSelect: () => void
}) {
  const labelBrandModel = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || '—'

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left p-4 bg-surface-2 border rounded-xl hover:border-brand hover:bg-surface-hover transition group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-ink font-semibold text-sm truncate">
            {labelBrandModel}
          </p>
          <p className="text-ink-muted text-xs font-mono mt-0.5">{vehicle.plate}</p>
          {vehicle.vin && (
            <p className="text-ink-muted text-xs mt-1">
              VIN : <span className="font-mono">{vehicle.vin}</span>
            </p>
          )}
          {vehicle.currentDriver && (
            <p className="text-ink-secondary text-xs mt-1.5 truncate">
              👤 {vehicle.currentDriver.name}
            </p>
          )}
        </div>
        {vehicle.archived && (
          <span className="flex-shrink-0 px-2 py-0.5 bg-warning-soft text-warning text-[10px] rounded font-medium uppercase tracking-wide">
            archivé
          </span>
        )}
      </div>
    </button>
  )
}
