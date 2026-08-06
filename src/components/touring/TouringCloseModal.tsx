'use client'
// src/components/touring/TouringCloseModal.tsx
//
// Modal de clôture Touring COMEX (chauffeur & dispatch). Le chauffeur choisit une
// panne (preset) ; le dispatch a en plus les raccourcis + peut ajuster les codes.
// Sur un remorquage : sélection du garage (liste COMEX) ou adresse libre.
// Fermable ✕ / Fermer uniquement (pas au clic-fond). Olivier 2026-08-06.

import { useEffect, useState } from 'react'
import {
  PRESETS_DSP, PRESETS_REM, PRESET_REM_CATCHALL, endMissionLabel, type ClosePreset,
} from '@/lib/touring/close-presets'

interface Provider {
  cidPrx: string; nom: string; rue: string; numRue: string
  cp: string; localite: string; distance: number; lat: number; lng: number
}
interface InitData {
  finCodes: { code: string; label: string; rem: boolean }[]
  vin: string; mecIso: string; status: string; plate: string
}

export default function TouringCloseModal({
  missionId, mode = 'driver', onClose, onDone,
}: {
  missionId: string
  mode?: 'driver' | 'dispatch'
  onClose: () => void
  onDone?: () => void
}) {
  const [init, setInit]         = useState<InitData | null>(null)
  const [loadErr, setLoadErr]   = useState<string | null>(null)
  const [tab, setTab]           = useState<'dsp' | 'rem'>('rem')
  const [preset, setPreset]     = useState<ClosePreset | null>(null)
  const [vr, setVr]             = useState(false)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [garageMode, setGarageMode] = useState<'list' | 'manual'>('list')
  const [garageCid, setGarageCid]   = useState<string>('')
  const [manual, setManual]     = useState({ nom: '', rue: '', num: '', cp: '', loc: '' })
  const [km, setKm]             = useState('')
  const [vin, setVin]           = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // Init (codes Fin de mission dispo, VIN, MEC).
  useEffect(() => {
    let alive = true
    fetch(`/api/missions/${missionId}/touring-close`)
      .then(r => r.json())
      .then(d => { if (!alive) return; if (d.error) setLoadErr(d.error); else { setInit(d); setVin(d.vin || '') } })
      .catch(() => alive && setLoadErr('Impossible de charger la clôture'))
    return () => { alive = false }
  }, [missionId])

  // Sur un preset remorquage → charger la liste des garages.
  useEffect(() => {
    if (!preset?.rem) { setProviders(null); return }
    let alive = true
    setProviders(null)
    const q = new URLSearchParams({ providers: '1', cause: preset.cause, desc: preset.desc, result: preset.result })
    fetch(`/api/missions/${missionId}/touring-close?${q}`)
      .then(r => r.json())
      .then(d => { if (!alive) return; const list: Provider[] = d.providers || []; setProviders(list); if (list[0]) setGarageCid(list[0].cidPrx) })
      .catch(() => alive && setProviders([]))
    return () => { alive = false }
  }, [preset, missionId])

  const isRem = !!preset?.rem
  const finCode = preset ? (isRem && vr ? '03' : preset.fin) : ''

  async function submit() {
    if (!preset) return
    setBusy(true); setError(null)
    try {
      const body: any = {
        finCode, cause: preset.cause, desc: preset.desc, result: preset.result,
        vin: vin || null, mecIso: init?.mecIso || null,
        km: km || null,
      }
      if (isRem) {
        if (garageMode === 'list') {
          const g = (providers || []).find(p => p.cidPrx === garageCid)
          if (!g) { setError('Choisis un garage'); setBusy(false); return }
          body.toCidIntv = g.cidPrx
          body.comment = `// ADRESSE TO REM AUTO : ${g.nom} ${g.numRue} ${g.rue} ${g.cp} ${g.localite} //`
          body.destination = { address: `${g.rue} ${g.numRue}, ${g.cp} ${g.localite}`, lat: g.lat, lng: g.lng }
        } else {
          if (!manual.rue || !manual.cp || !manual.loc) { setError('Complète l’adresse (rue, code postal, ville)'); setBusy(false); return }
          body.manualAddress = manual
          body.destination = { address: `${manual.rue} ${manual.num}, ${manual.cp} ${manual.loc}`.trim() }
        }
      }
      const r = await fetch(`/api/missions/${missionId}/touring-close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || `Clôture refusée par COMEX (statut ${j.statusAfter ?? '?'})`); setBusy(false); return }
      onDone?.()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Erreur'); setBusy(false)
    }
  }

  const presetsShown = tab === 'dsp' ? PRESETS_DSP : [...PRESETS_REM, PRESET_REM_CATCHALL]

  return (
    <div className="fixed inset-0 z-[60] bg-ink/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-xl">🚗</span>
          <div className="font-bold text-ink">Clôturer chez Touring</div>
          {init?.plate && <span className="ml-auto font-mono font-bold text-sm bg-ink text-white px-2 py-0.5 rounded">{init.plate}</span>}
          <button onClick={onClose} className="ml-2 text-ink-secondary hover:text-ink text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {loadErr && <div className="bg-critical/10 text-critical rounded-lg p-3 text-sm">{loadErr}</div>}
          {!init && !loadErr && <div className="text-ink-secondary text-sm py-6 text-center">Chargement…</div>}

          {init && (
            <>
              {/* onglets */}
              <div className="flex bg-surface-2 border rounded-xl p-1 gap-1">
                {(['dsp', 'rem'] as const).map(t => (
                  <button key={t} onClick={() => { setTab(t); setPreset(null); setVr(false) }}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold ${tab === t ? (t === 'rem' ? 'bg-surface text-amber-700 shadow-sm' : 'bg-surface text-ink shadow-sm') : 'text-ink-secondary'}`}>
                    {t === 'dsp' ? 'Dépannage sur place' : 'Remorquage'}
                  </button>
                ))}
              </div>

              {/* grille presets */}
              <div className="grid grid-cols-3 gap-2">
                {presetsShown.map(p => {
                  const sel = preset?.key === p.key
                  const isCatch = p.key === 'rem_autre'
                  return (
                    <button key={p.key} onClick={() => { setPreset(p); setVr(false) }}
                      className={`rounded-xl border p-2 text-center min-h-[74px] flex flex-col items-center justify-center gap-1 ${isCatch ? 'col-span-3 flex-row' : ''} ${sel ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400' : 'bg-surface-2 hover:bg-surface-hover'}`}>
                      <span className="text-[11px] font-bold leading-tight text-ink">{p.label.replace(/ → .*/, '')}</span>
                    </button>
                  )
                })}
              </div>

              {/* +VR (remorquage) */}
              {isRem && (
                <label className="flex items-center justify-between p-3 border rounded-xl bg-surface-2 cursor-pointer">
                  <span className="text-sm font-semibold text-ink">+ Demander un VR (véhicule de remplacement)</span>
                  <input type="checkbox" checked={vr} onChange={e => setVr(e.target.checked)} className="w-5 h-5 accent-amber-500" />
                </label>
              )}

              {/* garage (remorquage) */}
              {isRem && (
                <div className="border border-amber-300 bg-amber-50/50 rounded-xl p-3">
                  <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Où déposer le véhicule ?</div>
                  <div className="flex gap-1 mb-3">
                    {(['list', 'manual'] as const).map(gm => (
                      <button key={gm} onClick={() => setGarageMode(gm)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${garageMode === gm ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary'}`}>
                        {gm === 'list' ? 'Garage de la liste' : 'Autre adresse'}
                      </button>
                    ))}
                  </div>
                  {garageMode === 'list' ? (
                    providers == null ? <div className="text-xs text-ink-secondary py-2">Chargement des garages…</div> : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {providers.map(g => (
                          <button key={g.cidPrx} onClick={() => setGarageCid(g.cidPrx)}
                            className={`w-full text-left flex items-center gap-2 p-2 rounded-lg border ${garageCid === g.cidPrx ? 'border-success bg-success-soft/40 ring-1 ring-success' : 'bg-surface'}`}>
                            <div className="min-w-0"><div className="text-sm font-bold text-ink truncate">{g.nom}</div><div className="text-[11px] text-ink-secondary truncate">{g.rue} {g.numRue}, {g.cp} {g.localite}</div></div>
                            <span className="ml-auto text-xs text-ink-secondary whitespace-nowrap">{g.distance} km</span>
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input placeholder="Nom (optionnel)" value={manual.nom} onChange={e => setManual({ ...manual, nom: e.target.value })} className="col-span-2 border rounded-lg px-3 py-2 text-sm bg-surface" />
                      <input placeholder="Rue" value={manual.rue} onChange={e => setManual({ ...manual, rue: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                      <input placeholder="N°" value={manual.num} onChange={e => setManual({ ...manual, num: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                      <input placeholder="Code postal" value={manual.cp} onChange={e => setManual({ ...manual, cp: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                      <input placeholder="Ville" value={manual.loc} onChange={e => setManual({ ...manual, loc: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                    </div>
                  )}
                </div>
              )}

              {/* km + VIN */}
              {preset && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-ink-secondary uppercase">Kilométrage (optionnel)</label>
                    <input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" placeholder="—" className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-surface-2" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-ink-secondary uppercase">VIN</label>
                    <input value={vin} onChange={e => setVin(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm bg-surface-2 font-mono" />
                  </div>
                </div>
              )}
            </>
          )}

          {error && <div className="bg-critical/10 text-critical rounded-lg p-3 text-sm">{error}</div>}
        </div>

        {/* footer */}
        <div className="px-4 py-3 border-t flex gap-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border text-ink-secondary text-sm font-semibold">Fermer</button>
          <button onClick={submit} disabled={!preset || busy}
            className="flex-1 px-4 py-2.5 rounded-xl bg-success hover:bg-success-soft text-white text-sm font-bold disabled:opacity-40">
            {busy ? 'Clôture en cours…' : `Clôturer${finCode ? ' · ' + endMissionLabel(finCode) : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
