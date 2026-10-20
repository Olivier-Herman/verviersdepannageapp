'use client'
import { useEffect, useState } from 'react'

// Bandeau « Installer VD Espace pro » (Olivier 20/10/2026) : icône sur l'écran d'accueil, sans passer par un store.
// Android et ordinateur : bouton (beforeinstallprompt) ; iPhone : le geste Partager → « Sur l'écran d'accueil ».
// Caché quand l'espace tourne déjà en app installée, ou après « Plus tard » sur cet appareil.
export default function Installer() {
  const [evt, setEvt] = useState<any>(null)
  const [ios, setIos] = useState(false)
  const [vu, setVu] = useState(true)
  useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
    let ferme = false
    try { ferme = localStorage.getItem('vd_espace_install_ferme') === '1' } catch {}
    if (standalone || ferme) return
    const ua = navigator.userAgent
    if (/iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua)) { setIos(true); setVu(false) }
    const h = (e: any) => { e.preventDefault(); setEvt(e); setVu(false) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (vu || (!evt && !ios)) return null
  const fermer = () => { try { localStorage.setItem('vd_espace_install_ferme', '1') } catch {} setVu(true) }
  return (
    <div className="wrap" style={{ marginTop: 14 }}>
      <div className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <img src="/icons/icon-96x96.png" alt="" width={44} height={44} style={{ borderRadius: 10 }} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <b>Installer VD Espace pro</b>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            {ios ? <>Touchez <b>Partager</b> en bas de Safari, puis <b>« Sur l’écran d’accueil »</b> : votre espace s’ouvre ensuite d’un geste, comme une app.</>
              : <>Une icône sur votre écran d’accueil ou votre bureau : votre espace s’ouvre d’un geste, comme une app.</>}
          </div>
        </div>
        {evt && <button className="btn btn-red" style={{ minHeight: 44 }} onClick={async () => { evt.prompt(); await evt.userChoice.catch(() => null); setEvt(null); setVu(true) }}>Installer</button>}
        <button className="btn btn-ghost" style={{ minHeight: 44 }} onClick={fermer}>Plus tard</button>
      </div>
    </div>
  )
}
