'use client'
// src/app/capture/[token]/RestitutionWizard.tsx
//
// PROCÉDURE COMPLÈTE de sortie sur le téléphone (un seul QR depuis la fiche) :
//   1. chemin de sortie  2. bon Informex  3. personne présente
//   4. CMR (transporteur)  5. attestation signée
// Chaque étape est passable avec motif + PIN de celui qui a ouvert le QR.
// L'état vient du serveur après chaque action (preview), le téléphone ne
// garde rien en propre. Olivier 2026-09-05.

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, QrCode, Trash2, AlertTriangle, SkipForward, ChevronRight, Lock, Unlock } from 'lucide-react'
import SigPad from '@/components/mission/SigPad'

type Step = 'path' | 'informex' | 'identity' | 'cmr' | 'attestation'
const STEP_TITLES: Record<Step, string> = {
  path: 'Chemin de sortie', informex: 'Bon Informex', identity: 'Personne présente', cmr: 'CMR du transporteur', attestation: "Attestation d'enlèvement",
}
const ROLE_LABELS: Record<string, string> = { buyer: 'Acheteur', mandate: 'Mandataire', transporter: 'Transporteur' }
const roleLabel = (r?: string | null) => r === 'mandate' ? 'mandataire de l\'acheteur' : r === 'transporter' ? 'transporteur' : 'acheteur'

interface Mission { id: string; mission_number?: number | null; plate?: string | null; brand?: string | null; model?: string | null; vin?: string | null }

