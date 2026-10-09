'use client'
// Demande de Sam : tailles de t-shirt et de pull (module temporaire, Olivier 09/10/2026).
// Écran BLOQUANT pour tout le personnel concerné qui n'a pas encore répondu (chauffeurs
// sur téléphone, bureau sur PC) : pas de fermeture, réponse obligatoire le jour même.
// Texte FR / albanais (dictionnaire « vetements »). Tailles S à 2XL.
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export default function VetementsSamModal() {
  const { t } = useT()
  const [st, setSt] = useState<{ required: boolean; sizes: string[]; name: string | null } | null>(null)
  const [ts, setTs] = useState<string | null>(null)
  const [pl, setPl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let stop = false
    const load = () => fetch('/api/vetements/me', { cache: 'no-store' }).then(r => r.json()).then(j => { if (!stop) setSt(j) }).catch(() => {})
    load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; document.removeEventListener('visibilitychange', onVis) }
  }, [])

  if (!st?.required && !done) return null
  const name = (st?.name || '').split(' ')[0] || ''
  const ok = !!(ts && pl)
  const send = async () => {
    if (!ok) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/vetements/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tshirt: ts, pull: pl }) })
      if (!r.ok) throw new Error()
      setDone(true); setSt(s => s ? { ...s, required: false } : s)
    } catch { setErr(t('vetements.error')) } finally { setBusy(false) }
  }
  const chip = (on: boolean) => `min-h-[48px] rounded-xl border-2 text-base font-bold ${on ? 'bg-brand border-brand text-white' : 'bg-white border-slate-300 text-slate-900'}`
  const Grid = ({ value, set }: { value: string | null; set: (v: string) => void }) => (
    <div className="grid grid-cols-5 gap-2">
      {(st?.sizes || ['S', 'M', 'L', 'XL', '2XL']).map(s => <button key={s} type="button" onClick={() => set(s)} className={chip(value === s)}>{s}</button>)}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[450] bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={t('vetements.subtitle')}>
      <div className="w-full max-w-md max-h-[92vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="bg-brand text-white px-5 py-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white text-brand flex items-center justify-center font-extrabold text-xl flex-shrink-0">S</div>
          <div>
            <p className="font-extrabold text-lg leading-tight">Sam</p>
            <p className="text-sm opacity-90">{t('vetements.subtitle')}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
          <p className="max-w-[88%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 text-slate-900 text-[15px] leading-snug">{t('vetements.hello', { name })}</p>
          {!done ? <>
            <p className="max-w-[88%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 text-slate-900 text-[15px] leading-snug">{t('vetements.ask')}</p>
            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
              <p className="font-bold text-slate-900">{t('vetements.tshirt')}</p>
              <Grid value={ts} set={setTs} />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
              <div className="flex items-center">
                <p className="font-bold text-slate-900">{t('vetements.pull')}</p>
                <button type="button" onClick={() => ts && setPl(ts)} className="ml-auto min-h-[44px] px-2 text-sm font-bold text-brand">{t('vetements.same')}</button>
              </div>
              <Grid value={pl} set={setPl} />
            </div>
            <p className="text-xs text-slate-600 px-1">{t('vetements.hint')}</p>
          </> : <>
            <p className="ml-auto max-w-[80%] bg-brand text-white rounded-2xl rounded-tr-md px-4 py-3 font-semibold text-right">T-shirt {ts} · Pull {pl}</p>
            <p className="max-w-[88%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 text-slate-900 text-[15px] leading-snug">{t('vetements.thanks', { name })}</p>
          </>}
        </div>
        <div className="px-4 pt-3 pb-4 border-t border-slate-200 bg-white space-y-1.5">
          {err && <p className="text-sm font-semibold text-red-700 text-center">{err}</p>}
          {!done ? <>
            <button type="button" disabled={!ok || busy} onClick={send} className={`w-full min-h-[54px] rounded-2xl font-extrabold text-[17px] ${ok ? 'bg-brand text-white' : 'bg-slate-200 text-slate-600'}`}>{busy ? t('vetements.sending') : ok ? t('vetements.send') : t('vetements.missing')}</button>
            <p className="text-xs text-slate-600 text-center">{t('vetements.block')}</p>
          </> : <button type="button" onClick={() => setDone(false)} className="w-full min-h-[54px] rounded-2xl font-extrabold text-[17px] bg-slate-900 text-white">{t('vetements.cont')}</button>}
        </div>
      </div>
    </div>
  )
}
