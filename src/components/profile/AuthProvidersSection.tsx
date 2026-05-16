'use client'
// src/components/profile/AuthProvidersSection.tsx
//
// Section "Methodes de connexion" affichee dans /profil.
// Liste les 4 providers (Microsoft, Google, Apple, Email/MDP) avec leur etat
// lie/non-lie + actions Lier / Dissocier / Definir mot de passe.

import { useEffect, useState } from 'react'

type ProviderKey = 'apple' | 'google' | 'azure-ad' | 'credentials'

interface ProviderState {
  provider:       ProviderKey
  linked:         boolean
  link_id:        string | null
  provider_email: string | null
  linked_at:      string | null
}

const META: Record<ProviderKey, { label: string; subtitle: string; icon: React.ReactNode; supportsLink: boolean }> = {
  'azure-ad': {
    label:    'Microsoft Azure AD',
    subtitle: 'Compte professionnel Microsoft 365',
    icon: (
      <svg width="20" height="20" viewBox="0 0 21 21" className="flex-shrink-0">
        <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
        <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
        <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
        <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
      </svg>
    ),
    supportsLink: true,
  },
  google: {
    label:    'Google',
    subtitle: 'Compte Google personnel ou Workspace',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" className="flex-shrink-0">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
    supportsLink: true,
  },
  apple: {
    label:    'Apple',
    subtitle: 'Sign in with Apple ID',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
      </svg>
    ),
    supportsLink: true,
  },
  credentials: {
    label:    'Email & mot de passe',
    subtitle: 'Identifiants classiques (utile en backup)',
    icon: <span className="text-xl">🔑</span>,
    supportsLink: false,  // gere via le formulaire mot de passe
  },
}