export default function RestitutionWizard({ token, mission, initialPreview, onFinished }: {
  token: string
  mission: Mission | null
  initialPreview: any
  onFinished: () => void
}) {
  const [p, setP]           = useState<any>(initialPreview || {})
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [skipFor, setSkipFor] = useState<Step | null>(null)
  const [skipReason, setSkipReason] = useState('')
  const [skipPin, setSkipPin] = useState('')
  const [lastResult, setLastResult] = useState<any>(null)

  // Ordre des étapes selon le chemin / la qualité.
  const steps: Step[] = (() => {
    const s: Step[] = ['path']
    if (p.path === 'assistance') return s
    if (p.path === 'informex') s.push('informex')
    s.push('identity')
    if (p.identity_role === 'transporter') s.push('cmr')
    s.push('attestation')
    return s
  })()
  const checks = p.checks || {}
  const done = (s: Step) => !!checks[s]
  const skippedStep = (s: Step) => !!p.skips?.[s]
  const firstOpen = steps.find(s => !done(s))
  const [current, setCurrent] = useState<Step>(firstOpen || 'attestation')
  useEffect(() => { if (firstOpen && !steps.includes(current)) setCurrent(firstOpen) }, [p]) // eslint-disable-line react-hooks/exhaustive-deps

  async function post(payload: any, multipart?: FormData) {
    setBusy(true); setError(null)
    try {
      const r = multipart
        ? await fetch(`/api/capture/${token}`, { method: 'POST', body: multipart })
        : await fetch(`/api/capture/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      if (j.preview) setP(j.preview)
      setLastResult(j)
      return j
    } catch (e: any) { setError(e.message); return null }
    finally { setBusy(false) }
  }

  async function advance(j: any) {
    if (!j) return
    const next = (j.preview ? stepsFrom(j.preview) : steps).find(s => !(j.preview?.checks || checks)[s])
    if (next) setCurrent(next)
  }
  function stepsFrom(pv: any): Step[] {
    const s: Step[] = ['path']
    if (pv.path === 'assistance') return s
    if (pv.path === 'informex') s.push('informex')
    s.push('identity')
    if (pv.identity_role === 'transporter') s.push('cmr')
    s.push('attestation')
    return s
  }

  async function doSkip() {
    if (!skipFor) return
    const j = await post({ step: 'skip', which: skipFor, reason: skipReason, pin: skipPin })
    if (j) {
      setSkipFor(null); setSkipReason(''); setSkipPin('')
      if (skipFor === 'attestation') onFinished()
      else await advance(j)
    }
  }

  const allDone = p.allowed || (p.signed) || skippedStep('attestation')

  // ── Écran final ────────────────────────────────────────────────────────────
  if (allDone) {
    return (
      <div className="flex flex-col gap-3">
        <div className="bg-success/10 border border-success/40 rounded-xl p-4 flex items-start gap-3">
          <Unlock className="text-success mt-0.5" />
          <div>
            <p className="font-semibold text-lg">Sortie autorisée</p>
            <p className="text-sm text-ink-secondary">La procédure est complète. Le véhicule peut quitter le parc : encaissement ou « Restituer et facturer » sur la fiche.</p>
          </div>
        </div>
        {Object.keys(p.skips || {}).length > 0 && (
          <div className="bg-warning/10 border border-warning/40 rounded-xl p-3 text-sm">
            <p className="font-semibold">Étapes passées</p>
            <ul className="list-disc pl-5">
              {Object.entries(p.skips).map(([k, v]: any) => <li key={k}>{STEP_TITLES[k as Step] || k} — {v.reason} ({v.by_name})</li>)}
            </ul>
          </div>
        )}
        {p.signed && <p className="text-sm text-ink-secondary">L'attestation est figée ; le bureau peut l'imprimer depuis la fiche.</p>}
      </div>
    )
  }

  // ── Stepper ────────────────────────────────────────────────────────────────
  const stepper = (
    <ol className="flex flex-wrap gap-1.5">
      {steps.map((s, i) => {
        const isDone = done(s), isCur = s === current
        return (
          <li key={s}>
            <button onClick={() => setCurrent(s)} disabled={busy}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center gap-1 ${isCur ? 'bg-brand text-white border-brand' : isDone ? (skippedStep(s) ? 'bg-warning/15 text-warning border-warning/40' : 'bg-success/15 text-success border-success/40') : 'bg-surface text-ink-secondary'}`}>
              {isDone ? (skippedStep(s) ? <SkipForward size={12} /> : <Check size={12} />) : <span>{i + 1}</span>} {STEP_TITLES[s]}
            </button>
          </li>
        )
      })}
    </ol>
  )

  const skipButton = (s: Step) => (
    <button onClick={() => { setSkipFor(s); setSkipReason(''); setSkipPin('') }} disabled={busy}
      className="text-xs text-ink-muted hover:text-warning flex items-center gap-1 self-center"><SkipForward size={12} /> Passer cette étape (motif + PIN)</button>
  )

  const skipModal = skipFor && (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3">
      <div className="bg-surface border rounded-2xl w-full max-w-md p-4 flex flex-col gap-3">
        <p className="font-semibold flex items-center gap-2"><AlertTriangle className="text-warning" size={18} /> Passer « {STEP_TITLES[skipFor]} »</p>
        <p className="text-sm text-ink-secondary">Tracé sur la fiche à ton nom, avec le motif. Le PIN est celui de la personne qui a ouvert le QR sur la fiche.</p>
        <textarea value={skipReason} onChange={e => setSkipReason(e.target.value)} rows={2} placeholder="Motif (obligatoire)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
        <input value={skipPin} onChange={e => setSkipPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="PIN (4 chiffres)" className="border rounded-lg px-3 py-2 bg-surface text-sm tracking-widest" />
        {error && <p className="text-critical text-sm">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => setSkipFor(null)} className="flex-1 py-2.5 rounded-lg border text-sm">Annuler</button>
          <button onClick={doSkip} disabled={busy || skipReason.trim().length < 5 || skipPin.length !== 4}
            className="flex-1 py-2.5 rounded-lg bg-warning text-white text-sm font-semibold disabled:opacity-40">{busy ? <Loader2 size={16} className="animate-spin inline" /> : 'Confirmer'}</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-critical font-semibold"><Lock size={16} /> Sortie bloquée tant que la procédure n'est pas complète</div>
      {stepper}
      {error && !skipFor && <p className="text-critical text-sm bg-critical/10 border border-critical/30 rounded-lg px-3 py-2">{error}</p>}

      {current === 'path' && <PathStep p={p} busy={busy} onSubmit={async b => advance(await post({ step: 'path', ...b }))} skip={skipButton('path')} />}
      {current === 'informex' && <InformexStep token={token} p={p} busy={busy} setBusy={setBusy} setError={setError} onDone={async j => { if (j?.preview) setP(j.preview); setLastResult(j); await advance(j) }} onManual={async (raw, pin) => advance(await post({ step: 'informex_qr', raw, pin }))} skip={skipButton('informex')} lastResult={lastResult} />}
      {current === 'identity' && <IdentityStep token={token} p={p} busy={busy} setBusy={setBusy} setError={setError} onPhotoDone={async j => { if (j?.preview) setP(j.preview); setLastResult(j); if (!j?.needs_manual) await advance(j) }} onManual={async b => advance(await post({ step: 'identity', ...b }))} skip={skipButton('identity')} lastResult={lastResult} />}
      {current === 'cmr' && <PhotoStep token={token} kind="cmr" busy={busy} setBusy={setBusy} setError={setError} hint="Le document entier, à plat. Numéro, transporteur et plaque du camion sont lus automatiquement." onDone={async j => { if (j?.preview) setP(j.preview); await advance(j) }} skip={skipButton('cmr')} />}
      {current === 'attestation' && <SignatureStep token={token} p={p} mission={mission} busy={busy} onSubmit={async b => { const j = await post({ step: 'signature', ...b }); if (j) onFinished() }} skip={skipButton('attestation')} />}
      {skipModal}
    </div>
  )
}

