'use client'
// src/components/cloture/CloseScreen.tsx
//
// FLUX 2 — la page de clôture UNIVERSELLE (Olivier 2026-08-11).
//
// Le même écran pour toutes les assistances : motif, dépose, signature, clé,
// localisation du véhicule, châssis + kilométrage, remarque. Ce qui change d'une
// assistance à l'autre vit DERRIÈRE (transformation serveur), pas ici.
//
// Trois règles de terrain :
//   • Les deux branches de motifs sont ÉTANCHES : l'issue choisie sur la page
//     Action fixe la branche, on ne reçoit QUE ses motifs.
//   • Sur un REMORQUAGE, « où est le véhicule » et « où est la clé » ne sont PAS
//     demandés ici : le chauffeur ne peut pas le savoir avant d'avoir déposé.
//     Ces deux questions apparaissent à l'arrivée (écran de fin).
//   • Sans châssis NI kilométrage, on n'envoie rien : on emmène le chauffeur aux
//     photos, d'où l'OCR remplit les deux champs. Guider, pas bloquer.

import { useEffect, useState } from 'react'
import SigPad from '@/components/mission/SigPad'
import AddressField from '@/components/AddressField'
import type { OutcomeKey } from './ActionScreen'

const GM_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

// Préselections — « Autre » toujours en dernier, valeur par défaut en tête.
export const VEHICLE_LOCATIONS = ['Parking', 'Devant la maison', 'Dans la rue', 'Devant le garage', "Dans l'atelier", 'Autre']
export const KEY_LOCATIONS_F2  = ['Réception', 'Boîte à clés', 'Boîte aux lettres', 'Remise au client', 'Dans le véhicule', 'Autre']
export const DEFAULT_VEHICLE_LOCATION = 'Parking'
export const DEFAULT_KEY_LOCATION     = 'Réception'

interface MotifItem { key: string; label: string; icon: string; catchAll: boolean }
interface Provider {
  cidPrx: string; nom: string; rue: string; numRue: string
  cp: string; localite: string; distance: number; lat: number; lng: number
}

export interface CloseCommon {
  signature: 'signed' | 'refus' | 'absent' | null
  signaturePng: string | null
  keyRecovered: boolean | null
  keyLocation: string | null
  vehicleLocation: string | null
  vin: string
  km: string
  remark: string
}

const BRANCH_OF: Partial<Record<OutcomeKey, 'mobilite' | 'remorquage'>> = {
  dsp: 'mobilite', rem2dsp: 'mobilite', rem: 'remorquage', rem_vr: 'remorquage', park: 'remorquage',
}

