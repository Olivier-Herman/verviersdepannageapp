'use client'
// src/components/touring/TouringCloseModal.tsx
//
// Modal de clôture Touring COMEX (chauffeur & dispatch). Le chauffeur choisit une
// panne (preset). Le dispatch a les raccourcis + le FORMULAIRE COMPLET (Fin de
// mission + 3 codes panne éditables) ; choisir un preset préremplit les 3 selects.
// Sur remorquage : garage de la liste ou adresse libre. Fermable ✕/Fermer only.
// Olivier 2026-08-06.

import { useEffect, useState } from 'react'
import {
  ALL_DSP_PRESETS, ALL_REM_PRESETS, isCatchAllPreset,
  endMissionLabel, REM_FIN_CODES, type ClosePreset,
} from '@/lib/touring/close-presets'
import { PANNE_CAUSE, PANNE_DESC, PANNE_RESULT, type CodeOption } from '@/lib/touring/close-referentials'
import AddressField from '@/components/AddressField'

const GM_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

// Petit clin d'œil au chauffeur à l'ouverture (mode driver). Olivier 2026-08-06.
const DRIVER_INTROS = [
  'Bravo champion 🏆 elle avait quoi cette caisse ?',
  'Beau sauvetage 💪 c’était quoi le souci ?',
  'Encore un dépannage de maître 😎 dis-moi la panne !',
  'Mission accomplie 🚗 alors, elle avait quoi cette fois ?',
]

interface Provider {
  cidPrx: string; nom: string; rue: string; numRue: string
  cp: string; localite: string; distance: number; lat: number; lng: number
}
interface InitData {
  finCodes: { code: string; label: string; rem: boolean }[]
  vin: string; mecIso: string; status: string; plate: string
}

// Ajoute l'option courante à la liste si absente (code hors référentiel curé).
function withCurrent(list: CodeOption[], code: string): CodeOption[] {
  if (!code || list.some(o => o.code === code)) return list
  return [{ code, label: `Code ${code}` }, ...list]
}

