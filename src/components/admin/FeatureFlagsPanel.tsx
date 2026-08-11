'use client'

// Réglage des feature flags (mode preview) — superadmin uniquement.
// L'API /api/admin/feature-flags renvoie 403 aux autres : le panneau se masque alors
// de lui-même. Permet de basculer une nouvelle vue off → moi → tout le monde sans
// redéploiement (ex. `nav_menu_v2`, le menu navigable).

import { useEffect, useState } from 'react'

interface Flag { key: string; mode: string; label: string | null }

const MODES: [string, string][] = [
  ['off',        'Off'],
  ['superadmin', 'Moi'],
  ['all',        'Tout le monde'],
]

export default function FeatureFlagsPanel() {
  const [flags,  setFlags]  = useState<Flag[] | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/feature-flags', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => setFlags(j?.flags || null))
      .catch(() => setFlags(null))
  }, [])

  const setMode = async (key: string, mode: string) => {
    setSaving(key)
    setFlags(prev => (prev || []).map(f => (f.key === key ? { ...f, mode } : f)))
    try {
      await fetch('/api/admin/feature-flags', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ key, mode }),
      })
    } finally {
      setSaving(null)
    }
  }

  if (!flags || flags.length === 0) return null

  return (
    <div className="bg-surface-2 border border rounded-2xl p-4">
      <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-2">
        🧪 Nouveautés en préversion
      </p>
      <p className="text-ink-faint text-xs mb-3">
        « Moi » = visible pour les superadmins seulement, le temps de tester.
        « Tout le monde » = activé pour toute l&apos;équipe. Le changement est immédiat,
        sans redéploiement (jusqu&apos;à une minute pour se propager).
      </p>
      <div className="flex flex-col gap-2">
        {flags.map(f => (
          <div key={f.key} className="flex items-center justify-between gap-3 flex-wrap bg-surface border rounded-xl px-3 py-2.5">
            <span className="text-ink text-sm font-medium min-w-0">
              {f.label || f.key}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {MODES.map(([m, lbl]) => (
                <button
                  key={m}
                  onClick={() => setMode(f.key, m)}
                  disabled={saving === f.key}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition disabled:opacity-60 ${
                    f.mode === m ? 'bg-brand text-white' : 'bg-surface-2 border text-ink-secondary hover:text-ink'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
