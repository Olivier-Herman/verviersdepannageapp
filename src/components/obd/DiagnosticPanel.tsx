'use client'
// src/components/obd/DiagnosticPanel.tsx — diagnostic OBD du chauffeur (Olivier 05/11/2026, maquette validée
// https://claude.ai/artifact/F1KAFhsPsLkFqvgZvQS8oS). Deux usages :
//   • dans une mission (missionId) : les codes vont sur la fiche, puis « Je dépanne / Je remorque » ;
//   • seul, hors intervention : fiche de diagnostic identifiée par le VIN (lu par le boîtier, photo ou saisie,
//     toujours modifiable), plaque facultative ; une intervention du même véhicule est proposée, jamais imposée.
// Les codes sont enregistrés AVANT l'avis et avant tout effacement. L'effacement est signé par le PIN du chauffeur.
// Préversion : seuls les pilotes du drapeau obd_diagnostic voient ce composant, et seule l'app de test a le Bluetooth.
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { checkVin, cleanVin } from '@/lib/obd/vin'
import type { ClearResult, ObdLink, ObdReading } from '@/lib/obd/ble'
import PortHelp from './PortHelp'
import { shrinkPhoto } from './shrink'

type Step = 'start' | 'busy' | 'vin' | 'result'
type Vehicle = { marque: string | null; modele: string | null; motorisation: string | null; annee: number | null } | null

const btn = 'w-full min-h-[48px] rounded-xl font-semibold text-sm px-4 transition disabled:opacity-50'
const vehicleLabel = (v: Vehicle) => v ? [v.marque, v.modele, v.motorisation, v.annee].filter(Boolean).join(' · ') : ''

