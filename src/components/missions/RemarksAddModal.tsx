'use client'

// Modal unique d'AJOUT de remarque, avec sélecteur de type. Centralise la saisie
// des 3 types (Générale, Facturation, Instruction chauffeur) qui restent affichés
// en lecture dans la fiche. Pièces jointes uniquement pour « Générale ».
// Olivier 2026-07-10.

import { useRef, useState } from 'react'
import ScanToFicheButton from '@/components/missions/ScanToFicheButton'

type RemarkType = 'general' | 'billing' | 'driver'

const TYPES: { key: RemarkType; label: string; emoji: string; hint: string }[] = [
  { key: 'general', label: 'Remarque générale',    emoji: '💬', hint: 'Note interne dispatch (pièces jointes possibles).' },
  { key: 'billing', label: 'Remarque facturation', emoji: '📝', hint: 'Rappelée + bloquante à la facturation.' },
  { key: 'driver',  label: 'Instruction chauffeur', emoji: '📋', hint: 'Pop-up à l\'acceptation de la mission par le chauffeur.' },
]

const fmtSize = (b: number) => b < 1024 ? `${b} o` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} Ko` : `${(b / 1024 / 1024).toFixed(1)} Mo`

export default function RemarksAddModal({
  missionId, onClose, onAdded, defaultType = 'general',
}: {
  missionId: string
  onClose: () => void
  onAdded: (type: RemarkType) => void
  defaultType?: RemarkType
}) {
  const [type, setType]   = useState<RemarkType>(defaultType)
  const [text, setText]   = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async () => {
    const t = text.trim()
    if (!t) { setError('Texte requis'); return }
    setBusy(true); setError(null)
    try {
      let res: Response
      if (type === 'general') {
        const fd = new FormData()
        fd.append('text', t)
        for (const f of files) fd.append('files', f)
        res = await fetch(`/api/missions/${missionId}/remarks`, { method: 'POST', body: fd })
      } else {
        const url = type === 'billing'
          ? `/api/missions/${missionId}/billing-remarks`
          : `/api/missions/${missionId}/driver-instructions`
        res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: t }),
        })
      }
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Erreur'); return }
      onAdded(type)
      // reset (on reste ouvert pour enchaîner une autre remarque si besoin)
      setText(''); setFiles([])
    } catch (e: any) { setError(e.message || 'Erreur réseau') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4">
      <div className="bg-surface w-full max-w-lg rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-ink font-bold text-base">➕ Ajouter une remarque</h3>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none">×</button>
        </div>

        {/* Sélecteur de type */}
        <div className="grid grid-cols-3 gap-2">
          {TYPES.map(ty => (
            <button key={ty.key} onClick={() => setType(ty.key)}
              className={`rounded-xl px-2 py-2.5 text-center border transition ${
                type === ty.key ? 'bg-brand/15 border-brand text-ink' : 'bg-surface-2 border text-ink-secondary hover:border-zinc-500'
              }`}>
              <div className="text-lg">{ty.emoji}</div>
              <div className="text-[11px] font-medium leading-tight mt-0.5">{ty.label}</div>
            </button>
          ))}
        </div>
        <p className="text-ink-faint text-xs -mt-1">{TYPES.find(t => t.key === type)!.hint}</p>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          autoFocus
          placeholder={type === 'driver'
            ? "Ex : appeler le client 10 min avant · vérifier immatriculation + VIN"
            : 'Tape la remarque…'}
          className="w-full bg-surface-2 border rounded-lg px-3 py-2 text-ink text-sm outline-none focus:border-brand resize-y"
        />

        {/* Pièces jointes — uniquement pour la remarque générale */}
        {type === 'general' && (
          <div>
            <input ref={fileInput} type="file" multiple className="hidden"
              onChange={e => setFiles(Array.from(e.target.files || []))} />
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => fileInput.current?.click()} className="text-xs text-ink-faint hover:text-brand">
                📎 Ajouter des pièces jointes
              </button>
              {/* Scanner directement sur l'imprimante réseau (PC équipé de
                  l'agent). Le scan rejoint la liste des pièces jointes : c'est
                  « Enregistrer » qui envoie. Olivier 2026-08-19. */}
              <ScanToFicheButton onScanned={fs => setFiles(prev => [...prev, ...fs])} />
            </div>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-ink-secondary">
                    <span className="truncate">📎 {f.name}</span>
                    <span className="text-ink-faint flex-shrink-0">{fmtSize(f.size)}</span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-ink-faint hover:text-critical">✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-red-400 text-xs">⚠ {error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 bg-surface-hover text-ink-secondary rounded-lg text-sm">
            Fermer
          </button>
          <button onClick={submit} disabled={busy || !text.trim()}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? '⏳…' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}
