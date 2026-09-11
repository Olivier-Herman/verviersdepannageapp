'use client'
// Nouveau dossier de destruction — pensé pour le téléphone, devant le véhicule :
//   1. identifier : scan du QR de l'étiquette, ou choix dans la liste du parc, ou « sans fiche » ;
//   2. photos en rafale (appareil natif) ou depuis la galerie / un fichier ;
//   3. lecture par Claude : VIN, marque, modèle, couleur, état — proposés, corrigeables ;
//   4. valider : le dossier est créé, la fiche sort du parc (motif destruction).
// Pas de plaque (elles ont disparu), pas de km (pas de clé). Aucun envoi à la commune.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Cand = { id: string; mission_number: number | null; source: string | null; vehicle_plate: string | null; vehicle_vin: string | null; vehicle_brand: string | null; vehicle_model: string | null; parc_zone_key: string | null; entered_at: string | null; days: number | null; lock: { blocked: boolean; reason: string | null } }
type Desc = { vin: string | null; vin_image: number | null; plate: string | null; brand: string | null; model: string | null; color: string | null; condition: Record<string, string | null>; confidence: string }
const fmtD = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

export default function NouveauClient() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [err, setErr] = useState('')
  // 1. identification
  const [mission, setMission] = useState<Cand | null>(null)
  const [noFiche, setNoFiche] = useState(false)
  const [qrScanned, setQrScanned] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [q, setQ] = useState(''); const [cands, setCands] = useState<Cand[]>([]); const [searching, setSearching] = useState(false)
  const [zone, setZone] = useState(''); const [enteredAt, setEnteredAt] = useState('')
  // QR TowSoft sans fiche VD Soft : l'archive TowSoft préremplit le dossier « sans fiche ».
  const [archive, setArchive] = useState<any>(null)
  // 2. photos
  const [isNative, setIsNative] = useState(false)
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([])
  const [shooting, setShooting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadKey = useRef(`d${Date.now()}`)
  // 3. description
  const [urls, setUrls] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [desc, setDesc] = useState<Desc>({ vin: null, vin_image: null, plate: null, brand: null, model: null, color: null, condition: {}, confidence: 'basse' })
  // 4. validation
  const [saving, setSaving] = useState(false)
  const [force, setForce] = useState<{ reason: string; pin: string } | null>(null)

  useEffect(() => { import('@capacitor/core').then(m => setIsNative(m.Capacitor.isNativePlatform())).catch(() => {}) }, [])

  // ── Étape 1 : QR / liste ──────────────────────────────────────────────────
  const resolveQr = async (raw: string) => {
    setErr('')
    const r = await fetch(`/api/fourriere/destruction-dossiers/resolve?qr=${encodeURIComponent(raw)}`); const j = await r.json()
    if (r.ok && j.archive && !j.missions?.length) {
      // Fiche TowSoft archivée, jamais migrée : véhicule « sans fiche », prérempli.
      setArchive(j.archive); setMission(null); setNoFiche(true); setQrScanned(true)
      if (j.archive.date_appel) setEnteredAt(String(j.archive.date_appel).slice(0, 10))
      setDesc(d => ({ ...d, vin: j.archive.vin || d.vin, plate: j.archive.plate || d.plate, brand: j.archive.brand || d.brand, model: j.archive.model || d.model }))
      return
    }
    if (!r.ok || !j.missions?.length) { setErr(j.error || 'QR non reconnu'); return }
    const m: Cand = j.missions[0]
    if (!(m as any).in_parc) { setErr(`La fiche #${m.mission_number ?? ''} n'est pas en parc.`); return }
    setMission(m); setQrScanned(true); setNoFiche(false)
  }
  const startScan = async () => {
    setScanning(true); setErr('')
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const h = new Html5Qrcode('qr-live')
      await h.start({ facingMode: 'environment' }, { fps: 8, qrbox: 240 }, async txt => { try { await h.stop() } catch {} setScanning(false); resolveQr(txt) }, () => {})
      ;(window as any).__qrStop = async () => { try { await h.stop() } catch {} setScanning(false) }
    } catch (e: any) { setScanning(false); setErr(`Caméra indisponible : ${e?.message || e}`) }
  }
  const search = async () => {
    setSearching(true); setErr('')
    try { const r = await fetch(`/api/fourriere/destruction-dossiers/resolve?q=${encodeURIComponent(q.trim())}`); const j = await r.json(); setCands(j.missions || []) }
    catch (e: any) { setErr(e.message) } finally { setSearching(false) }
  }
  useEffect(() => { search() /* liste du parc, plus anciens d'abord */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Étape 2 : photos ──────────────────────────────────────────────────────
  const compress = (file: File): Promise<{ blob: Blob; preview: string }> => new Promise(resolve => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      c.toBlob(b => { URL.revokeObjectURL(url); resolve({ blob: b || file, preview: c.toDataURL('image/jpeg', 0.6) }) }, 'image/jpeg', 0.82)
    }
    img.onerror = () => resolve({ blob: file, preview: url })
    img.src = url
  })
  const addFiles = async (files: File[]) => { for (const f of files) { const { blob, preview } = await compress(f); setPhotos(p => [...p, { file: new File([blob], `dest-${Date.now()}.jpg`, { type: 'image/jpeg' }), preview }]) } }
  const shootBurst = async () => {
    if (!isNative) { fileRef.current?.click(); return }
    setShooting(true)
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
      while (true) {
        let dataUrl: string | undefined
        try { const p = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.DataUrl, quality: 85, saveToGallery: false, allowEditing: false, correctOrientation: true }); dataUrl = p.dataUrl } catch { break }
        if (!dataUrl) break
        const b64 = dataUrl.split(',')[1]; const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        await addFiles([new File([arr], `dest-${Date.now()}.jpg`, { type: 'image/jpeg' })])
      }
    } catch (e: any) { if (!/cancel|dismiss/i.test(String(e?.message || ''))) setErr(`Appareil photo : ${e?.message || 'indisponible'}`) }
    finally { setShooting(false) }
  }
  const uploadAndRead = async () => {
    if (photos.length < 3) { setErr('Au moins 3 photos : avant, arrière, VIN (pare-brise ou portière), intérieur.'); return }
    setReading(true); setErr('')
    try {
      const fd = new FormData(); fd.set('key', uploadKey.current); photos.forEach(p => fd.append('files', p.file))
      const up = await fetch('/api/fourriere/destruction-dossiers/photos', { method: 'POST', body: fd }); const uj = await up.json()
      if (!up.ok) throw new Error(uj.error || 'Envoi des photos impossible')
      setUrls(uj.urls || [])
      const oc = await fetch('/api/fourriere/destruction-dossiers/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photos: uj.urls }) })
      const oj = await oc.json()
      // Fusion : l'OCR d'abord, puis la fiche VD Soft, puis l'archive TowSoft
      // (Olivier 11/09/2026 : « étiquette TowSoft : il l'indique mais ne
      // reprend pas les données » — l'OCR écrasait ce que le QR avait rempli).
      const fb = (k: 'vin' | 'plate' | 'brand' | 'model', ocr: any) =>
        ocr || (k === 'vin' ? mission?.vehicle_vin : k === 'plate' ? mission?.vehicle_plate : k === 'brand' ? mission?.vehicle_brand : mission?.vehicle_model) || archive?.[k] || desc[k] || null
      if (oc.ok) setDesc({ ...oj, vin: fb('vin', oj.vin), plate: fb('plate', oj.plate), brand: fb('brand', oj.brand), model: fb('model', oj.model) })
      else setDesc(d => ({ ...d, vin: fb('vin', null), plate: fb('plate', null), brand: fb('brand', null), model: fb('model', null) }))
      setStep(3)
    } catch (e: any) { setErr(e.message) } finally { setReading(false) }
  }

  // ── Étape 4 : valider ─────────────────────────────────────────────────────
  const save = async (withForce?: { reason: string; pin: string }) => {
    setSaving(true); setErr('')
    try {
      const body: any = { mission_id: mission?.id || null, qr_scanned: qrScanned, photos: urls, vin: desc.vin, vin_image: desc.vin_image, plate: desc.plate, brand: desc.brand, model: desc.model, color: desc.color, condition: desc.condition,
        parc_zone_key: mission?.parc_zone_key || zone || null, entered_at: mission ? undefined : (enteredAt ? `${enteredAt}T12:00:00.000Z` : undefined), force: withForce,
        notes: archive ? `Fiche TowSoft n° ${archive.towsoft_num}${archive.motif ? ' · ' + archive.motif : ''}${archive.client_name ? ' · ' + archive.client_name : ''}` : undefined }
      const r = await fetch('/api/fourriere/destruction-dossiers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json()
      if (r.status === 409 && j.blocked) { setForce({ reason: '', pin: '' }); setErr(j.reason ? `Sortie bloquée : ${j.reason}` : j.error); return }
      if (!r.ok) throw new Error(j.error || 'Erreur')
      router.push(`/fourriere/destruction/dossiers/${j.dossier.id}`)
    } catch (e: any) { setErr(e.message) } finally { setSaving(false) }
  }

  const Steps = () => (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide mb-4">
      {(['Véhicule', 'Photos', 'Lecture', 'Valider'] as const).map((l, i) => <span key={l} className={`px-2 py-1 rounded-full ${step === i + 1 ? 'bg-brand text-white' : step > i + 1 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-surface-2 text-ink-muted'}`}>{i + 1} · {l}</span>)}
    </div>
  )
  const field = (label: string, key: keyof Desc, mono = false) => (
    <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">{label}</span>
      <input value={(desc[key] as string) || ''} onChange={e => setDesc(d => ({ ...d, [key]: e.target.value || null }))} className={`w-full bg-surface-hover border rounded-xl px-3 py-2.5 text-ink text-base outline-none focus:border-brand ${mono ? 'font-mono uppercase' : ''}`} /></label>
  )
  const cond = (label: string, key: string) => (
    <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">{label}</span>
      <textarea value={desc.condition?.[key] || ''} onChange={e => setDesc(d => ({ ...d, condition: { ...(d.condition || {}), [key]: e.target.value || null } }))} rows={2} className="w-full bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm outline-none focus:border-brand" /></label>
  )

  return (
    <main className="p-4 lg:p-8 max-w-2xl mx-auto pb-28">
      <Steps />
      {err && <p className="text-critical text-sm mb-3 whitespace-pre-wrap">⚠ {err}</p>}

      {step === 1 && (
        <div className="space-y-3">
          <div className="bg-surface border rounded-2xl p-4">
            <p className="text-ink font-semibold mb-2">Étiquette avec QR ?</p>
            {!scanning ? <button type="button" onClick={startScan} className="w-full py-3.5 bg-brand text-white rounded-2xl font-bold">📷 Scanner le QR de l'étiquette</button>
              : <div><div id="qr-live" className="rounded-xl overflow-hidden" /><button type="button" onClick={() => (window as any).__qrStop?.()} className="mt-2 w-full py-2 bg-surface-2 border rounded-xl text-sm">Arrêter</button></div>}
          </div>
          <div className="bg-surface border rounded-2xl p-4">
            <p className="text-ink font-semibold mb-2">Sans QR : retrouver la fiche au parc</p>
            <div className="flex gap-2"><input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} placeholder="VIN, marque, modèle…" className="flex-1 bg-surface-hover border rounded-xl px-3 py-2.5 text-ink text-base outline-none focus:border-brand" /><button type="button" onClick={search} className="px-3 bg-surface-2 border rounded-xl text-sm">{searching ? '…' : 'Chercher'}</button></div>
            <div className="mt-2 max-h-72 overflow-y-auto space-y-1">
              {cands.map(c => (
                <button key={c.id} type="button" onClick={() => { setMission(c); setNoFiche(false); setQrScanned(false); setErr('') }}
                  className={`w-full text-left rounded-xl border px-3 py-2 ${mission?.id === c.id ? 'border-brand bg-brand-soft' : 'hover:bg-surface-hover'}`}>
                  <span className="text-ink text-sm font-semibold">{[c.vehicle_brand, c.vehicle_model].filter(Boolean).join(' ') || 'Véhicule'}</span>
                  <span className="text-ink-muted text-xs"> · #{c.mission_number ?? ''}{c.parc_zone_key ? ` · zone ${c.parc_zone_key}` : ''}{c.days != null ? ` · ${c.days} j` : ''}{c.vehicle_vin ? ` · ${c.vehicle_vin}` : ''}</span>
                  {c.lock.blocked && <span className="block text-amber-600 text-[11px] font-semibold">🔒 sortie bloquée : {c.lock.reason}</span>}
                </button>
              ))}
              {!searching && cands.length === 0 && <p className="text-ink-faint text-sm py-2">Aucune fiche en parc ne correspond.</p>}
            </div>
          </div>
          <button type="button" onClick={() => { setNoFiche(true); setMission(null); setQrScanned(false) }} className={`w-full py-3 rounded-2xl border text-sm font-semibold ${noFiche ? 'border-brand bg-brand-soft text-brand' : 'bg-surface text-ink-secondary'}`}>Véhicule sans fiche connue</button>
          {noFiche && archive && (
            <div className="bg-sky-600/10 border border-sky-600/30 rounded-2xl p-3 text-sm">
              <p className="text-ink font-semibold">QR TowSoft n° {archive.towsoft_num} — fiche archivée, pas de fiche VD Soft</p>
              <p className="text-ink-secondary">{[archive.brand, archive.model].filter(Boolean).join(' ') || 'Véhicule'}{archive.plate ? ` · ${archive.plate}` : ''}{archive.vin ? ` · VIN ${archive.vin}` : ''}{archive.date_appel ? ` · appel du ${fmtD(archive.date_appel)}` : ''}{archive.motif ? ` · ${archive.motif}` : ''}</p>
            </div>
          )}
          {noFiche && (
            <div className="bg-surface border rounded-2xl p-4 grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">Zone du parc</span><input value={zone} onChange={e => setZone(e.target.value)} className="w-full bg-surface-hover border rounded-xl px-3 py-2 text-ink" /></label>
              <label className="block"><span className="block text-ink-muted text-[11px] uppercase tracking-wide mb-1">Entré au parc vers le</span><input type="date" value={enteredAt} onChange={e => setEnteredAt(e.target.value)} className="w-full bg-surface-hover border rounded-xl px-3 py-2 text-ink" /></label>
              <p className="col-span-2 text-ink-faint text-xs">Sans date, les frais ne pourront pas être calculés : mets la meilleure estimation.</p>
            </div>
          )}
          {(mission || noFiche) && (
            <div className="fixed bottom-0 inset-x-0 p-3 bg-surface border-t lg:static lg:border-0 lg:p-0">
              <button type="button" onClick={() => setStep(2)} className="w-full py-3.5 bg-brand text-white rounded-2xl font-bold">
                Suivant · {mission ? `${[mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || 'fiche'} #${mission.mission_number ?? ''}` : 'véhicule sans fiche'} →
              </button>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div className="bg-surface border rounded-2xl p-4">
            <p className="text-ink font-semibold">Photos du véhicule</p>
            <p className="text-ink-muted text-xs mb-3">Fais le tour : avant, arrière, les deux côtés, le VIN (languette du pare-brise ou montant de portière), l'intérieur par la vitre, et tout dégât. Appuie sur Annuler quand tu as fini la rafale.</p>
            <div className="flex gap-2">
              <button type="button" onClick={shootBurst} disabled={shooting} className="flex-1 py-3.5 bg-brand text-white rounded-2xl font-bold disabled:opacity-50">{shooting ? '📷 En cours…' : '📷 Photos en rafale'}</button>
              <button type="button" onClick={() => fileRef.current?.click()} className="px-4 py-3.5 bg-surface-2 border rounded-2xl text-sm">Galerie</button>
              <input ref={fileRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }} />
            </div>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {photos.map((p, i) => <div key={i} className="relative"><img src={p.preview} alt="" className="w-full h-24 object-cover rounded-lg" /><button type="button" onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs">✕</button></div>)}
              </div>
            )}
          </div>
          <div className="fixed bottom-0 inset-x-0 p-3 bg-surface border-t flex gap-2 lg:static lg:border-0 lg:p-0">
            <button type="button" onClick={() => setStep(1)} className="px-4 py-3.5 bg-surface-2 border rounded-2xl text-sm">←</button>
            <button type="button" onClick={uploadAndRead} disabled={reading || photos.length < 3} className="flex-1 py-3.5 bg-brand text-white rounded-2xl font-bold disabled:opacity-50">{reading ? 'Envoi et lecture…' : `Lire les photos (${photos.length}) →`}</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <p className="text-ink font-semibold">Ce que les photos disent <span className="text-ink-faint text-xs font-normal">· confiance {desc.confidence}</span></p>
            <p className="text-ink-muted text-xs">Corrige ce qui est faux. Pas de kilométrage : on n'a pas les clés.</p>
            {field('VIN (17 caractères)', 'vin', true)}
            <div className="grid grid-cols-2 gap-2">{field('Marque', 'brand')}{field('Modèle', 'model')}</div>
            <div className="grid grid-cols-2 gap-2">{field('Couleur', 'color')}{field('Plaque (si encore lisible)', 'plate', true)}</div>
            {cond('Carrosserie', 'carrosserie')}{cond('Vitres', 'vitres')}{cond('Roues', 'roues')}{cond('Intérieur', 'interieur')}{cond('Remarques', 'remarques')}
          </div>
          <div className="fixed bottom-0 inset-x-0 p-3 bg-surface border-t flex gap-2 lg:static lg:border-0 lg:p-0">
            <button type="button" onClick={() => setStep(2)} className="px-4 py-3.5 bg-surface-2 border rounded-2xl text-sm">←</button>
            <button type="button" onClick={() => setStep(4)} className="flex-1 py-3.5 bg-brand text-white rounded-2xl font-bold">Vérifier et valider →</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <div className="bg-surface border rounded-2xl p-4 space-y-2 text-sm">
            <p className="text-ink font-semibold text-base">{[desc.brand, desc.model].filter(Boolean).join(' ') || 'Véhicule'}{desc.color ? ` · ${desc.color}` : ''}</p>
            <p className="font-mono text-ink-secondary">{desc.vin ? `VIN ${desc.vin}` : 'VIN non lu'}</p>
            <p className="text-ink-secondary">{mission ? `Fiche #${mission.mission_number ?? ''} · entré le ${fmtD(mission.entered_at)}${mission.parc_zone_key ? ` · zone ${mission.parc_zone_key}` : ''}` : `Sans fiche · entré vers le ${enteredAt ? fmtD(enteredAt) : '?'}${zone ? ` · zone ${zone}` : ''}`}</p>
            <p className="text-ink-secondary">{urls.length} photos · QR {qrScanned ? 'scanné' : 'non scanné'}</p>
            {mission?.lock.blocked && <p className="text-amber-600 font-semibold">🔒 Sortie bloquée : {mission.lock.reason}. La validation demandera un motif et ton PIN.</p>}
            <p className="text-ink-muted text-xs pt-2 border-t">À la validation : le dossier est créé, la fiche sort du parc pour destruction, sans frais et sans facture. Rien n'est envoyé à la commune. Les frais restent calculables à n'importe quelle date depuis le dossier.</p>
          </div>
          {force && (
            <div className="bg-amber-500/5 border border-amber-500/40 rounded-2xl p-4 space-y-2">
              <p className="text-amber-700 dark:text-amber-300 font-semibold text-sm">Sortie forcée : motif et PIN personnel</p>
              <textarea value={force.reason} onChange={e => setForce(f => f && ({ ...f, reason: e.target.value }))} rows={2} placeholder="Pourquoi ce véhicule sort malgré le blocage" className="w-full bg-surface-hover border rounded-xl px-3 py-2 text-ink text-sm" />
              <input value={force.pin} onChange={e => setForce(f => f && ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))} inputMode="numeric" placeholder="PIN à 4 chiffres" className="w-40 bg-surface-hover border rounded-xl px-3 py-2 text-ink font-mono text-lg tracking-widest" />
            </div>
          )}
          <div className="fixed bottom-0 inset-x-0 p-3 bg-surface border-t flex gap-2 lg:static lg:border-0 lg:p-0">
            <button type="button" onClick={() => setStep(3)} className="px-4 py-3.5 bg-surface-2 border rounded-2xl text-sm">←</button>
            <button type="button" disabled={saving || (!!force && (force.reason.length < 5 || force.pin.length !== 4))} onClick={() => save(force || undefined)} className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-bold disabled:opacity-50">
              {saving ? 'Enregistrement…' : force ? '⚠️ Forcer la sortie et créer le dossier' : '🗑️ Créer le dossier et sortir le véhicule'}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
