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
  const [brandId,    setBrandId]    = useState<number | null>(null)
  const [brandName,  setBrandName]  = useState('')
  const [modelName,  setModelName]  = useState('')
  const [brands,     setBrands]     = useState<{ id: number; name: string }[]>([])
  const [models,     setModels]     = useState<{ id: number; name: string }[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [driverId,   setDriverId]   = useState(isDriverOnly ? currentUserId : '')
  const [otherDriver, setOtherDriver] = useState('')   // nom libre si "Autre"
  const [saving,     setSaving]     = useState(false)
  const [scan,       setScan]       = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)
  const [lastSaved,  setLastSaved]  = useState<string | null>(null)
  const plateRef = useRef<HTMLInputElement>(null)

  // Marque / Modèle = référentiel Odoo (listes dépendantes).
  useEffect(() => {
    if (brands.length > 0) return
    fetch('/api/vehicles?type=brands').then(r => r.json()).then(d => setBrands(Array.isArray(d) ? d : [])).catch(() => {})
  }, [brands.length])

  const onBrandChange = useCallback(async (id: number | null) => {
    setBrandId(id)
    setBrandName(id ? (brands.find(b => b.id === id)?.name || '') : '')
    setModelName(''); setModels([])
    if (!id) return
    setLoadingModels(true)
    try {
      const r = await fetch(`/api/vehicles?type=models&brandId=${id}`)
      const d = await r.json()
      setModels(Array.isArray(d) ? d : [])
    } catch {} finally { setLoadingModels(false) }
  }, [brands])

  // Mémorise le dernier chauffeur choisi (staff encode pour plusieurs chauffeurs).
  useEffect(() => {
    if (isDriverOnly) { setDriverId(currentUserId); return }
    try { const last = localStorage.getItem(LAST_DRIVER_KEY); if (last && drivers.some(d => d.id === last)) setDriverId(last) } catch {}
  }, [isDriverOnly, currentUserId, drivers])

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 2500) }

  // Lookup Odoo dès qu'une plaque est saisie : si le véhicule est connu,
  // pré-remplit Marque/Modèle (en matchant les listes Odoo).
  const lastLookup = useRef('')
  const lookupPlate = useCallback(async (p: string) => {
    const plt = p.trim().toUpperCase()
    if (plt.length < 5 || plt === lastLookup.current) return
    lastLookup.current = plt
    try {
      const r = await fetch(`/api/vehicles/lookup-by-plate?plate=${encodeURIComponent(plt)}`)
      const j = await r.json()
      const v = j?.vehicles?.[0]
      if (!j?.found || !v || !v.brand) return
      const b = brands.find(x => x.name.toLowerCase() === String(v.brand).toLowerCase())
      if (!b) return
      setBrandId(b.id); setBrandName(b.name)
      setLoadingModels(true)
      try {
        const md = await (await fetch(`/api/vehicles?type=models&brandId=${b.id}`)).json()
        const arr = Array.isArray(md) ? md : []
        setModels(arr)
        const mm = v.model ? arr.find((x: any) => x.name.toLowerCase() === String(v.model).toLowerCase()) : null
        setModelName(mm ? mm.name : '')
      } finally { setLoadingModels(false) }
      showToast(`✅ Véhicule connu : ${v.brand}${v.model ? ' ' + v.model : ''}`)
    } catch {}
  }, [brands])

  // OCR plaque → remplit l'immatriculation + lookup auto.
  const onPlateScanned = useCallback((value: string) => {
    const p = value.trim().toUpperCase()
    setPlate(p); setScan(false)
    lookupPlate(p)
  }, [lookupPlate])

  const save = async () => {
    const p = plate.trim().toUpperCase()
    if (!p) { showToast('⚠ Immatriculation requise'); plateRef.current?.focus(); return }
    if (!brandName) { showToast('⚠ Sélectionne la marque'); return }
    if (!modelName) { showToast('⚠ Sélectionne le modèle'); return }
    if (!isDriverOnly) {
      if (!driverId) { showToast('⚠ Sélectionne le chauffeur'); return }
      if (driverId === '__other__' && !otherDriver.trim()) { showToast('⚠ Indique le nom du chauffeur'); return }
    }
    const realDriverId = (driverId && driverId !== '__other__') ? driverId : undefined
    const driverNameFree = driverId === '__other__' ? otherDriver.trim() : undefined
    setSaving(true)
    try {
      const res = await fetch('/api/francofolies/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate: p, brand: brandName, model: modelName, driver_id: realDriverId, driver_name: driverNameFree }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(`⚠ ${j.error || 'Échec'}`); return }
      if (!isDriverOnly && realDriverId) { try { localStorage.setItem(LAST_DRIVER_KEY, realDriverId) } catch {} }
      setLastSaved(`${p} · ${[brandName, modelName].filter(Boolean).join(' ')}`)
      showToast('✅ Véhicule enregistré')
      // Reset rapide pour le suivant (on garde le chauffeur).
      setPlate(''); setBrandId(null); setBrandName(''); setModelName(''); setModels([])
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
          onBlur={() => lookupPlate(plate)}
          autoCapitalize="characters" placeholder="1ABC234"
          className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-lg font-mono tracking-wide focus:outline-none focus:border-brand" />
      </div>

      <div>
        <label className="block text-ink-secondary text-xs font-semibold mb-1">Marque *</label>
        <select value={brandId ?? ''} onChange={e => onBrandChange(e.target.value ? Number(e.target.value) : null)}
          className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand">
          <option value="">— Sélectionner la marque —</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-ink-secondary text-xs font-semibold mb-1">Modèle *</label>
        <select value={modelName} onChange={e => setModelName(e.target.value)} disabled={!brandId || loadingModels}
          className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand disabled:opacity-50">
          <option value="">{!brandId ? '— Choisis d\'abord la marque —' : loadingModels ? 'Chargement…' : '— Sélectionner le modèle —'}</option>
          {models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-ink-secondary text-xs font-semibold mb-1">Chauffeur (qui a ramené)</label>
        {isDriverOnly ? (
          <div className="w-full bg-surface-2 border rounded-xl px-3 py-3 text-ink text-base">{userName}</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {drivers.map(d => (
                <button key={d.id} type="button" onClick={() => setDriverId(d.id)}
                  className={`py-3 px-1 rounded-xl text-sm font-semibold border transition ${
                    driverId === d.id ? 'bg-brand text-white border-brand' : 'bg-surface border text-ink-secondary hover:border-brand/40'
                  }`}>
                  {d.name}
                </button>
              ))}
              <button type="button" onClick={() => setDriverId('__other__')}
                className={`py-3 px-1 rounded-xl text-sm font-semibold border transition ${
                  driverId === '__other__' ? 'bg-amber-500 text-white border-amber-500' : 'bg-surface border text-ink-secondary hover:border-amber-400'
                }`}>
                ✏️ Autre
              </button>
            </div>
            {driverId === '__other__' && (
              <input value={otherDriver} onChange={e => setOtherDriver(e.target.value)}
                placeholder="Nom du chauffeur"
                className="w-full mt-2 bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand" />
            )}
          </>
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
