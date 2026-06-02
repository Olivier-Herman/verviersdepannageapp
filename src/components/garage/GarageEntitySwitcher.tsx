'use client'

// Badge entite courant + dropdown pour switcher. Affiche en haut de toutes
// les pages /garage. Olivier 2026-06-02.

import { useEffect, useState, useCallback } from 'react'

interface Partner {
  id:               string
  name:             string
  is_default:       boolean
  last_selected_at: string | null
}

interface Props {
  onSwitch?: () => void
}

export function GarageEntitySwitcher({ onSwitch }: Props) {
  const [partners, setPartners] = useState<Partner[]>([])
  const [current,  setCurrent]  = useState<Partner | null>(null)
  const [open,     setOpen]     = useState(false)
  const [busy,     setBusy]     = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/garage/me/partners')
      const data = await res.json()
      setPartners(data.partners || [])
      setCurrent(data.current || null)
    } catch { /* silent */ }
  }, [])

  useEffect(() => { load() }, [load])

  async function switchTo(p: Partner) {
    if (p.id === current?.id) { setOpen(false); return }
    setBusy(true)
    try {
      await fetch('/api/garage/me/partners', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ partner_id: p.id }),
      })
      setCurrent(p)
      setOpen(false)
      onSwitch?.()
    } finally { setBusy(false) }
  }

  if (!current) return null

  // Une seule entite → pas de selecteur, juste l affichage
  if (partners.length <= 1) {
    return (
      <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5 text-sm">
        <span>🏢</span>
        <span className="font-semibold text-red-900">{current.name}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl px-3 py-1.5 text-sm transition">
        <span>🏢</span>
        <span className="font-semibold text-red-900">{current.name}</span>
        <span className="text-red-600 text-xs">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-[160] bg-white border border-gray-200 rounded-xl shadow-xl min-w-[240px] py-1 overflow-hidden">
            <p className="text-xs text-gray-400 uppercase px-3 py-1.5 font-semibold">Mes entités</p>
            {partners.map(p => (
              <button key={p.id}
                onClick={() => switchTo(p)}
                disabled={busy}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition ${
                  p.id === current.id ? 'bg-red-50 text-red-900 font-semibold' : 'text-gray-700'
                }`}>
                <div className="flex items-center gap-2">
                  <span>🏢</span>
                  <span className="flex-1">{p.name}</span>
                  {p.id === current.id && <span className="text-red-600 text-xs">✓</span>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
