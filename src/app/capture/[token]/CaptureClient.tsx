'use client'
// src/app/capture/[token]/CaptureClient.tsx
//
// Module téléphone du contrôle de sortie. Selon le jeton :
//   id_card / cmr / informex → prise de photos (caméra arrière), envoi, lecture
//   informex                 → en plus, décodage du QR du bon (sur la photo,
//                              ou scan caméra en direct)
//   signature                → résumé de l'attestation + pad de signature
// Olivier 2026-09-05.

import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, QrCode, Trash2, AlertTriangle } from 'lucide-react'
import SigPad from '@/components/mission/SigPad'
import RestitutionWizard from './RestitutionWizard'

type Kind = 'id_card' | 'cmr' | 'informex' | 'signature' | 'restitution'
interface Info {
  status: 'pending' | 'used' | 'expired'
  kind: Kind
  mission: { id: string; mission_number?: number | null; plate?: string | null; brand?: string | null; model?: string | null; vin?: string | null } | null
  preview?: any
  error?: string
}

const TITLES: Record<Kind, string> = {
  id_card: 'Pièce d\'identité', cmr: 'CMR du transporteur', informex: 'Bon Informex', signature: 'Attestation d\'enlèvement', restitution: 'Procédure de sortie',
}
const roleLabel = (r?: string | null) => r === 'mandate' ? 'mandataire de l\'acheteur' : r === 'transporter' ? 'transporteur' : 'acheteur'

