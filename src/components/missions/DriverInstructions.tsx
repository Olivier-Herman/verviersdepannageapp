'use client'

// Instructions chauffeur (dispatch) : commentaires libres qui s'affichent en
// pop-up quand le chauffeur ACCEPTE la mission. Chaque ligne montre le statut
// d'accusé (heure du « OK » chauffeur). Olivier 2026-07-10.
// Calqué sur BillingRemarks.

import { useEffect, useState, useCallback } from 'react'

interface Instruction {
  id: string
  text: string
  created_at: string
  acknowledged_at: string | null
  author?:  { id: string; name: string | null } | null
  ackuser?: { id: string; name: string | null } | null
}

interface Props {
  missionId: string
  onCountChange?: (n: number) => void
}

const fmt = (s: string | null) => {
  if (!s) return ''
  try {
    return new Date(s).toLocaleString('fr-BE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

export default function DriverInstructions({ missionId, onCountChange }: Props) {
  const [list, setList]       = useState<Instruction[]>([])
  const [text, setText]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/missions/${missionId}/driver-instructions`)
      const j = await r.json()
      if (j.ok) { setList(j.instructions || []); onCountChange?.((j.instructions || []).length) }
    } catch { /* silencieux */ }
  }, [missionId, onCountChange])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/driver-instructions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t }),
      })
      const j = await r.json()
      if (!r.ok) { setError(j.error || 'Erreur'); return }
      setText('')
      setList(prev => { const next = [...prev, j.instruction]; onCountChange?.(next.length); return next })
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    if (!confirm('Supprimer cette instruction chauffeur ?')) return
    try {
      const r = await fetch(`/api/missions/driver-instructions/${id}`, { method: 'DELETE' })
      if (r.ok) setList(prev => { const next = prev.filter(x => x.id !== id); onCountChange?.(next.length); return next })
    } catch { /* silencieux */ }
  }

  return (
    <div id="driver-instructions-card" className="bg-sky-950/40 rounded-xl p-4 shadow ring-1 ring-sky-700/50">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">📋</span>
        <h3 className="text-sky-200 font-bold text-sm">Instructions chauffeur</h3>
        <span className="text-sky-400/70 text-xs">(pop-up à l'acceptation)</span>
      </div>

      {/* Ajout */}
      <div className="flex gap-2 mb-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add() }}
          rows={2}
          placeholder="Ex : appeler le client 10 min avant d'arriver · vérifier immatriculation + VIN…"
          className="flex-1 bg-sky-950/60 border border-sky-700/50 focus:border-sky-500 rounded-lg px-3 py-2 text-sky-50 text-sm outline-none resize-none placeholder:text-sky-400/40"
        />
        <button onClick={add} disabled={busy || !text.trim()}
          className="px-3 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold self-stretch whitespace-nowrap">
          Ajouter
        </button>
      </div>
      {error && <p className="text-red-400 text-xs mb-2">⚠️ {error}</p>}

      {/* Liste */}
      {list.length === 0 ? (
        <p className="text-sky-400/50 text-xs italic">Aucune instruction. Le chauffeur ne verra pas de pop-up.</p>
      ) : (
        <div className="space-y-2">
          {list.map(it => (
            <div key={it.id} className="bg-sky-950/70 rounded-lg p-3 ring-1 ring-sky-800/60">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sky-50 text-sm whitespace-pre-line leading-snug flex-1">{it.text}</p>
                <button onClick={() => remove(it.id)} title="Supprimer"
                  className="text-sky-400/60 hover:text-red-400 text-sm flex-shrink-0">🗑️</button>
              </div>
              <div className="flex items-center gap-2 mt-2 text-[11px]">
                {it.acknowledged_at ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-600/20 text-green-300 border border-green-600/30 font-medium">
                    ✓ Vu le {fmt(it.acknowledged_at)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-300 border border-amber-600/30 font-medium">
                    ⏳ En attente d'accusé
                  </span>
                )}
                {it.author?.name && <span className="text-sky-400/50">· {it.author.name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
