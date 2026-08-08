'use client'

// Écran de clôture VAB côté chauffeur (remorquage). Réutilise le principe de
// l'écran Touring : mêmes gestes pour le chauffeur quelle que soit l'assistance.
// Collecte : signature (dessin → PNG) OU refus/absent · nombre de clés ·
// emplacement des clés · localisation du véhicule · qui réceptionne.
// → POST /api/missions/[id]/vab-close (rejoue la séquence VAB). Olivier 2026-08-08.

import { useEffect, useRef, useState } from 'react'

// Référentiel VAB (valeurs d'option Comet — liste VAB, pas notre config).
const KEYS_NR = [
  { value: '__ossli_1', label: '1' },
  { value: '__ossli_2', label: '2' },
  { value: '__ossli_3', label: '3' },
]
const KEY_LOCATIONS = [
  { value: '465',   label: 'Boîte à clés' },
  { value: '1043',  label: 'Réception' },
  { value: '463',   label: 'Client' },
  { value: '19712', label: 'Keybox' },
  { value: '1042',  label: 'Boîte aux lettres' },
  { value: '1041',  label: 'Habitant' },
  { value: '1040',  label: 'Clapet réservoir carburant' },
  { value: '1039',  label: 'Amortisseur droit' },
  { value: '1038',  label: 'Amortisseur gauche' },
]

export default function VabCloseModal({
  missionId, onClose, onDone,
}: {
  missionId: string
  onClose: () => void
  onDone?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const hasDrawn = useRef(false)
  const [noSign, setNoSign]   = useState<'' | 'refusal' | 'absent'>('')
  const [keysNr, setKeysNr]   = useState('__ossli_1')
  const [keyLoc, setKeyLoc]   = useState('465')
  const [vehLoc, setVehLoc]   = useState('Parking')
  const [name, setName]       = useState('')
  const [firstName, setFirstName] = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  // Init canvas (fond blanc + trait noir), gestion pointeur (souris + tactile).
  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#0b1120'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) } }
    const down = (e: PointerEvent) => { drawing.current = true; hasDrawn.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); c.setPointerCapture(e.pointerId) }
    const move = (e: PointerEvent) => { if (!drawing.current) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault() }
    const up = () => { drawing.current = false }
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up); c.addEventListener('pointerleave', up)
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointerleave', up) }
  }, [])

  const clearSig = () => {
    const c = canvasRef.current; const ctx = c?.getContext('2d'); if (!c || !ctx) return
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); hasDrawn.current = false
  }

  const submit = async () => {
    setErr(null)
    let signaturePng: string | undefined
    if (!noSign) {
      if (!hasDrawn.current) { setErr('Faites signer (ou cochez « refuse / absent »).'); return }
      signaturePng = canvasRef.current?.toDataURL('image/png')
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/vab-close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signaturePng, refusal: noSign === 'refusal', notPresent: noSign === 'absent',
          keysNr, keyLocation: keyLoc, vehicleLocation: vehLoc.trim() || 'Parking',
          receiverName: name.trim() || undefined, receiverFirstName: firstName.trim() || undefined,
          present: noSign !== 'absent',
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Clôture VAB refusée')
      onDone?.()
    } catch (e: any) { setErr(e?.message || 'Erreur'); setBusy(false) }
  }

  const sel = 'w-full px-3 py-2.5 bg-surface border border-app rounded-xl text-ink text-base'
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-app px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold text-ink">🅅 Clôture VAB — remorquage</h2>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-ink-muted hover:text-ink text-xl">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Signature */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold text-ink">Signature du client</span>
              {!noSign && <button onClick={clearSig} className="text-xs text-brand">Effacer</button>}
            </div>
            {!noSign ? (
              <canvas ref={canvasRef} width={520} height={180}
                className="w-full h-40 bg-white border-2 border-dashed border-app rounded-xl touch-none" />
            ) : (
              <div className="w-full h-40 flex items-center justify-center bg-surface-2 border border-app rounded-xl text-ink-muted text-sm">
                {noSign === 'refusal' ? 'Client refuse de signer' : 'Client absent'}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setNoSign(noSign === 'refusal' ? '' : 'refusal')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border ${noSign === 'refusal' ? 'bg-amber-500 text-white border-amber-500' : 'bg-surface-2 text-ink-secondary border-app'}`}>
                Refuse de signer
              </button>
              <button onClick={() => setNoSign(noSign === 'absent' ? '' : 'absent')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border ${noSign === 'absent' ? 'bg-amber-500 text-white border-amber-500' : 'bg-surface-2 text-ink-secondary border-app'}`}>
                Client absent
              </button>
            </div>
          </div>

          {/* Clés */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm font-semibold text-ink">Nombre de clés</span>
              <select className={sel} value={keysNr} onChange={e => setKeysNr(e.target.value)}>
                {KEYS_NR.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-semibold text-ink">Emplacement des clés</span>
              <select className={sel} value={keyLoc} onChange={e => setKeyLoc(e.target.value)}>
                {KEY_LOCATIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          {/* Localisation véhicule */}
          <label className="space-y-1 block">
            <span className="text-sm font-semibold text-ink">Localisation du véhicule</span>
            <input className={sel} value={vehLoc} onChange={e => setVehLoc(e.target.value)} placeholder="Parking, atelier…" />
          </label>

          {/* Réceptionné par (facultatif) */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm text-ink-secondary">Nom (facultatif)</span>
              <input className={sel} value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-sm text-ink-secondary">Prénom (facultatif)</span>
              <input className={sel} value={firstName} onChange={e => setFirstName(e.target.value)} />
            </label>
          </div>

          {err && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {err}</p>}

          <button onClick={submit} disabled={busy}
            className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold disabled:opacity-60">
            {busy ? 'Clôture chez VAB…' : 'Clôturer chez VAB'}
          </button>
          <p className="text-[11px] text-ink-muted text-center">La clôture est envoyée à VAB (accepter → départ → arrivé → signature → fin).</p>
        </div>
      </div>
    </div>
  )
}
