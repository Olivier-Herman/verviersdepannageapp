'use client'

// src/components/missions/OfficerAutocomplete.tsx
//
// Champ "Nom du policier" avec autocomplete des contacts (agents) de la société
// Odoo de la zone de police (companyId). Texte libre conservé si rien ne
// correspond ; on ne crée JAMAIS de contact Odoo. Olivier 2026-06-14.
//
// Utilisé par : la création mission Police (PoliceClient) et la fiche dispatch
// (MissionDetailClient).

import { useEffect, useRef, useState } from 'react'

export default function OfficerAutocomplete({ label, value, onChange, onPickPartner, companyId }: {
  label:          string
  value:          string
  onChange:       (v: string) => void
  onPickPartner:  (id: number | null) => void
  companyId:      number | null
}) {
  const [open, setOpen]       = useState(false)
  const [agents, setAgents]   = useState<Array<{ id: number; name: string; phone?: string; function?: string }>>([])
  const [loading, setLoading] = useState(false)
  const tRef   = useRef<any>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!companyId || value.trim().length === 0) { setAgents([]); return }
    if (tRef.current) clearTimeout(tRef.current)
    tRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/odoo/zone-agents?company_id=${companyId}&q=${encodeURIComponent(value)}`)
        const j = await r.json()
        setAgents(Array.isArray(j.agents) ? j.agents : [])
      } catch { setAgents([]) } finally { setLoading(false) }
    }, 300)
    return () => { if (tRef.current) clearTimeout(tRef.current) }
  }, [value, companyId])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const showDrop = open && !!companyId && value.trim().length > 0
  return (
    <div ref={boxRef} className="relative">
      <label className="block text-ink-secondary text-xs font-medium mb-1">{label}</label>
      <input
        type="text" value={value}
        onChange={e => { onChange(e.target.value); onPickPartner(null); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={companyId ? 'Nom de l’agent — suggestions de la zone' : 'Nom du policier'}
        className="w-full bg-surface border border-strong rounded-xl px-3 py-2.5 text-ink text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft"
      />
      {showDrop && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-surface border border-strong rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-ink-muted text-xs">⏳ Recherche…</div>}
          {!loading && agents.map(a => (
            <button key={a.id} type="button"
              onClick={() => { onChange(a.name); onPickPartner(a.id); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-surface-hover text-sm text-ink border-b last:border-b-0">
              {a.name}
              {a.function ? <span className="text-ink-muted text-xs"> · {a.function}</span> : ''}
              {a.phone ? <span className="text-ink-faint text-xs"> · {a.phone}</span> : ''}
            </button>
          ))}
          {!loading && agents.length === 0 && (
            <div className="px-3 py-2 text-ink-muted text-xs">Aucun contact — la saisie sera conservée.</div>
          )}
        </div>
      )}
      {companyId
        ? <p className="text-ink-faint text-[10px] mt-1">Suggestions = contacts Odoo de la zone. Si rien ne correspond, la saisie est conservée.</p>
        : null}
    </div>
  )
}
