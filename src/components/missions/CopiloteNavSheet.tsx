'use client'

// Copilote au départ (Olivier 19/10/2026, maquette validée) : au « En route » puis au chargement,
// Sam (8 h–20 h) ou Sonic (la nuit) propose d'encoder l'adresse dans l'app de navigation ou
// d'y aller à vue. Fermeture par ✕ uniquement. Textes fr + sq (copilote_nav.*).
import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { NavApp } from '@/lib/open-navigation'

const APPS: [NavApp, string][] = [['waze', 'Waze'], ['gmaps', 'Google Maps'], ['apple', 'Plans']]
const agentDuMoment = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date())) % 24
  return h >= 8 && h < 20 ? 'Sam' : 'Sonic'
}

export default function CopiloteNavSheet({ mode, address, navApp, busy = false, onGo, onEye, onClose }: {
  mode: 'on_way' | 'dest'; address: string; navApp: NavApp; busy?: boolean
  onGo: (app: NavApp) => void; onEye: () => void; onClose: () => void
}) {
  const { t } = useT()
  const [app, setApp] = useState<NavApp>(navApp)
  const agent = useMemo(agentDuMoment, [])
  const line = useMemo(() => `copilote_nav.${agent === 'Sam' ? 'day' : 'night'}${mode === 'on_way' ? 1 : 2}_${1 + Math.floor(Math.random() * 3)}`, [agent, mode])
  const appName = APPS.find(a => a[0] === app)?.[1] || 'GPS'
  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-end" role="dialog" aria-modal="true" aria-label={t('copilote_nav.name', { name: agent })}>
      <div className="w-full bg-white text-slate-900 rounded-t-3xl p-4 relative" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
        <button onClick={onClose} aria-label={t('copilote_nav.close')} className="absolute top-3 right-3 w-11 h-11 rounded-xl border border-slate-300 text-lg text-slate-800">✕</button>
        <div className="flex gap-3 items-start pr-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/noprecache/agents/${agent.toLowerCase()}.jpg`} alt="" className="w-14 h-14 rounded-full object-cover flex-none border-[3px] border-amber-500" />
          <div className="rounded-[4px_18px_18px_18px] bg-blue-50 text-blue-950 px-3 py-2.5 text-[15px] leading-snug">
            <span className="block text-[11.5px] font-extrabold uppercase tracking-wide text-blue-900/70">{t('copilote_nav.name', { name: agent })}</span>
            {t(line)}
          </div>
        </div>
        <div className="mt-3 mb-3 rounded-2xl border-2 border-dashed border-slate-300 px-3 py-2.5">
          <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">{t(mode === 'on_way' ? 'copilote_nav.here_on_way' : 'copilote_nav.here_dest')}</span>
          <span className="font-extrabold text-base text-slate-900">{address}</span>
        </div>
        <button disabled={busy} onClick={() => onGo(app)} className="w-full min-h-[60px] rounded-2xl bg-teal-700 text-white flex items-center gap-3 px-4 text-left disabled:opacity-50">
          <span className="text-2xl w-8 text-center">🧭</span>
          <span><span className="block font-extrabold">{t('copilote_nav.go', { app: appName })}</span><span className="block text-[12.5px] font-semibold opacity-90">{t('copilote_nav.go_hint')}</span></span>
        </button>
        <button disabled={busy} onClick={onEye} className="mt-2 w-full min-h-[60px] rounded-2xl border-2 border-slate-300 bg-white text-slate-900 flex items-center gap-3 px-4 text-left disabled:opacity-50">
          <span className="text-2xl w-8 text-center">👀</span>
          <span><span className="block font-extrabold">{t('copilote_nav.eye')}</span><span className="block text-[12.5px] font-semibold text-slate-700">{t('copilote_nav.eye_hint')}</span></span>
        </button>
        <div className="flex gap-1.5 justify-center flex-wrap mt-3" role="group" aria-label={t('copilote_nav.app')}>
          {APPS.map(([id, lb]) => (
            <button key={id} onClick={() => setApp(id)} aria-pressed={app === id}
              className={`min-h-[40px] px-3 rounded-full text-[12.5px] font-bold border ${app === id ? 'border-teal-700 text-teal-800 ring-1 ring-teal-700' : 'border-slate-300 text-slate-700'}`}>{lb}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
