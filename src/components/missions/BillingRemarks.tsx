'use client'

// src/components/missions/BillingRemarks.tsx
//
// Remarques de FACTURATION d'une mission — même principe que MissionRemarks
// (plusieurs remarques, chacune signée + datée, add/edit/delete) mais dédiées à
// la facturation. Thème gris foncé (blanc sur fond gris). Sans pièces jointes.
// Rappelées en haut de la fiche (bandeau) et affichées + bloquées à la
// facturation. Olivier 2026-07-07.

import { useState, useEffect, useCallback } from 'react'

interface Author { id: string; name: string | null; email: string | null }
export interface BillingRemark {
  id:           string
  text:         string
  created_at:   string
  updated_at:   string | null
  edit_history: Array<{ at: string; by: string; old_text: string }>
  author:       Author | null
  editor:       Author | null
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-BE', {
      day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

interface Props {
  missionId:     string
  currentUserId?: string
  isSuperadmin?: boolean
  /** Ancienne remarque (champ remarks_billing) des fiches créées avant le système
      multi-remarques → affichée en lecture seule (« initiale »). */
  legacyRemark?: string | null
  /** Rappelé avec le nombre de remarques (pour le bandeau parent). */
  onCountChange?: (n: number) => void
}

export default function BillingRemarks({ missionId, currentUserId, isSuperadmin, legacyRemark, onCountChange }: Props) {
  const legacy = (legacyRemark || '').trim()
  const [remarks, setRemarks] = useState<BillingRemark[]>([])
  const [loading, setLoading] = useState(true)
  const [newText, setNewText] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [legacyHidden, setLegacyHidden] = useState(false)

  // Rapporte le total (remarques + éventuelle remarque « initiale ») au parent.
  useEffect(() => {
    onCountChange?.(remarks.length + (legacy && !legacyHidden ? 1 : 0))
  }, [remarks, legacy, legacyHidden, onCountChange])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/missions/${missionId}/billing-remarks`)
      const j = await res.json()
      if (res.ok) setRemarks(j.remarks || [])
    } catch { /* silencieux */ } finally { setLoading(false) }
  }, [missionId])

  useEffect(() => { load() }, [load])

  async function add() {
    const text = newText.trim()
    if (!text) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/missions/${missionId}/billing-remarks`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      setNewText('')
      setRemarks([j.remark, ...remarks])
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setSaving(false) }
  }

  async function saveEdit(id: string) {
    const text = editingText.trim()
    if (!text) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/missions/billing-remarks/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      setRemarks(prev => prev.map(r => r.id === id ? j.remark : r))
      setEditingId(null); setEditingText('')
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Supprimer cette remarque de facturation ?')) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/missions/billing-remarks/${id}`, { method: 'DELETE' })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      setRemarks(remarks.filter(r => r.id !== id))
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setSaving(false) }
  }

  // Suppression de l'ancienne remarque « initiale » (champ remarks_billing) : on
  // vide la colonne via le PATCH mission. Olivier 2026-07-07.
  async function removeLegacy() {
    if (!confirm('Supprimer cette remarque de facturation ?')) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/missions/${missionId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ remarks_billing: '' }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || 'Erreur'); return }
      setLegacyHidden(true)
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setSaving(false) }
  }

  const canManage = (r: BillingRemark) =>
    isSuperadmin || (currentUserId && r.author?.id === currentUserId)

  return (
    <div id="billing-remark-card" className="bg-slate-800 rounded-xl p-4 shadow ring-1 ring-slate-600 scroll-mt-24">
      <p className="flex items-center gap-2 text-slate-300 text-xs font-bold uppercase tracking-widest mb-3">
        <span>📝</span> Remarques de facturation
      </p>

      {error && <p className="text-rose-300 text-xs mb-2">⚠ {error}</p>}

      {/* Ajout */}
      <div className="mb-3">
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          rows={2}
          placeholder="Ajouter une remarque de facturation (ex. facturer 2 dépannages ensemble, bon de commande à joindre, tarif dérogatoire convenu…)"
          className="w-full bg-slate-900 text-white placeholder:text-slate-500 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y"
        />
        <div className="flex justify-end mt-1.5">
          <button
            type="button"
            onClick={add}
            disabled={saving || !newText.trim()}
            className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition"
          >
            {saving ? '⏳…' : '+ Ajouter'}
          </button>
        </div>
      </div>

      {/* Liste */}
      {loading ? (
        <p className="text-slate-400 text-xs">Chargement…</p>
      ) : remarks.length === 0 && !(legacy && !legacyHidden) ? (
        <p className="text-slate-500 text-xs italic">Aucune remarque de facturation.</p>
      ) : (
        <div className="space-y-2">
          {/* Ancienne remarque (créée avant le système multi-remarques) — supprimable. */}
          {legacy && !legacyHidden && (
            <div className="bg-slate-900 rounded-lg p-3 ring-1 ring-slate-700">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-slate-400 text-[11px] italic">Remarque initiale (à la création)</p>
                <button type="button" onClick={removeLegacy} disabled={saving}
                  className="text-slate-400 hover:text-rose-400 text-xs px-1 disabled:opacity-40" title="Supprimer">🗑️</button>
              </div>
              <p className="text-white text-sm font-medium whitespace-pre-line leading-snug">{legacy}</p>
            </div>
          )}
          {remarks.map(r => (
            <div key={r.id} className="bg-slate-900 rounded-lg p-3 ring-1 ring-slate-700">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-slate-400 text-[11px]">
                  <span className="font-semibold text-slate-300">{r.author?.name || r.author?.email || 'Inconnu'}</span>
                  {' · '}{fmtDate(r.created_at)}
                  {r.updated_at && <span className="italic"> · modifiée {r.editor?.name ? `par ${r.editor.name}` : ''}</span>}
                </p>
                {canManage(r) && editingId !== r.id && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button type="button" onClick={() => { setEditingId(r.id); setEditingText(r.text) }}
                      className="text-slate-400 hover:text-white text-xs px-1" title="Modifier">✏️</button>
                    <button type="button" onClick={() => remove(r.id)}
                      className="text-slate-400 hover:text-rose-400 text-xs px-1" title="Supprimer">🗑️</button>
                  </div>
                )}
              </div>
              {editingId === r.id ? (
                <div>
                  <textarea
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-800 text-white border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-y"
                  />
                  <div className="flex justify-end gap-2 mt-1.5">
                    <button type="button" onClick={() => { setEditingId(null); setEditingText('') }}
                      className="px-2.5 py-1 text-slate-300 hover:text-white text-xs transition">Annuler</button>
                    <button type="button" onClick={() => saveEdit(r.id)} disabled={saving || !editingText.trim()}
                      className="px-2.5 py-1 bg-slate-600 hover:bg-slate-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition">Enregistrer</button>
                  </div>
                </div>
              ) : (
                <p className="text-white text-sm font-medium whitespace-pre-line leading-snug">{r.text}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
