'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ROLES = ['driver', 'dispatcher', 'admin', 'superadmin']
const ROLE_COLORS: Record<string, string> = {
  driver:     'bg-zinc-700 text-zinc-200',
  dispatcher: 'bg-blue-900 text-blue-200',
  admin:      'bg-purple-900 text-purple-200',
  superadmin: 'bg-red-900 text-red-200',
}

export default function UsersClient({ users, modules }: { users: any[], modules: any[] }) {
  const router = useRouter()
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [userModules, setUserModules] = useState<string[]>([])
  const [userRole, setUserRole] = useState('')
  const [userActive, setUserActive] = useState(true)
  const [userCanVerify, setUserCanVerify] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userPersonalEmail, setUserPersonalEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState('')
  const [showNewUser, setShowNewUser] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('driver')
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')

  const openUser = (user: any) => {
    setSelectedUser(user)
    setUserModules(user.user_modules?.filter((m: any) => m.granted).map((m: any) => m.module_id) || [])
    setUserRole(user.role)
    setUserActive(user.active)
    setUserCanVerify(user.can_verify || false)
    setUserEmail(user.email || '')
    setUserPersonalEmail(user.personal_email || '')
    setResetSuccess('')
  }

  const toggleModule = (moduleId: string) => {
    setUserModules(prev =>
      prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]
    )
  }

  const saveUser = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          email: userEmail,
          role: userRole,
          active: userActive,
          can_verify: userCanVerify,
          personal_email: userPersonalEmail || null,
          modules: userModules
        })
      })
      setSelectedUser(null)
      window.location.href = window.location.href + '?t=' + Date.now()
    } finally {
      setSaving(false)
    }
  }

  const resetPassword = async () => {
    if (!selectedUser) return
    setResetLoading(true); setResetSuccess('')
    const res = await fetch('/api/admin/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUser.id })
    })
    setResetLoading(false)
    if (res.ok) setResetSuccess('✅ Mot de passe réinitialisé à !Verviers4800')
  }

  const createUser = async () => {
    if (!newEmail) return
    setCreating(true)
    try {
      await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, name: newName, role: newRole })
      })
      setShowNewUser(false)
      setNewEmail('')
      setNewName('')
      setNewRole('driver')
      router.refresh()
    } finally {
      setCreating(false)
    }
  }

  const filtered = users.filter(u =>
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.name?.toLowerCase().includes(search.toLowerCase())
  )

  // Vue détail utilisateur
  if (selectedUser) {
    return (
      <div className="px-4 py-5">
        <button onClick={() => setSelectedUser(null)} className="text-zinc-500 hover:text-white text-sm mb-5 flex items-center gap-1">
          ← Retour
        </button>

        {/* Infos user */}
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {selectedUser.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '??'}
            </div>
            <div>
              <p className="text-white font-semibold">{selectedUser.name || 'Sans nom'}</p>
              <p className="text-zinc-500 text-xs">{selectedUser.email}</p>
            </div>
          </div>

          {/* Email professionnel */}
          <div className="mb-3">
            <label className="text-zinc-500 text-xs font-medium mb-1.5 block">Email professionnel</label>
            <input type="email" value={userEmail}
              onChange={e => setUserEmail(e.target.value)}
              className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-3 py-2.5 text-white text-sm outline-none" />
          </div>

          {/* Rôle */}
          <div className="mb-3">
            <label className="text-zinc-500 text-xs font-medium mb-1.5 block">Rôle</label>
            <div className="flex gap-2 flex-wrap">
              {ROLES.map(r => (
                <button
                  key={r}
                  onClick={() => setUserRole(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    userRole === r
                      ? 'border-brand bg-brand/20 text-brand'
                      : 'border-[#2a2a2a] text-zinc-500 hover:border-zinc-500'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Actif/Inactif */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-zinc-500 text-xs font-medium">Compte actif</span>
            <button
              onClick={() => setUserActive(!userActive)}
              className={`relative w-11 h-6 rounded-full transition-colors ${userActive ? 'bg-green-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${userActive ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {/* Email personnel (pour connexion Google/Microsoft perso) */}
          <div className="mt-3">
            <label className="text-zinc-500 text-xs font-medium block mb-1">Email personnel</label>
            <p className="text-zinc-700 text-xs mb-1.5">Pour connexion Google ou Microsoft personnel</p>
            <input type="email" value={userPersonalEmail}
              onChange={e => setUserPersonalEmail(e.target.value)}
              placeholder="prenom@gmail.com"
              className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-3 py-2.5 text-white text-sm outline-none" />
          </div>

          {/* Reset mot de passe */}
          <div className="mt-3">
            {resetSuccess && (
              <p className="text-green-400 text-xs mb-2">{resetSuccess}</p>
            )}
            <button onClick={resetPassword} disabled={resetLoading}
              className="w-full bg-[#2a2a2a] border border-[#333] text-zinc-400 text-xs rounded-xl py-2.5 hover:border-zinc-500 transition-all disabled:opacity-50">
              {resetLoading ? 'Réinitialisation…' : '🔑 Réinitialiser le mot de passe'}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-zinc-500 text-xs font-medium">Peut valider les remises espèces</span>
              <p className="text-zinc-700 text-xs">Accès au PIN de validation caisse</p>
            </div>
            <button
              onClick={() => setUserCanVerify(!userCanVerify)}
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${userCanVerify ? 'bg-brand' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${userCanVerify ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>

        {/* Modules */}
        <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3">Modules accessibles</p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {modules.map((mod: any) => {
            const active = userModules.includes(mod.id)
            return (
              <button
                key={mod.id}
                onClick={() => toggleModule(mod.id)}
                className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                  active
                    ? 'border-brand bg-brand/10 text-white'
                    : 'border-[#2a2a2a] text-zinc-500 hover:border-zinc-600'
                }`}
              >
                <span className="text-lg">{mod.icon}</span>
                <span className="text-xs font-medium leading-tight">{mod.label}</span>
                {active && <span className="ml-auto text-brand text-xs">✓</span>}
              </button>
            )
          })}
        </div>

        <button
          onClick={saveUser}
          disabled={saving}
          className="w-full bg-brand hover:bg-brand-dark text-white font-bold rounded-xl py-3.5 transition-colors disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : '✓ Sauvegarder'}
        </button>
      </div>
    )
  }

  // Liste des utilisateurs
  return (
    <div className="px-4 py-5">
      {/* Search + Add */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => setShowNewUser(true)}
          className="bg-brand text-white rounded-xl px-4 py-2.5 text-sm font-bold"
        >
          + Ajouter
        </button>
      </div>

      {/* Nouveau user modal */}
      {showNewUser && (
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-4">
          <p className="text-white font-semibold mb-3">Nouvel utilisateur</p>
          <input
            placeholder="Email *"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2"
          />
          <input
            placeholder="Nom complet"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-2"
          />
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            className="w-full bg-[#222] border border-[#333] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand mb-3"
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => setShowNewUser(false)} className="flex-1 bg-[#222] border border-[#333] text-zinc-400 rounded-xl py-2.5 text-sm">
              Annuler
            </button>
            <button onClick={createUser} disabled={creating || !newEmail} className="flex-2 flex-1 bg-brand text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">
              {creating ? 'Création...' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 bg-[#1e1e1e] rounded-xl p-3 text-center">
          <p className="text-white font-bold text-xl">{users.length}</p>
          <p className="text-zinc-500 text-xs">Total</p>
        </div>
        <div className="flex-1 bg-[#1e1e1e] rounded-xl p-3 text-center">
          <p className="text-white font-bold text-xl">{users.filter(u => u.active).length}</p>
          <p className="text-zinc-500 text-xs">Actifs</p>
        </div>
        <div className="flex-1 bg-[#1e1e1e] rounded-xl p-3 text-center">
          <p className="text-white font-bold text-xl">{users.filter(u => u.role === 'driver').length}</p>
          <p className="text-zinc-500 text-xs">Chauffeurs</p>
        </div>
      </div>

      {/* Liste */}
      <div className="flex flex-col gap-2">
        {filtered.map(user => {
          const moduleCount = user.user_modules?.filter((m: any) => m.granted).length || 0
          const initials = user.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '??'
          return (
            <button
              key={user.id}
              onClick={() => openUser(user)}
              className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 flex items-center gap-3 text-left hover:border-zinc-600 active:opacity-80 transition-all"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${user.active ? 'bg-brand text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm truncate">{user.name || 'Sans nom'}</p>
                <p className="text-zinc-500 text-xs truncate">{user.email}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${ROLE_COLORS[user.role] || 'bg-zinc-700 text-zinc-300'}`}>
                  {user.role}
                </span>
                <span className="text-zinc-600 text-xs">{moduleCount} modules</span>
              </div>
            </button>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center py-10 text-zinc-600">
            <p className="text-3xl mb-2">👥</p>
            <p>Aucun utilisateur trouvé</p>
          </div>
        )}
      </div>
    </div>
  )
}
