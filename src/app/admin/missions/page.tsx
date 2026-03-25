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
}

const SOURCES = ['touring', 'ethias', 'vivium', 'axa', 'ardenne', 'mondial', 'vab', 'unknown']

export default function AdminMissionsPage() {
  const [senders,       setSenders]       = useState<Sender[]>([])
  const [errorMissions, setErrorMissions] = useState<ErrorMission[]>([])
  const [loading,       setLoading]       = useState(true)
  const [newPattern,    setNewPattern]    = useState('')
  const [newSource,     setNewSource]     = useState('touring')
  const [newLabel,      setNewLabel]      = useState('')
  const [saving,        setSaving]        = useState(false)
  const [activeTab,     setActiveTab]     = useState<'senders'|'errors'>('senders')

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
    vab: 'bg-yellow-600', unknown: 'bg-zinc-600',
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-white font-bold text-xl">Gestion des missions</h2>
        <p className="text-zinc-500 text-sm mt-1">Expéditeurs reconnus et missions en erreur</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('senders')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
            activeTab === 'senders' ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
          }`}>
          Expéditeurs ({senders.length})
        </button>
        <button onClick={() => setActiveTab('errors')}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-2 ${
            activeTab === 'errors' ? 'bg-brand text-white' : 'text-zinc-400 hover:text-white hover:bg-[#2a2a2a]'
          }`}>
          Erreurs & inconnus
          {errorMissions.length > 0 && (
            <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">
              {errorMissions.length}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="text-zinc-500 py-8 text-center">Chargement...</div>
      ) : activeTab === 'senders' ? (
        <>
          {/* Formulaire ajout */}
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-5">
            <h3 className="text-white font-semibold text-sm mb-4">Ajouter un expéditeur</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="text-zinc-500 text-xs mb-1.5 block">Pattern email</label>
                <input
                  value={newPattern}
                  onChange={e => setNewPattern(e.target.value)}
                  placeholder="ex: @touring.be ou sender@assureur.com"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-zinc-500 text-xs mb-1.5 block">Source</label>
                <select value={newSource} onChange={e => setNewSource(e.target.value)}
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand">
                  {SOURCES.filter(s => s !== 'unknown').map(s => (
                    <option key={s} value={s}>{s.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-zinc-500 text-xs mb-1.5 block">Label (optionnel)</label>
                <input
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  placeholder="Nom lisible"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-brand"
                />
              </div>
            </div>
            <button onClick={handleAdd} disabled={saving || !newPattern.trim()}
              className="mt-3 px-4 py-2.5 bg-brand hover:bg-brand-dark text-white rounded-xl text-sm font-medium transition disabled:opacity-50">
              {saving ? 'Ajout...' : '+ Ajouter'}
            </button>
          </div>

          {/* Liste expéditeurs */}
          <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-zinc-400 text-xs uppercase">
                  <th className="px-4 py-3 text-left font-medium">Pattern</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Label</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222]">
                {senders.map(s => (
                  <tr key={s.id} className="hover:bg-[#222]">
                    <td className="px-4 py-3 font-mono text-zinc-300 text-xs">{s.email_pattern}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${SOURCE_COLORS[s.source] || 'bg-zinc-600'}`}>
                        {s.source.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{s.label || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${s.active ? 'text-green-400' : 'text-zinc-500'}`}>
                        {s.active ? '● Actif' : '○ Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleToggle(s.id, s.active)}
                          className="px-2.5 py-1 bg-[#111] border border-[#2a2a2a] rounded-lg text-zinc-400 hover:text-white text-xs transition">
                          {s.active ? 'Désactiver' : 'Activer'}
                        </button>
                        <button onClick={() => handleDelete(s.id)}
                          className="px-2.5 py-1 bg-[#111] border border-[#2a2a2a] rounded-lg text-zinc-500 hover:text-red-400 text-xs transition">
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
        <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl overflow-hidden">
          {errorMissions.length === 0 ? (
            <div className="text-center py-12 text-zinc-500">
              <p className="text-3xl mb-3">✅</p>
              <p>Aucune mission en erreur</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-zinc-400 text-xs uppercase">
                  <th className="px-4 py-3 text-left font-medium">ID</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Format</th>
                  <th className="px-4 py-3 text-left font-medium">Statut</th>
                  <th className="px-4 py-3 text-left font-medium">Reçu</th>
                  <th className="px-4 py-3 text-left font-medium">Contenu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222]">
                {errorMissions.map(m => (
                  <tr key={m.id} className="hover:bg-[#222]">
                    <td className="px-4 py-3 font-mono text-zinc-300 text-xs">{m.external_id}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${SOURCE_COLORS[m.source] || 'bg-zinc-600'}`}>
                        {m.source.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs uppercase">{m.source_format}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${m.status === 'parse_error' ? 'text-red-400' : 'text-yellow-400'}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {new Date(m.received_at).toLocaleString('fr-BE')}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs max-w-xs truncate">
                      {m.raw_content?.slice(0, 80) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