export default function DiagnosticPanel({ missionId, plate: plate0, vehicle: vehicle0, onDone }: { missionId?: string; plate?: string | null; vehicle?: string | null; onDone?: () => void }) {
  const { t, lang } = useT()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>('start')
  const [status, setStatus] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [reading, setReading] = useState<ObdReading | null>(null)
  const [vin, setVin] = useState('')
  const [vinSource, setVinSource] = useState<'obd' | 'photo' | 'saisie'>('saisie')
  const [vehicle, setVehicle] = useState<Vehicle>(null)
  const [plate, setPlate] = useState(plate0 || '')
  const [diag, setDiag] = useState<{ id: string; numero: string; propositions: { id: string; mission_number: number; label: string }[] } | null>(null)
  const [analysis, setAnalysis] = useState<any>(null)
  const [analysisErr, setAnalysisErr] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [pinErr, setPinErr] = useState<string | null>(null)
  const [cleared, setCleared] = useState<{ result: ClearResult; at: string; reste: string[] } | null>(null)
  const [moteurMsg, setMoteurMsg] = useState(false)
  const [decision, setDecision] = useState<string | null>(null)
  const [ended, setEnded] = useState<string | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const link = useRef<ObdLink | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { import('@/lib/obd/ble').then(m => m.obdAvailable()).then(setAvailable).catch(() => setAvailable(false)) }, [])
  useEffect(() => () => { link.current?.close().catch(() => {}) }, [])

  // Décodage dès que le VIN est valide (hors intervention).
  const vc = checkVin(vin)
  useEffect(() => {
    if (step !== 'vin' || !vc.valid) { if (!vc.valid) setVehicle(null); return }
    let stop = false
    fetch(`/api/obd/vin?vin=${vin}`, { cache: 'no-store' }).then(r => r.json()).then(j => { if (!stop && j.ok) setVehicle(j.vehicle) }).catch(() => {})
    return () => { stop = true }
  }, [vin, step, vc.valid])

  async function lancer() {
    setErr(null); setStep('busy'); setStatus(t('obd.recherche'))
    try {
      // Relance : on referme d'abord la connexion précédente au boîtier.
      await link.current?.close().catch(() => {}); link.current = null
      const ble = await import('@/lib/obd/ble')
      const l = await ble.connectObd(s => setStatus(s === 'connexion' ? t('obd.connexion') : s === 'lecture' ? t('obd.lecture') : t('obd.recherche')))
      link.current = l
      const r = await ble.readVehicle(l, s => setStatus(s === 'lecture' ? t('obd.lecture') : status))
      setReading(r)
      if (r.vin && checkVin(r.vin).valid) { setVin(r.vin); setVinSource('obd') }
      if (missionId) await enregistrer(r, r.vin && checkVin(r.vin).valid ? r.vin : null, r.vin ? 'obd' : 'saisie')
      else setStep('vin')
    } catch (e: any) {
      setErr(t('obd.erreur_connexion')); setStep('start')
      link.current?.close().catch(() => {}); link.current = null
    }
  }

  async function enregistrer(r: ObdReading, v: string | null, src: string) {
    setStep('busy'); setStatus(t('obd.lecture'))
    const res = await fetch('/api/obd/diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission_id: missionId || null, vin: v, vin_source: v ? src : null, plate: plate || null, codes: r.codes, measures: r.measures, adapter: link.current?.name || null, protocol: r.protocol, lecture: r.lecture, freeze: r.freeze, raw: r.raw }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(j.error || 'Erreur'); setStep(missionId ? 'start' : 'vin'); return }
    setDiag({ id: j.id, numero: j.numero, propositions: j.propositions || [] })
    if (j.vehicle) setVehicle(j.vehicle)
    setStep('result')
    demanderAvis(j.id)
  }

  // Sur le réseau mobile, la réponse peut se perdre alors que l'avis est enregistré (D-0004, 07/11/2026) : on redemande.
  async function demanderAvis(id: string) {
    setAnalysisErr(false)
    for (let essai = 0; essai < 3; essai++) {
      if (essai) await new Promise(r => setTimeout(r, 3000))
      try {
        const r = await fetch(`/api/obd/diagnostics/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'analyse' }) })
        const a = await r.json()
        if (a.ok) { setAnalysis(a.analysis); return }
      } catch { /* nouvel essai */ }
    }
    setAnalysisErr(true)
  }

  async function photoVin(f: File) {
    setOcrBusy(true); setErr(null)
    try {
      const b64 = await shrinkPhoto(f, 1800)   // le VIN doit rester lisible
      const r = await fetch('/api/obd/vin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mime: 'image/jpeg' }) })
      const j = await r.json()
      if (j.ok && j.vin) { setVin(j.vin); setVinSource('photo') } else setErr(t('obd.ocr_ko'))
    } catch { setErr(t('obd.ocr_ko')) } finally { setOcrBusy(false) }
  }

  async function action(body: any) {
    const r = await fetch(`/api/obd/diagnostics/${diag!.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    return { ok: r.ok && j.ok !== false, ...j }
  }

  async function signerEffacement(code: string) {
    setPinErr(null)
    const a = await action({ action: 'clear_authorize', pin: code })
    if (!a.ok) { setPinErr(a.error || 'Erreur'); setPin(''); return }
    setPinOpen(false); setPin('')
    let c: { result: ClearResult; reste: string[]; raw: { cmd: string; raw: string }[] } = { result: 'lien_perdu', reste: [], raw: [] }
    try { if (link.current) { const ble = await import('@/lib/obd/ble'); c = await ble.clearCodes(link.current, reading?.protocol || null) } } catch { c = { result: 'lien_perdu', reste: [], raw: [] } }
    await action({ action: 'clear_result', result: c.result, reste: c.reste, raw: c.raw })
    setCleared({ result: c.result, reste: c.reste, at: new Date().toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })
  }

  // Moteur tournant : certaines voitures refusent ; on demande de le couper avant de signer.
  async function demanderEffacement() {
    setMoteurMsg(false)
    try {
      if (link.current) { const ble = await import('@/lib/obd/ble'); if (await ble.moteurTourne(link.current, reading?.protocol || null)) { setMoteurMsg(true); return } }
    } catch { /* sans réponse : l'effacement dira lui-même si le boîtier est perdu */ }
    setPinOpen(true)
  }

  const tap = (k: string) => {
    if (k === '⌫') { setPin(p => p.slice(0, -1)); return }
    setPin(p => { const n = (p + k).slice(0, 4); if (n.length === 4) setTimeout(() => signerEffacement(n), 50); return n })
  }

  const reset = () => { setStep('start'); setReading(null); setVin(''); setVehicle(null); setDiag(null); setAnalysis(null); setAnalysisErr(false); setCleared(null); setMoteurMsg(false); setDecision(null); setEnded(null); setErr(null); link.current?.close().catch(() => {}); link.current = null }

  const A = analysis ? (lang === 'sq' ? analysis.sq : analysis.fr) : null
  const libelle = (code: string) => (A?.codes || []).find((c: any) => c.code === code)?.libelle || null
  const grave = (code: string) => (analysis?.fr?.codes || []).find((c: any) => c.code === code)?.gravite

  if (available === false) return (
    <div className="rounded-2xl border bg-surface p-4 text-sm text-ink-secondary">🔧 {t('obd.pas_module')}</div>
  )

  return (
    <div className="space-y-3 pb-28">
      {step === 'start' && available && <PortHelp vehicle={vehicle0} />}
      {step === 'start' && (
        <div className="rounded-2xl border bg-surface p-4 space-y-3">
          <p className="font-semibold text-ink">🔧 {t('obd.titre')}</p>
          <p className="text-sm text-ink-secondary">{t('obd.sous_titre')}</p>
          {err && <p className="text-sm rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3">{err}</p>}
          <button className={`${btn} bg-blue-700 hover:bg-blue-800 text-white`} disabled={available === null} onClick={lancer}>{t('obd.lancer')}</button>
        </div>
      )}

      {step === 'busy' && (
        <div className="rounded-2xl border bg-surface p-4 text-center space-y-2">
          <div className="mx-auto h-8 w-8 rounded-full border-4 border-blue-200 border-t-blue-700 animate-spin" />
          <p className="text-sm text-ink">{status}</p>
        </div>
      )}

      {step === 'vin' && reading && (
        <div className="rounded-2xl border bg-surface p-4 space-y-3">
          {vinSource === 'obd' && vin ? <span className="inline-block text-xs font-semibold rounded-full px-2 py-0.5 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300">{t('obd.vin_lu')}</span>
            : <p className="text-sm rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3">{t('obd.vin_ko')}</p>}
          <button className={`${btn} border bg-surface text-ink`} disabled={ocrBusy} onClick={() => fileRef.current?.click()}>{ocrBusy ? t('obd.ocr_en_cours') : t('obd.vin_photo')}</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const f = e.target.files?.[0]; if (f) photoVin(f); e.target.value = '' }} />
          <label className="block text-xs text-ink-muted">{t('obd.vin_label')}</label>
          <input value={vin} onChange={e => { setVin(cleanVin(e.target.value)); setVinSource('saisie') }} maxLength={17} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            className="w-full min-h-[48px] rounded-xl border bg-surface-2 px-3 font-mono text-lg tracking-wider text-ink" placeholder="VF3…" />
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${vc.ok17 ? 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>{vin.length}/17</span>
            {vc.ok17 && <span className={`rounded-full px-2 py-0.5 font-semibold ${vc.check === false ? 'bg-red-600/10 text-red-700 dark:text-red-300' : 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'}`}>{vc.check === null ? t('obd.vin_ctrl_na') : vc.check ? t('obd.vin_ctrl_ok') : t('obd.vin_ctrl_ko')}</span>}
          </div>
          {vc.valid && <div><p className="text-xs text-ink-muted">{t('obd.vehicule')}</p><p className="font-semibold text-ink">{vehicleLabel(vehicle) || [vc.brand, vc.year].filter(Boolean).join(' · ') || t('obd.vehicule_inconnu')}</p></div>}
          <label className="block text-xs text-ink-muted">{t('obd.plaque_label')}</label>
          <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} className="w-full min-h-[48px] rounded-xl border bg-surface-2 px-3 font-mono text-ink" placeholder="1ABC234" />
          {err && <p className="text-sm text-red-700 dark:text-red-300">{err}</p>}
          <button className={`${btn} bg-blue-700 hover:bg-blue-800 text-white`} disabled={!vc.valid} onClick={() => enregistrer(reading, vin, vinSource)}>{t('obd.continuer')}</button>
          {/* Sans ces boutons, un échec de lecture obligeait à fermer l'app (Olivier 06/11/2026). */}
          <div className="grid grid-cols-2 gap-2">
            <button className={`${btn} border bg-surface text-ink`} onClick={lancer}>{t('obd.relancer')}</button>
            <button className={`${btn} border bg-surface text-ink`} onClick={() => { link.current?.close().catch(() => {}); link.current = null; reset() }}>{t('obd.retour')}</button>
          </div>
        </div>
      )}

      {step === 'result' && diag && reading && (
        <>
          {!missionId && (
            <div className="rounded-2xl border bg-surface p-4">
              <p className="text-xs text-ink-muted">{t('obd.fiche', { n: diag.numero })}</p>
              <p className="font-semibold text-ink">{vehicleLabel(vehicle) || t('obd.vehicule_inconnu')}</p>
              <p className="text-xs text-ink-muted font-mono">VIN {vin}{plate ? ` · ${plate}` : ''}</p>
            </div>
          )}
          <p className="text-sm rounded-xl bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 p-3">✓ {missionId ? t('obd.enregistre_fiche') : t('obd.enregistre_diag')} · {diag.numero}</p>
          {reading.lecture.muette ? (
            <div className="rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3 text-sm space-y-1">
              <p className="font-semibold">⚠️ {t('obd.muette_titre')}</p>
              <p>{t('obd.muette_texte')}</p>
            </div>
          ) : reading.lecture.complete ? (
            <p className="text-sm rounded-xl bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 p-3 font-semibold">✓ {t('obd.lecture_complete')}</p>
          ) : (
            <div className="rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3 text-sm space-y-1">
              <p className="font-semibold">⚠️ {t('obd.lecture_incomplete')}</p>
              <p>{reading.lecture.manques.includes('lien_perdu') ? t('obd.lien_perdu') : reading.lecture.manques.includes('temoin_sans_code') ? t('obd.temoin_sans_code') : t('obd.lecture_incomplete_texte')}</p>
            </div>
          )}
          {!reading.lecture.complete && <button className={`${btn} bg-blue-700 hover:bg-blue-800 text-white`} onClick={lancer}>{t('obd.relancer')}</button>}
          {A?.partiel && <p className="text-sm rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3">⚠️ {t('obd.partiel')} : {A.partiel}</p>}

          <div className="rounded-2xl border bg-surface p-4 space-y-2">
            <p className="font-semibold text-ink">{t('obd.codes')}</p>
            {reading.codes.length === 0 && <p className="text-sm text-ink-secondary">{reading.lecture.complete ? t('obd.aucun_code') : t('obd.codes_non_confirmes')}</p>}
            {reading.codes.map(c => (
              <div key={c.code} className="rounded-xl border p-3">
                <p className="font-mono font-bold text-ink">{c.code} {grave(c.code) === 'grave' && <span className="ml-1 text-xs rounded-full px-2 py-0.5 bg-red-600/10 text-red-700 dark:text-red-300">!</span>}{c.type === 'en_attente' && <span className="ml-1 text-xs font-sans font-normal text-ink-muted">({t('obd.en_attente')})</span>}{c.type === 'permanent' && <span className="ml-1 text-xs font-sans font-normal text-ink-muted">({t('obd.permanent')})</span>}</p>
                <p className="text-sm text-ink-secondary">{libelle(c.code) || '…'}</p>
              </div>
            ))}
            {reading.freeze && (reading.freeze.vitesse_kmh != null || reading.freeze.temp_moteur_c != null || reading.freeze.regime_tr_min != null) && <>
              <p className="text-xs text-ink-muted pt-1">{t('obd.figee', { code: reading.freeze.code })}</p>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                {reading.freeze.vitesse_kmh != null && <><span className="text-ink-secondary">{t('obd.vitesse')}</span><span className="font-semibold tabular-nums text-ink">{reading.freeze.vitesse_kmh} km/h</span></>}
                {reading.freeze.temp_moteur_c != null && <><span className="text-ink-secondary">{t('obd.temperature')}</span><span className="font-semibold tabular-nums text-ink">{reading.freeze.temp_moteur_c} °C</span></>}
                {reading.freeze.regime_tr_min != null && <><span className="text-ink-secondary">{t('obd.regime')}</span><span className="font-semibold tabular-nums text-ink">{reading.freeze.regime_tr_min} tr/min</span></>}
                {reading.freeze.charge_pct != null && <><span className="text-ink-secondary">{t('obd.charge')}</span><span className="font-semibold tabular-nums text-ink">{reading.freeze.charge_pct} %</span></>}
              </div>
            </>}
            <p className="text-xs text-ink-muted pt-1">{t('obd.mesures')}</p>
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
              {reading.measures.batterie_v != null && <><span className="text-ink-secondary">{t('obd.batterie')}</span><span className="font-semibold tabular-nums text-ink">{String(reading.measures.batterie_v).replace('.', ',')} V</span></>}
              {reading.measures.temp_moteur_c != null && <><span className="text-ink-secondary">{t('obd.temperature')}</span><span className="font-semibold tabular-nums text-ink">{reading.measures.temp_moteur_c} °C</span></>}
              {reading.measures.regime_tr_min != null && <><span className="text-ink-secondary">{t('obd.regime')}</span><span className="font-semibold tabular-nums text-ink">{reading.measures.regime_tr_min} tr/min</span></>}
              {!reading.lecture.muette && <><span className="text-ink-secondary">{t('obd.carburant')}</span><span className="font-semibold text-ink text-right">{!reading.measures.carburant ? t('obd.non_lu') : lang === 'sq' ? ({ essence: 'benzinë', diesel: 'naftë', 'électrique': 'elektrike', GPL: 'GPL', GNC: 'GNC' } as Record<string, string>)[reading.measures.carburant] || (/hybride/.test(reading.measures.carburant) ? 'hibride' : reading.measures.carburant) : reading.measures.carburant}{reading.measures.carburant_source === 'allumage' && <span className="block text-xs font-normal text-ink-muted">{t('obd.selon_allumage')}</span>}</span></>}
              {reading.measures.temoin_moteur != null && <><span className="text-ink-secondary">{t('obd.temoin')}</span><span className="font-semibold text-ink">{reading.measures.temoin_moteur ? t('obd.allume') : t('obd.eteint')}</span></>}
              {reading.measures.km_temoin_allume != null && reading.measures.km_temoin_allume > 0 && <><span className="text-ink-secondary">{t('obd.km_temoin')}</span><span className="font-semibold tabular-nums text-ink">{reading.measures.km_temoin_allume.toLocaleString('fr-BE')} km</span></>}
              {reading.measures.km_depuis_effacement != null && <><span className="text-ink-secondary">{t('obd.km_effacement')}</span><span className="font-semibold tabular-nums text-ink">{reading.measures.km_depuis_effacement >= 65535 ? t('obd.km_max') : `${reading.measures.km_depuis_effacement.toLocaleString('fr-BE')} km`}</span></>}
              {reading.measures.kilometrage != null && <><span className="text-ink-secondary">{t('obd.kilometrage')}</span><span className="font-semibold tabular-nums text-ink">{reading.measures.kilometrage.toLocaleString('fr-BE')} km</span></>}
            </div>
          </div>

          <div className={`rounded-2xl p-4 space-y-1.5 ${analysis?.verdict === 'rem' ? 'bg-red-600/10 text-red-800 dark:text-red-200' : analysis?.verdict === 'incomplet' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : analysis ? 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-200' : 'border bg-surface text-ink-secondary'}`}>
            {!analysis && !analysisErr && <p className="text-sm">⏳ {t('obd.avis_attente')}</p>}
            {analysisErr && <>
              <p className="text-sm">{t('obd.avis_ko')}</p>
              <button className={`${btn} border bg-surface text-ink`} onClick={() => demanderAvis(diag.id)}>{t('obd.avis_relancer')}</button>
            </>}
            {A && <>
              <p className="font-semibold">{t('obd.avis')} : {analysis.verdict === 'dsp' ? t('obd.dsp') : analysis.verdict === 'rem' ? t('obd.rem') : analysis.verdict === 'incomplet' ? t('obd.incomplet') : t('obd.controle')}</p>
              <p className="text-sm"><b>{t('obd.pourquoi')} :</b> {A.pourquoi}</p>
              {A.a_essayer?.length > 0 && <p className="text-sm"><b>{t('obd.essayer')} :</b> {A.a_essayer.join(' · ')}</p>}
            </>}
          </div>

          {cleared && <p className={`text-sm rounded-xl p-3 ${cleared.result === 'ok' ? 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>{cleared.result === 'ok' ? `✓ ${t('obd.efface', { d: cleared.at })}` : cleared.result === 'partiel' ? t('obd.efface_partiel', { codes: cleared.reste.join(', ') }) : cleared.result === 'non_verifie' ? t('obd.efface_non_verifie') : cleared.result === 'lien_perdu' ? t('obd.efface_lien_perdu') : t('obd.refuse')}</p>}
          {moteurMsg && !cleared && <div className="text-sm rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 p-3 space-y-1"><p className="font-semibold">{t('obd.couper_titre')}</p><p>{t('obd.couper_texte')}</p></div>}

          {pinOpen ? (
            <div className="rounded-2xl border-2 border-red-600 bg-surface p-4 space-y-3">
              <p className="font-semibold text-ink">🔐 {t('obd.pin_titre')}</p>
              <p className="text-xs text-ink-muted">{t('obd.pin_texte')}</p>
              <div className="flex justify-center gap-3">{[0, 1, 2, 3].map(i => <span key={i} className={`h-4 w-4 rounded-full border-2 border-ink ${i < pin.length ? 'bg-ink' : ''}`} />)}</div>
              {pinErr && <p className="text-sm text-center text-red-700 dark:text-red-300">{pinErr}</p>}
              <div className="grid grid-cols-3 gap-2">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? <button key={i} onClick={() => tap(k)} className="min-h-[52px] rounded-xl border bg-surface-2 text-xl font-bold text-ink">{k}</button> : <span key={i} />)}</div>
              <button className={`${btn} border bg-surface text-ink`} onClick={() => { setPinOpen(false); setPin(''); setPinErr(null) }}>{lang === 'sq' ? 'Anulo' : 'Annuler'}</button>
            </div>
          ) : (!cleared && reading.codes.some(c => c.type !== 'permanent') && (
            <button className={`${btn} border bg-surface text-ink`} onClick={demanderEffacement}>🧹 {t('obd.effacer')}</button>
          ))}

          {missionId ? (
            decision ? <p className="text-sm rounded-xl bg-blue-600/10 text-blue-800 dark:text-blue-200 p-3">✓ {decision === 'dsp' ? t('obd.je_depanne') : t('obd.je_remorque')} — {t('obd.decision_notee')}</p> : (
              <div className="space-y-2">
                <p className="text-xs text-ink-muted">{t('obd.decision')}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['dsp', 'rem'] as const).map(d => (
                    <button key={d} className={`${btn} ${analysis?.verdict === d ? 'bg-brand text-white' : 'border bg-surface text-ink'}`} onClick={async () => { await action({ action: 'decision', decision: d }); setDecision(d); onDone?.() }}>{d === 'dsp' ? t('obd.je_depanne') : t('obd.je_remorque')}</button>
                  ))}
                </div>
              </div>
            )
          ) : ended ? (
            <>
              <p className="text-sm rounded-xl bg-blue-600/10 text-blue-800 dark:text-blue-200 p-3">✓ {ended}</p>
              <button className={`${btn} border bg-surface text-ink`} onClick={reset}>{t('obd.recommencer')}</button>
            </>
          ) : diag.propositions.length > 0 ? (
            <div className="rounded-2xl border bg-surface p-4 space-y-2">
              <p className="font-semibold text-ink">{t('obd.existe_titre')}</p>
              <p className="text-xs text-ink-muted">{t('obd.existe_texte')}</p>
              {diag.propositions.map(p => (
                <button key={p.id} className={`${btn} bg-blue-700 hover:bg-blue-800 text-white`} onClick={async () => { const a = await action({ action: 'attach', mission_id: p.id }); if (a.ok) setEnded(t('obd.rattache', { n: a.mission_number })) }}>{t('obd.rattacher')} · {p.label}</button>
              ))}
              <button className={`${btn} border bg-surface text-ink`} onClick={() => setEnded(t('obd.termine', { n: diag.numero }))}>{t('obd.garder_seul')}</button>
            </div>
          ) : (
            <button className={`${btn} bg-blue-700 hover:bg-blue-800 text-white`} onClick={() => setEnded(t('obd.termine', { n: diag.numero }))}>{t('obd.terminer')}</button>
          )}
        </>
      )}
    </div>
  )
}
