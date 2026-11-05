'use client'
// Où est la prise OBD ? (Olivier 06/11/2026, maquette https://claude.ai/artifact/8U668FhJzuhYdyDeY6BSkg validée.)
// Modèle connu (mission) : l'emplacement tout de suite. Sinon le chauffeur tape le modèle, ou voit les endroits courants.
// N'empêche jamais de lancer le diagnostic : le bouton reste dans le panneau, sous ce bloc.
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { shrinkPhoto } from './shrink'

type Loc = { id: string | null; label: string; fr: string; sq: string; status: 'a_confirmer' | 'verifie'; confirmations: number; source: string | null; photo: string | null }
const ZONES = ['z1', 'z2', 'z3', 'z4', 'z5', 'z6']
const btn = 'min-h-[48px] rounded-xl font-semibold text-sm px-3 border bg-surface text-ink disabled:opacity-50'

export default function PortHelp({ vehicle }: { vehicle?: string | null }) {
  const { t, lang } = useT()
  const [q, setQ] = useState((vehicle || '').trim())
  const [typed, setTyped] = useState('')
  const [loc, setLoc] = useState<Loc | null>(null)
  const [state, setState] = useState<'ask' | 'busy' | 'show' | 'common'>((vehicle || '').trim() ? 'busy' : 'ask')
  const [mode, setMode] = useState<'view' | 'else' | 'done'>('view')
  const [zone, setZone] = useState<number | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  async function search(text: string) {
    setState('busy'); setQ(text); setMode('view')
    try {
      const r = await fetch(`/api/obd/port?q=${encodeURIComponent(text)}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.location) { setLoc(j.location); setState('show') } else setState('common')
    } catch { setState('common') }
  }
  useEffect(() => { const v = (vehicle || '').trim(); if (v) search(v) }, [vehicle])   // eslint-disable-line react-hooks/exhaustive-deps

  async function send(body: any) {
    setSaving(true); setErr(false)
    try {
      const r = await fetch('/api/obd/port', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error()
      setMode('done')
    } catch { setErr(true) } finally { setSaving(false) }
  }
  // La zone est enregistrée dans les deux langues, quelle que soit celle du chauffeur.
  const zonesBoth = async (k: string) => {
    const { fr } = await import('@/lib/i18n/dictionaries/fr'); const { sq } = await import('@/lib/i18n/dictionaries/sq')
    return { fr: (fr.obd as any)[k], sq: (sq.obd as any)[k] }
  }

  const Correction = () => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-ink">{t('obd.prise_ou')}</p>
      <div className="grid grid-cols-2 gap-2">{ZONES.map((z, i) => <button key={z} onClick={() => setZone(i)} className={`${btn} ${zone === i ? '!border-blue-700 !bg-blue-600/10 !text-blue-800 dark:!text-blue-200' : ''}`}>{t(`obd.${z}`)}</button>)}</div>
      <button className={`${btn} w-full`} onClick={() => file.current?.click()}>{photo ? t('obd.prise_photo_ok') : t('obd.prise_photo')}</button>
      <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await shrinkPhoto(f).catch(() => null)); e.target.value = '' }} />
      {err && <p className="text-sm text-red-700 dark:text-red-300">{t('obd.prise_erreur')}</p>}
      <button className="w-full min-h-[48px] rounded-xl font-semibold text-sm bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50" disabled={zone === null || saving}
        onClick={async () => { const z = await zonesBoth(ZONES[zone!]); send({ action: 'ailleurs', id: loc?.id || null, q, ...z, image: photo }) }}>{t('obd.prise_enregistrer')}</button>
    </div>
  )

  return (
    <div className="rounded-2xl border bg-surface p-4 space-y-3">
      {state === 'ask' && <>
        <p className="font-semibold text-ink">📍 {t('obd.voiture')}</p>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder={t('obd.voiture_ex')} className="w-full min-h-[48px] rounded-xl border bg-surface-2 px-3 text-ink" />
        <div className="grid grid-cols-2 gap-2">
          <button className="min-h-[48px] rounded-xl font-semibold text-sm bg-blue-700 hover:bg-blue-800 text-white disabled:opacity-50" disabled={typed.trim().length < 2} onClick={() => search(typed.trim())}>{t('obd.chercher')}</button>
          <button className={btn} onClick={() => setState('common')}>{t('obd.sais_pas')}</button>
        </div>
      </>}
      {state === 'busy' && <p className="text-sm text-ink-secondary">⏳ {t('obd.prise_cherche')}</p>}
      {state === 'common' && <>
        <p className="font-semibold text-ink">📍 {t('obd.courants')}</p>
        <p className="text-xs text-ink-muted">{t('obd.courants_txt')}</p>
        <ol className="list-decimal pl-5 text-sm text-ink space-y-1">{ZONES.map(z => <li key={z}>{t(`obd.${z}`)}</li>)}</ol>
        {q && (mode === 'done' ? <p className="text-sm rounded-xl bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 p-3">✓ {t('obd.prise_merci')}</p> : <Correction />)}
      </>}
      {state === 'show' && loc && <>
        <p className="font-semibold text-ink">📍 {t('obd.prise_titre')} <span className="font-normal text-xs text-ink-muted">· {loc.label}</span></p>
        <span className={`inline-block text-xs font-semibold rounded-full px-2 py-0.5 ${loc.status === 'verifie' ? 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'}`}>{loc.status === 'verifie' ? t('obd.prise_verifie', { n: loc.confirmations }) : t('obd.prise_a_confirmer')}</span>
        {loc.photo && <img src={loc.photo} alt={t('obd.prise_titre')} className="w-full rounded-xl" />}
        {loc.status !== 'verifie' && <p className="text-xs text-ink-muted">{t('obd.prise_usuel')}</p>}
        <p className="font-bold text-ink">{lang === 'sq' ? loc.sq : loc.fr}</p>
        {loc.source && <p className="text-xs text-ink-muted">{t('obd.prise_source')} : {loc.source}</p>}
        {mode === 'done' && <p className="text-sm rounded-xl bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 p-3">✓ {t('obd.prise_merci')}</p>}
        {mode === 'else' && <Correction />}
        {mode === 'view' && <div className="grid grid-cols-2 gap-2">
          {loc.id && <button className={btn} disabled={saving} onClick={() => send({ action: 'trouvee', id: loc.id })}>✓ {t('obd.prise_trouvee')}</button>}
          <button className={btn} onClick={() => setMode('else')}>{t('obd.prise_ailleurs')}</button>
        </div>}
        {err && mode === 'view' && <p className="text-sm text-red-700 dark:text-red-300">{t('obd.prise_erreur')}</p>}
      </>}
    </div>
  )
}
