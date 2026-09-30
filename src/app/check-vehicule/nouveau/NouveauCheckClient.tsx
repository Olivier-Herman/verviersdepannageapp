'use client'
// Check camion par le chauffeur (Olivier 30/09/2026, maquette validée
// https://claude.ai/artifact/WHWzq8AJt5hqdSJDZhWQBi) : camion + kilométrage,
// anomalies illimitées (titre, description, niveau, photos en rafale),
// commentaire général facultatif. Aucun camion n'est bloqué.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import BurstCamera from '@/components/camera/BurstCamera'
import { compressImage } from '@/lib/image-compress'
import { CHECK_LEVELS } from '@/lib/truck-checks/levels'

type Photo = { path?: string; url: string; busy?: boolean }
type Anomaly = { title: string; description: string; level: number; photos: Photo[] }

const LV_STYLE: Record<number, string> = {
  1: 'border-info text-info', 2: 'border-success text-success', 3: 'border-warning text-warning',
  4: 'border-orange-500 text-orange-500', 5: 'border-critical text-critical',
}

export default function NouveauCheckClient() {
  const { t } = useT()
  const [data, setData] = useState<any>(null)
  const [step, setStep] = useState<'truck' | 'list' | 'form' | 'sent'>('truck')
  const [truckId, setTruckId] = useState<string | null>(null)
  const [km, setKm] = useState('')
  const [list, setList] = useState<Anomaly[]>([])
  const [comment, setComment] = useState('')
  const [edit, setEdit] = useState<number>(-1)
  const [form, setForm] = useState<Anomaly>({ title: '', description: '', level: 0, photos: [] })
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sentMsg, setSentMsg] = useState('')

  const load = () => fetch('/api/truck-checks', { cache: 'no-store' }).then(r => r.json()).then(j => { setData(j); setTruckId(p => p || j.myTruckId || null) }).catch(() => setErr('Réseau indisponible.'))
  useEffect(() => { load() }, [])

  const truck = data?.trucks?.find((x: any) => x.id === truckId)
  const last = truckId ? data?.lastKm?.[truckId] : null
  const kmNum = Number(km.replace(/\D/g, ''))
  const kmLower = last && kmNum > 0 && kmNum < last.mileage

  // Photo : compressée puis envoyée tout de suite, en arrière-plan.
  const addPhoto = async (blob: Blob) => {
    const local = URL.createObjectURL(blob)
    setForm(f => ({ ...f, photos: [...f.photos, { url: local, busy: true }] }))
    try {
      const small = await compressImage(blob, 1800)
      const fd = new FormData(); fd.append('file', new File([small], 'photo.jpg', { type: 'image/jpeg' }))
      const j = await (await fetch('/api/truck-checks/upload', { method: 'POST', body: fd })).json()
      if (!j.path) throw new Error(j.error || 'échec')
      setForm(f => ({ ...f, photos: f.photos.map(p => p.url === local ? { url: local, path: j.path } : p) }))
    } catch {
      setForm(f => ({ ...f, photos: f.photos.filter(p => p.url !== local) }))
      setErr('Une photo n’a pas pu être envoyée. Réessaie.')
    }
  }

  const openForm = (i: number) => { setEdit(i); setForm(i >= 0 ? list[i] : { title: '', description: '', level: 0, photos: [] }); setErr(null); setStep('form') }
  const saveForm = () => {
    if (!form.title.trim() || !form.level) { setErr(t('truck_check.need')); return }
    if (form.photos.some(p => p.busy)) { setErr(t('truck_check.uploading')); return }
    setList(l => edit >= 0 ? l.map((a, i) => i === edit ? form : a) : [...l, form]); setErr(null); setStep('list')
  }

  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/truck-checks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        truck_id: truckId, mileage: kmNum, comment,
        anomalies: list.map(a => ({ title: a.title, description: a.description, level: a.level, photos: a.photos.map(p => p.path).filter(Boolean) })),
      }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Envoi impossible')
      setSentMsg(list.length ? t('truck_check.sent_n', { n: list.length }) : t('truck_check.sent_ras', { plate: truck?.plate || '' }))
      setStep('sent'); load()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const reset = () => { setList([]); setComment(''); setKm(''); setStep('truck') }
  const Btn = ({ onClick, kind = 'brand', disabled, children }: any) => <button type="button" onClick={onClick} disabled={disabled || busy}
    className={`w-full min-h-[52px] rounded-2xl font-bold text-base px-4 disabled:opacity-50 ${kind === 'brand' ? 'bg-brand text-white' : kind === 'ok' ? 'bg-success text-white' : 'border-2 border-dashed border-strong text-ink'}`}>{children}</button>

  if (!data) return <div className="p-6 text-ink-muted">…</div>
  return (
    <div className="max-w-lg mx-auto p-4 flex flex-col gap-3 pb-24">
      {err && <div className="rounded-xl border border-critical bg-critical-soft text-critical px-3 py-2 text-sm">{err}</div>}

      {step === 'truck' && <>
        <section className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">{t('truck_check.which_truck')}</p>
          <div className="flex flex-col gap-2">
            {data.trucks.map((x: any) => (
              <button key={x.id} type="button" onClick={() => setTruckId(x.id)}
                className={`flex items-center gap-3 rounded-xl border-2 px-3 min-h-[52px] text-left ${x.id === truckId ? 'border-brand bg-brand/10' : 'border-border bg-surface-2'}`}>
                <span className="font-mono font-bold text-sm bg-white text-gray-900 rounded px-2 py-0.5">{x.plate}</span>
                <span className="text-ink">{x.name}</span>
                {x.id === data.myTruckId && <span className="ml-auto text-[11px] font-semibold text-white bg-info rounded-full px-2 py-0.5">{t('truck_check.my_truck')}</span>}
              </button>))}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">{t('truck_check.mileage')}</p>
          <input inputMode="numeric" value={km} onChange={e => setKm(e.target.value.replace(/[^\d ]/g, ''))} placeholder={t('truck_check.mileage_ph')}
            className="w-full min-h-[52px] rounded-xl border border-strong bg-surface-2 text-ink text-2xl font-bold px-3" aria-label={t('truck_check.mileage')} />
          {last && <p className="text-xs text-ink-muted mt-1.5">{t('truck_check.last_km', { km: Number(last.mileage).toLocaleString('fr-BE'), date: new Date(last.at).toLocaleDateString('fr-BE'), by: last.by || '—' })}</p>}
          {kmLower && <p className="text-xs text-warning font-semibold mt-1">{t('truck_check.km_lower', { km: Number(last.mileage).toLocaleString('fr-BE') })}</p>}
        </section>
        <Btn onClick={() => { setErr(null); setStep('list') }} disabled={!truckId || !kmNum}>{t('truck_check.next')}</Btn>
        {(data.recent || []).length > 0 && <section className="rounded-2xl border border-border bg-surface p-3 mt-2">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">{t('truck_check.history')}</p>
          {data.recent.slice(0, 8).map((c: any) => <Link key={c.id} href={`/check-vehicule/rapport/${c.id}`} className="flex items-center justify-between gap-2 min-h-[44px] border-b border-border last:border-0 text-sm">
            <span className="text-ink"><b className="font-mono">{c.truck_plate}</b> · {new Date(c.created_at).toLocaleDateString('fr-BE')}{data.viewer ? ` · ${c.driver_name || ''}` : ''}</span>
            <span className="text-ink-secondary">{c.anomaly_count ? `${CHECK_LEVELS.find(l => l.level === c.max_level)?.emoji || ''} ${c.anomaly_count}` : '✅'}</span></Link>)}
        </section>}
      </>}

      {step === 'list' && <>
        <div className="rounded-xl bg-surface border border-border px-3 py-2 text-sm text-ink"><b className="font-mono">{truck?.plate}</b> {truck?.name} · {kmNum.toLocaleString('fr-BE')} km
          <button type="button" className="float-right text-brand font-semibold" onClick={() => setStep('truck')}>{t('truck_check.edit')}</button></div>
        <p className="text-xs uppercase tracking-wide text-ink-muted">{t('truck_check.anomalies')}</p>
        {list.length === 0 && <div className="rounded-xl border border-dashed border-border text-ink-muted text-center py-4 text-sm">{t('truck_check.none_yet')}</div>}
        {list.map((a, i) => { const lv = CHECK_LEVELS.find(l => l.level === a.level)!
          return <div key={i} className="flex items-start gap-3 rounded-xl bg-surface-2 border border-border p-3">
            <span className="text-lg">{lv.emoji}</span>
            <div className="min-w-0 flex-1"><div className="font-semibold text-ink">{a.title}</div><div className="text-xs text-ink-muted">{t(`truck_check.lv${a.level}`)} · {t('truck_check.photos_n', { n: a.photos.length })}</div></div>
            <button type="button" className="min-h-[44px] px-2 text-sm text-ink-secondary" onClick={() => openForm(i)}>{t('truck_check.edit')}</button>
          </div> })}
        <Btn kind="ghost" onClick={() => openForm(-1)}>＋ {t('truck_check.add')}</Btn>
        <section className="rounded-2xl border border-border bg-surface p-3">
          <p className="text-xs uppercase tracking-wide text-ink-muted mb-2">{t('truck_check.comment')}</p>
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={t('truck_check.comment_ph')} rows={3}
            className="w-full rounded-xl border border-strong bg-surface-2 text-ink p-3" />
        </section>
        {list.length === 0
          ? <Btn kind="ok" onClick={send}>{busy ? t('truck_check.sending') : `✓ ${t('truck_check.ras')}`}</Btn>
          : <Btn onClick={send}>{busy ? t('truck_check.sending') : t('truck_check.send', { n: list.length })}</Btn>}
      </>}

      {step === 'form' && <>
        <section className="rounded-2xl border border-border bg-surface p-3 flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-ink-muted" htmlFor="tc-title">{t('truck_check.f_title')}</label>
          <input id="tc-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t('truck_check.f_title_ph')} className="w-full min-h-[48px] rounded-xl border border-strong bg-surface-2 text-ink px-3" />
          <label className="text-xs uppercase tracking-wide text-ink-muted mt-1" htmlFor="tc-desc">{t('truck_check.f_desc')}</label>
          <textarea id="tc-desc" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('truck_check.f_desc_ph')} rows={3} className="w-full rounded-xl border border-strong bg-surface-2 text-ink p-3" />
          <p className="text-xs uppercase tracking-wide text-ink-muted mt-1">{t('truck_check.f_level')}</p>
          <div className="grid grid-cols-2 gap-2">
            {CHECK_LEVELS.map(l => <button key={l.level} type="button" onClick={() => setForm({ ...form, level: l.level })}
              className={`rounded-xl border-2 p-2.5 min-h-[56px] text-left ${l.level === 1 ? 'col-span-2' : ''} ${form.level === l.level ? `${LV_STYLE[l.level]} bg-surface` : 'border-border bg-surface-2 text-ink'}`}>
              <b className="block">{l.emoji} {t(`truck_check.lv${l.level}`)}</b><span className="text-xs text-ink-muted">{t(`truck_check.lv${l.level}_sub`)}</span></button>)}
          </div>
          <p className="text-xs uppercase tracking-wide text-ink-muted mt-1">{t('truck_check.f_photos')}</p>
          <div className="flex flex-wrap gap-2">
            {form.photos.map((p, i) => <div key={p.url} className="relative w-16 h-16 rounded-lg overflow-hidden bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className={`w-full h-full object-cover ${p.busy ? 'opacity-50' : ''}`} />
              {!p.busy && <button type="button" aria-label={t('truck_check.remove')} onClick={() => setForm(f => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}
                className="absolute top-0 right-0 w-6 h-6 bg-black/60 text-white text-xs rounded-bl">✕</button>}</div>)}
            <button type="button" onClick={() => setCamera(true)} className="w-16 h-16 rounded-lg border-2 border-dashed border-strong text-ink text-xs">📷<br />{t('truck_check.add_photos')}</button>
          </div>
        </section>
        <Btn onClick={saveForm}>{t('truck_check.save')}</Btn>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setErr(null); setStep('list') }} className="flex-1 min-h-[48px] rounded-2xl border border-strong text-ink font-semibold">{t('truck_check.cancel')}</button>
          {edit >= 0 && <button type="button" onClick={() => { setList(l => l.filter((_, i) => i !== edit)); setStep('list') }} className="flex-1 min-h-[48px] rounded-2xl border border-critical text-critical font-semibold">{t('truck_check.remove')}</button>}
        </div>
        {camera && <BurstCamera title={form.title || t('truck_check.f_photos')} count={form.photos.length} onShot={addPhoto} onClose={() => setCamera(false)} />}
      </>}

      {step === 'sent' && <div className="text-center py-10 flex flex-col gap-3 items-center">
        <div className="text-5xl">✅</div>
        <h2 className="text-xl font-bold text-ink">{t('truck_check.sent_title')}</h2>
        <p className="text-ink-secondary">{sentMsg}</p>
        <Btn onClick={reset}>{t('truck_check.again')}</Btn>
      </div>}
    </div>
  )
}
