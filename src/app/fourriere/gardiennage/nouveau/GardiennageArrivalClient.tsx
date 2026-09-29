'use client'

// Formulaire mobile de la fiche gardiennage à l'arrivée (maquette validée le
// 28/09/2026 : https://claude.ai/artifact/5S8kKA11FRYQKt5ddyN52J).
// Un écran, du haut vers le bas : véhicule, qui l'apporte, pour qui, clé,
// zone, photos. Les photos sont prises avant la création puis envoyées une
// par une sur la fiche créée.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import BurstCamera from '@/components/camera/BurstCamera'
import ScanButton from '@/components/ScanButton'
import BrandModelPicker, { findOther, OTHER_NAME, type CatalogItem } from '@/components/vehicles/BrandModelPicker'
import { compressImage } from '@/lib/image-compress'
import { normalizePlate } from '@/lib/plate'

type Opts = { zones: { key: string; label: string }[]; assisteurs: { key: string; label: string }[]; transporters: string[]; rate: { htva: number; tvac: number; free_days: number } | null }
type Shot = { id: string; blob: Blob; url: string }
type OdooVehicle = { id: number; plate: string; vin: string | false; brand: string; model: string }
type Done = { id: string; number: number | null; label_ok: boolean; label_error: string | null; photosSent: number; photosFailed: number }

const eur = (n: number) => n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const KEYS: [string, string][] = [['in_vehicle', 'Dans le véhicule'], ['hook', 'Au crochet'], ['office', 'Au bureau'], ['no_key', 'Pas de clé']]

const Lbl = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">{children}</div>
const Card = ({ children }: { children: React.ReactNode }) => <section className="bg-surface border border-border rounded-card p-3.5 flex flex-col gap-2.5">{children}</section>
const Chip = ({ on, onClick, children, mono }: { on: boolean; onClick: () => void; children: React.ReactNode; mono?: boolean }) =>
  <button type="button" onClick={onClick} aria-pressed={on} className={`min-h-[40px] rounded-full border px-3.5 text-sm font-semibold ${mono ? 'font-mono' : ''} ${on ? 'border-info bg-info-soft text-info' : 'border-strong bg-surface text-ink'}`}>{children}</button>
