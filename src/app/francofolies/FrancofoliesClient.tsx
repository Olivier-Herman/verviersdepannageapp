'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import OcrScanModal from '@/components/OcrScanModal'

interface Driver { id: string; name: string }
interface Row {
  id: string; mission_number: number | null
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null
  status: string; amount_to_collect: number | null; parked_at: string | null
  assigned_user?: { id: string; name: string } | null
}

const LAST_DRIVER_KEY = 'ff_last_driver'

export default function FrancofoliesClient({
  userRole, userName, userEmail, userModules, currentUserId, isDriverOnly, drivers, price, gardiennagePrice,
}: {
  userRole: string; userName: string; userEmail?: string; userModules: string[]
  currentUserId: string; isDriverOnly: boolean; drivers: Driver[]
  price: number; gardiennagePrice: number
}) {
  const [screen, setScreen] = useState<'home' | 'arrival' | 'list'>('home')

  // ── Encodage arrivée (rapide) ──────────────────────────────────────────────
  const [plate,      setPlate]      = useState('')
  const [brandModel, setBrandModel] = useState('')
  const [driverId,   setDriverId]   = useState(isDriverOnly ? currentUserId : '')
  const [saving,     setSaving]     = useState(false)
  const [scan,       setScan]       = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)
  const [lastSaved,  setLastSaved]  = useState<string | null>(null)
  const plateRef = useRef<HTMLInputElement>(null)
  const bmRef    = useRef<HTMLInputElement>(null)

  // Mémorise le dernier chauffeur choisi (staff encode pour plusieurs chauffeurs).
  useEffect(() => {
    if (isDriverOnly) { setDriverId(currentUserId); return }
    try { const last = localStorage.getItem(LAST_DRIVER_KEY); if (last && drivers.some(d => d.id === last)) setDriverId(last) } catch {}
  }, [isDriverOnly, currentUserId, drivers])

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 2500) }

  // OCR plaque → remplit + tente le lookup marque/modèle (non bloquant).
  const onPlateScanned = useCallback(async (value: string) => {
    const p = value.trim().toUpperCase()
    setPlate(p); setScan(false)
    if (!brandModel.trim()) {
      try {
        const r = await fetch(`/api/vehicles/lookup-by-plate?plate=${encodeURIComponent(p)}`)
        const j = await r.json()
        const v = j?.vehicles?.[0]
        if (v && (v.brand || v.model)) setBrandModel([v.brand, v.model].filter(Boolean).join(' '))
      } catch {}
    }
    setTimeout(() => bmRef.current?.focus(), 100)
  }, [brandModel])

  const save = async () => {
    const p = plate.trim().toUpperCase()
    if (!p) { showToast('⚠ Immatriculation requise'); plateRef.current?.focus(); return }
    if (!brandModel.trim()) { showToast('⚠ Marque / Modèle requis'); bmRef.current?.focus(); return }
    setSaving(true)
    try {
      const res = await fetch('/api/francofolies/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate: p, brand: brandModel.trim(), driver_id: driverId || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(`⚠ ${j.error || 'Échec'}`); return }
      if (!isDriverOnly && driverId) { try { localStorage.setItem(LAST_DRIVER_KEY, driverId) } catch {} }
      setLastSaved(`${p} · ${brandModel.trim()}`)
      showToast('✅ Véhicule enregistré')
      // Reset rapide pour le suivant (on garde le chauffeur).
      setPlate(''); setBrandModel('')
      setTimeout(() => plateRef.current?.focus(), 100)
    } catch { showToast('⚠ Erreur réseau') }
    finally { setSaving(false) }
  }

  // ── Liste / recherche ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const loadList = useCallback(async (query = '') => {
    setLoadingList(true)
    try {
      const r = await fetch(`/api/francofolies/list?scope=pending&q=${encodeURIComponent(query)}`)
      const j = await r.json()
      setRows(j.rows || [])
    } catch {} finally { setLoadingList(false) }
  }, [])
  useEffect(() => { if (screen === 'list') loadList(q) }, [screen]) // eslint-disable-line
  useEffect(() => {
    if (screen !== 'list') return
    const t = setTimeout(() => loadList(q), 250)
    return () => clearTimeout(t)
  }, [q, screen, loadList])

  const shell = (children: React.ReactNode, title = 'Francofolies') => (
    <AppShell title={title} userRole={userRole} userName={userName} userEmail={userEmail} userModules={userModules}>
      {toast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-surface border shadow-lg rounded-xl px-4 py-2 text-sm font-medium text-ink">
          {toast}
        </div>
      )}
      {children}
    </AppShell>
  )

  // ── HOME ───────────────────────────────────────────────────────────────────
  if (screen === 'home') return shell(
    <main className="p-4 lg:p-8 max-w-md mx-auto">
      <div className="text-center mb-6">
        <div className="text-5xl mb-2">🎪</div>
        <h1 className="text-ink text-xl font-bold">Francofolies de Spa</h1>
        <p className="text-ink-muted text-sm">Mal garée — encodage & enlèvement</p>
      </div>
      <div className="space-y-3">
        <button onClick={() => { setScreen('arrival'); setTimeout(() => plateRef.current?.focus(), 150) }}
          className="w-full py-6 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-600/20 transition">
          📷 Nouveau véhicule (arrivée)
        </button>
        <button onClick={() => setScreen('list')}
          className="w-full py-6 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-emerald-600/20 transition">
          🔍 Liste / Enlèvement
        </button>
      </div>
      <p className="text-ink-faint text-xs text-center mt-6">Tarif : {price} € · gardiennage {gardiennagePrice} €/jour au-delà de 24h</p>
    </main>
  )

  // ── ARRIVÉE (encodage rapide) ──────────────────────────────────────────────
  if (screen === 'arrival') return shell(
    <main className="p-4 max-w-md mx-auto space-y-4">
      <button onClick={() => setScreen('home')} className="text-ink-muted text-sm">← Accueil</button>
      <h1 className="text-ink text-lg font-bold">Nouveau véhicule</h1>

      <button onClick={() => setScan(true)}
        className="w-full py-5 bg-brand hover:bg-brand/90 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-2">
        📷 Scanner la plaque
      </button>

      <div>
        <label className="block text-ink-secondary text-xs font-semibold mb-1">Immatriculation *</label>
        <input ref={plateRef} value={plate} onChange={e => setPlate(e.target.value.toUpperCase())}
          autoCapitalize="characters" placeholder="1ABC234"
          className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-lg font-mono tracking-wide focus:outline-none focus:border-brand" />
      </div>

      <div>
        <label className="block text-ink-secondary text-xs font-semibold mb-1">Marque et Modèle *</label>
        <input ref={bmRef} value={brandModel} onChange={e => setBrandModel(e.target.value)}
          placeholder="Renault Clio" enterKeyHint="done" onKeyDown={e => { if (e.key === 'Enter') save() }}
          className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand" />
      </div>

      <div>
        <label className="block text-ink-secondary text-xs font-semibold mb-1">Chauffeur (qui a ramené)</label>
        {isDriverOnly ? (
          <div className="w-full bg-surface-2 border rounded-xl px-3 py-3 text-ink text-base">{userName}</div>
        ) : (
          <select value={driverId} onChange={e => setDriverId(e.target.value)}
            className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand">
            <option value="">— Sélectionner —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>

      <button onClick={save} disabled={saving}
        className="w-full py-5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-lg disabled:opacity-50 transition">
        {saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}
      </button>

      {lastSaved && <p className="text-emerald-600 text-sm text-center">✅ Dernier : {lastSaved}</p>}

      {scan && <OcrScanModal mode="plate" current={plate} onPick={onPlateScanned} onClose={() => setScan(false)} />}
    </main>
  )

  // ── LISTE / RECHERCHE ──────────────────────────────────────────────────────
  return shell(
    <main className="p-4 max-w-2xl mx-auto space-y-3">
      <button onClick={() => setScreen('home')} className="text-ink-muted text-sm">← Accueil</button>
      <h1 className="text-ink text-lg font-bold">Véhicules en attente d'enlèvement</h1>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Rechercher (plaque / marque)…"
        className="w-full bg-surface border rounded-xl px-3 py-3 text-ink focus:outline-none focus:border-brand" />
      {loadingList ? (
        <p className="text-ink-muted py-6 text-center">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-ink-muted py-10 text-center">Aucun véhicule en attente {q && '(pour cette recherche)'}.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(m => (
            <button key={m.id} onClick={() => showToast('🚧 Enlèvement / encaissement : à venir (Phase 2)')}
              className="w-full text-left bg-surface border rounded-xl p-3 hover:border-brand/40 transition">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-ink font-bold font-mono">{m.vehicle_plate || '—'}</p>
                  <p className="text-ink-secondary text-sm">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                  {m.assigned_user?.name && <p className="text-ink-faint text-xs mt-0.5">🚚 {m.assigned_user.name}</p>}
                </div>
                <span className="text-ink-faint text-xs">{m.parked_at ? new Date(m.parked_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  )
}