export default function AuthProvidersSection() {
  const [list,    setList]    = useState<ProviderState[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')
  const [info,    setInfo]    = useState('')
  const [pwdModalOpen, setPwdModalOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/profile/auth-providers')
      const j = await r.json()
      setList(j.providers || [])
    } catch (e: any) {
      setErr(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
    // Detect le retour de linking (callbackUrl=/profil?linked=apple)
    const url = new URL(window.location.href)
    const linked = url.searchParams.get('linked')
    const error  = url.searchParams.get('error')
    if (linked) {
      setInfo(`✅ ${META[linked as ProviderKey]?.label || linked} lié avec succès`)
      url.searchParams.delete('linked')
      window.history.replaceState(null, '', url.pathname + (url.search || ''))
      setTimeout(() => setInfo(''), 5000)
    }
    if (error === 'PROVIDER_ALREADY_LINKED_OTHER_USER') {
      setErr('Ce compte est déjà lié à un autre utilisateur. Dissocie-le là-bas avant de le lier ici.')
      url.searchParams.delete('error')
      window.history.replaceState(null, '', url.pathname + (url.search || ''))
    }
  }, [])

  const handleLink = async (provider: ProviderKey) => {
    if (provider === 'credentials') {
      setPwdModalOpen(true)
      return
    }
    try {
      const r = await fetch('/api/profile/auth-providers/start-link', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ provider }),
      })
      const j = await r.json()
      if (!r.ok || !j.redirect_to) {
        setErr(j.error || 'Impossible de démarrer la liaison')
        return
      }
      window.location.href = j.redirect_to
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    }
  }

  const handleUnlink = async (state: ProviderState) => {
    if (state.provider === 'credentials') {
      if (!confirm('Retirer le mot de passe ? Tu ne pourras plus te connecter avec email/mdp.')) return
      try {
        const r = await fetch('/api/profile/password', { method: 'DELETE' })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Erreur')
        load()
      } catch (e: any) { setErr(e.message || 'Erreur') }
      return
    }
    if (!state.link_id) return
    if (!confirm(`Dissocier ${META[state.provider].label} de ton compte ?`)) return
    try {
      const r = await fetch(`/api/profile/auth-providers/${state.link_id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      load()
    } catch (e: any) { setErr(e.message || 'Erreur') }
  }

  return (
    <div className="bg-surface border rounded-2xl p-5 space-y-4">
      <div>
        <h3 className="font-display text-ink font-bold text-lg">Méthodes de connexion</h3>
        <p className="text-ink-muted text-sm mt-0.5">
          Lie plusieurs méthodes pour pouvoir te connecter avec celle que tu veux.
        </p>
      </div>

      {info && <p className="text-success text-sm bg-success-soft border border-success/30 rounded-lg px-3 py-2">{info}</p>}
      {err  && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">⚠️ {err}</p>}

      {loading && <p className="text-ink-muted text-sm">Chargement…</p>}

      {!loading && (
        <div className="space-y-2">
          {(['azure-ad', 'google', 'apple', 'credentials'] as ProviderKey[]).map(key => {
            const state = list.find(l => l.provider === key) || { provider: key, linked: false, link_id: null, provider_email: null, linked_at: null }
            const meta = META[key]
            return (
              <div key={key} className={`flex items-center gap-3 p-3 rounded-xl border transition ${state.linked ? 'bg-success-soft border-success/30' : 'bg-surface border'}`}>
                <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0">
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-ink font-medium text-sm">{meta.label}</p>
                  <p className="text-ink-muted text-xs mt-0.5">
                    {state.linked
                      ? (state.provider_email ? `Lié avec ${state.provider_email}` : 'Lié')
                      : meta.subtitle}
                  </p>
                </div>
                {state.linked ? (
                  <button onClick={() => handleUnlink(state)}
                    className="px-3 py-1.5 bg-critical-soft hover:bg-critical/15 text-critical rounded-lg text-xs font-medium whitespace-nowrap transition">
                    Dissocier
                  </button>
                ) : (
                  <button onClick={() => handleLink(key)}
                    className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold whitespace-nowrap transition">
                    {key === 'credentials' ? 'Définir un mot de passe' : 'Lier'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pwdModalOpen && <PasswordModal onClose={() => setPwdModalOpen(false)} onSaved={() => { setPwdModalOpen(false); load() }} hasPasswordAlready={list.find(l => l.provider === 'credentials')?.linked || false} />}
    </div>
  )
}

function PasswordModal({ onClose, onSaved, hasPasswordAlready }: {
  onClose: () => void
  onSaved: () => void
  hasPasswordAlready: boolean
}) {
  const [current, setCurrent] = useState('')
  const [pwd, setPwd]         = useState('')
  const [pwd2, setPwd2]       = useState('')
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const save = async () => {
    if (pwd.length < 8) { setErr('Au moins 8 caractères'); return }
    if (pwd !== pwd2)   { setErr('Les mots de passe ne correspondent pas'); return }
    if (hasPasswordAlready && !current) { setErr('Mot de passe actuel requis'); return }
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/profile/password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ current_password: current, new_password: pwd }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      onSaved()
    } catch (e: any) {
      setErr(e.message || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface border rounded-lg px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft transition'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-md rounded-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <p className="text-ink font-semibold text-lg">{hasPasswordAlready ? 'Modifier le mot de passe' : 'Définir un mot de passe'}</p>
          <p className="text-ink-muted text-xs mt-0.5">{hasPasswordAlready ? 'Saisis ton mot de passe actuel pour confirmer.' : 'Tu pourras te connecter avec ton email + ce mot de passe.'}</p>
        </div>
        {hasPasswordAlready && (
          <div>
            <p className="text-ink-secondary text-xs mb-1.5">Mot de passe actuel</p>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} className={inputCls} />
          </div>
        )}
        <div>
          <p className="text-ink-secondary text-xs mb-1.5">Nouveau mot de passe <span className="text-ink-faint">(8 chars min)</span></p>
          <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} className={inputCls} />
        </div>
        <div>
          <p className="text-ink-secondary text-xs mb-1.5">Confirmer</p>
          <input type="password" value={pwd2} onChange={e => setPwd2(e.target.value)} className={inputCls} />
        </div>
        {err && <p className="text-red-400 text-xs">⚠️ {err}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 bg-surface-hover text-ink-secondary rounded-lg text-sm">Annuler</button>
          <button onClick={save} disabled={saving || pwd.length < 8 || pwd !== pwd2}
            className="flex-1 py-2.5 bg-brand disabled:opacity-50 text-white rounded-lg text-sm font-semibold">
            {saving ? '⏳…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
