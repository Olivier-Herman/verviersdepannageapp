'use client'

// Mise à jour de l'app iPhone (Olivier 17/10/2026) : à l'ouverture, l'appareil dit au serveur
// ce qu'il est (version de l'app si connue). Si l'App Store a plus récent, un écran propose de
// mettre à jour, avec un bouton direct. Une fois par jour au plus ; fermeture par bouton ou ✕.
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

type Upd = { installed: string; latest: string; url: string }

export default function AppUpdatePrompt() {
  const { status } = useSession()
  const [upd, setUpd] = useState<Upd | null>(null)
  useEffect(() => {
    if (status !== 'authenticated') return
    let done = false
    try { if (sessionStorage.getItem('client_info_sent')) return; sessionStorage.setItem('client_info_sent', '1') } catch {}
    const C: any = (window as any).Capacitor
    const native = !!C?.isNativePlatform?.()
    const platform = C?.getPlatform?.() || undefined
    const plugins: string[] = Array.isArray(C?.PluginHeaders) ? C.PluginHeaders.map((p: any) => p?.name).filter(Boolean) : []
    const send = (info: { version?: string; build?: string; model?: string } = {}) => {
      if (done) return; done = true
      fetch('/api/client-info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ native, platform, plugins, app_version: info.version, app_build: info.build, model: info.model, ua: navigator.userAgent }) })
        .then(r => r.ok ? r.json() : null).then(j => {
          if (!j?.update) return
          const key = `app_update_vu_${j.update.latest}_${new Date().toISOString().slice(0, 10)}`
          try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') } catch {}
          setUpd(j.update)
        }).catch(() => {})
    }
    // Version de l'app native : plugin App de Capacitor s'il est présent (jamais d'await sur un proxy).
    const App = native && C?.isPluginAvailable?.('App') ? C?.Plugins?.App : null
    if (App?.getInfo) { App.getInfo().then((i: any) => send({ version: i?.version, build: i?.build })).catch(() => send()); setTimeout(() => send(), 3000) }
    else send()
  }, [status])
  if (!upd) return null
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mise à jour disponible">
      <div className="w-full max-w-sm rounded-2xl bg-white text-slate-900 shadow-2xl p-5 relative">
        <button onClick={() => setUpd(null)} aria-label="Fermer" className="absolute top-2 right-2 w-11 h-11 rounded-xl text-slate-700 text-lg">✕</button>
        <p className="text-3xl">📲</p>
        <h2 className="mt-2 text-lg font-extrabold">Nouvelle version de VD Soft</h2>
        <p className="mt-1 text-sm text-slate-700">La version <b>{upd.latest}</b> est disponible (tu as la {upd.installed}). Mets-la à jour pour avoir les dernières améliorations.</p>
        <a href={upd.url} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setUpd(null), 500)} className="mt-4 flex items-center justify-center min-h-[48px] rounded-xl bg-red-700 text-white font-bold">Mettre à jour</a>
        <button onClick={() => setUpd(null)} className="mt-2 w-full min-h-[44px] rounded-xl border border-slate-300 text-slate-800 font-semibold text-sm">Plus tard</button>
      </div>
    </div>
  )
}
