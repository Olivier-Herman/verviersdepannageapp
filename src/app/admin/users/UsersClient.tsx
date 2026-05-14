'use client'
// src/app/admin/users/UsersClient.tsx
//
// POC Phase 1 — proof-of-concept du système d'avatars colorés multi-users.
// Mobi → rouge, Jonathan → bleu, Bovy → orange, Palm → vert, Momo → gris.
// Les autres users tombent sur le hash fallback (8 gradients harmonieux).
//
// Aucune modif fonctionnelle vs version précédente — uniquement migration
// visuelle. La logique CRUD (POST/PATCH /api/admin/users, /reset-password,
// /welcome, /roles, gestion modules) est intacte.

import { useState } from 'react'
import { Plus, X, Mail, Key, ArrowLeft } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

const ROLES = ['driver', 'dispatcher', 'admin', 'superadmin', 'partner']

// Mapping rôle → variant <Badge>
// - superadmin = brand (pouvoir maximal, identité de marque)
// - admin      = purple (administratif)
// - dispatcher = info (info bleue)
// - driver     = neutral (défaut)
// - partner    = success (couleur vert/teal proche du teal historique)
const ROLE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  driver:     'neutral',
  dispatcher: 'info',
  admin:      'purple',
  superadmin: 'brand',
  partner:    'success',
}

// Classes communes pour les inputs HTML — pas de composant <Input> atomique en phase 1.
const inputCls =
  'w-full bg-surface border rounded-md px-3 py-2.5 text-sm text-ink ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'placeholder:text-ink-muted transition-colors'

