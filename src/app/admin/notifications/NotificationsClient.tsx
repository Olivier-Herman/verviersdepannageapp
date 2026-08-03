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
  const [pinBusy,  setPinBusy]  = useState<string | null>(null)   // `${kind}:${target}`
  const [pinMsg,   setPinMsg]   = useState('')
  const [pinCount, setPinCount] = useState<{ without_pin: number; with_pin: number; total: number; without: { name: string; role: string }[]; with: { name: string; role: string }[] } | null>(null)
  const [pinShowList, setPinShowList] = useState(false)
  const loadPinState = () => fetch('/api/admin/notify-pin-setup').then(r => r.json()).then(j => { if (j && typeof j.without_pin === 'number') setPinCount(j) }).catch(() => {})
  useEffect(() => { loadPinState() }, [])
  const sendPinReminder = async (target: 'me' | 'all', kind: 'setup' | 'recall' = 'setup') => {
    if (target === 'all') {
      const who = kind === 'recall' ? `tous les utilisateurs AVEC code${pinCount ? ` (${pinCount.with_pin})` : ''}` : `tous les utilisateurs SANS code${pinCount ? ` (${pinCount.without_pin})` : ''}`
      const what = kind === 'recall' ? '« te souviens-tu de ton code ? »' : '« définis ton code »'
      if (!confirm(`Envoyer ${what} à ${who} ?`)) return
    }
    setPinBusy(`${kind}:${target}`); setPinMsg('')
    try {
      const r = await fetch('/api/admin/notify-pin-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, kind }) })
      const j = await r.json()
      if (!r.ok) { setPinMsg('❌ ' + (j.error || 'Erreur')); return }
      setPinMsg(target === 'me' ? '✅ Notif test envoyée sur ton compte.' : `✅ Envoyée à ${j.sent || 0} utilisateur(s).${j.note ? ' ' + j.note : ''}`)
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
              Invite les utilisateurs à créer leur code à 4 chiffres (validation encaissement). Lien direct vers leur profil. Renvoyée chaque jour tant que le code n'est pas défini.
            </p>
            {pinCount && (
              <div className="flex items-center gap-3 mt-1.5 text-xs">
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">✅ {pinCount.with_pin} avec code</span>
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">⏳ {pinCount.without_pin} sans code</span>
                <button onClick={() => { setPinShowList(v => !v); loadPinState() }} className="text-brand hover:underline">{pinShowList ? 'masquer' : 'voir qui'}</button>
              </div>
            )}
            {pinShowList && pinCount && (
              <div className="grid sm:grid-cols-2 gap-3 mt-2">
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
                  <p className="text-amber-700 dark:text-amber-400 text-[11px] font-semibold mb-1">⏳ Sans code ({pinCount.without_pin})</p>
                  {pinCount.without.length === 0 ? <p className="text-ink-muted text-[11px]">— personne, tout le monde est couvert 🎉</p>
                    : <ul className="text-ink-secondary text-[11px] space-y-0.5">{pinCount.without.map((x, i) => <li key={i}>{x.name} <span className="text-ink-muted">· {x.role}</span></li>)}</ul>}
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5">
                  <p className="text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold mb-1">✅ Avec code ({pinCount.with_pin})</p>
                  {pinCount.with.length === 0 ? <p className="text-ink-muted text-[11px]">—</p>
                    : <ul className="text-ink-secondary text-[11px] space-y-0.5">{pinCount.with.map((x, i) => <li key={i}>{x.name} <span className="text-ink-muted">· {x.role}</span></li>)}</ul>}
                </div>
              </div>
            )}
            {pinMsg && <p className="text-xs mt-2 text-ink">{pinMsg}</p>}
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted w-24 flex-shrink-0">Définir le code</span>
              <button onClick={() => sendPinReminder('me', 'setup')} disabled={!!pinBusy}
                className="text-xs px-3 py-2 rounded-lg border hover:bg-surface-2 disabled:opacity-50">{pinBusy === 'setup:me' ? '…' : 'Test (moi)'}</button>
              <button onClick={() => sendPinReminder('all', 'setup')} disabled={!!pinBusy || (pinCount?.without_pin === 0)}
                className="text-xs px-3 py-2 rounded-lg bg-amber-600 text-white font-semibold hover:opacity-90 disabled:opacity-50">{pinBusy === 'setup:all' ? 'Envoi…' : `À tous sans code${pinCount ? ` (${pinCount.without_pin})` : ''}`}</button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-muted w-24 flex-shrink-0">Vérif mémoire</span>
              <button onClick={() => sendPinReminder('me', 'recall')} disabled={!!pinBusy}
                className="text-xs px-3 py-2 rounded-lg border hover:bg-surface-2 disabled:opacity-50">{pinBusy === 'recall:me' ? '…' : 'Test (moi)'}</button>
              <button onClick={() => sendPinReminder('all', 'recall')} disabled={!!pinBusy || (pinCount?.with_pin === 0)}
                className="text-xs px-3 py-2 rounded-lg bg-brand text-white font-semibold hover:opacity-90 disabled:opacity-50">{pinBusy === 'recall:all' ? 'Envoi…' : `À tous avec code${pinCount ? ` (${pinCount.with_pin})` : ''}`}</button>
            </div>
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
