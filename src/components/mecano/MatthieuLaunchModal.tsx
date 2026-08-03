'use client'
// src/components/mecano/MatthieuLaunchModal.tsx
//
// Modal de lancement « La tête à Matthieu » — s'ouvre à la 1re ouverture de
// l'app à partir de 20h le soir du lancement, une seule fois par user.
// Design repris de la maquette validée. Olivier 2026-08-03.

import { useEffect, useState } from 'react'

const SEEN_KEY  = 'matthieu_launch_v1'
const ANN_ID    = '99afd1e2-48f8-4f26-beb4-08a159736140'

export default function MatthieuLaunchModal({ userRole }: { userRole?: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (userRole === 'garage' || userRole === 'partner') return
    // Olivier 2026-08-03 : afficher dès que dispo (plus d'attente 20h), 1×/user.
    try { if (localStorage.getItem(SEEN_KEY)) return } catch { /* */ }
    setShow(true)
  }, [userRole])

  const close = () => {
    setShow(false)
    try { localStorage.setItem(SEEN_KEY, '1') } catch { /* */ }
    // Suivi de lecture : marque l'annonce comme vue.
    fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'seen', id: ANN_ID }) }).catch(() => {})
  }

  if (!show) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(6,5,10,.62)', backdropFilter: 'blur(3px)' }}>
      <div className="w-full max-w-[360px] rounded-[28px] overflow-hidden shadow-2xl border border-indigo-500/30"
        style={{ background: 'radial-gradient(120% 60% at 50% 0%, rgba(124,116,255,.20), transparent 60%), var(--surface, #16151c)' }}>
        <div className="px-6 pt-7 pb-6 text-center">
          <div className="w-[86px] h-[86px] mx-auto rounded-[26px] flex items-center justify-center relative"
            style={{ background: 'linear-gradient(150deg,#7c74ff,#4b40e0)', boxShadow: '0 18px 40px -10px rgba(124,116,255,.6)' }}>
            <span className="text-[42px]">🔧</span>
            <span className="absolute -inset-[7px] rounded-[31px] border-2 border-indigo-400/40" />
          </div>
          <span className="inline-block mt-4 text-[11px] font-extrabold tracking-widest uppercase px-3 py-1 rounded-full text-amber-500 bg-amber-500/15 border border-amber-500/30">Nouveau</span>
          <h2 className="text-ink text-[24px] font-black leading-tight mt-3.5">Voici La tête à Matthieu</h2>
          <p className="text-ink-muted text-[13.5px] mt-1.5 leading-relaxed">Ton mécano de poche. Une question sur le véhicule ? Il connaît chaque modèle et te répond direct — dépannage <b className="text-ink">et</b> remorquage.</p>

          <div className="flex flex-col gap-2 mt-5 text-left">
            {[['💬', 'Demande-lui n\'importe quoi sur le véhicule'], ['📄', 'Il t\'affiche la bonne fiche (ouverture, ancrage…)'], ['📷', 'Pas sûr du modèle ? Envoie une photo']].map(([ic, tx]) => (
              <div key={tx} className="flex items-center gap-3 bg-surface border rounded-2xl px-3 py-2.5">
                <span className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center text-lg flex-shrink-0">{ic}</span>
                <span className="text-ink text-[12.5px] font-semibold leading-tight">{tx}</span>
              </div>
            ))}
          </div>

          <p className="text-ink-muted text-[11.5px] mt-4">Tu le trouves sur ta <b className="text-ink">fiche d'intervention</b> — la tuile 🔧 <b style={{ color: '#7c74ff' }}>La tête à Matthieu</b>.</p>

          <button onClick={close} className="w-full mt-4 py-3.5 rounded-2xl text-white font-extrabold text-[15px]"
            style={{ background: 'linear-gradient(135deg,#7c74ff,#e23b2e)', boxShadow: '0 14px 28px -10px rgba(226,59,46,.5)' }}>
            Génial, j'ai compris ! →
          </button>
        </div>
      </div>
    </div>
  )
}