export default function CloseScreen({
  missionId, outcome, plate, vehicle, fallbackVin, fallbackKm, photosDone, dprCodes,
  onNeedPhotos, onBack, onDone,
}: {
  missionId: string
  outcome: OutcomeKey
  plate?: string | null
  vehicle?: string | null
  fallbackVin?: string | null
  fallbackKm?: string | number | null
  /** Les 3 photos (véhicule, châssis, compteur) sont-elles prises ? */
  photosDone: boolean
  dprCodes?: { code: string; label: string }[]
  onNeedPhotos: () => void
  onBack: () => void
  /** Transformation réussie → le parent enchaîne sur la clôture VD Soft. */
  onDone: (r: { outcome: OutcomeKey; common: CloseCommon; destination?: { address: string; lat?: number; lng?: number } }) => void
}) {
  const branch = BRANCH_OF[outcome] || null
  const isRem  = outcome === 'rem' || outcome === 'rem_vr'
  const isDpr  = outcome === 'dpr'
  // Livraison : les codes ont été encodés sur la jambe dépannage, on les reprend
  // côté serveur → aucun motif à re-choisir. Restent signature, véhicule, clé, km.
  const isDelivered = outcome === 'delivered'
  // Sur un remorquage, véhicule + clé se demandent à l'arrivée, pas ici.
  const askLocKey = !isRem && !isDpr

  const [motifs, setMotifs]       = useState<MotifItem[] | null>(null)
  const [suggested, setSuggested] = useState<string[]>([])
  const [motifKey, setMotifKey]   = useState('')
  const [dprCode, setDprCode]     = useState('')

  const [providers, setProviders]   = useState<Provider[] | null>(null)
  const [destMode, setDestMode]     = useState<'list' | 'manual'>('list')
  const [garageCid, setGarageCid]   = useState('')
  const [addrText, setAddrText]     = useState('')
  const [coords, setCoords]         = useState<{ lat: number; lng: number } | null>(null)
  const [manual, setManual]         = useState({ nom: '', rue: '', num: '', cp: '', loc: '' })

  const [sig, setSig]               = useState<'signed' | 'refus' | 'absent' | null>(null)
  const [sigPng, setSigPng]         = useState<string | null>(null)
  const [showPad, setShowPad]       = useState(false)
  const [keyRecovered, setKeyRec]   = useState<boolean>(true)
  const [keyLoc, setKeyLoc]         = useState(DEFAULT_KEY_LOCATION)
  const [keyOther, setKeyOther]     = useState('')
  const [vehLoc, setVehLoc]         = useState(DEFAULT_VEHICLE_LOCATION)
  const [vehOther, setVehOther]     = useState('')
  const [vin, setVin]               = useState('')
  const [km, setKm]                 = useState('')
  const [remark, setRemark]         = useState('')

  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Motifs de la branche + priorisation IA (l'IA ne renvoie que des clés du
  // catalogue : impossible de recevoir un code inventé).
  useEffect(() => {
    if (!branch) { setMotifs([]); return }
    let alive = true
    fetch(`/api/missions/${missionId}/cloture/motifs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    })
      .then(r => r.json())
      .then(d => { if (!alive) return; setMotifs(d.motifs || []); setSuggested(d.suggested || []) })
      .catch(() => alive && setMotifs([]))
    return () => { alive = false }
  }, [missionId, branch])

  // Repli VIN / km depuis la fiche.
  useEffect(() => {
    if (fallbackVin) setVin(String(fallbackVin).slice(-5).toUpperCase())
    if (fallbackKm !== '' && fallbackKm != null) setKm(String(fallbackKm))
  }, [fallbackVin, fallbackKm])

  // Liste des garages Touring dès qu'un motif est choisi (elle dépend des codes).
  useEffect(() => {
    if (!isRem || !motifKey) { setProviders(null); return }
    let alive = true
    // Les garages dépendent des codes du motif → c'est le serveur qui les résout.
    fetch(`/api/missions/${missionId}/cloture?garages=1&branch=${branch}&motifKey=${encodeURIComponent(motifKey)}`,
      { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (alive) setProviders(d.providers || []) })
      .catch(() => alive && setProviders([]))
    return () => { alive = false }
  }, [isRem, motifKey, missionId, branch])

  // Motifs triés : suggestions en tête, « Autre » toujours en dernier.
  const ordered = (motifs || []).slice().sort((a, b) => {
    if (a.catchAll) return 1
    if (b.catchAll) return -1
    const ia = suggested.indexOf(a.key), ib = suggested.indexOf(b.key)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  const vinEmpty = !vin.trim(), kmEmpty = !km.trim()
  const needPhotos = (vinEmpty && kmEmpty) || !photosDone
  const destOk = !isRem || (destMode === 'list' ? !!garageCid : !!manual.rue && !!manual.cp)
  const canSubmit = isDpr ? !!dprCode : isDelivered ? true : (!!motifKey && destOk)

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function submit() {
    setBusy(true); setError(null)
    const common: CloseCommon = {
      signature: sig, signaturePng: sigPng,
      keyRecovered: askLocKey ? keyRecovered : null,
      keyLocation:  askLocKey ? (keyLoc === 'Autre' ? (keyOther || 'Autre') : keyLoc) : null,
      vehicleLocation: askLocKey ? (vehLoc === 'Autre' ? (vehOther || 'Autre') : vehLoc) : null,
      vin: vin.trim().toUpperCase(), km: km.trim(), remark: remark.trim(),
    }
    const body: any = { outcome, motifKey: motifKey || null, dprCode: dprCode || null, common }

    if (isRem) {
      if (destMode === 'manual') {
        body.manualAddress = manual
        body.destination = {
          address: `${manual.rue} ${manual.num}, ${manual.cp} ${manual.loc}`.trim(),
          ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        }
      } else {
        const g = (providers || []).find(p => p.cidPrx === garageCid)
        if (g) {
          body.toCidIntv = g.cidPrx
          body.comment = `// ADRESSE TO REM AUTO : ${g.nom} ${g.numRue} ${g.rue} ${g.cp} ${g.localite} //`
          body.destination = { address: `${g.rue} ${g.numRue}, ${g.cp} ${g.localite}`, lat: g.lat, lng: g.lng }
        }
      }
    }

    try {
      const r = await fetch(`/api/missions/${missionId}/cloture`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) { setError(j.error || 'Clôture refusée'); setBusy(false); return }
      onDone({ outcome, common, destination: body.destination })
    } catch (e: any) {
      setError(e?.message || 'Erreur réseau'); setBusy(false)
    }
  }

  const sectCls = 'text-ink-muted text-[11px] uppercase tracking-widest font-bold pt-1'
  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick}
      className={`px-3.5 py-2.5 rounded-full text-xs font-bold border transition ${
        on ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300' : 'border bg-surface-2 text-ink-secondary'
      }`}>{label}</button>
  )

  return (
    <div className="fixed inset-0 bg-surface z-40 flex flex-col">
      <div className="bg-surface border-b border px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 flex items-center justify-center bg-surface-hover rounded-xl text-ink">←</button>
          <div className="flex-1 min-w-0">
            <p className="text-ink font-semibold truncate">
              {isDpr ? 'Déplacement pour rien' : isDelivered ? 'Livraison — clôture' : isRem ? 'Clôture · remorquage' : 'Clôture · dépannage réussi'}
            </p>
            <p className="text-ink-muted text-xs truncate">{[vehicle, plate].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* ── Déplacement pour rien : pas de code panne, juste le motif ─────── */}
        {isDpr ? (
          <>
            <div className="bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 rounded-xl px-3 py-3 text-sm font-medium">
              Pas de panne à encoder — dis simplement pourquoi tu repars à vide.
            </div>
            <div className="bg-surface-2 border border rounded-2xl divide-y divide-[color:var(--border)]">
              {(dprCodes || []).map(d => (
                <button key={d.code} onClick={() => setDprCode(d.code)}
                  className="w-full flex items-center justify-between px-4 py-3.5 text-left">
                  <span className="text-ink text-sm">{d.label}</span>
                  <span className={`text-sm font-bold ${dprCode === d.code ? 'text-green-500' : 'text-blue-400'}`}>
                    {dprCode === d.code ? '✓' : 'choisir'}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : isDelivered ? (
          <div className="bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-300 rounded-xl px-3 py-3 text-sm font-medium">
            ✅ Véhicule livré. Plus de panne à encoder — il reste la signature, où tu laisses le véhicule et la clé.
          </div>
        ) : (
          <>
            {/* ── Motif (branche fixée par l'issue) ────────────────────────── */}
            <p className={sectCls}>{isRem ? 'Pourquoi le remorquage ?' : "Qu'est-ce que tu as fait ?"}</p>
            {!motifs && <p className="text-ink-muted text-sm py-4 text-center">Chargement des motifs…</p>}
            <div className="grid grid-cols-3 gap-2.5">
              {ordered.map(m => {
                const sel = motifKey === m.key
                return (
                  <button key={m.key}
                    onClick={() => { setMotifKey(m.key); scrollTo(isRem ? 'f2-dest' : 'f2-sig') }}
                    className={`rounded-2xl border p-3 flex items-center justify-center gap-1.5 transition relative ${
                      m.catchAll ? 'col-span-3 py-3.5' : 'flex-col min-h-[88px]'
                    } ${sel ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 ring-2 ring-amber-400' : 'bg-surface-2 border'}`}>
                    {suggested.includes(m.key) && <span className="absolute top-1.5 right-2 text-[10px]">✨</span>}
                    <span className="text-[26px] leading-none">{m.icon}</span>
                    <span className="text-[11px] font-bold leading-tight text-ink text-center">{m.label}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {/* ── Dépose (remorquage) ────────────────────────────────────────── */}
        {isRem && (
          <div id="f2-dest" className="space-y-2 pt-1">
            <p className={sectCls}>Où déposer le véhicule ?</p>
            <div className="flex gap-2">
              {(['list', 'manual'] as const).map(mode => (
                <button key={mode} onClick={() => setDestMode(mode)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border ${
                    destMode === mode ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300' : 'border bg-surface-2 text-ink-secondary'
                  }`}>
                  {mode === 'list' ? 'Garage de la liste' : 'Autre adresse'}
                </button>
              ))}
            </div>
            {destMode === 'list' ? (
              providers == null ? <p className="text-ink-muted text-xs py-2">Chargement des garages…</p>
              : providers.length === 0 ? <p className="text-ink-muted text-xs py-2">Aucun garage proposé — utilise « Autre adresse ».</p>
              : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {providers.map(g => (
                    <button key={g.cidPrx} onClick={() => { setGarageCid(g.cidPrx); scrollTo('f2-sig') }}
                      className={`w-full text-left flex items-center gap-2 p-2.5 rounded-xl border ${
                        garageCid === g.cidPrx ? 'border-green-500 bg-green-500/10' : 'bg-surface-2 border'
                      }`}>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-ink truncate">{g.nom}</span>
                        <span className="block text-[11px] text-ink-muted truncate">{g.rue} {g.numRue}, {g.cp} {g.localite}</span>
                      </span>
                      <span className="ml-auto text-xs text-ink-muted whitespace-nowrap">{g.distance} km</span>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-2">
                <input placeholder="Nom (garage, société, domicile…)" value={manual.nom}
                  onChange={e => setManual({ ...manual, nom: e.target.value })}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm bg-surface" />
                <AddressField
                  value={addrText} onChange={setAddrText} gmKey={GM_KEY}
                  placeholder="Rechercher l'adresse (Google)…"
                  onSelect={(_a, lat, lng) => setCoords({ lat, lng })}
                  onParts={p => setManual(m => ({ ...m, rue: p.rue, num: p.num, cp: p.cp, loc: p.loc, nom: m.nom || p.name || '' }))}
                />
                {(manual.rue || manual.cp) && (
                  <p className="text-[11px] text-ink-muted bg-surface-2 border rounded-lg px-2 py-1.5">
                    → {[`${manual.rue} ${manual.num}`.trim(), `${manual.cp} ${manual.loc}`.trim()].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Signature ──────────────────────────────────────────────────── */}
        <div id="f2-sig" className="space-y-2 pt-1">
          <p className={sectCls}>Signature du client</p>
          {sigPng ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 border border-green-500/40 rounded-xl overflow-hidden bg-white">
                <img src={sigPng} alt="Signature" className="w-full max-h-24 object-contain" />
              </div>
              <button onClick={() => { setSigPng(null); setSig(null) }} className="text-ink-muted text-xs">Refaire</button>
            </div>
          ) : showPad ? (
            <SigPad onSave={d => { setSigPng(d); setSig('signed'); setShowPad(false); scrollTo(askLocKey ? 'f2-veh' : 'f2-releves') }} />
          ) : (
            <button onClick={() => setShowPad(true)}
              className="w-full py-3.5 border border-dashed border rounded-2xl text-ink-secondary text-sm">
              Faire signer le client
            </button>
          )}
          <div className="flex gap-2">
            {chip('Refuse de signer', sig === 'refus',  () => { setSig(sig === 'refus' ? null : 'refus'); setSigPng(null) })}
            {chip('Client absent',    sig === 'absent', () => { setSig(sig === 'absent' ? null : 'absent'); setSigPng(null) })}
          </div>
        </div>

        {/* ── Véhicule + clé : SUR PLACE seulement (à la dépose pour un REM) ── */}
        {askLocKey ? (
          <>
            <div id="f2-veh" className="space-y-2 pt-1">
              <p className={sectCls}>Où se trouve le véhicule ?</p>
              <div className="flex flex-wrap gap-2">
                {VEHICLE_LOCATIONS.map(l => chip(l, vehLoc === l, () => { setVehLoc(l); if (l !== 'Autre') scrollTo('f2-key') }))}
              </div>
              {vehLoc === 'Autre' && (
                <input value={vehOther} onChange={e => setVehOther(e.target.value)} placeholder="Précise l'endroit…"
                  className="w-full border rounded-xl px-3 py-2.5 text-sm bg-surface" />
              )}
            </div>
            <div id="f2-key" className="space-y-2 pt-1">
              <p className={sectCls}>Clé du véhicule</p>
              <div className="flex gap-2">
                {chip('Récupérée', keyRecovered === true,  () => setKeyRec(true))}
                {chip('Non',       keyRecovered === false, () => { setKeyRec(false); scrollTo('f2-releves') })}
              </div>
              {keyRecovered && (
                <div className="flex flex-wrap gap-2">
                  {KEY_LOCATIONS_F2.map(l => chip(l, keyLoc === l, () => { setKeyLoc(l); if (l !== 'Autre') scrollTo('f2-releves') }))}
                </div>
              )}
              {keyRecovered && keyLoc === 'Autre' && (
                <input value={keyOther} onChange={e => setKeyOther(e.target.value)} placeholder="Où as-tu mis la clé ?"
                  className="w-full border rounded-xl px-3 py-2.5 text-sm bg-surface" />
              )}
            </div>
          </>
        ) : !isDpr && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 rounded-xl px-3 py-3 text-sm font-medium">
            📍 Où tu déposes le véhicule et où tu laisses la clé : on te le demandera à l'arrivée.
          </div>
        )}

        {/* ── Châssis + kilométrage ──────────────────────────────────────── */}
        {!isDpr && (
          <div id="f2-releves" className="space-y-2 pt-1">
            <p className={sectCls}>Châssis &amp; kilométrage</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={vin} onChange={e => setVin(e.target.value.toUpperCase())} placeholder="5 derniers du VIN"
                className="w-full border rounded-xl px-3 py-2.5 text-sm bg-surface font-mono tracking-wider" />
              <input value={km} onChange={e => setKm(e.target.value)} inputMode="numeric" placeholder="Kilométrage"
                className="w-full border rounded-xl px-3 py-2.5 text-sm bg-surface font-mono" />
            </div>
            {needPhotos && (
              <div className="bg-amber-500/10 border border-amber-500/40 text-amber-700 dark:text-amber-300 rounded-xl px-3 py-3 text-sm font-medium">
                📷 Prends le châssis et le compteur en photo — je remplis les deux cases pour toi.
              </div>
            )}
          </div>
        )}

        {/* ── Remarque ──────────────────────────────────────────────────── */}
        <div className="space-y-2 pt-1">
          <p className={sectCls}>Remarque <span className="normal-case tracking-normal font-medium text-ink-faint">— facultatif</span></p>
          <textarea rows={3} value={remark} onChange={e => setRemark(e.target.value)}
            placeholder="Un mot pour le dispatch…"
            className="w-full bg-surface border border rounded-xl px-3 py-3 text-ink text-sm outline-none resize-none" />
        </div>

        {error && <div className="bg-red-500/10 text-red-500 rounded-xl px-3 py-3 text-sm">{error}</div>}
      </div>

      <div className="px-4 py-4 border-t border space-y-2">
        {needPhotos && !isDpr ? (
          <>
            <button onClick={onNeedPhotos}
              className="w-full py-4 bg-orange-500 text-ink font-bold rounded-2xl text-base">
              📷 Prendre les photos
            </button>
            <button disabled className="w-full py-3 bg-surface-2 border border text-ink-faint rounded-2xl text-sm font-semibold">
              Il faut les 3 photos pour clôturer
            </button>
          </>
        ) : (
          <button onClick={submit} disabled={busy || !canSubmit}
            className="w-full py-4 bg-green-600 disabled:opacity-40 text-white font-bold rounded-2xl text-base">
            {busy ? 'Clôture en cours…' : !canSubmit ? (!motifKey && !isDpr ? 'Choisis un motif' : isDpr ? 'Choisis un motif' : 'Indique où déposer le véhicule') : 'Valider la clôture'}
          </button>
        )}
      </div>
    </div>
  )
}
