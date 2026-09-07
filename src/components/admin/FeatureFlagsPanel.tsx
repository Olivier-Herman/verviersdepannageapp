'use client'

// Réglage des feature flags (mode preview) — superadmin uniquement.
// L'API /api/admin/feature-flags renvoie 403 aux autres : le panneau se masque alors
// de lui-même. Permet de basculer une nouvelle vue off → moi → tout le monde sans
// redéploiement (ex. `nav_menu_v2`, le menu navigable).

import { useEffect, useState } from 'react'

interface Flag { key: string; mode: string; label: string | null; pilot_user_ids?: string[] }
interface U { id: string; name: string; role: string }

const MODES: [string, string][] = [
  ['off',        'Off'],
  ['superadmin', 'Moi'],
  ['all',        'Tout le monde'],
]

export default function FeatureFlagsPanel() {
  const [flags,  setFlags]  = useState<Flag[] | null>(null)
  const [users,  setUsers]  = useState<U[]>([])
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/feature-flags', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { setFlags(j?.flags || null); setUsers(j?.users || []) })
      .catch(() => setFlags(null))
  }, [])

  // Pilotes nommés : en mode « Moi », ces users voient aussi la préversion.
  const setPilots = async (key: string, ids: string[]) => {
    setSaving(key)
    setFlags(prev => (prev || []).map(f => (f.key === key ? { ...f, pilot_user_ids: ids } : f)))
    try {
      await fetch('/api/admin/feature-flags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, pilot_user_ids: ids }) })
    } finally { setSaving(null) }
  }

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
        « Moi » = visible pour les superadmins seulement, le temps de tester, plus les
        pilotes nommés en dessous. « Tout le monde » = activé pour toute l&apos;équipe. Le changement est immédiat,
        sans redéploiement (jusqu&apos;à une minute pour se propager).
      </p>
      <div className="flex flex-col gap-2">
        {flags.map(f => (
          <div key={f.key} className="bg-surface border rounded-xl px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
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
            {f.mode === 'superadmin' && (
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <span className="text-ink-muted">Pilotes :</span>
                {(f.pilot_user_ids || []).map(id => {
                  const u = users.find(x => x.id === id)
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 font-medium">
                      {u?.name || id.slice(0, 8)}
                      <button onClick={() => setPilots(f.key, (f.pilot_user_ids || []).filter(x => x !== id))} disabled={saving === f.key} className="hover:text-red-700" title="Retirer">✕</button>
                    </span>
                  )
                })}
                <select value="" onChange={e => { if (e.target.value) setPilots(f.key, [...(f.pilot_user_ids || []), e.target.value]) }} disabled={saving === f.key}
                  className="bg-surface-2 border rounded-lg px-2 py-0.5 text-ink-secondary">
                  <option value="">+ ajouter</option>
                  {users.filter(u => u.role !== 'superadmin' && !(f.pilot_user_ids || []).includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