const labelCls = 'block text-ink-muted text-xs font-semibold mb-1.5 uppercase tracking-wider'

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={value}
      className={`relative inline-flex items-center w-11 h-6 rounded-full overflow-hidden transition-colors flex-shrink-0 ${
        value ? 'bg-brand' : 'bg-ink-faint'
      }`}
    >
      {/* Pastille : block + transform — pas d'absolute (évite tout débord
          géométrique sur les bords arrondis du capsule). overflow-hidden du
          parent garantit qu'aucun pixel ne sort. Translation symétrique :
          off = 2px depuis la gauche, on = 22px → mouvement de 20px exactement. */}
      <span
        className={`block w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
          value ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function RoleBadges({ roles, size = 'sm' }: { roles: string[]; size?: 'sm' | 'md' }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {roles.map(r => (
        <Badge key={r} variant={ROLE_BADGE_VARIANT[r] || 'neutral'} size={size} className="capitalize">
          {r}
        </Badge>
      ))}
    </div>
  )
}

export default function UsersClient({ users, modules, currentUserRole = 'admin' }: {
  users: any[]
  modules: any[]
  currentUserRole?: string
}) {
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
  const [userHasOdooAccess, setUserHasOdooAccess] = useState(false)
  const [userOdooId,       setUserOdooId]       = useState('')
  const [userModules,      setUserModules]      = useState<string[]>([])
  const [resetLoading,     setResetLoading]     = useState(false)
  const [resetSuccess,     setResetSuccess]     = useState('')
  const [welcomeLoading,   setWelcomeLoading]   = useState(false)
  const [welcomeSuccess,   setWelcomeSuccess]   = useState('')
  const [showRoleModal,    setShowRoleModal]    = useState(false)
  const [roleModalRoles,   setRoleModalRoles]   = useState<string[]>([])
  const isSuperAdmin = currentUserRole === 'superadmin'
  const [roleSaving,       setRoleSaving]       = useState(false)
  const [userTowsoftName,  setUserTowsoftName]  = useState('')
  const [roleError,        setRoleError]        = useState('')

  // ── Ouvrir un utilisateur ──────────────────────────────
  const openUser = (user: any) => {
    setSelectedUser(user)
    setUserEmail(user.email || '')
    setUserPersonalEmail(user.personal_email || '')
    const r = Array.isArray(user.roles) && user.roles.length > 0
      ? user.roles
      : user.role ? [user.role] : ['driver']
    setUserRoles(r)
    setUserActive(!!user.active)
    setUserCanVerify(!!user.can_verify)
    setUserAuthProvider(user.auth_provider || 'email_password')
    setUserTgrPush(!!user.tgr_push_notify)
    setUserHasOdooAccess(!!user.has_odoo_access)
    setUserOdooId(user.odoo_partner_id ? String(user.odoo_partner_id) : '')
    setUserTowsoftName(user.towsoft_name || '')
    setUserModules(user.user_modules?.filter((m: any) => m.granted).map((m: any) => m.module_id) || [])
    setResetSuccess('')
    setWelcomeSuccess('')
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
          has_odoo_access: userHasOdooAccess,
          odoo_partner_id: userOdooId ? parseInt(userOdooId) : null,
          towsoft_name:    userTowsoftName || null,
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

  // ── Envoyer mail de bienvenue ──────────────────────────
  const sendWelcome = async () => {
    if (!selectedUser) return
    setWelcomeLoading(true); setWelcomeSuccess('')
    const res = await fetch('/api/admin/users/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUser.id }),
    })
    setWelcomeLoading(false)
    if (res.ok) setWelcomeSuccess('✅ Mail de bienvenue envoyé')
    else { const d = await res.json(); setWelcomeSuccess('❌ ' + (d.error || 'Erreur')) }
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
      {/* Mobile : back */}
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<ArrowLeft size={14} />}
        className="mb-4 lg:hidden"
        onClick={() => setSelectedUser(null)}
      >
        Retour
      </Button>

      {/* Desktop : titre + avatar lg + close */}
      <div className="hidden lg:flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            name={selectedUser?.name || '?'}
            userId={selectedUser?.id}
            email={selectedUser?.email}
            size="lg"
            className={!selectedUser?.active ? 'opacity-60' : ''}
          />
          <div className="min-w-0">
            <h2 className="font-display text-ink font-bold text-lg truncate">{selectedUser?.name || 'Sans nom'}</h2>
            <p className="text-ink-muted text-xs truncate">{selectedUser?.email}</p>
          </div>
        </div>
        <button
          onClick={() => setSelectedUser(null)}
          aria-label="Fermer"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors flex-shrink-0">
          <X size={16} />
        </button>
      </div>

      {/* ── Infos générales ── */}
      <div className="bg-surface border rounded-card shadow-card p-4 mb-4">
        {/* Mobile : avatar md + nom (le header desktop a déjà l'avatar) */}
        <div className="flex items-center gap-3 mb-4 lg:hidden">
          <Avatar
            name={selectedUser?.name || '?'}
            userId={selectedUser?.id}
            email={selectedUser?.email}
            size="md"
            className={!selectedUser?.active ? 'opacity-60' : ''}
          />
          <div className="min-w-0">
            <p className="font-display text-ink font-semibold truncate">{selectedUser?.name || 'Sans nom'}</p>
            <p className="text-ink-muted text-xs truncate">{selectedUser?.email}</p>
          </div>
        </div>

        {/* Email */}
        <div className="mb-3">
          <label className={labelCls}>Email professionnel</label>
          <input
            type="email"
            value={userEmail}
            onChange={e => setUserEmail(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Rôle(s) — lecture seule + bouton modal */}
        <div className="mb-3">
          <label className={labelCls}>Rôle(s)</label>
          <div className="flex items-center justify-between bg-surface border rounded-md px-3 py-2">
            <RoleBadges roles={userRoles} size="sm" />
            <button
              onClick={openRoleModal}
              className="text-brand text-xs font-semibold ml-3 hover:underline transition flex-shrink-0">
              Modifier
            </button>
          </div>
        </div>

        {/* Compte actif */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="flex-1 min-w-0 text-ink-muted text-xs font-semibold uppercase tracking-wider">Compte actif</span>
          <Toggle value={userActive} onChange={() => setUserActive(!userActive)} />
        </div>

        {/* Méthode connexion */}
        <div className="mb-3">
          <label className={labelCls}>Méthode de connexion</label>
          <div className="flex flex-col gap-1.5">
            {[
              { value: 'email_password', label: '✉️ Email & mot de passe', sub: 'Connexion avec email + mdp' },
              { value: 'microsoft',      label: '🏢 Microsoft professionnel', sub: 'Compte M365 du tenant VD' },
              { value: 'google',         label: '🔵 Google', sub: 'Compte Gmail personnel' },
            ].map(opt => {
              const active = userAuthProvider === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setUserAuthProvider(opt.value)}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-md border text-left transition-colors ${
                    active ? 'border-brand bg-brand-soft' : 'hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex-1">
                    <p className={`text-xs font-semibold ${active ? 'text-brand' : 'text-ink-secondary'}`}>{opt.label}</p>
                    <p className="text-ink-faint text-xs">{opt.sub}</p>
                  </div>
                  {active && <span className="text-brand text-xs mt-0.5" aria-hidden="true">✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Reset password */}
        <div className="mb-3">
          {resetSuccess && <p className="text-success text-xs mb-2">{resetSuccess}</p>}
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            iconLeft={<Key size={14} />}
            loading={resetLoading}
            onClick={resetPassword}
          >
            Réinitialiser le mot de passe
          </Button>
        </div>

        {/* Mail de bienvenue */}
        <div className="mb-3">
          {welcomeSuccess && <p className="text-success text-xs mb-2">{welcomeSuccess}</p>}
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            iconLeft={<Mail size={14} />}
            loading={welcomeLoading}
            onClick={sendWelcome}
          >
            Envoyer le mail de bienvenue
          </Button>
        </div>

        {/* Peut valider caisse */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="block text-ink-muted text-xs font-semibold uppercase tracking-wider">Peut valider les transferts espèces</span>
            <p className="text-ink-faint text-xs mt-0.5">Accès au PIN de validation caisse</p>
          </div>
          <Toggle value={userCanVerify} onChange={() => setUserCanVerify(!userCanVerify)} />
        </div>
      </div>

      {/* ── Accès Odoo ── */}
      <div className="bg-surface border rounded-card shadow-card p-4 mb-4">
        <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">Accès Odoo</p>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <span className="block text-ink-muted text-xs font-semibold uppercase tracking-wider">Activé</span>
            <p className="text-ink-faint text-xs mt-0.5">Si activé, l'utilisateur verra le bouton "Ouvrir dans Odoo" sur les fiches véhicule, facture et autres (in-app). Si désactivé : consultation uniquement dans l'app.</p>
          </div>
          <Toggle value={userHasOdooAccess} onChange={() => setUserHasOdooAccess(!userHasOdooAccess)} />
        </div>
      </div>

      {/* ── TGR Touring ── */}
      <div className="bg-surface border rounded-card shadow-card p-4 mb-4">
        <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">TGR Touring</p>

        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <span className="block text-ink-muted text-xs font-semibold uppercase tracking-wider">Notifications push</span>
            <p className="text-ink-faint text-xs mt-0.5">Reçoit les alertes nouvelles missions TGR</p>
          </div>
          <Toggle value={userTgrPush} onChange={() => setUserTgrPush(!userTgrPush)} />
        </div>

        <div className="mb-3">
          <label className={labelCls}>ID Partenaire Odoo</label>
          <input
            type="number"
            placeholder="Ex: 1251"
            value={userOdooId}
            onChange={e => setUserOdooId(e.target.value)}
            className={inputCls}
          />
          <p className="text-ink-faint text-xs mt-1">ID partenaire Odoo pour les devis TGR</p>
        </div>

        {isSuperAdmin && (
          <div>
            <label className={labelCls}>Nom TowSoft</label>
            <input
              type="text"
              placeholder="Ex: Mobi, FPalm, MLoslever…"
              value={userTowsoftName}
              onChange={e => setUserTowsoftName(e.target.value)}
              className={inputCls}
            />
            <p className="text-ink-faint text-xs mt-1">Nom exact dans la liste conducteurs TowSoft</p>
          </div>
        )}
      </div>

      {/* ── Modules ── */}
      <p className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">Modules accessibles</p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {modules.map((mod: any) => {
          const active = userModules.includes(mod.id)
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => setUserModules(prev => prev.includes(mod.id) ? prev.filter(m => m !== mod.id) : [...prev, mod.id])}
              className={`flex items-center gap-2 p-3 rounded-md border text-left transition-colors ${
                active ? 'border-brand bg-brand-soft' : 'hover:bg-surface-hover'
              }`}
            >
              <span className="text-lg" aria-hidden="true">{mod.icon}</span>
              <span className={`text-xs font-medium leading-tight ${active ? 'text-brand' : 'text-ink-secondary'}`}>
                {mod.label}
              </span>
              {active && <span className="ml-auto text-brand text-xs" aria-hidden="true">✓</span>}
            </button>
          )
        })}
      </div>

      <Button variant="primary" size="lg" fullWidth loading={saving} onClick={saveUser}>
        ✓ Sauvegarder
      </Button>
    </div>
  )

  return (
    <div className="lg:flex lg:gap-6">
      {/* ─── Liste ─── */}
      <div className={`${selectedUser ? 'hidden lg:block' : ''} lg:flex-1 px-4 py-5 lg:px-0 lg:pt-0`}>

        <div className="hidden lg:flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-ink text-2xl font-bold">Utilisateurs</h1>
            <p className="text-ink-muted text-sm mt-1">{users.length} utilisateurs · {users.filter(u => u.active).length} actifs</p>
          </div>
          <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowNewUser(!showNewUser)}>
            Ajouter un utilisateur
          </Button>
        </div>

        {/* Mobile : recherche + ajouter */}
        <div className="flex gap-2 mb-4 lg:hidden">
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={inputCls}
          />
          <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowNewUser(!showNewUser)}>
            Ajouter
          </Button>
        </div>

        {/* Desktop : recherche */}
        <div className="hidden lg:block mb-4">
          <input
            type="text"
            placeholder="Rechercher par nom, email, rôle…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Mobile : stats compactes */}
        <div className="flex gap-2 mb-4 lg:hidden">
          <div className="flex-1 bg-surface border rounded-card p-3 text-center">
            <p className="font-display text-ink font-bold text-xl">{users.length}</p>
            <p className="text-ink-muted text-xs">Total</p>
          </div>
          <div className="flex-1 bg-surface border rounded-card p-3 text-center">
            <p className="font-display text-ink font-bold text-xl">{users.filter(u => u.active).length}</p>
            <p className="text-ink-muted text-xs">Actifs</p>
          </div>
          <div className="flex-1 bg-surface border rounded-card p-3 text-center">
            <p className="font-display text-ink font-bold text-xl">{users.filter(u => u.role === 'driver').length}</p>
            <p className="text-ink-muted text-xs">Chauffeurs</p>
          </div>
        </div>

        {/* Form inline : nouvel utilisateur (accordion expandable) */}
        {showNewUser && (
          <div className="bg-surface border rounded-card shadow-card p-4 mb-4">
            <p className="font-display text-ink font-semibold mb-3">Nouvel utilisateur</p>
            <div className="flex flex-col gap-2">
              <input
                type="email"
                placeholder="Email professionnel *"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className={inputCls}
              />
              <input
                type="text"
                placeholder="Nom complet"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className={inputCls}
              />
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value)}
                className={`${inputCls} appearance-none capitalize`}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="flex gap-2 mt-1">
                <Button variant="ghost" fullWidth onClick={() => setShowNewUser(false)}>
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  fullWidth
                  disabled={!newEmail}
                  loading={creating}
                  onClick={createUser}
                >
                  Créer
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Liste mobile */}
        <div className="flex flex-col gap-2 lg:hidden">
          {filtered.map(user => {
            const moduleCount = user.user_modules?.filter((m: any) => m.granted).length || 0
            const roles       = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role]
            return (
              <button
                key={user.id}
                onClick={() => openUser(user)}
                className="bg-surface border rounded-card shadow-card p-4 flex items-center gap-3 text-left hover:shadow-md transition-all"
              >
                <Avatar
                  name={user.name || '?'}
                  userId={user.id}
                  email={user.email}
                  size="md"
                  className={user.active ? '' : 'opacity-60'}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-medium text-sm truncate">{user.name || 'Sans nom'}</p>
                  <p className="text-ink-muted text-xs truncate">{user.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <RoleBadges roles={roles} size="sm" />
                  <span className="text-ink-faint text-xs">{moduleCount} modules</span>
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-ink-muted">
              <p className="text-3xl mb-2" aria-hidden="true">👥</p>
              <p>Aucun utilisateur trouvé</p>
            </div>
          )}
        </div>

        {/* Tableau desktop */}
        <div className="hidden lg:block">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                {['Utilisateur', 'Email', 'Rôle(s)', 'Statut', 'Modules', 'Méthode', ''].map(h => (
                  <th key={h} className="text-left text-ink-muted text-xs font-semibold uppercase tracking-wider pb-3 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => {
                const moduleCount = user.user_modules?.filter((m: any) => m.granted).length || 0
                const roles       = Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : [user.role]
                return (
                  <tr
                    key={user.id}
                    onClick={() => openUser(user)}
                    className="border-b hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          name={user.name || '?'}
                          userId={user.id}
                          email={user.email}
                          size="sm"
                          className={user.active ? '' : 'opacity-60'}
                        />
                        <span className="text-ink text-sm font-medium truncate">{user.name || 'Sans nom'}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-ink-secondary text-sm">{user.email}</td>
                    <td className="py-3 pr-4">
                      <RoleBadges roles={roles} size="sm" />
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant={user.active ? 'success' : 'neutral'} size="sm">
                        {user.active ? 'Actif' : 'Inactif'}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-ink-muted text-sm">{moduleCount}</td>
                    <td className="py-3 pr-4 text-ink-muted text-sm">
                      {user.auth_provider === 'google' ? '🔵 Google' : user.auth_provider === 'microsoft' ? '🏢 Microsoft' : '✉️ Email/mdp'}
                    </td>
                    <td className="py-3">
                      <span className="text-brand text-xs font-semibold">Modifier →</span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-ink-muted">Aucun utilisateur trouvé</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Panel édition ─── */}
      {selectedUser && (
        <div className="lg:w-96 lg:flex-shrink-0 lg:border-l lg:pl-6">
          {renderEditPanel()}
        </div>
      )}

      {/* ─── Modal rôles ─── */}
      {showRoleModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={roleSaving ? undefined : () => setShowRoleModal(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="roles-modal-title"
            className="relative w-full max-w-sm bg-surface border rounded-card shadow-md"
          >
            <div className="px-5 pt-5 pb-2 flex items-center justify-between">
              <div className="min-w-0">
                <h2 id="roles-modal-title" className="font-display text-ink font-bold text-base">Modifier les rôles</h2>
                <p className="text-ink-muted text-xs mt-0.5 truncate">{selectedUser.name}</p>
              </div>
              <button
                onClick={() => setShowRoleModal(false)}
                aria-label="Fermer"
                disabled={roleSaving}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-3 flex flex-col gap-2">
              {ROLES.map(r => {
                const active = roleModalRoles.includes(r)
                const isPrimary = roleModalRoles[0] === r
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRoleModal(r)}
                    className={`flex items-center justify-between px-4 py-3 rounded-md border transition-colors ${
                      active ? 'border-brand bg-brand-soft' : 'hover:bg-surface-hover'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center text-xs flex-shrink-0 ${
                          active ? 'bg-brand border-brand text-ink' : ''
                        }`}
                      >
                        {active && <span aria-hidden="true">✓</span>}
                      </span>
                      <Badge variant={ROLE_BADGE_VARIANT[r] || 'neutral'} size="sm" className="capitalize">{r}</Badge>
                    </div>
                    {isPrimary && (
                      <span className="text-ink-muted text-xs">primaire</span>
                    )}
                  </button>
                )
              })}
            </div>

            <p className="px-5 pb-2 text-ink-faint text-xs">
              Rôle primaire : <span className="text-ink capitalize font-medium">{roleModalRoles[0] || '—'}</span>
              {' · '}
              {roleModalRoles.length} rôle{roleModalRoles.length > 1 ? 's' : ''} sélectionné{roleModalRoles.length > 1 ? 's' : ''}
            </p>

            {roleError && (
              <div className="mx-5 mb-3 bg-critical-soft text-critical rounded-md px-3 py-2 text-xs">
                {roleError}
              </div>
            )}

            <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowRoleModal(false)} disabled={roleSaving}>
                Annuler
              </Button>
              <Button variant="primary" loading={roleSaving} onClick={saveRoles}>
                Confirmer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
