'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import AppShell from '@/components/layout/AppShell'
import OcrScanModal from '@/components/OcrScanModal'
import VehiclePlateLookup from '@/components/vehicles/VehiclePlateLookup'
import type { VehicleMatch } from '@/types/vehicles'
import { COMPANY } from '@/config/company'

/**
 * Construit le payload d'un QR EPC (EPC069-12, virement SEPA). Scanné par les
 * apps bancaires belges → ouvre un virement prérempli (bénéficiaire + montant +
 * communication = plaque). BIC vide autorisé pour la zone SEPA/EEE.
 */
function buildEpcPayload(amount: number, communication: string): string {
  const iban = COMPANY.iban.replace(/\s/g, '')
  return [
    'BCD', '002', '1', 'SCT', '',
    COMPANY.name.slice(0, 70),
    iban,
    `EUR${amount.toFixed(2)}`,
    '', '',
    communication.slice(0, 140),
    '',
  ].join('\n')
}

interface Driver { id: string; name: string }
interface Row {
  id: string; mission_number: number | null
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null
  status: string; amount_to_collect: number | null; parked_at: string | null
  police_blocked?: boolean | null
  assigned_user?: { id: string; name: string } | null
}

/** Jours de gardiennage facturables : "jour entamé au-delà de 24h". */
function gardiennageDaysSince(parkedAt: string | null): number {
  if (!parkedAt) return 0
  const over = (Date.now() - new Date(parkedAt).getTime()) - 24 * 3600 * 1000
  if (over <= 0) return 0
  return Math.ceil(over / (24 * 3600 * 1000))
}

const LAST_DRIVER_KEY = 'ff_last_driver'

