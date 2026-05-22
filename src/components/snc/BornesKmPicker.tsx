'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, Loader2, MapPin, Check, AlertTriangle } from 'lucide-react'

interface Route {
  numero_route: string
  nom_route:    string
  longueur_km:  number
  type:         string
}

interface Props {
  onLocated: (result: {
    lat:          number
    lng:          number
    label:        string
    numero_route: string
    cumulee:      number
    is_approx:    boolean
  }) => void
}

const TYPE_LABEL: Record<string, string> = {
  autoroute: '🛣️ Autoroute',
  ring:      '🔄 Ring',
  nationale: '🛤️ Nationale',
}

export default function BornesKmPicker({ onLocated }: Props) {
  const [routes, setRoutes] = useState<Route[]>([])
  const [loadingRoutes, setLoadingRoutes] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)
  const [km, setKm] = useState('')
  const [locating, setLocating] = useState(false)
  const [result, setResult] = useState<{ label: string; is_approx: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  // Charge les routes une seule fois
  useEffect(() => {
    fetch('/api/snc-bk/routes')
      .then(r => r.json())
      .then(j => {
        setRoutes(j.routes || [])
        setLoadingRoutes(false)
      })
      .catch(() => {
        setErr('Impossible de charger la liste des routes')
        setLoadingRoutes(false)
      })
  }, [])

  // Filtre les routes selon la query
  const filtered = useMemo(() => {
    if (!query.trim()) return routes.slice(0, 30)
    const q = query.trim().toLowerCase()
    return routes.filter(r =>
      r.numero_route.toLowerCase().includes(q) ||
      r.nom_route.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [routes, query])

  async function handleLocate() {
    if (!selectedRoute) { setErr('Sélectionne une route'); return }
    const kmNum = parseFloat(km)
    if (!isFinite(kmNum) || kmNum < 0) { setErr('BK invalide'); return }

    setLocating(true)
    setErr(null)
    setResult(null)
    try {
      const params = new URLSearchParams({
        numero_route: selectedRoute.numero_route,
        km:           String(kmNum),
      })
      const res = await fetch(`/api/snc-bk/borne?${params}`)
      const j = await res.json()
      if (!res.ok || !j.ok) {
        setErr(j.error || `Borne non trouvée pour ${selectedRoute.numero_route} BK${kmNum}`)
        return
      }
      setResult({ label: j.label, is_approx: Boolean(j.is_approx) })
      onLocated({
        lat:          j.lat,
        lng:          j.lng,
        label:        j.label,
        numero_route: j.numero_route,
        cumulee:      j.cumulee,
        is_approx:    Boolean(j.is_approx),
      })
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-ink-secondary">
        Localisation précise par borne kilométrique (Géoportail Wallonie)
      </div>

      {/* Combobox route */}
      <div className="relative">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={selectedRoute ? `${selectedRoute.numero_route} — ${selectedRoute.nom_route}` : query}
            onChange={e => { setQuery(e.target.value); setSelectedRoute(null); setShowDropdown(true) }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
            placeholder={loadingRoutes ? 'Chargement...' : 'Rechercher route (ex: A004121, E40, N3...)'}
            disabled={loadingRoutes}
            className="w-full pl-9 pr-3 py-2 bg-surface border border-strong rounded-lg text-ink text-sm focus:outline-none focus:border-blue-500"
          />
          {loadingRoutes && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-muted" />}
        </div>
        {showDropdown && !loadingRoutes && filtered.length > 0 && (
          <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-strong rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {filtered.map(r => (
              <button
                key={r.numero_route}
                onMouseDown={() => { setSelectedRoute(r); setQuery(''); setShowDropdown(false); setResult(null) }}
                className="w-full text-left px-3 py-2 hover:bg-surface-hover border-b border-strong last:border-0 transition"
              >
                <div className="text-ink text-sm font-mono font-bold">
                  {TYPE_LABEL[r.type] || ''} {r.numero_route}
                </div>
                <div className="text-ink-muted text-xs truncate">{r.nom_route} · {r.longueur_km} km</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input BK + bouton */}
      {selectedRoute && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-ink-muted block mb-0.5">Borne kilométrique (BK)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max={selectedRoute.longueur_km || 999}
              value={km}
              onChange={e => setKm(e.target.value)}
              placeholder={`0 - ${selectedRoute.longueur_km}`}
              className="w-full px-3 py-2 bg-surface border border-strong rounded-lg text-ink text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleLocate}
            disabled={!km || locating}
            className="self-end px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
          >
            {locating ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
            Localiser
          </button>
        </div>
      )}

      {/* Resultat */}
      {result && (
        <div className={`p-2 rounded-lg flex items-start gap-2 text-sm ${
          result.is_approx
            ? 'bg-warning/10 border border-warning/40 text-warning'
            : 'bg-success/10 border border-success/40 text-success'
        }`}>
          {result.is_approx ? <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> : <Check size={14} className="flex-shrink-0 mt-0.5" />}
          <div>
            <div className="font-medium">{result.label}</div>
            {result.is_approx && <div className="text-xs">Borne exacte introuvable, borne la plus proche utilisée.</div>}
          </div>
        </div>
      )}

      {err && (
        <div className="bg-critical/10 border border-critical/40 text-critical text-sm p-2 rounded-lg">
          {err}
        </div>
      )}
    </div>
  )
}