export default function TouringCloseModal({
  missionId, mode = 'driver', onClose, onDone, mandatory = false, blockExit = false,
  leg, vrAllowed = false, initialVr = false, fallbackVin = '', fallbackKm = '', forcedFin = '',
}: {
  missionId: string
  mode?: 'driver' | 'dispatch'
  onClose: () => void
  onDone?: (result?: { finCode: string; destination?: { address: string; lat?: number; lng?: number } }) => void
  /** Vrai écran plein cadre (étape de clôture Touring, pas un popup superposé). */
  mandatory?: boolean
  /** Sortie bloquée : masque la ✕ (le chauffeur doit valider) — gate DSP « Terminer »
   *  uniquement. Échappatoire seulement si COMEX n'est pas prêt. */
  blockExit?: boolean
  /** Contexte chauffeur : 'dsp' = écran Dépannage sur place (fin 00) ; 'rem' = écran
   *  Remorquage (fin 02, +VR=03). Absent (dispatch) = onglets libres + formulaire complet. */
  leg?: 'dsp' | 'rem'
  /** VR autorisé par COMEX (vr_proposed) → affiche le toggle VR sur l'écran Remorquage. */
  vrAllowed?: boolean
  /** Pré-coche le +VR (raccourci « Demander un VR »). */
  initialVr?: boolean
  /** Repli VIN / km depuis la fiche VD Soft si COMEX ne les a pas (évite la double saisie). */
  fallbackVin?: string
  fallbackKm?: string | number
  /** Force le code Fin de mission (ex. '05' mise en parc) : les presets ne l'écrasent
   *  pas, et comme 05 ∉ REM_FIN_CODES, garage + VR sont masqués automatiquement. */
  forcedFin?: string
}) {
  const [init, setInit]         = useState<InitData | null>(null)
  const [loadErr, setLoadErr]   = useState<string | null>(null)
  const [tab, setTab]           = useState<'dsp' | 'rem'>(leg ?? (mandatory ? 'dsp' : 'rem'))
  const [wantVr, setWantVr]     = useState(initialVr)
  const [presetKey, setPresetKey] = useState<string>('')
  const [codes, setCodes]       = useState({ cause: '', desc: '', result: '' })
  const [finSel, setFinSel]     = useState(forcedFin || '')
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [garageMode, setGarageMode] = useState<'list' | 'manual'>('list')
  // « Autre adresse » : 1 champ Nom + 1 champ Adresse (Google autocomplete) qui
  // découpe vers rue/num/cp/ville pour le formulaire Touring. Olivier 2026-08-10.
  const [addrText, setAddrText] = useState('')
  const [coords, setCoords]     = useState<{ lat: number; lng: number } | null>(null)
  const [garageCid, setGarageCid]   = useState<string>('')
  const [manual, setManual]     = useState({ nom: '', rue: '', num: '', cp: '', loc: '' })
  const [km, setKm]             = useState('')
  const [vin, setVin]           = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [errorCtx, setErrorCtx] = useState<any>(null)
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [intro] = useState(() => DRIVER_INTROS[Math.floor(Math.random() * DRIVER_INTROS.length)])

  const isDispatch = mode === 'dispatch'
  const isRem = REM_FIN_CODES.has(finSel)

  // Init (codes Fin de mission dispo, VIN, MEC).
  useEffect(() => {
    let alive = true
    fetch(`/api/missions/${missionId}/touring-close`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (d.error) { setLoadErr(d.error); return }
        setInit(d)
        // VIN/km : COMEX en priorité, sinon repli sur la fiche VD Soft (le VIN y est,
        // récupéré de COMEX à la création). Évite un champ vierge au DSP→REM alors que
        // la jambe DSP ne les renvoie pas encore. Olivier 2026-08-07.
        setVin(d.vin || fallbackVin || '')
        // Pré-remplissage. Priorité à la 1ère clôture déjà encodée (d.prefill : codes
        // repris de la clôture précédente du dossier, ex. seq 200 + demande VR) →
        // le chauffeur ne ré-encode pas. Sinon repli sur les codes présents dans COMEX.
        // Olivier 2026-08-07.
        const c  = d.closure
        const pf = d.prefill
        if (pf && (pf.cause || pf.desc || pf.result)) setCodes({ cause: pf.cause || '', desc: pf.desc || '', result: pf.result || '' })
        else if (c && (c.cause || c.desc || c.result)) setCodes({ cause: c.cause || '', desc: c.desc || '', result: c.result || '' })
        if (!forcedFin) {
          let fin = pf?.finCode || c?.finCode
          // RE-clôture d'une jambe (prefill présent = une clôture déjà faite sur le
          // dossier) : NE JAMAIS re-demander le VR (un seul VR par dossier). Le code
          // 03 (Fin + Rem + VR) est ramené à 02 (Fin + Rem). Olivier 2026-08-07.
          if (pf && fin === '03') fin = '02'
          if (fin) setFinSel(fin)
        }
        if (pf) setWantVr(false)   // re-clôture : VR déjà demandé → décoché par défaut
        if (pf?.toCidIntv) setGarageCid(String(pf.toCidIntv))   // garage de la 1ère clôture pré-sélectionné
        if (pf?.km) setKm(String(pf.km))
        else if (c?.km) setKm(String(c.km))
        else if (fallbackKm !== '' && fallbackKm != null) setKm(String(fallbackKm))
      })
      .catch(() => alive && setLoadErr('Impossible de charger la clôture'))
    return () => { alive = false }
  }, [missionId])

  // Modal plein premier plan : on verrouille le scroll de la page derrière.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Sur un remorquage avec les 3 codes → charger la liste des garages.
  useEffect(() => {
    if (!isRem || !codes.cause || !codes.desc || !codes.result) { setProviders(null); return }
    let alive = true
    setProviders(null)
    const q = new URLSearchParams({ providers: '1', cause: codes.cause, desc: codes.desc, result: codes.result })
    fetch(`/api/missions/${missionId}/touring-close?${q}`)
      .then(r => r.json())
      .then(d => { if (!alive) return; const list: Provider[] = d.providers || []; setProviders(list); if (list[0] && !garageCid) setGarageCid(list[0].cidPrx) })
      .catch(() => alive && setProviders([]))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRem, codes.cause, codes.desc, codes.result, missionId])

  function pickPreset(p: ClosePreset) {
    setPresetKey(p.key)
    setCodes({ cause: p.cause, desc: p.desc, result: p.result })
    setFinSel(forcedFin || (p.rem && wantVr ? '03' : p.fin))   // forcedFin (05) l'emporte ; sinon +VR → 03
    setGarageCid('')
  }

  const vrOn = finSel === '03' || (tab === 'rem' && wantVr)
  function toggleVr(on: boolean) {
    setWantVr(on)
    if (presetKey) setFinSel(on ? '03' : '02')   // maj immédiate si un preset est déjà choisi
  }

  async function reportToMobi() {
    setReportState('sending')
    try {
      await fetch(`/api/missions/${missionId}/touring-close/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error, attempted: errorCtx?.attempted, comexResponse: errorCtx?.comexResponse }),
      })
      setReportState('sent')
    } catch { setReportState('idle') }
  }

  async function submit() {
    if (!finSel || !codes.cause || !codes.desc || !codes.result) { setError('Complète la panne (Fin de mission + les 3 codes)'); return }
    setBusy(true); setError(null)
    let body: any = null
    try {
      body = { finCode: finSel, cause: codes.cause, desc: codes.desc, result: codes.result, vin: vin || null, mecIso: init?.mecIso || null, km: km || null }
      // Garage/dépose. Dispatch : liste ou adresse libre. Chauffeur : uniquement si
      // Touring a renvoyé une liste préencodée NON vide (il choisit) ; sinon on ne
      // fixe pas de garage → la clôture +REM ferme la fiche dépannage, la jambe
      // remorquage part au dispatch. Olivier 2026-08-06.
      const hasGarageList = providers != null && providers.length > 0
      if (isRem && (isDispatch || hasGarageList)) {
        if (garageMode === 'manual') {   // Olivier 2026-08-10 : « Autre adresse » aussi pour le chauffeur.
          if (!manual.rue || !manual.cp || !manual.loc) { setError('Complète l’adresse (rue, code postal, ville)'); setBusy(false); return }
          body.manualAddress = manual
          body.destination = { address: `${manual.rue} ${manual.num}, ${manual.cp} ${manual.loc}`.trim(), ...(coords ? { lat: coords.lat, lng: coords.lng } : {}) }
        } else {
          const g = (providers || []).find(p => p.cidPrx === garageCid)
          if (!g) { setError('Choisis un garage'); setBusy(false); return }
          body.toCidIntv = g.cidPrx
          body.comment = `// ADRESSE TO REM AUTO : ${g.nom} ${g.numRue} ${g.rue} ${g.cp} ${g.localite} //`
          body.destination = { address: `${g.rue} ${g.numRue}, ${g.cp} ${g.localite}`, lat: g.lat, lng: g.lng }
        }
      }
      const r = await fetch(`/api/missions/${missionId}/touring-close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setError(j.error || `Clôture refusée par COMEX (statut ${j.statusAfter ?? '?'})`)
        setErrorCtx({ attempted: body, comexResponse: j }); setReportState('idle'); setBusy(false); return
      }
      if (onDone) onDone({ finCode: finSel, destination: body.destination }); else onClose()
    } catch (e: any) {
      setError(e?.message || 'Erreur')
      setErrorCtx({ attempted: body, comexResponse: { exception: String(e?.message || e) } }); setReportState('idle'); setBusy(false)
    }
  }

  // Les listes portent déjà le catch-all « Autre » EN DERNIER (Olivier 2026-08-11).
  const presetsShown = tab === 'dsp' ? ALL_DSP_PRESETS : ALL_REM_PRESETS
  const selCls = 'mt-1 w-full border rounded-lg px-2.5 py-2 text-sm bg-surface-2'
  const lblCls = 'text-[11px] font-bold text-ink-secondary uppercase tracking-wide'
  const shortLabel = (p: ClosePreset) => p.label.replace(/ → .*/, '')
  // COMEX n'autorise la clôture qu'à partir de « sur place » (06). 07 = déjà clôturée.
  const statusBlock = init?.status && init.status !== '06'
    ? (init.status === '07' ? 'Cette mission est déjà clôturée dans Touring.'
       : `Clôture possible uniquement quand le chauffeur est sur place (statut COMEX actuel : ${init.status}).`)
    : null

  // `mandatory` = vrai écran plein cadre (étape de clôture Touring, pas un popup) ;
  // sinon bottom-sheet superposé (dispatch, demande VR). Olivier 2026-08-06.
  const rootCls = mandatory
    ? 'fixed inset-0 z-[100] bg-surface flex flex-col overscroll-contain'
    : 'fixed inset-0 z-[100] bg-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overscroll-contain touch-none'
  const panelCls = mandatory
    ? 'bg-surface w-full h-full flex flex-col overscroll-contain'
    : 'bg-surface w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-2xl overscroll-contain'

  return (
    <div className={rootCls}>
      <div className={panelCls}>
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <span className="text-xl">🚗</span>
          <div className="font-bold text-ink">{isDispatch ? 'Clôturer chez Touring' : forcedFin === '05' ? 'Mise en parc — Touring' : tab === 'rem' ? 'Remorquage — Touring' : 'Clôture — la panne'}</div>
          {init?.plate && <span className="ml-auto font-mono font-bold text-sm bg-ink text-white px-2 py-0.5 rounded">{init.plate}</span>}
          {!blockExit && (
            <button onClick={onClose} className="ml-2 text-ink-secondary hover:text-ink text-xl leading-none">✕</button>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
          {loadErr && <div className="bg-critical/10 text-critical rounded-lg p-3 text-sm">{loadErr}</div>}
          {!init && !loadErr && <div className="text-ink-secondary text-sm py-6 text-center">Chargement…</div>}

          {init && statusBlock && (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-xl p-3 text-sm flex items-start gap-2">
              <span className="text-lg leading-none">⏳</span><span>{statusBlock}</span>
            </div>
          )}

          {/* Sortie bloquée : ne jamais piéger le chauffeur si Touring n'est pas prêt
              (mauvais statut) ou si le chargement échoue → échappatoire. */}
          {blockExit && (loadErr || statusBlock) && (
            <button onClick={onClose}
              className="w-full py-3 bg-surface-2 border rounded-2xl font-bold text-sm text-ink-secondary">
              Continuer sans clôturer Touring →
            </button>
          )}

          {init && !statusBlock && (
            <>
              {!isDispatch && tab === 'dsp' && (
                <div className="text-center text-[15px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl py-2.5 px-3">{intro}</div>
              )}
              {/* onglets — dispatch uniquement ; côté chauffeur l'écran est fixé par le
                  contexte (leg) : DSP → Dépannage sur place, REM → Remorquage. */}
              {isDispatch ? (
                <div className="flex bg-surface-2 border rounded-xl p-1 gap-1">
                  {(['dsp', 'rem'] as const).map(t => (
                    <button key={t} onClick={() => { setTab(t); setPresetKey(''); }}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold ${tab === t ? (t === 'rem' ? 'bg-surface text-amber-700 shadow-sm' : 'bg-surface text-ink shadow-sm') : 'text-ink-secondary'}`}>
                      {t === 'dsp' ? 'Dépannage sur place' : 'Remorquage'}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={`rounded-xl px-3 py-2 text-sm font-bold text-center ${tab === 'rem' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-surface-2 text-ink border'}`}>
                  {forcedFin === '05' ? '🅿️ Mise en parc (Fin Remorquage + Transfert)' : tab === 'rem' ? '🚛 Remorquage' : '🔧 Dépannage sur place'}
                </div>
              )}

              {/* presets — chips (dispatch) / tuiles à icônes (chauffeur) */}
              {isDispatch ? (
                <div className="rounded-xl border border-[#1f5fd6]/25 bg-[#1f5fd6]/[.06] p-3">
                  <div className="text-[11px] font-extrabold text-[#1f5fd6] uppercase tracking-wide mb-2.5">⚡ Raccourcis — remplit les codes</div>
                  <div className="flex flex-wrap gap-2">
                    {presetsShown.map(p => {
                      const sel = presetKey === p.key
                      return (
                        <button key={p.key} onClick={() => pickPreset(p)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${sel ? 'bg-surface border-[#1f5fd6] ring-2 ring-[#1f5fd6] text-ink' : 'bg-surface border text-ink-secondary hover:text-ink hover:border-[#1f5fd6]/40'}`}>
                          <span className="text-sm leading-none">{p.icon}</span>{shortLabel(p)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {presetsShown.map(p => {
                    const sel = presetKey === p.key
                    const isCatch = isCatchAllPreset(p)
                    return (
                      <button key={p.key} onClick={() => pickPreset(p)}
                        className={`rounded-2xl border p-3 flex items-center justify-center gap-1.5 transition ${isCatch ? 'col-span-3 py-3.5' : 'flex-col min-h-[88px]'} ${sel ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400 shadow-sm' : 'bg-surface-2 hover:bg-surface-hover border'}`}>
                        <span className="text-[26px] leading-none">{p.icon}</span>
                        <span className="text-[11px] font-bold leading-tight text-ink text-center">{shortLabel(p)}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Codes panne — sélecteurs éditables (dispatch ET chauffeur), pré-remplis
                  depuis Touring : le chauffeur VOIT les codes déjà mis et peut les ajuster,
                  sans être obligé de choisir un preset. La « Fin de mission » reste au
                  dispatch (côté chauffeur = contexte leg + toggle VR). Olivier 2026-08-07. */}
              {init && (
                <div className="space-y-2.5 border rounded-xl p-3 bg-surface-2/50">
                  {!isDispatch && (codes.cause || codes.desc || codes.result) && !presetKey && (
                    <div className="text-[12px] text-emerald-700 font-semibold">✅ Codes déjà fournis par Touring — vérifie/ajuste, ou choisis une panne ci-dessus.</div>
                  )}
                  {isDispatch && (
                  <div>
                    <label className={lblCls}>Fin de mission</label>
                    <select value={finSel} onChange={e => setFinSel(e.target.value)} className={selCls}>
                      <option value="">— choisir —</option>
                      {init.finCodes.map(f => <option key={f.code} value={f.code}>{f.label}</option>)}
                    </select>
                  </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={lblCls}>Incident</label>
                      <select value={codes.cause} onChange={e => setCodes({ ...codes, cause: e.target.value })} className={selCls}>
                        <option value="">—</option>
                        {withCurrent(PANNE_CAUSE, codes.cause).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lblCls}>Type</label>
                      <select value={codes.desc} onChange={e => setCodes({ ...codes, desc: e.target.value })} className={selCls}>
                        <option value="">—</option>
                        {withCurrent(PANNE_DESC, codes.desc).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lblCls}>Résultat</label>
                      <select value={codes.result} onChange={e => setCodes({ ...codes, result: e.target.value })} className={selCls}>
                        <option value="">—</option>
                        {withCurrent(PANNE_RESULT, codes.result).map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* +VR (remorquage) — visible seulement si VR autorisé par COMEX (ou dispatch) */}
              {tab === 'rem' && (isDispatch || vrAllowed) && (
                <label className="flex items-center justify-between p-3 border rounded-xl bg-surface-2 cursor-pointer">
                  <span className="text-sm font-semibold text-ink">+ Demander un VR (véhicule de remplacement)</span>
                  <input type="checkbox" checked={vrOn} onChange={e => toggleVr(e.target.checked)} className="w-5 h-5 accent-amber-500" />
                </label>
              )}

              {/* garage (remorquage). Dispatch : toujours (liste + adresse libre).
                  Chauffeur : seulement si Touring renvoie une liste préencodée NON vide
                  pour ce REM → il choisit ; sinon rien (la jambe REM part au dispatch).
                  Olivier 2026-08-06. */}
              {isRem && (isDispatch || (providers != null && providers.length > 0)) && (
                <div className="border border-amber-300 bg-amber-50/50 rounded-xl p-3">
                  <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Où déposer le véhicule ?</div>
                  {/* Olivier 2026-08-10 : le chauffeur doit aussi pouvoir saisir une
                      AUTRE adresse (pas seulement un garage de la liste). */}
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
                    <div className="space-y-2">
                      <input placeholder="Nom (optionnel — garage, société…)" value={manual.nom}
                        onChange={e => setManual({ ...manual, nom: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 text-sm bg-surface" />
                      <AddressField
                        value={addrText}
                        onChange={setAddrText}
                        gmKey={GM_KEY}
                        placeholder="Rechercher l'adresse (Google)…"
                        onSelect={(_addr, lat, lng) => setCoords({ lat, lng })}
                        onParts={p => setManual(m => ({ ...m, rue: p.rue, num: p.num, cp: p.cp, loc: p.loc, nom: m.nom || p.name || '' }))}
                      />
                      {(manual.rue || manual.cp) && (
                        <div className="text-[11px] text-ink-secondary bg-surface-2 border rounded-lg px-2 py-1.5">
                          → {[`${manual.rue} ${manual.num}`.trim(), `${manual.cp} ${manual.loc}`.trim()].filter(Boolean).join(', ')}
                          {(!manual.rue || !manual.cp || !manual.loc) && <span className="text-amber-600"> · complète les champs manquants ci-dessous</span>}
                        </div>
                      )}
                      {/* Repli manuel si l'autocomplete n'a pas tout rempli */}
                      {(manual.rue || manual.cp || manual.loc) && (!manual.rue || !manual.cp || !manual.loc) && (
                        <div className="grid grid-cols-2 gap-2">
                          <input placeholder="Rue" value={manual.rue} onChange={e => setManual({ ...manual, rue: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                          <input placeholder="N°" value={manual.num} onChange={e => setManual({ ...manual, num: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                          <input placeholder="Code postal" value={manual.cp} onChange={e => setManual({ ...manual, cp: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                          <input placeholder="Ville" value={manual.loc} onChange={e => setManual({ ...manual, loc: e.target.value })} className="border rounded-lg px-3 py-2 text-sm bg-surface" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* km + VIN — toujours visibles (pré-remplis COMEX ou repli fiche VD Soft) */}
              {init && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lblCls}>Kilométrage (optionnel)</label>
                    <input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" placeholder="—" className={selCls} />
                  </div>
                  <div>
                    <label className={lblCls}>VIN</label>
                    <input value={vin} onChange={e => setVin(e.target.value)} className={selCls + ' font-mono'} />
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="bg-critical/10 text-critical rounded-lg p-3 text-sm space-y-2">
              <div>{error}</div>
              <div className="text-ink-secondary text-xs">Tu peux clôturer normalement dans COMEX, ou m'envoyer l'erreur :</div>
              <button onClick={reportToMobi} disabled={reportState !== 'idle'}
                className="px-3 py-1.5 rounded-lg bg-ink text-white text-xs font-bold disabled:opacity-60">
                {reportState === 'sending' ? 'Envoi…' : reportState === 'sent' ? '✅ Envoyé à Mobi' : '📧 Envoyer à Mobi'}
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex gap-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border text-ink-secondary text-sm font-semibold">Fermer</button>
          <button onClick={submit} disabled={busy || !finSel || !!statusBlock}
            className="flex-1 px-4 py-2.5 rounded-xl bg-success hover:bg-success-soft text-white text-sm font-bold disabled:opacity-40">
            {busy ? 'Clôture en cours…' : `Clôturer${finSel ? ' · ' + endMissionLabel(finSel) : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