export default function FrancofoliesClient({
  userRole, userName, userEmail, userModules, currentUserId, isDriverOnly, drivers, price, gardiennagePrice,
}: {
  userRole: string; userName: string; userEmail?: string; userModules: string[]
  currentUserId: string; isDriverOnly: boolean; drivers: Driver[]
  price: number; gardiennagePrice: number
}) {
  const [screen, setScreen] = useState<'home' | 'arrival' | 'list' | 'pickup' | 'stats'>('home')

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
  const [policeBlock, setPoliceBlock] = useState(false)
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

  // Lookup véhicule via le MODAL partagé VehiclePlateLookup (liste des
  // correspondances Odoo + "pas dans la liste"). 0 → manuel, 1 → auto, 2+ → modal.
  const [lookupStatus,   setLookupStatus]   = useState<'idle' | 'found' | 'notfound'>('idle')
  const [lookupOpen,     setLookupOpen]     = useState(false)
  const [lookupPlateVal, setLookupPlateVal] = useState('')
  const lastLookup = useRef('')

  // Remplit Marque/Modèle depuis le véhicule Odoo choisi (match sur les listes).
  const fillFromVehicle = useCallback(async (v: VehicleMatch) => {
    setLookupOpen(false)
    if (!v?.brand) { setLookupStatus('notfound'); return }
    const b = brands.find(x => x.name.toLowerCase() === String(v.brand).toLowerCase())
    if (!b) { setLookupStatus('notfound'); showToast('ℹ️ Marque non listée — sélectionne manuellement'); return }
    setBrandId(b.id); setBrandName(b.name)
    setLoadingModels(true)
    try {
      const md = await (await fetch(`/api/vehicles?type=models&brandId=${b.id}`)).json()
      const arr = Array.isArray(md) ? md : []
      setModels(arr)
      const mm = v.model ? arr.find((x: any) => x.name.toLowerCase() === String(v.model).toLowerCase()) : null
      setModelName(mm ? mm.name : '')
    } finally { setLoadingModels(false) }
    setLookupStatus('found')
    showToast(`✅ ${v.brand}${v.model ? ' ' + v.model : ''}`)
  }, [brands])

  // Ouvre le modal de recherche pour une plaque (idempotent par plaque).
  const openLookup = useCallback((p: string) => {
    const plt = p.trim().toUpperCase().replace(/[-.\s]/g, '')
    if (plt.length < 4 || plt === lastLookup.current) return
    lastLookup.current = plt
    setLookupPlateVal(plt)
    setLookupOpen(true)
  }, [])

  // OCR plaque → remplit l'immatriculation + ouvre la recherche.
  const onPlateScanned = useCallback((value: string) => {
    const p = value.trim().toUpperCase()
    setPlate(p); setScan(false)
    openLookup(p)
  }, [openLookup])

  // Déclenche la recherche (modal) quand la plaque saisie est complète (débouncée).
  useEffect(() => {
    if (screen !== 'arrival') return
    const p = plate.trim().toUpperCase().replace(/[-.\s]/g, '')
    if (p.length < 6) { lastLookup.current = ''; return }
    const t = setTimeout(() => openLookup(p), 600)
    return () => clearTimeout(t)
  }, [plate, screen, openLookup])

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
        body: JSON.stringify({ plate: p, brand: brandName, model: modelName, driver_id: realDriverId, driver_name: driverNameFree, police_blocked: policeBlock }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(`⚠ ${j.error || 'Échec'}`); return }
      if (!isDriverOnly && realDriverId) { try { localStorage.setItem(LAST_DRIVER_KEY, realDriverId) } catch {} }
      setLastSaved(`${p} · ${[brandName, modelName].filter(Boolean).join(' ')}`)
      showToast('✅ Véhicule enregistré')
      // Reset rapide pour le suivant (on garde le chauffeur).
      setPlate(''); setBrandId(null); setBrandName(''); setModelName(''); setModels([]); setPoliceBlock(false)
      setTimeout(() => plateRef.current?.focus(), 100)
    } catch { showToast('⚠ Erreur réseau') }
    finally { setSaving(false) }
  }

  // ── Liste / recherche ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<Row[]>([])
  const [q, setQ] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  // Compteur "en attente d'enlèvement" — chargé en permanence sur l'accueil.
  const loadPendingCount = useCallback(async () => {
    try {
      const r = await fetch('/api/francofolies/list?scope=pending')
      const j = await r.json()
      if (typeof j.count === 'number') setPendingCount(j.count)
    } catch {}
  }, [])
  useEffect(() => { if (screen === 'home') loadPendingCount() }, [screen, loadPendingCount])
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

  // ── Enlèvement (Phase 2) ─────────────────────────────────────────────────
  const [picked,    setPicked]    = useState<Row | null>(null)
  const [cName,     setCName]     = useState('')
  const [cAddress,  setCAddress]  = useState('')
  const [cZip,      setCZip]      = useState('')
  const [cCity,     setCCity]     = useState('')
  const [cPhone,    setCPhone]    = useState('')
  const [cEmail,    setCEmail]    = useState('')
  const [cVat,      setCVat]      = useState('')
  const [payMode,   setPayMode]   = useState<'cash' | 'bancontact' | 'sumup' | 'qr_transfer' | 'unpaid'>('cash')
  const [chargeGard, setChargeGard] = useState(true)
  const [policeOk,  setPoliceOk]  = useState(false)
  const [pickupSaving, setPickupSaving] = useState(false)
  const [noChargeMode, setNoChargeMode] = useState(false)
  const [noChargeReason, setNoChargeReason] = useState('')
  const [viesLoading, setViesLoading] = useState(false)
  const [viesResult,  setViesResult]  = useState<null | { valid: boolean; name?: string; error?: string }>(null)

  // VIES : valide le n° TVA (source officielle UE) et auto-remplit nom + adresse.
  async function checkVies() {
    const cleaned = cVat.replace(/[\s.\-]/g, '').toUpperCase()
    if (cleaned.length < 6) { setViesResult(null); return }
    setViesLoading(true)
    try {
      const res = await fetch(`/api/vies?vat=${encodeURIComponent(cleaned)}`)
      const j   = await res.json()
      setViesResult(j)
      if (j.valid) {
        if (j.name) setCName(j.name)
        if (j.address) {
          const m = j.address.match(/^(.+?)\s+(\d{4,5})\s+(.+)$/)
          if (m) { setCAddress(m[1].trim()); setCZip(m[2].trim()); setCCity(m[3].trim()) }
          else   { setCAddress(j.address); setCZip(''); setCCity('') }
        }
      }
    } catch { setViesResult({ valid: false, error: 'VIES indisponible' }) }
    finally { setViesLoading(false) }
  }

  // ── Stats chauffeur ──────────────────────────────────────────────────────
  interface DriverStat { name: string; total: number; picked: number; collected: number }
  const [stats, setStats] = useState<{ totals: { vehicles: number; picked: number; parked: number; collected: number }; drivers: DriverStat[] } | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const loadStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const r = await fetch('/api/francofolies/stats')
      const j = await r.json()
      if (j.ok) setStats({ totals: j.totals, drivers: j.drivers })
    } catch {} finally { setLoadingStats(false) }
  }, [])
  useEffect(() => { if (screen === 'stats') loadStats() }, [screen, loadStats])

  const gardDays = picked ? gardiennageDaysSince(picked.parked_at) : 0
  // price = prix réquisition TVAC (220 par défaut) ; gardiennagePrice = HTVA/jour (20).
  const baseTvac = Math.round(price * 100) / 100
  const gardTvac = Math.round(gardiennagePrice * 1.21 * (chargeGard ? gardDays : 0) * 100) / 100
  const totalTvac = Math.round((baseTvac + gardTvac) * 100) / 100

  function openPickup(row: Row) {
    setPicked(row)
    setCName(''); setCAddress(''); setCZip(''); setCCity(''); setCPhone(''); setCEmail(''); setCVat('')
    setPayMode('cash'); setChargeGard(true); setPoliceOk(false)
    setNoChargeMode(false); setNoChargeReason(''); setViesResult(null)
    setScreen('pickup')
  }

  async function submitPickup() {
    if (!picked) return
    if (noChargeMode) {
      if (!noChargeReason.trim()) { showToast('⚠ Motif requis'); return }
    } else {
      if (!cName.trim()) { showToast('⚠ Nom du client requis'); return }
      if (picked.police_blocked && !policeOk) { showToast('⚠ Confirme le passage au commissariat'); return }
    }
    setPickupSaving(true)
    try {
      const res = await fetch('/api/francofolies/pickup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noChargeMode ? {
          mission_id: picked.id, mode: 'no_charge', no_charge_reason: noChargeReason.trim(),
        } : {
          mission_id: picked.id, mode: 'invoice',
          client: { name: cName.trim(), address: cAddress.trim(), zip: cZip.trim(), city: cCity.trim(), phone: cPhone.trim(), email: cEmail.trim(), vat: cVat.trim() },
          payment_mode: payMode,
          gardiennage_days: chargeGard ? gardDays : 0,
          police_verified: policeOk,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { showToast(`⚠ ${j.error || 'Échec'}`); return }
      showToast(noChargeMode ? '✅ Restitué sans frais'
        : `✅ Encaissé ${j.total_tvac?.toFixed?.(2) || ''} € TVAC${j.receipt_sent ? ' · reçu envoyé' : ''}`)
      setScreen('list'); setPicked(null); loadList(q)
    } catch { showToast('⚠ Erreur réseau') }
    finally { setPickupSaving(false) }
  }

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

      {/* Compteur permanent : véhicules en attente d'enlèvement */}
      <div className="mb-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4 flex items-center justify-center gap-3">
        <span className="text-4xl font-bold text-emerald-700">{pendingCount ?? '—'}</span>
        <span className="text-emerald-800 text-sm font-semibold leading-tight">
          véhicule{(pendingCount ?? 0) > 1 ? 's' : ''}<br />en attente d'enlèvement
        </span>
      </div>

      <div className="space-y-3">
        <button onClick={() => { setScreen('arrival'); setTimeout(() => plateRef.current?.focus(), 150) }}
          className="w-full py-6 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-600/20 transition">
          📷 Nouveau véhicule (arrivée)
        </button>
        <button onClick={() => setScreen('list')}
          className="w-full py-6 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-lg shadow-lg shadow-emerald-600/20 transition flex items-center justify-center gap-2">
          🔍 Liste / Enlèvement
          {pendingCount != null && pendingCount > 0 && (
            <span className="px-2.5 py-0.5 bg-white/25 rounded-full text-base">{pendingCount}</span>
          )}
        </button>
        {userRole === 'superadmin' && (
          <button onClick={() => setScreen('stats')}
            className="w-full py-4 bg-surface border text-ink-secondary hover:border-brand/40 rounded-2xl font-semibold transition">
            📊 Statistiques chauffeurs
          </button>
        )}
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
          onBlur={() => openLookup(plate)}
          autoCapitalize="characters" placeholder="1ABC234"
          className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-lg font-mono tracking-wide focus:outline-none focus:border-brand" />
        {lookupStatus === 'found'     && <p className="text-emerald-600 text-xs mt-1">✅ Véhicule trouvé — marque/modèle pré-remplis</p>}
        {lookupStatus === 'notfound'  && <p className="text-amber-600 text-xs mt-1">ℹ️ Pas dans la liste — sélectionne marque/modèle (le véhicule sera créé)</p>}
        <button type="button" onClick={() => { lastLookup.current = ''; openLookup(plate) }}
          className="text-brand text-xs mt-1 underline">🔍 Rechercher dans Odoo</button>
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

      <button type="button" onClick={() => setPoliceBlock(v => !v)}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 transition text-left ${
          policeBlock ? 'bg-red-50 border-red-500' : 'bg-surface border'
        }`}>
        <span className={`w-6 h-6 rounded-md flex items-center justify-center text-white text-sm flex-shrink-0 ${policeBlock ? 'bg-red-600' : 'bg-ink-faint'}`}>
          {policeBlock ? '✓' : ''}
        </span>
        <span>
          <span className="block text-ink font-semibold text-sm">🚔 Blocage police</span>
          <span className="block text-ink-muted text-xs">Le propriétaire devra passer au commissariat avant l'enlèvement</span>
        </span>
      </button>

      <button onClick={save} disabled={saving}
        className="w-full py-5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold text-lg disabled:opacity-50 transition">
        {saving ? '⏳ Enregistrement…' : '💾 Enregistrer'}
      </button>

      {lastSaved && <p className="text-emerald-600 text-sm text-center">✅ Dernier : {lastSaved}</p>}

      {scan && <OcrScanModal mode="plate" current={plate} onPick={onPlateScanned} onClose={() => setScan(false)} />}

      <VehiclePlateLookup
        plate={lookupPlateVal}
        open={lookupOpen}
        confirmAlways
        onSelect={fillFromVehicle}
        onCreateNew={() => { setLookupOpen(false); setLookupStatus('notfound') }}
        onCancel={() => setLookupOpen(false)}
      />
    </main>
  )

  // ── ENLÈVEMENT (Phase 2) ────────────────────────────────────────────────────
  if (screen === 'pickup' && picked) return shell(
    <main className="p-4 max-w-md mx-auto space-y-4">
      <button onClick={() => { setScreen('list'); setPicked(null) }} className="text-ink-muted text-sm">← Liste</button>

      <div className="bg-surface border rounded-2xl p-4">
        <p className="text-ink font-bold font-mono text-lg">{picked.vehicle_plate || '—'}</p>
        <p className="text-ink-secondary text-sm">{[picked.vehicle_brand, picked.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
        {picked.police_blocked && (
          <p className="mt-2 text-red-700 text-xs font-semibold bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
            🚔 Blocage police — le propriétaire doit avoir réglé sa situation au commissariat.
          </p>
        )}
      </div>

      {/* Bascule sans frais */}
      <button type="button" onClick={() => setNoChargeMode(v => !v)}
        className={`w-full px-3 py-2.5 rounded-xl border-2 text-sm font-semibold transition ${
          noChargeMode ? 'bg-amber-50 border-amber-500 text-amber-800' : 'bg-surface border text-ink-secondary'
        }`}>
        {noChargeMode ? '✓ Restitution sans frais' : '🚫 Restituer sans frais'}
      </button>

      {noChargeMode ? (
        <div>
          <label className="block text-ink-secondary text-xs font-semibold mb-1">Motif (obligatoire) *</label>
          <textarea value={noChargeReason} onChange={e => setNoChargeReason(e.target.value)} rows={3}
            placeholder="Ex : erreur d'enlèvement, geste commercial…"
            className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand" />
        </div>
      ) : (
        <>
          {/* Client */}
          <div className="space-y-2">
            <label className="block text-ink-secondary text-xs font-semibold">Client</label>
            <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Nom / Société *"
              className="w-full bg-surface border rounded-xl px-3 py-3 text-ink text-base focus:outline-none focus:border-brand" />
            <input value={cAddress} onChange={e => setCAddress(e.target.value)} placeholder="Adresse (rue + n°)"
              className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-base focus:outline-none focus:border-brand" />
            <div className="grid grid-cols-3 gap-2">
              <input value={cZip} onChange={e => setCZip(e.target.value)} placeholder="CP"
                className="bg-surface border rounded-xl px-3 py-2.5 text-ink text-base focus:outline-none focus:border-brand" />
              <input value={cCity} onChange={e => setCCity(e.target.value)} placeholder="Ville"
                className="col-span-2 bg-surface border rounded-xl px-3 py-2.5 text-ink text-base focus:outline-none focus:border-brand" />
            </div>
            <input value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="Téléphone" inputMode="tel"
              className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-base focus:outline-none focus:border-brand" />
            <input value={cEmail} onChange={e => setCEmail(e.target.value)} placeholder="Email (reçu envoyé)" inputMode="email" autoCapitalize="none"
              className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-base focus:outline-none focus:border-brand" />
            <div>
              <div className="flex gap-2">
                <input value={cVat} onChange={e => { setCVat(e.target.value); setViesResult(null) }} onBlur={checkVies}
                  placeholder="N° TVA (ex BE0123456789)" autoCapitalize="characters"
                  className="flex-1 bg-surface border rounded-xl px-3 py-2.5 text-ink text-base focus:outline-none focus:border-brand" />
                <button type="button" onClick={checkVies} disabled={viesLoading}
                  className="px-3 py-2.5 bg-surface-2 border rounded-xl text-ink-secondary text-sm font-semibold disabled:opacity-50 whitespace-nowrap">
                  {viesLoading ? '⏳' : '🔎 VIES'}
                </button>
              </div>
              {viesResult && (
                viesResult.valid
                  ? <p className="text-emerald-600 text-xs mt-1">✅ TVA valide{viesResult.name ? ` — ${viesResult.name}` : ''} (nom + adresse remplis)</p>
                  : <p className="text-amber-600 text-xs mt-1">⚠ {viesResult.error || 'TVA non reconnue par VIES'}</p>
              )}
            </div>
          </div>

          {/* Gardiennage */}
          {gardDays > 0 && (
            <button type="button" onClick={() => setChargeGard(v => !v)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 text-left transition ${
                chargeGard ? 'bg-emerald-50 border-emerald-500' : 'bg-surface border'
              }`}>
              <span className={`w-6 h-6 rounded-md flex items-center justify-center text-white text-sm flex-shrink-0 ${chargeGard ? 'bg-emerald-600' : 'bg-ink-faint'}`}>
                {chargeGard ? '✓' : ''}
              </span>
              <span className="text-sm">
                <span className="block text-ink font-semibold">Il y a {gardDays} jour{gardDays > 1 ? 's' : ''} de gardiennage</span>
                <span className="block text-ink-muted text-xs">Les comptabiliser ({gardiennagePrice} € HTVA/jour) ?</span>
              </span>
            </button>
          )}

          {/* Paiement */}
          <div>
            <label className="block text-ink-secondary text-xs font-semibold mb-1">Mode de paiement</label>
            <div className="grid grid-cols-2 gap-2">
              {([['cash', '💵 Espèces'], ['bancontact', '💳 Bancontact'], ['sumup', '📲 Sumup'], ['qr_transfer', '📷 QR virement'], ['unpaid', '🧾 À facturer']] as const).map(([v, lbl]) => (
                <button key={v} type="button" onClick={() => setPayMode(v)}
                  className={`py-3 rounded-xl border-2 text-sm font-semibold transition ${
                    payMode === v
                      ? (v === 'unpaid' ? 'bg-amber-500 text-white border-amber-500' : 'bg-brand text-white border-brand')
                      : 'bg-surface border text-ink-secondary'
                  }`}>{lbl}</button>
              ))}
            </div>
            {payMode === 'unpaid' && (
              <p className="text-amber-600 text-xs mt-1">Le client recevra une confirmation « non payée » ; le montant reste à facturer.</p>
            )}
            {payMode === 'qr_transfer' && (
              <div className="mt-2 bg-surface border rounded-xl p-3 text-center">
                <p className="text-ink-secondary text-xs mb-2">Le client scanne ce QR avec son app bancaire — virement prérempli ({totalTvac.toFixed(2)} € · comm. {picked?.vehicle_plate}).</p>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(buildEpcPayload(totalTvac, `${picked?.vehicle_plate || ''} Francofolies`))}`}
                  alt="QR virement SEPA" width={240} height={240}
                  className="mx-auto rounded-lg bg-white" />
                <p className="text-ink-faint text-[11px] mt-2">Virement {COMPANY.iban} — bénéficiaire {COMPANY.name}</p>
              </div>
            )}
          </div>

          {/* Blocage police : confirmation */}
          {picked.police_blocked && (
            <button type="button" onClick={() => setPoliceOk(v => !v)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border-2 text-left transition ${
                policeOk ? 'bg-red-50 border-red-500' : 'bg-surface border border-red-300'
              }`}>
              <span className={`w-6 h-6 rounded-md flex items-center justify-center text-white text-sm flex-shrink-0 ${policeOk ? 'bg-red-600' : 'bg-ink-faint'}`}>
                {policeOk ? '✓' : ''}
              </span>
              <span className="text-ink text-sm font-semibold">Le propriétaire est passé au commissariat</span>
            </button>
          )}

          {/* Total */}
          <div className="bg-surface-2 border rounded-2xl p-4 space-y-1">
            <div className="flex justify-between text-sm text-ink-secondary">
              <span>Réquisition mal garée</span><span>{baseTvac.toFixed(2)} €</span>
            </div>
            {chargeGard && gardDays > 0 && (
              <div className="flex justify-between text-sm text-ink-secondary">
                <span>Gardiennage ({gardDays} j)</span><span>{gardTvac.toFixed(2)} €</span>
              </div>
            )}
            <div className="flex justify-between text-ink font-bold text-lg pt-1 border-t">
              <span>Total TVAC</span><span>{totalTvac.toFixed(2)} €</span>
            </div>
          </div>
        </>
      )}

      <button onClick={submitPickup} disabled={pickupSaving}
        className={`w-full py-5 text-white rounded-2xl font-bold text-lg disabled:opacity-50 transition ${
          noChargeMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
        }`}>
        {pickupSaving ? '⏳…' : noChargeMode ? '🚫 Restituer sans frais'
          : payMode === 'unpaid' ? `🧾 Enlever (${totalTvac.toFixed(2)} € à facturer)`
          : `💰 Encaisser ${totalTvac.toFixed(2)} € & enlever`}
      </button>
    </main>, 'Enlèvement',
  )

  // ── STATS CHAUFFEUR (superadmin uniquement) ─────────────────────────────────
  if (screen === 'stats' && userRole === 'superadmin') return shell(
    <main className="p-4 max-w-2xl mx-auto space-y-4">
      <button onClick={() => setScreen('home')} className="text-ink-muted text-sm">← Accueil</button>
      <h1 className="text-ink text-lg font-bold">📊 Statistiques chauffeurs</h1>

      {loadingStats ? (
        <p className="text-ink-muted py-6 text-center">Chargement…</p>
      ) : !stats ? (
        <p className="text-ink-muted py-10 text-center">Aucune donnée.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-surface border rounded-xl p-3 text-center">
              <p className="text-ink text-2xl font-bold">{stats.totals.vehicles}</p>
              <p className="text-ink-muted text-xs">Véhicules</p>
            </div>
            <div className="bg-surface border rounded-xl p-3 text-center">
              <p className="text-ink text-2xl font-bold">{stats.totals.parked}</p>
              <p className="text-ink-muted text-xs">En attente</p>
            </div>
            <div className="bg-surface border rounded-xl p-3 text-center">
              <p className="text-ink text-2xl font-bold">{stats.totals.collected.toFixed(0)} €</p>
              <p className="text-ink-muted text-xs">Encaissé</p>
            </div>
          </div>

          {stats.drivers.length === 0 ? (
            <p className="text-ink-muted py-6 text-center">Aucun véhicule encore encodé.</p>
          ) : (
            <div className="space-y-2">
              {stats.drivers.map((d, i) => (
                <div key={d.name + i} className="bg-surface border rounded-xl p-3 flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                    i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-white' : i === 2 ? 'bg-amber-700 text-white' : 'bg-surface-2 text-ink-secondary'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-ink font-semibold text-sm truncate">{d.name}</p>
                    <p className="text-ink-muted text-xs">{d.picked} enlevé{d.picked > 1 ? 's' : ''} · {(d.total - d.picked)} en attente</p>
                  </div>
                  <span className="text-ink font-bold text-lg">{d.total}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>, 'Statistiques',
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
            <button key={m.id} onClick={() => openPickup(m)}
              className="w-full text-left bg-surface border rounded-xl p-3 hover:border-brand/40 transition">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-ink font-bold font-mono">
                    {m.vehicle_plate || '—'}
                    {m.police_blocked && <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] rounded font-bold align-middle">🚔 BLOCAGE</span>}
                  </p>
                  <p className="text-ink-secondary text-sm">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ') || '—'}</p>
                  {m.assigned_user?.name && <p className="text-ink-faint text-xs mt-0.5">🚚 {m.assigned_user.name}</p>}
                </div>
                <div className="text-right">
                  <span className="text-ink-faint text-xs block">{m.parked_at ? new Date(m.parked_at).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  <span className="text-emerald-600 text-xs font-semibold">Enlèvement →</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  )
}
