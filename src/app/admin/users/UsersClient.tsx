'use client'

import { useState } from 'react'

const ROLES = ['driver', 'dispatcher', 'admin', 'superadmin', 'partner']
const ROLE_COLORS: Record<string, string> = {
  driver:     'bg-zinc-700 text-zinc-200',
  dispatcher: 'bg-blue-900 text-blue-200',
  admin:      'bg-purple-900 text-purple-200',
  superadmin: 'bg-red-900 text-red-200',
  partner:    'bg-teal-900 text-teal-200',
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-brand' : 'bg-zinc-700'}`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function UsersClient({ users, modules }: { users: any[], modules: any[] }) {
  // ── Liste ──────────────────────────────────────────────
  const [search,      setSearch]      = useState('')
  const [selectedUser,setSelectedUser]= useState<any>(null)
  const [showNewUser, setShowNewUser] = useState(false)
  const [newEmail,    setNewEmail]    = useState('')
  const [newName,     setNewName]     = useState('')
  const [newRole,     setNewRole]     = useState('driver')
  const [creating,    setCreating]    = useState(false)

  // ── Édition ────────────────────────────────────────────
  const [saving,           setSaving]           = useState(false)
  const [userEmail,        setUserEmail]        = useState('')
  const [userPersonalEmail,setUserPersonalEmail]= useState('')
  const [userRoles,        setUserRoles]        = useState<string[]>([])
  const [userActive,       setUserActive]       = useState(true)
  const [userCanVerify,    setUserCanVerify]    = useState(false)
  const [userAuthProvider, setUserAuthProvider] = useState('email_password')
  const [userTgrPush,      setUserTgrPush]      = useState(false)
  const [userOdooId,       setUserOdooId]       = useState('')
  const [userModules,      setUserModules]      = useState<string[]>([])
  const [resetLoading,     setResetLoading]     = useState(false)
  const [resetSuccess,     setResetSuccess]     = useState('')
  const [showRoleModal,    setShowRoleModal]    = useState(false)
  const [roleModalRoles,   setRoleModalRoles]   = useState<string[]>([])
  const [roleSaving,       setRoleSaving]       = useState(false)
  const [roleError,        setRoleError]        = useState('')

  // ── Ouvrir un utilisateur ──────────────────────────────
  const openUser = (user: any) => {
    setSelectedUser(user)
    setUserEmail(user.email || '')
    setUserPersonalEmail(user.personal_email || '')
    // Rôles : priorité à roles[], fallback sur role string
    const r = Array.isArray(user.roles) && user.roles.length > 0
      ? user.roles
      : user.role ? [user.role] : ['driver']
    setUserRoles(r)
    setUserActive(!!user.active)
    setUserCanVerify(!!user.can_verify)
    setUserAuthProvider(user.auth_provider || 'email_password')
    setUserTgrPush(!!user.tgr_push_notify)
    setUserOdooId(user.odoo_partner_id ? String(user.odoo_partner_id) : '')
    setUserModules(user.user_modules?.filter((m: any) => m.granted).map((m: any) => m.module_id) || [])
    setResetSuccess('')
  }

  // ── Toggle rôle ────────────────────────────────────────
  const toggleRole = (r: string) => {
    setUserRoles(prev => {
      const has  = prev.includes(r)
      if (has && prev.length === 1) return prev // garder au moins 1
      return has ? prev.filter(x => x !== r) : [...prev, r]
    })
  }

  // ── Modal rôles ────────────────────────────────────────
  const openRoleModal = () => {
    setRoleModalRoles([...userRoles])
    setRoleError('')
    setShowRoleModal(true)
  }

  const toggleRoleModal = (r: string) => {
    setRoleModalRoles(prev => {
      const has = prev.includes(r)
      if (has && prev.length === 1) return prev
      return has ? prev.filter(x => x !== r) : [...prev, r]
    })
  }

  const saveRoles = async () => {
    if (!selectedUser) return
    setRoleSaving(true); setRoleError('')
    try {
      const res = await fetch('/api/admin/users/roles', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: selectedUser.id, roles: roleModalRoles }),
      })
      const data = await res.json()
      if (!res.ok) { setRoleError(data.error || 'Erreur'); return }
      // Mettre à jour localement
      setUserRoles(roleModalRoles)
      setShowRoleModal(false)
    } finally {
      setRoleSaving(false)
    }
  }

  // ── Sauvegarder ────────────────────────────────────────
  const saveUser = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/users', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId:          selectedUser.id,
          email:           userEmail,
          role:            userRoles[0] || 'driver',
          roles:           userRoles,
          active:          userActive,
          can_verify:      userCanVerify,
          personal_email:  userPersonalEmail || null,
          auth_provider:   userAuthProvider,
          modules:         userModules,
          tgr_push_notify: userTgrPush,
          odoo_partner_id: userOdooId ? parseInt(userOdooId) : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert('Erreur: ' + data.error); return }
      setSelectedUser(null)
      window.location.href = window.location.href.split('?')[0] + '?t=' + Date.now()
    } finally {
      setSaving(false)
    }
  }

  // ── Reset password ─────────────────────────────────────
  const resetPassword = async () => {
    if (!selectedUser) return
    setResetLoading(true); setResetSuccess('')
    const res = await fetch('/api/admin/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUser.id }),
    })
    setResetLoading(false)
    if (res.ok) setResetSuccess('✅ Mot de passe réinitialisé à !Verviers4800')
  }

  // ── Créer utilisateur ──────────────────────────────────
  const createUser = async () => {
    if (!newEmail) return
    setCreating(true)
    const res = await fetch('/api/admin/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail,
        name:  newName,
        role:  newRole,
        password_hash: '$2a$10$oiOH/C5U8.kzGjIeK7U4I.AccsreHbuOn4mShqv42TQIt7AzlY9eu',
      }),
    })
    setCreating(false)
    if (res.ok) {
      setShowNewUser(false)
      setNewEmail(''); setNewName(''); setNewRole('driver')
      window.location.href = window.location.href.split('?')[0] + '?t=' + Date.now()
    } else {
      const d = await res.json()
      alert('Erreur: ' + d.error)
    }
  }

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    return !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.role?.includes(q)
  })

  // ── Panel édition ──────────────────────────────────────
  const renderEditPanel = () => (
    <div className="px-4 py-5 lg:px-0">
      <button onClick={() => setSelectedUser(null)}
        className="text-zinc-500 hover:text-white text-sm mb-5 flex items-center gap-1 lg:hidden">
        ← Retour
      </button>
      <div className="hidden lg:flex items-center justify-between mb-5">
        <h2 className="text-white font-bold text-lg">{selectedUser?.name}</h2>
        <button onClick={() => setSelectedUser(null)} className="text-zinc-500 hover:text-white text-2xl">×</button>
      </div>

      {/* ── Infos générales ── */}
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-3 mb-3 lg:hidden">
          <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {selectedUser?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '??'}
          </div>
          <div>
            <p className="text-white font-semibold">{selectedUser?.name || 'Sans nom'}</p>
            <p className="text-zinc-500 text-xs">{selectedUser?.email}</p>
          </div>
        </div>

        {/* Email */}
        <div className="mb-3">
          <label className="text-zinc-500 text-xs font-medium mb-1.5 block">Email professionnel</label>
          <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)}
            className="w-full bg-[#0F0F0F] border border-[#333] focus:border-brand rounded-xl px-3 py-2.5 text-white text-sm outline-none" />
        </div>

        {/* Rôle(s) — lecture seule + bouton modal */}
        <div className="mb-3">
          <label className="text-zinc-500 text-xs font-medium mb-1.5 block">Rôle(s)</label>
          <div className="flex items-center justify-between bg-[#0F0F0F] border border-[#333] rounded-xl px-3 py-2.5">
            <div className="flex gap-1.5 flex-wrap">
              {userRoles.map(r => (
                <span key={r} className={`text-xs font-semibold px-2 py-0.5 rounded-lg capitalize ${ROLE_COLORS[r] || 'bg-zinc-700 text-zinc-300'}`}>
                  {r}
                </span>
              ))}
            </div>
            <button onClick={openRoleModal}
              className="text-brand text-xs font-medium ml-3 hover:text-white transition-colors flex-shrink-0">
              Modifier
            </button>
          </div>
        </div>

        {/* Compte actif */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-zinc-500 text-xs font-medium">Compte actif</span>
          <Toggle value={userActive} onChange={() => setUserActive(!userActive)} />
        </div>

        {/* Méthode connexion */}
        <div className="mb-3">
          <label className="text-zinc-500 text-xs font-medium mb-1.5 block">Méthode de connexion</label>
          <div className="flex flex-col gap-1.5">
            {[
              { value: 'email_password', label: '✉️ Email & mot de passe', sub: 'Connexion avec email + mdp' },
              { value: 'microsoft',      label: '🏢 Microsoft professionnel', sub: 'Compte M365 du tenant VD' },
              { value: 'google',         label: '🔵 Google', sub: 'Compte Gmail personnel' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setUserAuthProvider(opt.value)}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                  userAuthProvider === opt.value ? 'border-brand bg-brand/10' : 'border-[#2a2a2a] hover:border-zinc-500'
                }`}>
                <div className="flex-1">
                  <p className={`text-xs font-semibold ${userAuthProvider === opt.value ? 'text-white' : 'text-zinc-400'}`}>{opt.label}</p>
                  <p className="text-zinc-600 text-xs">{opt.sub}</p>
                </div>
                {userAuthProvider === opt.value && <span className="text-brand text-xs mt-0.5">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Reset password */}
        <div className="mb-3">
          {resetSuccess && <p className="text-green-400 text-xs mb-2">{resetSuccess}</p>}
          <button onClick={resetPassword} disabled={resetLoading}
            className="w-full bg-[#2a2a2a] border border-[#333] text-zinc-400 text-xs rounded-xl py-2.5 hover:border-zinc-500 transition-all disabled:opacity-50">
            {resetLoading ? 'Réinitialisation…' : '🔑 Réinitialiser le mot de passe'}
          </button>
        </div>

        {/* Peut valider caisse */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-zinc-500 text-xs font-medium">Peut valider les transferts espèces</span>
            <p className="text-zinc-700 text-xs">Accès au PIN de validation caisse</p>
          </div>
          <Toggle value={userCanVerify} onChange={() => setUserCanVerify(!userCanVerify)} />
        </div>
      </div>

      {/* ── TGR Touring ── */}
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-4">
        <p className="text-zinc-400 text-xs font-semibold uppercase tracking-widest mb-3">TGR Touring</p>

        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-zinc-500 text-xs font-medium">Notifications push</span>
            <p className="text-zinc-700 text-xs">Reçoit les alertes nouvelles missions TGR</p>
          </div>
          <Toggle value={userTgrPush} onChange={() => setUserTgrPush(!userTgrPush)} />
        </div>

        <div>
          <label className="text-zinc-500 text-xs font-medium mb-1.5 block">ID Partenaire Odoo</label>
          <input type="number" placeholder="Ex: 1251" value={userOdooId}
            onChange={e => setUserOdooId(e.target.value)}
            className="w-full bg-[#0F0F0F] border border-[#2a2a2a] rounded-xl px-4 py-2.5
                       text-white text-sm outline-none focus:border-brand" />
          <p className="text-zinc-700 text-xs mt-1">ID partenaire Odoo pour les devis TGR</p>
        </div>
      </div>

      {/* ── Modules ── */}
      <p className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3">Modules accessibles</p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {modules.map((mod: any) => {
          const active = userModules.includes(mod.id)
          return (
            <button key={mod.id}
              onClick={() => setUserModules(prev => prev.includes(mod.id) ? prev.filter(m => m !== mod.id) : [...prev, mod.id])}
              className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                active ? 'border-brand bg-brand/10 text-white' : 'border-[#2a2a2a] text-zinc-500 hover:border-zinc-600'
              }`}>
              <span className="text-lg">{mod.icon}</span>
              <span className="text-xs font-medium leading-tight">{mod.label}</span>
              {active && <span className="ml-auto text-brand text-xs">✓</span>}
            </button>
          )
        })}
      </div>

      <button onClick={saveUser} disabled={saving}
        className="w-full bg-brand text-white font-bold rounded-xl py-3.5 transition-colors disabled:opacity-50 hover:bg-red-700">
        {saving ? 'Enregistrement...' : '✓ Sauvegarder'}
      </button>
    </div>
  )

  return (
    <div className="lg:flex lg:gap-6">
      {/* ─── Liste ─── */}
      <div className={`${selectedUser ? 'hidden lg:block' : ''} lg:flex-1 px-4 py-5 lg:px-0 lg:pt-0`}>

        <div className="hidden lg:flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white text-2xl font-bold">Utilisateurs</h1>
            <p className="text-zinc-500 text-sm mt-1">{users.length} utilisateurs · {users.filter(u => u.active).length} actifs</p>
          </div>
          <button onClick={() => setShowNewUser(!showNewUser)}
            className="bg-brand text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:bg-red-700 transition-all">
            + Ajouter un utilisateur
          </button>
        </div>

        <div className="flex gap-2 mb-4 lg:hidden">
          <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand" />
          <button onClick={() => setShowNewUser(!showNewUser)} className="bg-brand text-white rounded-xl px-4 py-2.5 text-sm font-bold">+ Ajouter</button>
        </div>

        <div className="hidden lg:block mb-4">
          <input type="text" placeholder="Rechercher par nom, email, rôle…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand" />
        </div>

        <div className="flex gap-2 mb-4 lg:hidden">
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

        {/* Nouveau utilisateur */}
        {showNewUser && (
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 mb-4">
            <p className="text-white font-semibold mb-3">Nouvel utilisateur</p>
            <div className="flex flex-col gap-2">
              <input type="email" placeholder="Email professionnel *" value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="bg-[#0F0F0F] border border-[#333] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-brand" />
              <input type="text" placeholder="Nom complet" value={newName}
                onChange={e => setNewName(e.target.value)}
                className="bg-[#0F0F0F] border border-[#333] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-brand" />
              <select value={newRole} onChange={e => setNewRole(e.target.value)}
                className="bg-[#0F0F0F] border border-[#333] rounded-xl px-3 py-2.5 text-white text-sm outline-none appearance-none">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex gap-2 mt-1">
                <button onClick={() => setShowNewUser(false)} className="flex-1 bg-[#2a2a2a] text-zinc-400 rounded-xl py-2.5 text-sm">Annuler</button>
                <button onClick={createUser} disabled={creating || !newEmail}
                  className="flex-1 bg-brand text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50">
                  {creating ? '…' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Liste mobile */}
        <div className="flex flex-col gap-2 lg:hidden">
          {filtered.map(user => {
            const moduleCount = user.user_modules?.filter((m: any) => m.granted).length || 0
            const initials    = user.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '??'
            const roles       = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role]
            return (
              <button key={user.id} onClick={() => openUser(user)}
                className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 flex items-center gap-3 text-left hover:border-zinc-600 transition-all">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${user.active ? 'bg-brand text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm truncate">{user.name || 'Sans nom'}</p>
                  <p className="text-zinc-500 text-xs truncate">{user.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex gap-1 flex-wrap justify-end">
                    {roles.map((r: string) => (
                      <span key={r} className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${ROLE_COLORS[r] || 'bg-zinc-700 text-zinc-300'}`}>{r}</span>
                    ))}
                  </div>
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

        {/* Tableau desktop */}
        <div className="hidden lg:block">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                {['Utilisateur', 'Email', 'Rôle(s)', 'Statut', 'Modules', 'Méthode', ''].map(h => (
                  <th key={h} className="text-left text-zinc-500 text-xs font-medium uppercase tracking-wider pb-3 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => {
                const moduleCount = user.user_modules?.filter((m: any) => m.granted).length || 0
                const initials    = user.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '??'
                const roles       = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role]
                return (
                  <tr key={user.id} className="border-b border-[#1e1e1e] hover:bg-[#1A1A1A] transition-colors cursor-pointer" onClick={() => openUser(user)}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${user.active ? 'bg-brand text-white' : 'bg-zinc-700 text-zinc-400'}`}>
                          {initials}
                        </div>
                        <span className="text-white text-sm font-medium">{user.name || 'Sans nom'}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-zinc-400 text-sm">{user.email}</td>
                    <td className="py-3 pr-4">
                      <div className="flex gap-1 flex-wrap">
                        {roles.map((r: string) => (
                          <span key={r} className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${ROLE_COLORS[r] || 'bg-zinc-700 text-zinc-300'}`}>{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-1 rounded-lg ${user.active ? 'bg-green-900/40 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}>
                        {user.active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-zinc-500 text-sm">{moduleCount}</td>
                    <td className="py-3 pr-4 text-zinc-500 text-sm">
                      {user.auth_provider === 'google' ? '🔵 Google' : user.auth_provider === 'microsoft' ? '🏢 Microsoft' : '✉️ Email/mdp'}
                    </td>
                    <td className="py-3">
                      <span className="text-brand text-xs font-medium">Modifier →</span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-zinc-600">Aucun utilisateur trouvé</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Panel édition ─── */}
      {selectedUser && (
        <div className="lg:w-96 lg:flex-shrink-0 lg:border-l lg:border-[#2a2a2a] lg:pl-6">
          {renderEditPanel()}
        </div>
      )}

      {/* ─── Modal rôles ─── */}
      {showRoleModal && selectedUser && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowRoleModal(false)}>
          <div className="bg-[#1A1A1A] rounded-2xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-bold">Modifier les rôles</h2>
                <p className="text-zinc-500 text-xs mt-0.5">{selectedUser.name}</p>
              </div>
              <button onClick={() => setShowRoleModal(false)} className="text-zinc-500 text-2xl">×</button>
            </div>

            <div className="flex flex-col gap-2 mb-5">
              {ROLES.map(r => {
                const active = roleModalRoles.includes(r)
                return (
                  <button key={r} onClick={() => toggleRoleModal(r)}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                      active
                        ? 'border-brand bg-brand/10 text-white'
                        : 'border-[#2a2a2a] text-zinc-400 hover:border-zinc-500'
                    }`}>
                    <div className="flex items-center gap-3">
                      <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs ${
                        active ? 'bg-brand border-brand' : 'border-zinc-600'
                      }`}>
                        {active && '✓'}
                      </span>
                      <span className={`text-sm font-medium capitalize ${
                        active ? (ROLE_COLORS[r]?.split(' ')[1] || 'text-white') : ''
                      }`}>{r}</span>
                    </div>
                    {roleModalRoles[0] === r && (
                      <span className="text-zinc-500 text-xs">primaire</span>
                    )}
                  </button>
                )
              })}
            </div>

            <p className="text-zinc-600 text-xs mb-4">
              Rôle primaire : <span className="text-white capitalize">{roleModalRoles[0] || '—'}</span>
              {' '}· {roleModalRoles.length} rôle{roleModalRoles.length > 1 ? 's' : ''} sélectionné{roleModalRoles.length > 1 ? 's' : ''}
            </p>

            {roleError && (
              <div className="bg-red-950/50 border border-red-900 text-red-300 rounded-xl px-3 py-2 text-xs mb-3">
                {roleError}
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowRoleModal(false)}
                className="flex-1 py-3 bg-[#2a2a2a] text-zinc-400 rounded-xl text-sm font-medium">
                Annuler
              </button>
              <button onClick={saveRoles} disabled={roleSaving}
                className="flex-1 py-3 bg-brand text-white rounded-xl text-sm font-bold disabled:opacity-50">
                {roleSaving ? '⏳ Sauvegarde…' : '✅ Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
