'use client'
// src/components/notifications/AppelEntrantBandeau.tsx — appel entrant d'un service suivi (Fourrière, Administration,
// Rent a car) : un GRAND bandeau en haut de l'écran, qui reste tant qu'on ne l'a pas traité, avec de gros boutons
// (Olivier 25/11/2026 : « pas une simple notif comme les autres qui disparaît après quelques secondes »).
// Les autres notifications gardent le petit bandeau en haut à droite.
import { useEffect, useState } from 'react'
import { Phone, FolderOpen, Search, Plus, X, List } from 'lucide-react'

interface Appel {
  id: string
  created_at: string
  payload: { title: string; body: string; action_url?: string; mission_id?: string; data?: Record<string, any> } | null
}

const depuis = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - +new Date(iso)) / 1000))
  if (s < 60) return 'à l’instant'
  const m = Math.floor(s / 60)
  return m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

export default function AppelEntrantBandeau({ appels, onDone }: { appels: Appel[]; onDone: (id: string) => void | Promise<void> }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 10_000); return () => clearInterval(t) }, [])

  // Onglet VD Soft derrière autre chose : le titre de l'onglet clignote tant qu'un appel attend.
  const premier = appels[0]?.payload?.title || ''
  useEffect(() => {
    if (!premier || typeof document === 'undefined') return
    const base = document.title
    let on = false
    const t = setInterval(() => { on = !on; document.title = on ? premier : base }, 1200)
    return () => { clearInterval(t); document.title = base }
  }, [premier])

  if (!appels.length) return null
  // Prendre l'appel (tout bouton sauf « Fermer ») le retire aussi des écrans des autres personnes prévenues.
  // On quitte la page : l'envoi est fait de façon à survivre au changement de page, sinon le bandeau reviendrait.
  const aller = (id: string, url: string) => {
    try { fetch('/api/telephonie/pris', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notif_id: id }) }).catch(() => {}) } catch {}
    void onDone(id); window.location.href = url
  }
  const gros = 'inline-flex items-center justify-center gap-2 min-h-[56px] px-5 rounded-2xl text-base sm:text-lg font-bold'

  return (
    <div className="fixed top-0 inset-x-0 z-[340] flex flex-col items-center gap-2 px-2 sm:px-4 pt-[max(8px,env(safe-area-inset-top,0px))] pointer-events-none">
      {appels.slice(0, 3).map(a => {
        const d = a.payload?.data || {}
        const numero: string = d.numero || ''
        const tel = /^\+?\d{6,}$/.test(numero) ? numero : ''
        const ficheId = a.payload?.mission_id
        const nb = Number(d.fiches || 0)
        return (
          <div key={a.id} role="alert" className="pointer-events-auto w-full max-w-4xl rounded-3xl border-4 border-green-600 bg-green-50 shadow-2xl p-4 sm:p-5">
            <div className="flex items-start gap-3 sm:gap-4">
              <span className="flex-shrink-0 flex items-center justify-center w-14 h-14 rounded-full bg-green-600 text-white animate-pulse"><Phone size={28} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-xl sm:text-2xl font-extrabold text-green-900 break-words">{a.payload?.title || 'Appel entrant'}</p>
                <p className="mt-0.5 text-base sm:text-lg font-semibold text-green-800 break-words">{a.payload?.body}</p>
                <p className="text-sm text-green-700">{depuis(a.created_at, now)}</p>
              </div>
              <button type="button" aria-label="Fermer" title="Fermer" onClick={() => void onDone(a.id)}
                className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full text-green-900 hover:bg-green-100"><X size={24} /></button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 sm:gap-3">
              {ficheId ? (
                <>
                  <button type="button" className={`${gros} flex-1 bg-green-700 text-white hover:bg-green-800`} onClick={() => aller(a.id, `/dispatch/${ficheId}`)}><FolderOpen size={22} /> Ouvrir la fiche</button>
                  {tel && <button type="button" className={`${gros} border-2 border-green-700 bg-white text-green-900 hover:bg-green-100`} onClick={() => aller(a.id, `/appel?tel=${encodeURIComponent(tel)}&choisir=1`)}><Search size={22} /> Autre fiche</button>}
                </>
              ) : tel && nb > 1 ? (
                <button type="button" className={`${gros} flex-1 bg-green-700 text-white hover:bg-green-800`} onClick={() => aller(a.id, `/appel?tel=${encodeURIComponent(tel)}&choisir=1`)}><List size={22} /> Choisir parmi les {nb} fiches</button>
              ) : tel ? (
                <>
                  <button type="button" className={`${gros} flex-1 bg-green-700 text-white hover:bg-green-800`} onClick={() => aller(a.id, `/appel?tel=${encodeURIComponent(tel)}`)}><Search size={22} /> Chercher la fiche</button>
                  <button type="button" className={`${gros} flex-1 border-2 border-green-700 bg-white text-green-900 hover:bg-green-100`} onClick={() => aller(a.id, `/dispatch/new?tel=${encodeURIComponent(tel)}`)}><Plus size={22} /> Nouvelle fiche</button>
                </>
              ) : (
                <button type="button" className={`${gros} flex-1 bg-green-700 text-white hover:bg-green-800`} onClick={() => aller(a.id, '/appels')}><Search size={22} /> Chercher la fiche</button>
              )}
              <button type="button" className={`${gros} border-2 border-green-700 bg-white text-green-900 hover:bg-green-100`} onClick={() => void onDone(a.id)}><X size={22} /> Fermer</button>
            </div>
            <p className="mt-2 text-sm text-green-800">Dès que quelqu’un prend l’appel ici, ce bandeau disparaît chez les autres. « Fermer » ne le retire que de votre écran.</p>
          </div>
        )
      })}
      {appels.length > 3 && <p className="pointer-events-auto rounded-full bg-green-700 text-white text-sm font-semibold px-3 py-1">+ {appels.length - 3} autre{appels.length > 4 ? 's' : ''} appel{appels.length > 4 ? 's' : ''}</p>}
    </div>
  )
}