// ── Étape 1 : chemin ─────────────────────────────────────────────────────────
function PathStep({ p, busy, onSubmit, skip }: { p: any; busy: boolean; onSubmit: (b: any) => void; skip: React.ReactNode }) {
  const [path, setPath] = useState<'informex' | 'autre' | 'assistance'>(p.path || 'informex')
  const [byName, setByName] = useState(p.path_by || '')
  const [dest, setDest] = useState(p.destination || '')
  const [note, setNote] = useState(p.path_note || '')
  return (
    <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
      <p className="font-semibold">1 · Chemin de sortie</p>
      <p className="text-sm text-ink-secondary">Décidé par le bureau d'expertise{p.expert_bureau ? ` (${p.expert_bureau})` : ''} : encode qui te l'a donné. Exception : une mission de relivraison reçue d'une assistance (Touring, VAB, Kaze, Allianz, AXA) vaut accord à elle seule, et elle est reconnue toute seule quand elle est arrivée sur la même plaque.</p>
      <div className="grid grid-cols-1 gap-2">
        {(['informex', 'autre', 'assistance'] as const).map(k => (
          <button key={k} onClick={() => setPath(k)} className={`text-left px-3 py-2.5 rounded-lg border text-sm font-semibold ${path === k ? 'bg-brand text-white border-brand' : 'bg-surface'}`}>
            {k === 'informex' ? 'Sortie Informex — véhicule vendu, bon avec QR' : k === 'autre' ? 'Autre sortie — propriétaire, garage, …' : 'Reprise par une assistance — la mission de relivraison reçue vaut accord'}
          </button>
        ))}
      </div>
      {path !== 'assistance' && <input value={byName} onChange={e => setByName(e.target.value)} placeholder="Qui, au bureau, a donné l'instruction ? (nom)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />}
      {path === 'autre' && <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destination (propriétaire, garage X, …)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />}
      <input value={note} onChange={e => setNote(e.target.value)} placeholder={path === 'assistance' ? 'Assistance + référence du dossier (obligatoire)' : 'Par mail / téléphone, référence… (facultatif)'} className="border rounded-lg px-3 py-2 bg-surface text-sm" />
      <button onClick={() => onSubmit({ path, by_name: byName, destination: dest, note })}
        disabled={busy || (path !== 'assistance' && !byName.trim()) || (path === 'autre' && !dest.trim()) || (path === 'assistance' && !note.trim())}
        className="py-3 rounded-xl bg-brand text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">{busy ? <Loader2 size={18} className="animate-spin" /> : <ChevronRight size={18} />} Continuer</button>
      {skip}
    </div>
  )
}

// ── Prise de photos réutilisable ─────────────────────────────────────────────
function usePhotos() {
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach(u => URL.revokeObjectURL(u))
  }, [files])
  return { files, setFiles, previews }
}
function PhotoPicker({ files, setFiles, previews, label, onFirst }: { files: File[]; setFiles: (f: File[]) => void; previews: string[]; label: string; onFirst?: (f: File) => void }) {
  return (
    <>
      <label className="w-full py-3.5 rounded-xl bg-brand text-white font-bold flex items-center justify-center gap-2 cursor-pointer">
        <Camera size={20} /> {files.length ? 'Ajouter une photo' : label}
        <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => {
          const picked = Array.from(e.target.files || [])
          if (!picked.length) return
          if (!files.length && onFirst) onFirst(picked[0])
          setFiles([...files, ...picked].slice(0, 6)); e.target.value = ''
        }} />
      </label>
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((src, i) => (
            <div key={src} className="relative aspect-[3/4] rounded-lg overflow-hidden border bg-surface">
              <img src={src} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white" aria-label="Retirer"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
async function sendForm(token: string, fd: FormData) {
  const r = await fetch(`/api/capture/${token}`, { method: 'POST', body: fd })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || 'Envoi échoué')
  return j
}

// ── Étape CMR (photos simples) ──────────────────────────────────────────────
function PhotoStep({ token, kind, hint, busy, setBusy, setError, onDone, skip }: {
  token: string; kind: 'cmr'; hint: string; busy: boolean; setBusy: (b: boolean) => void; setError: (e: string | null) => void; onDone: (j: any) => void; skip: React.ReactNode
}) {
  const ph = usePhotos()
  async function send() {
    if (!ph.files.length) { setError('Ajoute au moins une photo.'); return }
    setBusy(true); setError(null)
    try {
      const fd = new FormData(); fd.append('step', kind); ph.files.forEach(f => fd.append('files', f))
      onDone(await sendForm(token, fd))
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
      <p className="font-semibold">{STEP_TITLES[kind]}</p>
      <p className="text-sm text-ink-secondary">{hint}</p>
      <PhotoPicker {...ph} label="Photographier le CMR" />
      <button onClick={send} disabled={busy || !ph.files.length} className="py-3 rounded-xl bg-success text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">{busy ? <><Loader2 size={18} className="animate-spin" /> Envoi et lecture…</> : <><Check size={18} /> Envoyer</>}</button>
      {skip}
    </div>
  )
}

// ── Étape 2 : bon Informex (QR + photo) ─────────────────────────────────────
function InformexStep({ token, p, busy, setBusy, setError, onDone, onManual, skip, lastResult }: {
  token: string; p: any; busy: boolean; setBusy: (b: boolean) => void; setError: (e: string | null) => void; onDone: (j: any) => void; onManual: (raw: string, pin: string) => void; skip: React.ReactNode; lastResult: any
}) {
  const ph = usePhotos()
  const [qrRaw, setQrRaw] = useState('')
  const [qrBusy, setQrBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [manual, setManual] = useState('')
  const [manualPin, setManualPin] = useState('')
  const scanRef = useRef<any>(null)

  async function decodeFromFile(file: File) {
    setQrBusy(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      let host = document.getElementById('qr-file-host')
      if (!host) { host = document.createElement('div'); host.id = 'qr-file-host'; host.style.display = 'none'; document.body.appendChild(host) }
      const h = new Html5Qrcode(host.id)
      const text = await h.scanFile(file, false)
      if (text) setQrRaw(text)
      try { h.clear() } catch {}
    } catch { /* pas de QR lisible sur la photo */ }
    finally { setQrBusy(false) }
  }
  async function startLive() {
    setScanning(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const h = new Html5Qrcode('qr-live'); scanRef.current = h
      await h.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 240, height: 240 } }, (t: string) => { setQrRaw(t); stopLive() }, () => {})
    } catch (e: any) { setError(e?.message || 'Caméra indisponible'); setScanning(false) }
  }
  async function stopLive() { try { await scanRef.current?.stop(); scanRef.current?.clear() } catch {} scanRef.current = null; setScanning(false) }
  async function send() {
    if (!ph.files.length && !qrRaw) { setError('Photographie le bon ou scanne son QR.'); return }
    setBusy(true); setError(null)
    try {
      const fd = new FormData(); fd.append('step', 'informex'); ph.files.forEach(f => fd.append('files', f)); if (qrRaw) fd.append('qr_raw', qrRaw)
      onDone(await sendForm(token, fd))
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  const match = lastResult?.match || p.informex_match
  return (
    <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
      <p className="font-semibold">2 · Bon Informex</p>
      {p.informex_qr && <p className="text-sm text-success">✅ QR déjà décodé{p.informex?.buyerName ? ` · acheteur ${p.informex.buyerName}` : ''}</p>}
      <div className="flex flex-col gap-2">
        {qrRaw ? <p className="text-sm text-success break-all">✅ QR décodé : <span className="text-ink-muted">{qrRaw.slice(0, 100)}{qrRaw.length > 100 ? '…' : ''}</span></p>
               : <p className="text-sm text-ink-secondary">{qrBusy ? 'Lecture du QR sur la photo…' : 'Photographie le bon entier : le QR est lu sur la photo. Sinon, scanne-le en direct.'}</p>}
        <div id="qr-live" className={scanning ? 'rounded-lg overflow-hidden' : 'hidden'} />
        {scanning ? <button onClick={stopLive} className="py-2 rounded-lg border text-sm">Arrêter le scan</button>
                  : <button onClick={startLive} className="py-2 rounded-lg border text-sm flex items-center justify-center gap-2"><QrCode size={16} /> Scanner le QR en direct</button>}
      </div>
      <PhotoPicker {...ph} label="Photographier le bon" onFirst={f => { if (!qrRaw) decodeFromFile(f) }} />
      {match && (match.plate === false || match.vin === false) && (
        <p className="text-critical font-semibold text-sm flex items-center gap-1"><AlertTriangle size={14} /> Le bon ne correspond pas à ce véhicule. Ne pas restituer.</p>
      )}
      <button onClick={send} disabled={busy || (!ph.files.length && !qrRaw)} className="py-3 rounded-xl bg-success text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">{busy ? <><Loader2 size={18} className="animate-spin" /> Envoi et lecture…</> : <><Check size={18} /> Envoyer</>}</button>
      <details className="text-sm">
        <summary className="text-ink-muted cursor-pointer">QR illisible ? Encoder la référence à la main</summary>
        <p className="text-xs text-warning mt-2">Une référence tapée ne prouve rien (le V vert est dans le QR) : l'étape est <b>passée</b>, tracée à ton nom avec ton PIN, et l'attestation le mentionne.</p>
        <div className="flex gap-2 mt-2">
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="Référence du bon" className="border rounded-lg px-3 py-2 bg-surface text-sm flex-1 min-w-0" />
          <input value={manualPin} onChange={e => setManualPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="PIN" className="border rounded-lg px-3 py-2 bg-surface text-sm w-20 tracking-widest" />
          <button onClick={() => onManual(manual, manualPin)} disabled={busy || !manual.trim() || manualPin.length !== 4} className="px-3 rounded-lg border text-sm disabled:opacity-40">OK</button>
        </div>
      </details>
      {skip}
    </div>
  )
}

// ── Étape 3 : personne présente ─────────────────────────────────────────────
function IdentityStep({ token, p, busy, setBusy, setError, onPhotoDone, onManual, skip, lastResult }: {
  token: string; p: any; busy: boolean; setBusy: (b: boolean) => void; setError: (e: string | null) => void; onPhotoDone: (j: any) => void; onManual: (b: any) => void; skip: React.ReactNode; lastResult: any
}) {
  const ph = usePhotos()
  const [role, setRole] = useState<'buyer' | 'mandate' | 'transporter'>(p.identity_role || 'buyer')
  const [mandate, setMandate] = useState(p.mandate_note || '')
  const [company, setCompany] = useState({ name: p.company?.name || '', vat: p.company?.vat || '', truck_plate: p.company?.truck_plate || '' })
  const [mode, setMode] = useState<'photo' | 'manual' | 'counter'>('photo')
  const [id, setId] = useState({ firstName: '', lastName: '', documentNumber: '', nationality: '', birthDate: '' })
  const readOcr = lastResult?.kind === 'id_card' ? lastResult.ocr : null
  const mandateMissing = role === 'mandate' && !mandate.trim()
  // Écran comptoir : la personne encode elle-même (ou insère sa carte eID).
  const [counterReq, setCounterReq] = useState<string | null>(null)
  const [counterMode, setCounterMode] = useState<'manual' | 'eid' | null>(null)
  const counterTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  async function sendToCounter(m: 'manual' | 'eid', force = false) {
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/capture/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: m === 'eid' ? 'counter_eid' : 'counter_manual', force }) })
      const j = await r.json()
      if (r.status === 409 && j.occupied) {
        const who = j.occupant?.client ? ` (${j.occupant.client})` : ''
        if (window.confirm(`L'écran comptoir affiche déjà quelque chose${who}. Le remplacer ?`)) { setBusy(false); return sendToCounter(m, true) }
        setBusy(false); return
      }
      if (!r.ok) throw new Error(j.error || 'Écran comptoir indisponible')
      setCounterReq(j.request_id); setCounterMode(m)
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  useEffect(() => {
    if (!counterReq) return
    counterTimer.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/capture/${token}?counter=${encodeURIComponent(counterReq)}`, { cache: 'no-store' })
        const j = await r.json()
        if (j.counter === 'done') {
          if (counterTimer.current) clearInterval(counterTimer.current)
          setCounterReq(null)
          onManual({ role, mandate_note: mandate, company })   // garde l'identité reçue, pose la qualité, avance
        }
      } catch { /* tick suivant */ }
    }, 2500)
    return () => { if (counterTimer.current) clearInterval(counterTimer.current) }
  }, [counterReq]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendPhotos() {
    if (!ph.files.length) { setError('Ajoute au moins une photo.'); return }
    setBusy(true); setError(null)
    try {
      const fd = new FormData(); fd.append('step', 'id_card'); ph.files.forEach(f => fd.append('files', f))
      fd.append('role', role); fd.append('mandate_note', mandate); fd.append('company', JSON.stringify(company))
      onPhotoDone(await sendForm(token, fd))
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="bg-surface border rounded-xl p-4 flex flex-col gap-3">
      <p className="font-semibold">Personne présente à l'enlèvement</p>
      {p.identity && <p className="text-sm text-success">✅ Déjà enregistrée : {[p.identity.firstName, p.identity.lastName].filter(Boolean).join(' ')} ({roleLabel(p.identity_role)})</p>}
      {p.identity && p.path === 'informex' && p.identity_role === 'buyer' && p.identity_match === false && (
        <p className="text-sm bg-critical/10 border border-critical/40 rounded-lg px-3 py-2 font-semibold flex items-start gap-1"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{[p.identity.firstName, p.identity.lastName].filter(Boolean).join(' ')} n'est PAS l'acheteur du bon ({p.informex?.buyerName}). Ne pas restituer comme acheteur : passe en <b>Mandataire</b> avec le mandat écrit, ou passe l'étape (motif + PIN).</span></p>
      )}
      {p.identity && p.path === 'informex' && p.identity_role === 'buyer' && p.identity_match === true && (
        <p className="text-sm text-success">✅ Même personne que l'acheteur du bon ({p.informex?.buyerName}).</p>
      )}
      {p.path === 'informex' && p.informex?.buyerName && (
        <p className="text-sm bg-warning/10 border border-warning/40 rounded-lg px-3 py-2">Acheteur selon le bon : <b>{p.informex.buyerName}</b>. Si ce n'est pas la même personne : mandat écrit + rappel de l'acheteur au numéro fourni par le bureau, pas à celui de la personne présente.</p>
      )}
      {p.path === 'informex' && !p.informex?.buyerName && (
        <p className="text-sm bg-warning/10 border border-warning/40 rounded-lg px-3 py-2">Acheteur du bon inconnu (bon non lu) : compare toi-même le nom de l'acheteur sur le bon avec la pièce d'identité.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {(['buyer', 'mandate', 'transporter'] as const).map(r => (
          <button key={r} onClick={() => setRole(r)} className={`px-3 py-1.5 rounded-lg border text-sm font-semibold ${role === r ? 'bg-brand text-white border-brand' : 'bg-surface'}`}>{ROLE_LABELS[r]}</button>
        ))}
      </div>
      {role === 'mandate' && <input value={mandate} onChange={e => setMandate(e.target.value)} placeholder="Mandat écrit (obligatoire) : signé par qui, rappel de l'acheteur à quel numéro / heure" className={`border rounded-lg px-3 py-2 bg-surface text-sm ${!mandate.trim() ? 'border-critical' : ''}`} />}
      {(role === 'transporter' || role === 'mandate') && (
        <div className="grid grid-cols-1 gap-2">
          <input value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} placeholder="Société" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
          <input value={company.vat} onChange={e => setCompany({ ...company, vat: e.target.value })} placeholder="N° TVA" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
          {role === 'transporter' && <input value={company.truck_plate} onChange={e => setCompany({ ...company, truck_plate: e.target.value })} placeholder="Plaque du camion" className="border rounded-lg px-3 py-2 bg-surface text-sm" />}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => setMode('photo')} className={`py-2 rounded-lg border text-xs font-semibold ${mode === 'photo' ? 'bg-brand text-white border-brand' : ''}`}>Photographier la pièce</button>
        <button onClick={() => setMode('counter')} className={`py-2 rounded-lg border text-xs font-semibold ${mode === 'counter' ? 'bg-brand text-white border-brand' : ''}`}>Écran comptoir</button>
        <button onClick={() => setMode('manual')} className={`py-2 rounded-lg border text-xs font-semibold ${mode === 'manual' ? 'bg-brand text-white border-brand' : ''}`}>Saisir à la main</button>
      </div>
      {mode === 'counter' ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">L'écran face au comptoir passe en mode saisie : la personne encode elle-même ses coordonnées, ou insère sa carte d'identité belge dans le lecteur. Dès qu'elle valide, l'identité arrive ici.</p>
          {counterReq ? (
            <p className="text-sm text-ink-secondary flex items-center gap-2 py-2"><Loader2 size={16} className="animate-spin" /> En attente de la personne au comptoir ({counterMode === 'eid' ? 'lecture de la carte' : 'saisie des coordonnées'})…</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => sendToCounter('manual')} disabled={busy || mandateMissing} className="py-3 rounded-xl bg-brand text-white font-bold disabled:opacity-40">📺 La personne encode ses coordonnées</button>
              <button onClick={() => sendToCounter('eid')} disabled={busy || mandateMissing} className="py-3 rounded-xl border font-semibold disabled:opacity-40">🪪 Lire sa carte d'identité belge (lecteur)</button>
            </div>
          )}
          {counterReq && <button onClick={() => { setCounterReq(null); if (counterTimer.current) clearInterval(counterTimer.current) }} className="text-xs text-ink-muted underline">Annuler</button>}
        </div>
      ) : mode === 'photo' ? (
        <>
          <p className="text-xs text-ink-muted">Carte d'identité ou passeport, tous pays : recto puis verso, bien net. Lecture automatique.</p>
          <PhotoPicker {...ph} label="Photographier la pièce" />
          {readOcr && !(readOcr.firstName || readOcr.lastName) && <p className="text-warning text-sm flex items-center gap-1"><AlertTriangle size={14} /> Lecture impossible : reprends la photo ou saisis à la main.</p>}
          <button onClick={sendPhotos} disabled={busy || !ph.files.length || mandateMissing} className="py-3 rounded-xl bg-success text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">{busy ? <><Loader2 size={18} className="animate-spin" /> Envoi et lecture…</> : <><Check size={18} /> Envoyer</>}</button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2">
            <input value={id.lastName} onChange={e => setId({ ...id, lastName: e.target.value })} placeholder="Nom" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
            <input value={id.firstName} onChange={e => setId({ ...id, firstName: e.target.value })} placeholder="Prénom" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
            <input value={id.documentNumber} onChange={e => setId({ ...id, documentNumber: e.target.value })} placeholder="N° de la pièce" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
            <input value={id.nationality} onChange={e => setId({ ...id, nationality: e.target.value })} placeholder="Nationalité" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
            <input value={id.birthDate} onChange={e => setId({ ...id, birthDate: e.target.value })} placeholder="Date de naissance (JJ/MM/AAAA)" className="border rounded-lg px-3 py-2 bg-surface text-sm" />
          </div>
          <button onClick={() => onManual({ identity: id, role, mandate_note: mandate, company })} disabled={busy || (!id.lastName && !id.firstName) || mandateMissing} className="py-3 rounded-xl bg-success text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2"><Check size={18} /> Enregistrer</button>
        </>
      )}
      {p.identity && <button onClick={() => onManual({ role, mandate_note: mandate, company })} disabled={busy || mandateMissing} className="py-2 rounded-lg border text-sm">Garder l'identité déjà lue, mettre à jour la qualité et continuer</button>}
      {skip}
    </div>
  )
}

// ── Étape 5 : attestation ───────────────────────────────────────────────────
function SignatureStep({ p, mission, busy, onSubmit, skip }: { token: string; p: any; mission: Mission | null; busy: boolean; onSubmit: (b: any) => void; skip: React.ReactNode }) {
  const [signature, setSignature] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const id = p.identity || {}
  const blocked = !p.checks?.path || !p.checks?.informex || !p.checks?.identity || !p.checks?.cmr
  return (
    <div className="flex flex-col gap-3">
      {blocked && <p className="text-sm bg-critical/10 border border-critical/40 rounded-lg px-3 py-2">Étapes précédentes incomplètes : {p.missing}</p>}
      <div className="bg-surface border rounded-xl p-4 text-sm flex flex-col gap-1.5">
        <p className="font-semibold text-base">Déclaration</p>
        <p>Je soussigné(e) <b>{[id.firstName, id.lastName].filter(Boolean).join(' ') || '…'}</b>, {roleLabel(p.identity_role)}{p.company?.name ? <> pour le compte de <b>{p.company.name}</b></> : null}, déclare emporter ce jour le véhicule <b>{[mission?.brand, mission?.model, mission?.plate].filter(Boolean).join(' ')}</b>{mission?.vin ? ` (châssis ${mission.vin})` : ''} du parc de Verviers Dépannage{p.path === 'informex' ? <>, sur base du bon d'enlèvement Informex{p.informex?.reference ? ` n° ${p.informex.reference}` : ''}{p.informex?.buyerName ? <> établi au nom de <b>{p.informex.buyerName}</b></> : null}</> : p.destination ? `, vers ${p.destination}` : ''}, et reconnais que les documents présentés sont authentiques et que je suis habilité(e) à prendre possession de ce véhicule.</p>
        {p.mandate_note && <p className="text-ink-muted">Mandat : {p.mandate_note}</p>}
        {p.cmr?.cmrNumber && <p className="text-ink-muted">CMR n° {p.cmr.cmrNumber}{p.cmr.truckPlate ? ` · camion ${p.cmr.truckPlate}` : ''}</p>}
        {Object.keys(p.skips || {}).length > 0 && <p className="text-warning">Étapes passées : {Object.keys(p.skips).map(k => STEP_TITLES[k as Step] || k).join(', ')}</p>}
      </div>
      <input value={signerName} onChange={e => setSignerName(e.target.value)} className="border rounded-lg px-3 py-2 bg-surface text-sm" placeholder={`Nom du signataire${id.lastName ? ` (${[id.firstName, id.lastName].filter(Boolean).join(' ')})` : ''}`} />
      <div className="bg-surface border rounded-xl p-3">
        <p className="text-sm font-semibold mb-2">Signature de la personne présente</p>
        <SigPad onSave={d => setSignature(d)} />
        {signature && <p className="text-success text-xs mt-1 flex items-center gap-1"><Check size={14} /> Signature prête</p>}
      </div>
      <button onClick={() => onSubmit({ signature, signer_name: signerName.trim() || undefined })} disabled={busy || !signature || blocked}
        className="w-full py-3.5 rounded-xl bg-brand text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Valider l'attestation
      </button>
      {skip}
    </div>
  )
}