const Opt = ({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) =>
  <button type="button" onClick={onClick} aria-pressed={on} className={`w-full min-h-[48px] text-left rounded-xl border px-3 py-2.5 flex items-center gap-2.5 ${on ? 'border-info bg-info-soft' : 'border-strong bg-surface'}`}>
    <span className={`w-[22px] h-[22px] flex-none rounded-md border-2 flex items-center justify-center text-xs ${on ? 'bg-info-fill border-info-fill text-white' : 'border-strong text-transparent'}`}>✓</span>
    <span className="font-semibold text-ink">{title}{sub && <span className="block text-xs font-normal text-ink-muted">{sub}</span>}</span>
  </button>
const input = 'w-full rounded-btn border border-strong bg-surface px-3 py-2.5 text-ink'

export default function GardiennageArrivalClient() {
  const [opts, setOpts] = useState<Opts | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [camera, setCamera] = useState<null | 'photos' | 'bon'>(null)
  // Date d'entrée au parc : aujourd'hui par défaut, modifiable (véhicule arrivé un
  // autre jour, fiche encodée après coup). Olivier 29/09/2026.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
  const [f, setF] = useState({ entry: today, plate: '', vin: '', brand: '', model: '', transporter: '', cmr: '', from: '', for: 'unknown', assist: '', assistRef: '', client: '', key: '', hook: '', zone: 'Transit', remark: '' })
  const [shots, setShots] = useState<Shot[]>([])
  const [bon, setBon] = useState<Shot[]>([])
  const galleryRef = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }))

  // Véhicule : plaque → recherche dans le parc véhicules ; sinon marque et
  // modèle en liste (comme l'app chauffeur) ; châssis lu sur les photos.
  const [veh, setVeh] = useState<'idle' | 'searching' | 'found' | 'confirmed' | 'manual'>('idle')
  const [found, setFound] = useState<OdooVehicle | null>(null)
  const [odooVehicleId, setOdooVehicleId] = useState<number | null>(null)
  const [brands, setBrands] = useState<CatalogItem[]>([])
  const [models, setModels] = useState<CatalogItem[]>([])
  const [brandId, setBrandId] = useState<number | null>(null)
  const [pick, setPick] = useState<'brand' | 'model' | null>(null)
  const [loadingCat, setLoadingCat] = useState(false)
  const [ocr, setOcr] = useState<'idle' | 'reading' | 'done' | 'none' | 'error'>('idle')
  useEffect(() => {
    setLoadingCat(true)
    fetch('/api/vehicles?type=brands').then(r => r.json()).then(d => setBrands(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoadingCat(false))
  }, [])
  useEffect(() => {
    if (!brandId) { setModels([]); return }
    setLoadingCat(true)
    fetch(`/api/vehicles?type=models&brandId=${brandId}`).then(r => r.json()).then(d => setModels(Array.isArray(d) ? d : [])).catch(() => setModels([])).finally(() => setLoadingCat(false))
  }, [brandId])
  const searchPlate = async (q = f.plate) => {
    const plate = normalizePlate(q)
    if (plate.length < 3) return
    setVeh('searching'); setFound(null)
    try {
      const d = await (await fetch(`/api/odoo/search-vehicle?q=${encodeURIComponent(plate)}`, { cache: 'no-store' })).json()
      const v: OdooVehicle | undefined = (d.vehicles || [])[0]
      if (v) { setFound(v); setVeh('found') } else setVeh('manual')
    } catch { setVeh('manual') }
  }
  const confirmFound = () => {
    if (!found) return
    setF(p => ({ ...p, plate: found.plate || p.plate, brand: found.brand || '', model: found.model || '', vin: p.vin || (found.vin ? String(found.vin) : '') }))
    setOdooVehicleId(found.id); setVeh('confirmed')
  }
  const readPhotos = async () => {
    const list = [...bon, ...shots].slice(-6)
    if (!list.length) return
    setOcr('reading')
    try {
      const images: string[] = []
      for (const x of list) {
        const small = await compressImage(x.blob, 1400, 0.8)
        images.push(await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(small) }))
      }
      const j = await (await fetch('/api/fourriere/gardiennage?ocr=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images }) })).json()
      if (j.error) throw new Error(j.error)
      if (!j.vin && !j.plate) { setOcr('none'); return }
      setF(p => ({ ...p, vin: p.vin || j.vin || '', plate: p.plate || j.plate || '' }))
      setOcr('done')
      if (j.plate && !f.plate && veh === 'idle') searchPlate(j.plate)
    } catch { setOcr('error') }
  }
  const closeCamera = () => {
    const was = camera; setCamera(null)
    // Châssis encore vide : on le cherche tout de suite sur les photos prises.
    if (was && !f.vin.trim() && ocr === 'idle' && (shots.length + bon.length) > 0) setTimeout(readPhotos, 0)
  }

  useEffect(() => {
    fetch('/api/fourriere/gardiennage', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j.error) { setErr(j.error); return }
      setOpts(j)
      if (!(j.zones || []).some((z: any) => z.key === 'Transit')) setF(p => ({ ...p, zone: '' }))
    }).catch(() => setErr('Chargement impossible. Vérifiez la connexion.'))
  }, [])

  const addShot = (list: 'photos' | 'bon', blob: Blob) => {
    const s = { id: Math.random().toString(36).slice(2), blob, url: URL.createObjectURL(blob) }
    ;(list === 'photos' ? setShots : setBon)(p => [...p, s])
  }
  const removeShot = (list: 'photos' | 'bon', id: string) => (list === 'photos' ? setShots : setBon)(p => { const x = p.find(s => s.id === id); if (x) URL.revokeObjectURL(x.url); return p.filter(s => s.id !== id) })

  const hasVehicle = !!(f.plate.trim() || f.vin.trim())
  const canCreate = hasVehicle && !!f.transporter.trim() && !busy && (f.key !== 'hook' || !!f.hook.trim()) && (f.for !== 'assist' || !!f.assist) && (f.for !== 'client' || !!f.client.trim())
  const missing = !hasVehicle ? 'Il manque la plaque (ou le numéro de châssis).' : !f.transporter.trim() ? 'Il manque le nom du transporteur.' : f.key === 'hook' && !f.hook.trim() ? 'Il manque le numéro de crochet.' : f.for === 'assist' && !f.assist ? 'Choisissez l’assistance.' : f.for === 'client' && !f.client.trim() ? 'Indiquez le nom du client.' : null

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/fourriere/gardiennage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, odooVehicleId }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Création impossible')
      // Photos : le bon de transport d'abord, puis l'état du véhicule, une par une.
      let sent = 0, failed = 0
      for (const s of [...bon, ...shots]) {
        try {
          const small = await compressImage(s.blob, 1800)
          const fd = new FormData(); fd.append('files', new File([small], `gardiennage_${Date.now()}.jpg`, { type: small.type || 'image/jpeg' })); fd.append('via', 'fiche')
          const pr = await fetch(`/api/missions/${j.id}/photos-add`, { method: 'POST', body: fd })
          if (pr.ok) sent++; else failed++
        } catch { failed++ }
      }
      ;[...bon, ...shots].forEach(s => URL.revokeObjectURL(s.url))
      setDone({ id: j.id, number: j.mission_number ?? null, label_ok: !!j.label_ok, label_error: j.label_error || null, photosSent: sent, photosFailed: failed })
      window.scrollTo(0, 0)
    } catch (e: any) { setErr(e?.message || 'Création impossible') } finally { setBusy(false) }
  }

  const another = () => {
    setF(p => ({ ...p, plate: '', vin: '', brand: '', model: '', key: '', hook: '', remark: '' }))
    setShots([]); setBon([]); setDone(null); setVeh('idle'); setFound(null); setOdooVehicleId(null); setBrandId(null); setOcr('idle'); window.scrollTo(0, 0)
  }

  if (done) return (
    <div className="max-w-md mx-auto px-4 py-4 flex flex-col gap-3">
      <Card>
        <span className="self-start rounded-full bg-success-soft text-success px-2.5 py-0.5 text-xs font-bold">✓ Fiche {done.number || ''} créée</span>
        <div className="font-mono text-2xl font-semibold text-ink">{f.plate || f.vin}</div>
        <div className="text-sm text-ink-muted">{[f.brand, f.model].filter(Boolean).join(' ')}{f.zone ? ` · zone ${f.zone}` : ''}</div>
        <Row k="Étiquette" v={done.label_ok ? 'envoyée à la Zebra du parc' : `pas imprimée${done.label_error ? ` (${done.label_error})` : ''} : réimprimez depuis la fiche`} warn={!done.label_ok} />
        <Row k="Apporté par" v={`${f.transporter}${f.cmr ? ` · ${f.cmr}` : ''}`} />
        <Row k="Pour" v={f.for === 'assist' ? `${opts?.assisteurs.find(x => x.key === f.assist)?.label || 'Assistance'}${f.assistRef ? ` · ${f.assistRef}` : ''}` : f.for === 'client' ? f.client : 'À déterminer (Client divers)'} />
        <Row k="Photos" v={`${done.photosSent} envoyée${done.photosSent > 1 ? 's' : ''}${done.photosFailed ? ` · ${done.photosFailed} en échec : à reprendre sur la fiche` : ''}`} warn={done.photosFailed > 0} />
        <Row k="Gardiennage" v="en attente de décision · 0 nuit" />
      </Card>
      <Link href={`/dispatch/${done.id}`} className="w-full min-h-[50px] rounded-btn bg-brand hover:bg-brand-hover text-white font-bold flex items-center justify-center shadow-brand">Ouvrir la fiche</Link>
      <button type="button" onClick={another} className="w-full min-h-[44px] rounded-btn border border-strong bg-surface text-ink font-semibold">＋ Un autre véhicule de {f.transporter}</button>
      <Link href="/dashboard" className="text-center text-sm font-semibold text-ink-muted py-2">Retour au tableau de bord</Link>
    </div>
  )

  return (
    <div className="max-w-md mx-auto px-4 py-4 flex flex-col gap-3">
      {camera && <BurstCamera title={camera === 'bon' ? 'Bon de transport' : 'Photos'} count={(camera === 'bon' ? bon : shots).length} onShot={blob => addShot(camera, blob)} onClose={closeCamera} />}
      <div>
        <h1 className="font-display text-xl font-bold text-ink">Véhicule apporté par un transporteur</h1>
        <p className="text-sm text-ink-secondary mt-0.5">Crée une fiche de gardiennage, sans remorquage. Le véhicule attend la décision d’un client ou d’une assistance.</p>
      </div>
      {err && <p className="rounded-xl bg-critical-soft text-critical px-3 py-2 text-sm font-semibold">{err}</p>}
      {!opts && !err && <p className="text-sm text-ink-muted">Chargement…</p>}

      {opts && <>
        <Card>
          <Lbl>Véhicule</Lbl>
          {veh !== 'confirmed' && <div className="flex gap-1.5">
            <input className={`${input} flex-1 min-w-0 font-mono text-xl font-semibold tracking-wider uppercase`} placeholder="1-ABC-123" value={f.plate}
              onChange={e => { set('plate', normalizePlate(e.target.value)); if (veh === 'found') setVeh('idle') }}
              onKeyDown={e => { if (e.key === 'Enter') searchPlate() }} aria-label="Plaque" autoCapitalize="characters" autoComplete="off" />
            <ScanButton mode="plate" value={f.plate} onScan={t => { const p = normalizePlate(t); set('plate', p); searchPlate(p) }} className="min-w-[48px] rounded-btn bg-brand/10 text-brand text-sm flex items-center justify-center" label="📷" />
            <button type="button" onClick={() => searchPlate()} disabled={normalizePlate(f.plate).length < 3 || veh === 'searching'} aria-label="Rechercher la plaque" className="min-w-[48px] rounded-btn bg-brand text-white font-semibold disabled:opacity-40">{veh === 'searching' ? '…' : '🔍'}</button>
          </div>}

          {veh === 'found' && found && (
            <div className="rounded-xl border border-border bg-surface-2 p-3 flex flex-col gap-2">
              <div className="text-xs text-ink-muted">Déjà connu pour cette plaque :</div>
              <div><div className="font-bold text-ink">{found.brand} {found.model}</div><div className="font-mono text-sm text-ink-secondary">{found.plate}{found.vin ? ` · ${found.vin}` : ''}</div></div>
              <div className="flex gap-2">
                <button type="button" onClick={confirmFound} className="flex-1 min-h-[44px] rounded-btn bg-success-fill text-white font-semibold">C’est bien lui</button>
                <button type="button" onClick={() => { setFound(null); setVeh('manual') }} className="flex-1 min-h-[44px] rounded-btn border border-strong bg-surface text-ink font-semibold">Non, autre véhicule</button>
              </div>
            </div>
          )}

          {veh === 'confirmed' && (
            <div className="rounded-xl bg-success-soft px-3 py-2.5 flex items-start gap-2">
              <span className="text-success font-bold">✓</span>
              <div className="flex-1 min-w-0"><div className="font-bold text-ink">{f.brand} {f.model}</div><div className="font-mono text-sm text-ink-secondary">{f.plate}</div></div>
              <button type="button" onClick={() => { setVeh('idle'); setOdooVehicleId(null) }} className="text-xs font-semibold text-ink-secondary underline">Changer</button>
            </div>
          )}

          {(veh === 'manual' || veh === 'idle') && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPick('brand')} className={`${input} min-h-[44px] text-left flex items-center justify-between`}><span className={f.brand ? 'text-ink' : 'text-ink-muted'}>{f.brand || 'Marque'}</span><span className="text-ink-muted">▾</span></button>
              <button type="button" onClick={() => setPick('model')} disabled={!f.brand} className={`${input} min-h-[44px] text-left flex items-center justify-between disabled:opacity-40`}><span className={f.model ? 'text-ink' : 'text-ink-muted'}>{f.model || 'Modèle'}</span><span className="text-ink-muted">▾</span></button>
            </div>
          )}
          {veh === 'manual' && !f.brand && <p className="text-xs text-ink-muted">Plaque inconnue chez nous : choisissez la marque et le modèle.</p>}
          <BrandModelPicker open={pick === 'brand'} title="Marque" items={brands} loading={loadingCat}
            onPick={x => { setBrandId(x.id); setF(p => ({ ...p, brand: x.name, model: '' })); setPick('model') }}
            onOther={typed => { const o = findOther(brands); setBrandId(o?.id ?? null); setF(p => ({ ...p, brand: OTHER_NAME, model: OTHER_NAME, remark: [p.remark, typed ? `Marque : ${typed}` : ''].filter(Boolean).join(' · ') })); setPick(null) }}
            onClose={() => setPick(null)} />
          <BrandModelPicker open={pick === 'model'} title={f.brand} items={models} loading={loadingCat}
            onPick={x => { set('model', x.name); setPick(null) }}
            onOther={typed => { setF(p => ({ ...p, model: OTHER_NAME, remark: [p.remark, typed ? `Modèle : ${typed}` : ''].filter(Boolean).join(' · ') })); setPick(null) }}
            onClose={() => setPick(null)} />

          <div className="flex gap-1.5">
            <input className={`${input} flex-1 min-w-0 font-mono uppercase`} placeholder="N° de châssis (VIN)" value={f.vin} onChange={e => set('vin', e.target.value.toUpperCase())} aria-label="Numéro de châssis" maxLength={17} autoCapitalize="characters" />
            <ScanButton mode="vin" value={f.vin} onScan={t => set('vin', t.toUpperCase())} className="min-w-[48px] rounded-btn bg-brand/10 text-brand text-sm flex items-center justify-center" label="📷" />
          </div>
          <button type="button" onClick={readPhotos} disabled={ocr === 'reading' || (shots.length + bon.length) === 0}
            className="w-full min-h-[44px] rounded-xl border border-dashed border-strong bg-surface px-3 text-sm font-semibold text-ink-secondary disabled:opacity-50">
            {ocr === 'reading' ? 'Lecture des photos…' : '🔎 Lire la plaque et le châssis sur les photos'}
          </button>
          <p className={`text-xs ${ocr === 'none' || ocr === 'error' ? 'text-warning font-semibold' : 'text-ink-muted'}`}>
            {(shots.length + bon.length) === 0 ? 'Photographiez la plaquette du châssis (pare-brise) ou la carte grise plus bas : le numéro se remplira tout seul.'
              : ocr === 'done' ? 'Lu sur les photos : vérifiez le numéro.'
              : ocr === 'none' ? 'Aucun numéro lisible sur les photos : prenez la plaquette du pare-brise de plus près.'
              : ocr === 'error' ? 'Lecture impossible pour le moment : tapez le numéro ou réessayez.'
              : 'Le numéro est cherché sur les photos dès que vous fermez l’appareil photo.'}
          </p>
        </Card>

        <Card>
          <Lbl>Date d’entrée au parc</Lbl>
          <input type="date" className={input} value={f.entry} max={today} onChange={e => set('entry', e.target.value || today)} aria-label="Date d’entrée au parc" />
          {f.entry < today && (() => { const n = Math.round((new Date(today).getTime() - new Date(f.entry).getTime()) / 86400000); return <p className="text-xs font-semibold text-warning">Entré il y a {n} jour{n > 1 ? 's' : ''} : {n} nuit{n > 1 ? 's' : ''} de gardiennage déjà comptée{n > 1 ? 's' : ''}.</p> })()}
          {f.entry === today && <p className="text-xs text-ink-muted">Aujourd’hui. Changez la date si le véhicule est arrivé un autre jour.</p>}
        </Card>

        <Card>
          <Lbl>Qui l’apporte</Lbl>
          <input className={input} placeholder="Nom du transporteur" value={f.transporter} onChange={e => set('transporter', e.target.value)} aria-label="Transporteur" />
          {opts.transporters.length > 0 && <div className="flex flex-wrap gap-1.5">{opts.transporters.map(t => <Chip key={t} on={f.transporter === t} onClick={() => set('transporter', t)}>{t}</Chip>)}</div>}
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="N° CMR / bon" value={f.cmr} onChange={e => set('cmr', e.target.value)} aria-label="Numéro du bon" />
            <input className={input} placeholder="Vient de…" value={f.from} onChange={e => set('from', e.target.value)} aria-label="Provenance" />
          </div>
          <button type="button" onClick={() => setCamera('bon')} className="w-full min-h-[44px] text-left rounded-xl border border-strong bg-surface px-3 py-2.5 text-sm font-semibold text-ink">📄 Photographier le bon de transport{bon.length ? ` · ${bon.length} page${bon.length > 1 ? 's' : ''}` : ''}</button>
          {bon.length > 0 && <Thumbs list={bon} onRemove={id => removeShot('bon', id)} />}
        </Card>

        <Card>
          <Lbl>Pour qui ?</Lbl>
          <Opt on={f.for === 'unknown'} onClick={() => set('for', 'unknown')} title="On ne sait pas encore" sub="facturé à Client divers en attendant qu’on se manifeste" />
          <Opt on={f.for === 'assist'} onClick={() => set('for', 'assist')} title="Une assistance" />
          {f.for === 'assist' && <>
            <div className="flex flex-wrap gap-1.5">{opts.assisteurs.map(x => <Chip key={x.key} on={f.assist === x.key} onClick={() => set('assist', x.key)}>{x.label}</Chip>)}</div>
            <input className={input} placeholder="N° de dossier (si connu)" value={f.assistRef} onChange={e => set('assistRef', e.target.value)} aria-label="Numéro de dossier assistance" />
          </>}
          <Opt on={f.for === 'client'} onClick={() => set('for', 'client')} title="Un client (propriétaire, garage)" />
          {f.for === 'client' && <input className={input} placeholder="Nom ou société" value={f.client} onChange={e => set('client', e.target.value)} aria-label="Client" />}
        </Card>

        <Card>
          <Lbl>Clé</Lbl>
          <div className="flex flex-wrap gap-1.5">{KEYS.map(([k, l]) => <Chip key={k} on={f.key === k} onClick={() => set('key', f.key === k ? '' : k)}>{l}</Chip>)}</div>
          {f.key === 'hook' && <input className={`${input} font-mono`} inputMode="numeric" placeholder="N° de crochet" value={f.hook} onChange={e => set('hook', e.target.value)} aria-label="Numéro de crochet" />}
        </Card>

        <Card>
          <Lbl>Zone du parc</Lbl>
          <div className="flex flex-wrap gap-1.5">{opts.zones.map(z => <Chip key={z.key} mono on={f.zone === z.key} onClick={() => set('zone', z.key)}>{z.key}</Chip>)}</div>
        </Card>

        <Card>
          <Lbl>État à l’arrivée</Lbl>
          {shots.length > 0 && <Thumbs list={shots} onRemove={id => removeShot('photos', id)} />}
          <div className="flex gap-2">
            <button type="button" onClick={() => setCamera('photos')} className="flex-1 min-h-[48px] rounded-xl border border-strong bg-surface px-3 text-sm font-semibold text-ink">📷 Photographier en rafale{shots.length ? ` (${shots.length})` : ''}</button>
            <button type="button" onClick={() => galleryRef.current?.click()} className="min-h-[48px] rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-ink-secondary">Galerie</button>
          </div>
          <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={e => { Array.from(e.target.files || []).forEach(file => addShot('photos', file)); e.target.value = '' }} />
          <p className="text-xs text-ink-muted">Dégâts visibles, carburant, compteur : utile si le transporteur conteste l’état du véhicule.</p>
          <textarea className={input} rows={2} placeholder="Remarque (facultatif)" value={f.remark} onChange={e => set('remark', e.target.value)} aria-label="Remarque" />
        </Card>

        {opts.rate && (
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
            <span><Lbl>Gardiennage</Lbl><span className="text-xs text-ink-muted">par nuit passée au parc{opts.rate.free_days ? `, après ${opts.rate.free_days} jours inclus` : ', dès la 1re nuit'}</span></span>
            <span className="text-right"><b className="font-mono text-lg text-ink">{eur(opts.rate.htva)}</b> <span className="text-xs text-ink-muted">HTVA</span><br /><span className="font-mono text-xs text-ink-muted">{eur(opts.rate.tvac)} TVAC</span></span>
          </div>
        )}

        <button type="button" onClick={create} disabled={!canCreate} className="w-full min-h-[52px] rounded-btn bg-brand hover:bg-brand-hover text-white font-bold shadow-brand disabled:opacity-45 disabled:cursor-not-allowed">
          {busy ? 'Création en cours…' : 'Créer la fiche et imprimer l’étiquette'}
        </button>
        <p className="text-center text-xs text-ink-muted -mt-1">{missing || 'Le reste pourra se compléter sur la fiche.'}</p>
      </>}
    </div>
  )
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return <div className="flex justify-between gap-3 border-b border-border last:border-0 py-1.5 text-sm"><span className="text-ink-muted">{k}</span><span className={`text-right ${warn ? 'text-warning font-semibold' : 'text-ink'}`}>{v}</span></div>
}
function Thumbs({ list, onRemove }: { list: Shot[]; onRemove: (id: string) => void }) {
  return <div className="grid grid-cols-4 gap-1.5">{list.map((s, i) => (
    <div key={s.id} className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface-2">
      <img src={s.url} alt="" className="w-full h-full object-cover" />
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white">{i + 1}</span>
      <button type="button" onClick={() => onRemove(s.id)} aria-label={`Retirer la photo ${i + 1}`} className="absolute right-0 top-0 w-8 h-8 flex items-center justify-center text-white text-sm font-bold bg-black/50 rounded-bl-lg">✕</button>
    </div>
  ))}</div>
}
