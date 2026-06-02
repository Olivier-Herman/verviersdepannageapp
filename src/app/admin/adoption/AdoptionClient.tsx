'use client'

import { useState } from 'react'
import Link         from 'next/link'

interface Row {
  id:           string
  name:         string | null
  email:        string | null
  role:         string | null
  last_login:   string | null
  iosFirst:     string | null
  iosLast:      string | null
  androidFirst: string | null
  androidLast:  string | null
  watchHas:     boolean
  pwaFirst:     string | null
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function fmtRel(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (days === 0) return "auj."
  if (days === 1) return "hier"
  if (days < 7)   return `il y a ${days}j`
  if (days < 30)  return `il y a ${Math.floor(days / 7)}sem`
  return d.toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' })
}

type Filter = 'all' | 'native_ios' | 'native_android' | 'pwa' | 'never_logged'

export default function AdoptionClient({ rows }: { rows: Row[] }) {
  const [filter, setFilter]   = useState<Filter>('all')
  const [search, setSearch]   = useState('')

  function channelOf(r: Row): { code: string; label: string; color: string } {
    if (r.iosFirst || r.androidFirst) {
      const parts: string[] = []
      if (r.iosFirst) parts.push('iOS')
      if (r.androidFirst) parts.push('Android')
      if (r.watchHas) parts.push('Watch')
      return { code: 'native', label: '📱 Native ' + parts.join('+'), color: 'bg-green-100 text-green-800' }
    }
    if (r.pwaFirst) return { code: 'pwa', label: '🌐 PWA', color: 'bg-blue-100 text-blue-800' }
    if (r.last_login) return { code: 'web', label: '💻 Web', color: 'bg-gray-100 text-gray-700' }
    return { code: 'never', label: '⚪ Jamais connecté', color: 'bg-gray-50 text-gray-400' }
  }

  const filtered = rows.filter(r => {
    if (search) {
      const s = search.toLowerCase()
      if (!(r.name || '').toLowerCase().includes(s) && !(r.email || '').toLowerCase().includes(s)) return false
    }
    if (filter === 'all')         return true
    if (filter === 'native_ios')  return !!r.iosFirst
    if (filter === 'native_android') return !!r.androidFirst
    if (filter === 'pwa')         return !!r.pwaFirst && !r.iosFirst && !r.androidFirst
    if (filter === 'never_logged') return !r.last_login
    return true
  })

  // Stats globales
  const counts = {
    total: rows.length,
    ios:   rows.filter(r => r.iosFirst).length,
    android: rows.filter(r => r.androidFirst).length,
    pwa:   rows.filter(r => r.pwaFirst && !r.iosFirst && !r.androidFirst).length,
    web:   rows.filter(r => r.last_login && !r.iosFirst && !r.androidFirst && !r.pwaFirst).length,
    never: rows.filter(r => !r.last_login).length,
  }

  return (
    <div className="min-h-screen bg-surface max-w-5xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">📊 Adoption</h1>
            <p className="text-ink-muted text-xs">Qui utilise quoi : App native iOS/Android, PWA Web Push, ou Web simple. Basé sur device_tokens + push_subscriptions + last_login.</p>
          </div>
        </div>
      </div>

      <div className="px-5 py-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <StatCard label="Total" v={counts.total} color="bg-surface" />
          <StatCard label="📱 iOS native" v={counts.ios}   color="bg-green-50 border-green-200 text-green-900" />
          <StatCard label="🤖 Android native" v={counts.android} color="bg-green-50 border-green-200 text-green-900" />
          <StatCard label="🌐 PWA (web push)" v={counts.pwa}   color="bg-blue-50 border-blue-200 text-blue-900" />
          <StatCard label="⚪ Jamais connecté" v={counts.never} color="bg-gray-50 border-gray-200 text-gray-500" />
        </div>

        {/* Filtres */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'native_ios', 'native_android', 'pwa', 'never_logged'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${filter === f ? 'bg-brand text-white' : 'bg-surface-2 border'}`}>
              {f === 'all' && 'Tous'}
              {f === 'native_ios' && '📱 iOS'}
              {f === 'native_android' && '🤖 Android'}
              {f === 'pwa' && '🌐 PWA seulement'}
              {f === 'never_logged' && '⚪ Jamais connecté'}
            </button>
          ))}
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Recherche nom / email"
            className="ml-auto bg-surface-2 border rounded-xl px-3 py-1.5 text-ink text-sm w-48" />
        </div>

        {/* Tableau */}
        <div className="bg-surface border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase text-ink-muted">User</th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase text-ink-muted">Channel</th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase text-ink-muted">iOS</th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase text-ink-muted">Android</th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase text-ink-muted">PWA</th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase text-ink-muted">Dernière conn.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-ink-faint italic">Aucun user</td></tr>
              ) : filtered.map(r => {
                const c = channelOf(r)
                return (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-surface-hover">
                    <td className="px-3 py-2">
                      <p className="text-ink font-medium">{r.name || '—'}</p>
                      <p className="text-ink-muted text-xs">{r.email}</p>
                      <p className="text-ink-faint text-[10px] uppercase mt-0.5">{r.role}</p>
                    </td>
                    <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs ${c.color}`}>{c.label}</span></td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">{r.iosFirst ? <>depuis {fmt(r.iosFirst)}<br /><span className="text-ink-faint">vu {fmtRel(r.iosLast)}</span></> : '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">{r.androidFirst ? <>depuis {fmt(r.androidFirst)}<br /><span className="text-ink-faint">vu {fmtRel(r.androidLast)}</span></> : '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">{r.pwaFirst ? fmt(r.pwaFirst) : '—'}</td>
                    <td className="px-3 py-2 text-xs text-ink-secondary">{fmtRel(r.last_login)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-ink-faint text-xs">
          ⚠️ Limites : un user qui refuse les notifications n&apos;a pas de device_token enregistré → il peut être sur l&apos;app native sans qu&apos;on le détecte. Un user qui passe de PWA à App native garde son push_subscriptions PWA en BDD (à nettoyer manuellement si besoin).
        </p>
      </div>
    </div>
  )
}

function StatCard({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className={`border rounded-xl p-3 ${color}`}>
      <p className="text-xs font-semibold opacity-75">{label}</p>
      <p className="text-2xl font-bold">{v}</p>
    </div>
  )
}
