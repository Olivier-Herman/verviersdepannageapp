'use client'

import { useMemo, useState, useEffect } from 'react'
import { Bell, Check, X, KeyRound } from 'lucide-react'
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORY_LABELS,
  getApplicableTypes,
  isEnabled,
  type NotificationCategory,
} from '@/lib/notifications/types'

interface User { id: string; name: string; email: string; role: string; active: boolean }
interface Pref { user_id: string; notif_type: string; enabled: boolean }

export default function NotificationsClient({
  initialUsers, initialPrefs,
}: { initialUsers: User[]; initialPrefs: Pref[] }) {
  const [users] = useState<User[]>(initialUsers)
  const [prefs, setPrefs] = useState<Pref[]>(initialPrefs)
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [search,     setSearch]     = useState<string>('')
  const [saving,     setSaving]     = useState<string | null>(null)  // `${userId}:${type}` en cours

  // ── Rappel « définis ton code de validation » ──────────────────────────────
  const [pinBusy,  setPinBusy]  = useState<'me' | 'all' | null>(null)
  const [pinMsg,   setPinMsg]   = useState('')
  const [pinCount, setPinCount] = useState<{ without_pin: number; total: number } | null>(null)
  useEffect(() => { fetch('/api/admin/notify-pin-setup').then(r => r.json()).then(j => { if (j && typeof j.without_pin === 'number') setPinCount(j) }).catch(() => {}) }, [])
  const sendPinReminder = async (target: 'me' | 'all') => {
    if (target === 'all' && !confirm(`Envoyer le rappel « définis ton code » à tous les utilisateurs SANS code${pinCount ? ` (${pinCount.without_pin})` : ''} ?`)) return
    setPinBusy(target); setPinMsg('')
    try {
      const r = await fetch('/api/admin/notify-pin-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) })
      const j = await r.json()
      if (!r.ok) { setPinMsg('❌ ' + (j.error || 'Erreur')); return }
      setPinMsg(target === 'me' ? '✅ Notif test envoyée sur ton compte.' : `✅ Envoyée à ${j.sent || 0} utilisateur(s) sans code.${j.note ? ' ' + j.note : ''}`)
    } finally { setPinBusy(null) }
  }

  // Index prefs par (user_id, type) pour resolution rapide
  const prefIndex = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const p of prefs) map.set(`${p.user_id}:${p.notif_type}`, p.enabled)
    return map
  }, [prefs])

  // Filtre users : par role et recherche libre
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (roleFilter && u.role !== roleFilter) return false
      const q = search.toLowerCase().trim()
      if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false
      return true
    })
  }, [users, roleFilter, search])

  // Types groupes par categorie pour affichage
  const categoriesOrder: NotificationCategory[] = ['driver', 'dispatcher', 'on_duty', 'admin']

  async function toggle(userId: string, type: string, currentValue: boolean) {
    const k = `${userId}:${type}`
    setSaving(k)
    const newValue = !currentValue
    // Optimistic update
    setPrefs(prev => {
      const idx = prev.findIndex(p => p.user_id === userId && p.notif_type === type)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], enabled: newValue }
        return updated
      }
      return [...prev, { user_id: userId, notif_type: type, enabled: newValue }]
    })
    try {
      const r = await fetch('/api/admin/notifications', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: userId, notif_type: type, enabled: newValue }),
      })
      if (!r.ok) {
        // Rollback
        setPrefs(prev => prev.map(p =>
          p.user_id === userId && p.notif_type === type ? { ...p, enabled: currentValue } : p
        ))
      }
    } finally {
      setSaving(null)
    }
  }

  function getValue(userId: string, type: string, userRole: string): boolean {
    const prefMap = new Map<string, boolean>()
    const explicit = prefIndex.get(`${userId}:${type}`)
    if (typeof explicit === 'boolean') prefMap.set(type, explicit)
    return isEnabled(type, prefMap)
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
          <Bell size={20} />
        </div>
        <div>
          <h1 className="text-ink text-xl font-semibold">Notifications</h1>
          <p className="text-ink-muted text-sm">
            Configure les notifications activées par utilisateur. Les types disponibles dépendent du rôle.
          </p>
        </div>
      </div>

      {/* Rappel « définis ton code de validation » */}
      <div className="bg-surface border rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 bg-amber-500/10 rounded-xl flex items-center justify-center text-amber-600 flex-shrink-0"><KeyRound size={18} /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-ink font-semibold text-sm">Rappel « définis ton code »</h2>
            <p className="text-ink-muted text-xs mt-0.5">
              Invite les utilisateurs à créer leur code à 4 chiffres (validation encaissement). Lien direct vers leur profil.
              {pinCount && <> {' '}<span className="text-amber-700 font-medium">{pinCount.without_pin}/{pinCount.total} sans code.</span></>}
            </p>
            {pinMsg && <p className="text-xs mt-2 text-ink">{pinMsg}</p>}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => sendPinReminder('me')} disabled={!!pinBusy}
              className="text-xs px-3 py-2 rounded-lg border hover:bg-surface-2 disabled:opacity-50">{pinBusy === 'me' ? '…' : 'Test (moi)'}</button>
            <button onClick={() => sendPinReminder('all')} disabled={!!pinBusy || (pinCount?.without_pin === 0)}
              className="text-xs px-3 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:opacity-90 disabled:opacity-50">{pinBusy === 'all' ? 'Envoi…' : 'Envoyer à tous (sans code)'}</button>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          className="bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand">
          <option value="">Tous les rôles</option>
          <option value="driver">Chauffeurs</option>
          <option value="dispatcher">Dispatchers</option>
          <option value="admin">Admins</option>
          <option value="superadmin">Superadmins</option>
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un utilisateur…"
          className="flex-1 max-w-xs bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
        />
        <span className="text-ink-muted text-xs ml-auto">
          {filteredUsers.length} utilisateur{filteredUsers.length > 1 ? 's' : ''} affiché{filteredUsers.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Legende */}
      <div className="bg-surface-2 border rounded-xl p-3 text-xs text-ink-muted">
        💡 Cellule <span className="text-success">✓</span> = activée. Cellule <span className="text-critical">✕</span> = désactivée. Cellule <span className="opacity-50">atténuée</span> = hors rôle par défaut (mais tu peux quand même l'activer manuellement). Click pour basculer (sauvegarde immédiate).
      </div>

      {/* Matrice */}
      <div className="bg-surface border rounded-2xl overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b">
              <th className="sticky left-0 bg-surface px-3 py-2 text-left font-semibold text-ink min-w-[180px]">Utilisateur</th>
              {categoriesOrder.map(cat => {
                const typesInCat = NOTIFICATION_TYPES.filter(t => t.category === cat)
                if (typesInCat.length === 0) return null
                return (
                  <th key={cat} colSpan={typesInCat.length} className="px-2 py-2 text-center font-semibold text-ink-secondary text-xs border-l">
                    {NOTIFICATION_CATEGORY_LABELS[cat]}
                  </th>
                )
              })}
            </tr>
            <tr className="border-b bg-surface-2">
              <th className="sticky left-0 bg-surface-2 px-3 py-2"></th>
              {categoriesOrder.flatMap(cat =>
                NOTIFICATION_TYPES.filter(t => t.category === cat).map(t => (
                  <th key={t.key} title={t.description}
                    className="px-2 py-2 text-center font-normal text-ink-muted text-xs border-l min-w-[100px] max-w-[140px]">
                    <div className="line-clamp-2 break-words">{t.label}</div>
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(u => {
              const applicable = new Set(getApplicableTypes(u.role).map(t => t.key))
              return (
                <tr key={u.id} className="border-b hover:bg-surface-2 transition">
                  <td className="sticky left-0 bg-surface px-3 py-2">
                    <p className="text-ink text-sm font-medium">{u.name}</p>
                    <p className="text-ink-muted text-xs capitalize">{u.role}</p>
                  </td>
                  {categoriesOrder.flatMap(cat =>
                    NOTIFICATION_TYPES.filter(t => t.category === cat).map(t => {
                      const isApplicable = applicable.has(t.key)
                      const value  = getValue(u.id, t.key, u.role)
                      const isLoad = saving === `${u.id}:${t.key}`
                      // Toutes les cellules sont cliquables — l'admin peut overrider
                      // pour donner une notif non-applicable au role (ex : un dispatcher
                      // qui doit aussi recevoir les notifs chauffeur). Visuellement
                      // attenue si pas applicable par default.
                      return (
                        <td key={t.key} className="text-center px-2 py-2 border-l">
                          <button type="button"
                            disabled={isLoad}
                            onClick={() => toggle(u.id, t.key, value)}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition ${
                              value
                                ? 'bg-success-soft border-success text-success hover:opacity-80'
                                : 'bg-critical-soft border-critical/40 text-critical hover:opacity-80'
                            } ${isLoad ? 'opacity-50' : ''} ${!isApplicable ? 'opacity-50' : ''}`}
                            title={
                              (isApplicable ? '' : 'Hors rôle par défaut · ') +
                              (value ? 'Activé · clic pour désactiver' : 'Désactivé · clic pour activer')
                            }>
                            {isLoad ? '⏳' : value ? <Check size={14} /> : <X size={14} />}
                          </button>
                        </td>
                      )
                    })
                  )}
                </tr>
              )
            })}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={1 + NOTIFICATION_TYPES.length} className="text-center text-ink-muted text-sm py-8">
                  Aucun utilisateur correspondant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
