// src/app/admin/missions/page.tsx
'use client'

import { useState, useEffect } from 'react'

interface Sender {
  id: string
  email_pattern: string
  source: string
  label: string | null
  active: boolean
  created_at: string
}

interface ErrorMission {
  id: string
  external_id: string
  source: string
  source_format: string
  status: string
  received_at: string
  raw_content: string | null
  sender_email: string | null
}

const SOURCES = ['touring', 'ethias', 'vivium', 'axa', 'ardenne', 'mondial', 'aginsurance', 'vab', 'police', 'prive', 'garage', 'unknown']

export default function AdminMissionsPage() {
  const [senders,       setSenders]       = useState<Sender[]>([])
  const [errorMissions, setErrorMissions] = useState<ErrorMission[]>([])
  const [loading,       setLoading]       = useState(true)
  const [newPattern,    setNewPattern]    = useState('')
  const [newSource,     setNewSource]     = useState('touring')
  const [newLabel,      setNewLabel]      = useState('')
  const [saving,        setSaving]        = useState(false)
  const [activeTab,     setActiveTab]     = useState<'senders'|'errors'>('senders')
  const [linkTarget,    setLinkTarget]    = useState<ErrorMission | null>(null)
  const [linkSource,    setLinkSource]    = useState('touring')
  const [linkLoading,   setLinkLoading]   = useState(false)

  async function handleLinkSource() {
    if (!linkTarget?.sender_email) return
    setLinkLoading(true)
    try {
      const res = await fetch('/api/admin/missions/link-source', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sender_email: linkTarget.sender_email, source: linkSource })
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || `Erreur ${res.status}`)
      setLinkTarget(null)
      await load()
      alert(`✓ Expéditeur ${j.pattern} lié à ${linkSource.toUpperCase()}. ${j.deleted} mission(s) UNKNOWN supprimée(s). Les prochains mails de cet expéditeur seront parsés automatiquement.`)
    } catch (e: any) {
      alert(`Erreur : ${e.message}`)
    } finally {
      setLinkLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [sendersRes, errorsRes] = await Promise.all([
        fetch('/api/admin/missions/senders'),
        fetch('/api/admin/missions/errors'),
      ])
      const sendersData = await sendersRes.json()
      const errorsData  = await errorsRes.json()
      setSenders(sendersData.senders || [])
      setErrorMissions(errorsData.missions || [])
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!newPattern.trim()) return
    setSaving(true)
    await fetch('/api/admin/missions/senders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email_pattern: newPattern.trim(), source: newSource, label: newLabel.trim() || null })
    })
    setNewPattern('')
    setNewLabel('')
    await load()
    setSaving(false)
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch('/api/admin/missions/senders', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, active: !active })
    })
    await load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cet expéditeur ?')) return
    await fetch('/api/admin/missions/senders', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id })
    })
    await load()
  }

  const SOURCE_COLORS: Record<string, string> = {
    touring: 'bg-blue-600',  ethias: 'bg-green-600', vivium: 'bg-purple-600',
    axa: 'bg-red-600', ardenne: 'bg-orange-600', mondial: 'bg-teal-600',
    aginsurance: 'bg-indigo-600',
    vab: 'bg-yellow-600', police: 'bg-blue-900', prive: 'bg-zinc-700',
    garage: 'bg-amber-700', unknown: 'bg-zinc-600',
  }

  return (
    <>
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-ink font-bold text-xl">Gestion des missions</h2>
        <p className="text-ink-muted text-sm mt-1">Expéditeurs reconnus et missions en erreur</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('senders')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
            activeTab === 'senders' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-hover'
          }`}>
          Expéditeurs ({senders.length})
        </button>
        <button onClick={() => setActiveTab('errors')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-2 ${
            activeTab === 'errors' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-hover'
          }`}>
          Erreurs & inconnus
          {errorMissions.length > 0 && (
            <span className="bg-red-500 text-ink text-xs px-1.5 py-0.5 rounded-full font-bold">
              {errorMissions.length}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="text-ink-muted py-8 text-center">Chargement...</div>
      ) : activeTab === 'senders' ? (
        <>
          {/* Formulaire ajout */}
          <div className="bg-surface-2 border border rounded-2xl p-5">
            <h3 className="text-ink font-semibold text-sm mb-4">Ajouter un expéditeur</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="text-ink-muted text-xs mb-1.5 block">Pattern email</label>
                <input
                  value={newPattern}
                  onChange={e => setNewPattern(e.target.value)}
                  placeholder="ex: @touring.be ou sender@assureur.com"
                  className="w-full bg-surface border border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-ink-muted text-xs mb-1.5 block">Source</label>
                <select value={newSource} onChange={e => setNewSource(e.target.value)}
                  className="w-full bg-surface border border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand">
                  {SOURCES.filter(s => s !== 'unknown').map(s => (
                    <option key={s} value={s}>{s.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-ink-muted text-xs mb-1.5 block">Label (optionnel)</label>
                <input
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="Nom lisible"
                  className="w-full bg-surface border border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand"
                />
              </div>
            </div>
            <button onClick={handleAdd} disabled={saving || !newPattern.trim()}
              className="mt-3 px-4 py-2.5 bg-brand hover:bg-brand-dark text-ink rounded-xl text-sm font-medium transition disabled:opacity-50">
              {saving ? 'Ajout...' : '+ Ajouter'}
            </button>
          </div>

          {/* Liste expéditeurs */}
          <div className="bg-surface-2 border border rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border text-ink-muted text-xs uppercase">
                  <th className="px-4 py-3 text-left font-medium">Pattern</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Label</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222]">
                {senders.map(s => (
                  <tr key={s.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 font-mono text-ink-secondary text-xs">{s.email_pattern}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold text-ink ${SOURCE_COLORS[s.source] || 'bg-zinc-600'}`}>
                        {s.source.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">{s.label || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${s.active ? 'text-success' : 'text-ink-muted'}`}>
                        {s.active ? '● Actif' : '○ Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleToggle(s.id, s.active)}
                          className="px-2.5 py-1 bg-surface border border rounded-lg text-ink-muted hover:text-ink text-xs transition">
                          {s.active ? 'Désactiver' : 'Activer'}
                        </button>
                        <button onClick={() => handleDelete(s.id)}
                          className="px-2.5 py-1 bg-surface border border rounded-lg text-ink-muted hover:text-critical text-xs transition">
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Tab erreurs */
        <div className="bg-surface-2 border border rounded-2xl overflow-hidden">
          {errorMissions.length === 0 ? (
            <div className="text-center py-12 text-ink-muted">
              <p className="text-3xl mb-3">✅</p>
              <p>Aucune mission en erreur</p>
            </div>
          ) : (
            <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border text-ink-muted text-xs uppercase">
                  <th className="px-4 py-3 text-left font-medium">ID</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Expéditeur</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-left font-medium">Reçu</th>
                  <th className="px-4 py-3 text-left font-medium">Contenu</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222]">
                {errorMissions.map(m => (
                  <tr key={m.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 font-mono text-ink-secondary text-xs">{m.external_id}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold text-ink ${SOURCE_COLORS[m.source] || 'bg-zinc-600'}`}>
                        {m.source.toUpperCase()}
                      </span>
                      <div className="text-ink-faint text-[10px] mt-1 uppercase">{m.source_format}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-secondary text-xs">
                      {m.sender_email || <span className="text-ink-muted italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${m.status === 'parse_error' ? 'text-critical' : 'text-warning'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs">
                      {new Date(m.received_at).toLocaleString('fr-BE')}
                    </td>
                    <td className="px-4 py-3 text-ink-muted text-xs max-w-xs truncate">
                      {m.raw_content?.slice(0, 80) || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {m.sender_email && m.source === 'unknown' ? (
                        <button
                          onClick={() => { setLinkTarget(m); setLinkSource('touring') }}
                          className="px-2.5 py-1 bg-brand hover:bg-brand-dark text-white rounded-lg text-xs font-medium transition whitespace-nowrap"
                        >
                          🔗 Lier à une source
                        </button>
                      ) : <span className="text-ink-faint text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Modal "Lier à une source" */}
            {linkTarget && (
              <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                   onClick={!linkLoading ? () => setLinkTarget(null) : undefined}>
                <div onClick={e => e.stopPropagation()}
                     className="bg-surface border rounded-2xl max-w-md w-full p-5 shadow-2xl">
                  <h3 className="text-ink font-bold text-lg mb-1">🔗 Lier à une source</h3>
                  <p className="text-ink-muted text-sm mb-4">
                    Tous les futurs mails de <code className="text-ink-secondary bg-surface-2 px-1.5 py-0.5 rounded">{linkTarget.sender_email}</code> seront automatiquement classés comme cette source. Les missions UNKNOWN existantes de cet expéditeur seront supprimées.
                  </p>
                  <label className="text-ink-muted text-xs mb-1.5 block">Source à associer</label>
                  <select value={linkSource} onChange={e => setLinkSource(e.target.value)}
                          disabled={linkLoading}
                          className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm mb-5">
                    {SOURCES.filter(s => s !== 'unknown').map(s => (
                      <option key={s} value={s}>{s.toUpperCase()}</option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setLinkTarget(null)} disabled={linkLoading}
                            className="px-3 py-2 text-ink-secondary hover:text-ink text-sm">
                      Annuler
                    </button>
                    <button onClick={handleLinkSource} disabled={linkLoading}
                            className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl font-semibold text-sm disabled:opacity-50">
                      {linkLoading ? 'Lien en cours…' : 'Confirmer'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      )}
    </div>
    </>
  )
}
