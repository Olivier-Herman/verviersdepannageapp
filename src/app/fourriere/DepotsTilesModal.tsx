'use client'
// src/app/fourriere/DepotsTilesModal.tsx
//
// Olivier 2026-06-03 : modale sélecteur de tuiles pour "Accéder aux parcs".
// Affiche les 5 parcs (depots actifs) avec nb zones + nb véhicules présents.
// Clic sur une tuile → redirige vers /fourriere/parc/[id].

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, Building2, Loader2, MapPin, ChevronRight, Star } from 'lucide-react'

interface DepotTile {
  id:              string
  name:            string
  address:         string | null
  is_default_parc: boolean
  zone_count:      number
  vehicle_count:   number
}

export default function DepotsTilesModal({ onClose }: { onClose: () => void }) {
  const [depots, setDepots]   = useState<DepotTile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/fourriere/depots')
      .then(r => r.json())
      .then(j => setDepots(j.depots || []))
      .catch(() => setDepots([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Accéder aux parcs</h2>
            <p className="text-ink-muted text-xs">Choisis un parc pour voir les véhicules par zone.</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink-muted hover:text-ink hover:bg-surface-hover rounded transition">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-10 text-ink-muted text-sm">
              <Loader2 size={20} className="mx-auto animate-spin mb-2 text-brand" />
              Chargement…
            </div>
          ) : depots.length === 0 ? (
            <div className="text-center py-10 text-ink-muted text-sm">
              <Building2 size={28} className="mx-auto text-ink-faint mb-3" />
              Aucun parc actif. Crée-en un depuis <Link href="/admin/depots" className="text-brand hover:underline">/admin/depots</Link>.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {depots.map(d => (
                <Link key={d.id} href={`/fourriere/parc/${d.id}`} onClick={onClose}
                  className="bg-surface-2 border hover:border-brand/50 hover:bg-surface-hover rounded-card p-4 transition group">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center text-brand">
                      <Building2 size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-display font-bold text-ink text-base truncate">{d.name}</h3>
                        {d.is_default_parc && <Star size={12} className="text-warning fill-warning" />}
                      </div>
                      {d.address && (
                        <p className="text-ink-muted text-xs mt-0.5 truncate flex items-center gap-1">
                          <MapPin size={10} /> {d.address}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        <span className="text-ink">
                          <strong className="text-brand">{d.vehicle_count}</strong> véh.
                        </span>
                        <span className="text-ink-muted">·</span>
                        <span className="text-ink-muted">{d.zone_count} zone{d.zone_count > 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-ink-faint group-hover:text-brand transition" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
