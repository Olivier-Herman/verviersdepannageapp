'use client'
// src/app/ma-paie/AnnouncementModal.tsx
//
// Modal « nouveauté » : s'affiche une seule fois par user (l'annonce active non
// encore lue). Ferme via ✕ ou le CTA (pas au clic-fond). Marque la lecture au
// serveur → alimente le suivi « qui a lu » de la console Annonces.

import { useEffect, useState } from 'react'
import { X, Sparkles, ArrowRight } from 'lucide-react'

interface Ann { id: string; emoji: string; title: string; body: string; action_url: string; cta_label: string }

export default function AnnouncementModal() {
  const [ann, setAnn]   = useState<Ann | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    fetch('/api/announcements', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (d?.announcement) { setAnn(d.announcement); requestAnimationFrame(() => setShow(true)) } })
      .catch(() => {})
  }, [])

  if (!ann) return null

  const markSeen = () => fetch('/api/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'seen', id: ann.id }),
  }).catch(() => {})

  const close = () => { markSeen(); setShow(false); setTimeout(() => setAnn(null), 200) }
  const go    = () => { markSeen(); window.location.href = ann.action_url }

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)' }}>
      <div className={`relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl transition-all duration-300 ${show ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}`}
        style={{ background: 'var(--surface, #fff)' }}>
        {/* Header gradient festif */}
        <div className="relative px-7 pt-8 pb-9 text-white overflow-hidden"
          style={{ background: 'linear-gradient(135deg,#CC2222 0%,#e0483a 55%,#7a1414 100%)' }}>
          <button onClick={close} aria-label="Fermer"
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition">
            <X size={17} />
          </button>
          {/* pastilles décoratives */}
          <Sparkles size={16} className="absolute top-6 left-6 text-white/40" />
          <Sparkles size={22} className="absolute bottom-6 right-10 text-white/25" />
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-4xl mb-4 shadow-inner">
              {ann.emoji}
            </div>
            <div className="text-[11px] font-bold tracking-[2px] text-white/75">NOUVEAUTÉ</div>
            <h2 className="text-[22px] font-extrabold leading-tight mt-1" style={{ textWrap: 'balance' as any }}>{ann.title}</h2>
          </div>
        </div>
        {/* Corps */}
        <div className="px-7 py-6">
          <p className="text-ink-muted text-[14.5px] leading-relaxed">{ann.body}</p>
          <button onClick={go}
            className="w-full mt-6 inline-flex items-center justify-center gap-2 bg-brand text-white font-semibold text-[15px] py-3.5 rounded-2xl hover:opacity-90 active:scale-[.98] transition">
            {ann.cta_label} <ArrowRight size={17} />
          </button>
          <button onClick={close} className="w-full mt-2 text-ink-muted text-[13px] py-2 hover:text-ink transition">
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}