export default function CaptureClient({ token }: { token: string }) {
  const [info, setInfo]       = useState<Info | null>(null)
  const [files, setFiles]     = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [qrRaw, setQrRaw]     = useState<string>('')
  const [qrBusy, setQrBusy]   = useState(false)
  const [scanning, setScanning] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult]   = useState<any>(null)
  const [error, setError]     = useState<string | null>(null)
  const [signature, setSignature] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const scanRef = useRef<any>(null)

  useEffect(() => {
    fetch(`/api/capture/${token}`, { cache: 'no-store' }).then(r => r.json()).then(setInfo)
      .catch(() => setInfo({ status: 'expired', kind: 'id_card', mission: null }))
  }, [token])

  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach(u => URL.revokeObjectURL(u))
  }, [files])

  // Informex : tente de décoder le QR sur la première photo ajoutée.
  async function decodeQrFromFile(file: File) {
    setQrBusy(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const host = document.getElementById('qr-file-host') || (() => {
        const d = document.createElement('div'); d.id = 'qr-file-host'; d.style.display = 'none'; document.body.appendChild(d); return d
      })()
      const h = new Html5Qrcode(host.id)
      const text = await h.scanFile(file, false)
      if (text) setQrRaw(text)
      try { h.clear() } catch {}
    } catch { /* pas de QR lisible sur la photo : scan caméra possible */ }
    finally { setQrBusy(false) }
  }

  async function startLiveScan() {
    setScanning(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const h = new Html5Qrcode('qr-live')
      scanRef.current = h
      await h.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 240, height: 240 } },
        (text: string) => { setQrRaw(text); stopLiveScan() }, () => {})
    } catch (e: any) { setError(e?.message || 'Caméra indisponible'); setScanning(false) }
  }
  async function stopLiveScan() {
    try { await scanRef.current?.stop(); scanRef.current?.clear() } catch {}
    scanRef.current = null
    setScanning(false)
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return
    setFiles(prev => [...prev, ...picked].slice(0, 6))
    if (info?.kind === 'informex' && !qrRaw) decodeQrFromFile(picked[0])
    e.target.value = ''
  }

  async function sendPhotos() {
    if (!info) return
    if (!files.length && !(info.kind === 'informex' && qrRaw)) { setError('Ajoute au moins une photo.'); return }
    setSending(true); setError(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      if (qrRaw) fd.append('qr_raw', qrRaw)
      const r = await fetch(`/api/capture/${token}`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Envoi échoué')
      setResult(j)
    } catch (e: any) { setError(e.message) }
    finally { setSending(false) }
  }

  async function sendSignature() {
    if (!signature) { setError('Signe d\'abord.'); return }
    setSending(true); setError(null)
    try {
      const r = await fetch(`/api/capture/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, signer_name: signerName.trim() || undefined }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Envoi échoué')
      setResult(j)
    } catch (e: any) { setError(e.message) }
    finally { setSending(false) }
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-page text-ink">
      <div className="max-w-md mx-auto p-4 pb-10 flex flex-col gap-4">
        <header className="flex items-center gap-3">
          <img src="/vd-logo.png" alt="Verviers Dépannage" className="h-9 w-auto" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Contrôle de sortie</p>
            <h1 className="font-bold text-lg leading-tight">{info ? TITLES[info.kind] : '…'}</h1>
          </div>
        </header>
        {info?.mission && (
          <div className="bg-surface border rounded-xl px-4 py-3">
            <p className="font-mono text-xl font-bold tracking-wider">{info.mission.plate || '—'}</p>
            <p className="text-ink-secondary text-sm">{[info.mission.brand, info.mission.model].filter(Boolean).join(' ')}{info.mission.mission_number ? ` · #${info.mission.mission_number}` : ''}</p>
          </div>
        )}
        {children}
      </div>
    </div>
  )

  if (!info) return shell(<p className="text-ink-muted flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Chargement…</p>)
  if (info.status !== 'pending' && !result) {
    return shell(
      <div className="bg-warning/10 border border-warning/40 rounded-xl p-4">
        <p className="font-semibold">{info.status === 'used' ? 'Ce lien a déjà servi.' : 'Lien expiré ou invalide.'}</p>
        <p className="text-sm text-ink-secondary mt-1">Refais un QR depuis la fiche sur l'ordinateur.</p>
      </div>,
    )
  }

  if (info.kind === 'restitution') {
    return shell(<RestitutionWizard token={token} mission={info.mission} initialPreview={info.preview} onFinished={() => setResult({ ok: true, kind: 'restitution' })} />)
  }

  if (result) {
    const ocr = result.ocr
    return shell(
      <div className="flex flex-col gap-3">
        <div className="bg-success/10 border border-success/40 rounded-xl p-4 flex items-start gap-3">
          <Check className="text-success mt-0.5" />
          <div>
            <p className="font-semibold">Reçu sur la fiche</p>
            <p className="text-sm text-ink-secondary">Tu peux fermer cette page. La fiche sur l'ordinateur s'est mise à jour.</p>
          </div>
        </div>
        {info.kind === 'id_card' && ocr && (
          <div className="bg-surface border rounded-xl p-4 text-sm">
            <p className="font-semibold mb-1">Lu sur la pièce</p>
            <p>{[ocr.firstName, ocr.lastName].filter(Boolean).join(' ') || '—'}{ocr.nationality ? ` · ${ocr.nationality}` : ''}{ocr.birthDate ? ` · né(e) le ${ocr.birthDate}` : ''}</p>
            {ocr.documentNumber && <p className="text-ink-muted">N° {ocr.documentNumber}</p>}
            {ocr.confidence === 'low' && <p className="text-warning mt-1 flex items-center gap-1"><AlertTriangle size={14} /> Lecture peu sûre : vérifie sur la fiche.</p>}
          </div>
        )}
        {info.kind === 'cmr' && ocr && (
          <div className="bg-surface border rounded-xl p-4 text-sm">
            <p className="font-semibold mb-1">Lu sur le CMR</p>
            <p>{ocr.cmrNumber ? `N° ${ocr.cmrNumber}` : 'Numéro non lu'}{ocr.carrier ? ` · ${ocr.carrier}` : ''}</p>
            {ocr.truckPlate && <p className="text-ink-muted">Camion {ocr.truckPlate}</p>}
          </div>
        )}
        {info.kind === 'informex' && (
          <div className="bg-surface border rounded-xl p-4 text-sm flex flex-col gap-1">
            <p className="font-semibold">Bon Informex</p>
            <p>{result.qr_raw ? '✅ QR décodé et enregistré' : '⚠️ QR non décodé (photo seule)'}</p>
            {ocr?.buyerName && <p>Acheteur : <b>{ocr.buyerName}</b></p>}
            {ocr?.reference && <p className="text-ink-muted">Réf. {ocr.reference}</p>}
            {result.match && (
              <p>Plaque {result.match.plate === null ? '?' : result.match.plate ? '✅' : '❌'} · Châssis {result.match.vin === null ? '?' : result.match.vin ? '✅' : '❌'}</p>
            )}
            {result.match && (result.match.plate === false || result.match.vin === false) && (
              <p className="text-critical font-semibold flex items-center gap-1"><AlertTriangle size={14} /> Le bon ne correspond pas à ce véhicule. Ne pas restituer.</p>
            )}
          </div>
        )}
        {info.kind === 'signature' && <p className="text-sm text-ink-secondary">L'attestation est figée. Le bureau peut l'imprimer depuis la fiche.</p>}
      </div>,
    )
  }

  if (info.kind === 'signature') {
    const p = info.preview || {}
    const id = p.identity || {}
    const missing = p.missing as string | null
    return shell(
      <div className="flex flex-col gap-3">
        {missing && (
          <div className="bg-critical/10 border border-critical/40 rounded-xl p-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="text-critical mt-0.5" />
            <p><b>Checklist incomplète :</b> {missing} La signature sera refusée tant que ce n'est pas fait sur la fiche.</p>
          </div>
        )}
        <div className="bg-surface border rounded-xl p-4 text-sm flex flex-col gap-1.5">
          <p className="font-semibold text-base">Déclaration</p>
          <p>Je soussigné(e) <b>{[id.firstName, id.lastName].filter(Boolean).join(' ') || '…'}</b>, {roleLabel(p.identity_role)}{p.company?.name ? <> pour le compte de <b>{p.company.name}</b></> : null}, déclare emporter ce jour le véhicule <b>{info.mission?.plate}</b>{info.mission?.vin ? ` (châssis ${info.mission.vin})` : ''} du parc de Verviers Dépannage{p.path === 'informex' ? <>, sur base du bon d'enlèvement Informex{p.informex?.reference ? ` n° ${p.informex.reference}` : ''}{p.informex?.buyerName ? <> établi au nom de <b>{p.informex.buyerName}</b></> : null}</> : p.destination ? `, vers ${p.destination}` : ''}, et reconnais que les documents présentés sont authentiques et que je suis habilité(e) à prendre possession de ce véhicule.</p>
          {p.mandate_note && <p className="text-ink-muted">Mandat : {p.mandate_note}</p>}
          {p.cmr?.cmrNumber && <p className="text-ink-muted">CMR n° {p.cmr.cmrNumber}{p.cmr.truckPlate ? ` · camion ${p.cmr.truckPlate}` : ''}</p>}
        </div>
        <label className="text-sm">
          <span className="text-ink-secondary">Nom du signataire (si différent)</span>
          <input value={signerName} onChange={e => setSignerName(e.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 bg-surface" placeholder={[id.firstName, id.lastName].filter(Boolean).join(' ')} />
        </label>
        <div className="bg-surface border rounded-xl p-3">
          <p className="text-sm font-semibold mb-2">Signature</p>
          <SigPad onSave={d => setSignature(d)} />
          {signature && <p className="text-success text-xs mt-1 flex items-center gap-1"><Check size={14} /> Signature prête</p>}
        </div>
        {error && <p className="text-critical text-sm">{error}</p>}
        <button onClick={sendSignature} disabled={sending || !signature || !!missing}
          className="w-full py-3.5 rounded-xl bg-brand text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Valider l'attestation
        </button>
      </div>,
    )
  }

  // Photos (id_card / cmr / informex)
  return shell(
    <div className="flex flex-col gap-3">
      {info.kind === 'informex' && (
        <div className="bg-surface border rounded-xl p-3 flex flex-col gap-2">
          <p className="text-sm font-semibold flex items-center gap-2"><QrCode size={16} /> QR du bon</p>
          {qrRaw ? (
            <p className="text-sm text-success break-all">✅ Décodé : <span className="text-ink-muted">{qrRaw.slice(0, 120)}{qrRaw.length > 120 ? '…' : ''}</span></p>
          ) : (
            <p className="text-sm text-ink-secondary">{qrBusy ? 'Lecture du QR sur la photo…' : 'Photographie le bon : le QR est lu sur la photo. Sinon, scanne-le en direct.'}</p>
          )}
          <div id="qr-live" className={scanning ? 'rounded-lg overflow-hidden' : 'hidden'} />
          {scanning ? (
            <button onClick={stopLiveScan} className="py-2 rounded-lg border text-sm">Arrêter le scan</button>
          ) : (
            <button onClick={startLiveScan} className="py-2 rounded-lg border text-sm flex items-center justify-center gap-2"><QrCode size={16} /> Scanner le QR en direct</button>
          )}
        </div>
      )}

      <label className="w-full py-4 rounded-xl bg-brand text-white font-bold flex items-center justify-center gap-2 cursor-pointer">
        <Camera size={20} /> {files.length ? 'Ajouter une photo' : 'Prendre une photo'}
        <input type="file" accept="image/*" capture="environment" multiple onChange={onPick} className="hidden" />
      </label>
      <p className="text-xs text-ink-muted text-center">
        {info.kind === 'id_card' ? 'Recto, puis verso. Bien net, sans reflet.' : info.kind === 'cmr' ? 'Le document entier, à plat.' : 'Le bon entier, QR bien visible.'}
      </p>

      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((src, i) => (
            <div key={src} className="relative aspect-[3/4] rounded-lg overflow-hidden border bg-surface">
              <img src={src} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white" aria-label="Retirer"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-critical text-sm">{error}</p>}
      <button onClick={sendPhotos} disabled={sending || (!files.length && !qrRaw)}
        className="w-full py-3.5 rounded-xl bg-success text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2">
        {sending ? <><Loader2 size={18} className="animate-spin" /> Envoi et lecture…</> : <><Check size={18} /> Envoyer sur la fiche</>}
      </button>
    </div>,
  )
}
