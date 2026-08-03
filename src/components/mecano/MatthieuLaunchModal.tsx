'use client'
// src/components/mecano/MatthieuLaunchModal.tsx
//
// Modal de lancement « La tête à Matthieu » — splash premium, 1×/user, dans
// AppShell (hors partenaires). Design soigné (maquette validée). Olivier 2026-08-03.

import { useEffect, useState } from 'react'

const SEEN_KEY  = 'matthieu_launch_v2'   // bump → réaffiché à tout le monde
const ANN_ID    = '99afd1e2-48f8-4f26-beb4-08a159736140'
// Splash « pleinement opérationnel » — à partir de 20h (base complète). Olivier.
const LAUNCH_TS = Date.parse('2026-08-03T18:00:00Z')  // 20:00 Europe/Brussels

const FEATURES: [string, string, string][] = [
  ['💬', 'Demande-lui n\'importe quoi', 'Panne, ouverture, remorquage — il connaît chaque modèle.'],
  ['📄', 'Il te montre la fiche', 'La bonne page (schéma, points d\'ancrage), pas 40 pages.'],
  ['📷', 'Un doute sur le modèle ?', 'Envoie une photo, il l\'analyse et identifie le véhicule.'],
]

export default function MatthieuLaunchModal({ userRole }: { userRole?: string }) {
  const [show, setShow]   = useState(false)
  const [enter, setEnter] = useState(false)

  useEffect(() => {
    if (userRole === 'garage' || userRole === 'partner') return
    try { if (localStorage.getItem(SEEN_KEY)) return } catch { /* */ }
    setShow(true)
    const t = setTimeout(() => setEnter(true), 30)
    return () => clearTimeout(t)
  }, [userRole])

  const close = () => {
    setEnter(false)
    setTimeout(() => setShow(false), 220)
    try { localStorage.setItem(SEEN_KEY, '1') } catch { /* */ }
    fetch('/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'seen', id: ANN_ID }) }).catch(() => {})
  }

  if (!show) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(5,4,9,.66)', backdropFilter: 'blur(4px)', opacity: enter ? 1 : 0, transition: 'opacity .22s ease' }}>
      <style>{`
        @keyframes mtSheen{0%{transform:translateX(-120%)}60%,100%{transform:translateX(220%)}}
        @keyframes mtFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes mtPulse{0%,100%{opacity:.35;transform:scale(1)}50%{opacity:.6;transform:scale(1.06)}}
        @media (prefers-reduced-motion:reduce){.mt-anim{animation:none!important}}
      `}</style>
      <div
        style={{
          width: '100%', maxWidth: 372, borderRadius: 30, overflow: 'hidden', position: 'relative',
          transform: enter ? 'translateY(0) scale(1)' : 'translateY(18px) scale(.96)',
          transition: 'transform .26s cubic-bezier(.2,.9,.3,1.2)',
          background: 'linear-gradient(180deg,#1b1930,#121019)',
          border: '1px solid rgba(124,116,255,.34)',
          boxShadow: '0 40px 90px -30px rgba(124,116,255,.55), 0 12px 40px rgba(0,0,0,.5)',
        }}>
        {/* glow haut */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(130% 55% at 50% -8%, rgba(124,116,255,.42), transparent 60%), radial-gradient(90% 40% at 100% 0%, rgba(226,59,46,.28), transparent 55%)' }} />
        {/* sheen animé */}
        <div className="mt-anim" style={{ position: 'absolute', top: 0, left: 0, width: '55%', height: '100%',
          background: 'linear-gradient(100deg,transparent,rgba(255,255,255,.06),transparent)', animation: 'mtSheen 2.6s ease-in-out .4s infinite', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', padding: '30px 24px 22px', textAlign: 'center' }}>
          {/* crest */}
          <div className="mt-anim" style={{ width: 92, height: 92, margin: '4px auto 0', borderRadius: 27, position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(150deg,#8b83ff,#4b40e0)', boxShadow: '0 20px 46px -12px rgba(124,116,255,.7)', animation: 'mtFloat 3.4s ease-in-out infinite' }}>
            <span style={{ fontSize: 46, filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.35))' }}>🔧</span>
            <span className="mt-anim" style={{ position: 'absolute', inset: -8, borderRadius: 33, border: '2px solid #8b83ff', animation: 'mtPulse 2.8s ease-in-out infinite' }} />
          </div>

          <div style={{ display: 'inline-block', marginTop: 18, fontSize: 11, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase',
            color: '#f5c451', background: 'rgba(245,196,81,.14)', border: '1px solid rgba(245,196,81,.34)', padding: '5px 13px', borderRadius: 999 }}>✦ Nouveau dans VD Soft</div>

          <h2 style={{ margin: '15px 4px 0', fontSize: 27, lineHeight: 1.04, fontWeight: 900, letterSpacing: '-.02em', color: '#f4f2ef' }}>
            Voici <span style={{ background: 'linear-gradient(100deg,#a79fff,#ff6a5c)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>La tête à Matthieu</span>
          </h2>
          <p style={{ margin: '9px 6px 0', fontSize: 13.5, lineHeight: 1.5, color: '#a7a2b8' }}>
            Le mécano que tout le monde appelle, désormais dans ta poche <b style={{ color: '#f4f2ef' }}>24/7</b>. Dépannage <b style={{ color: '#f4f2ef' }}>et</b> remorquage, toutes les marques.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 20, textAlign: 'left' }}>
            {FEATURES.map(([ic, t, d]) => (
              <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, padding: '11px 13px' }}>
                <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: 'rgba(124,116,255,.16)' }}>{ic}</span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 13, color: '#f4f2ef', lineHeight: 1.2 }}>{t}</b>
                  <span style={{ fontSize: 11.5, color: '#9a95a8', lineHeight: 1.3 }}>{d}</span>
                </span>
              </div>
            ))}
          </div>

          <p style={{ margin: '16px 4px 0', fontSize: 11.5, color: '#8f8aa0' }}>
            👉 Sur ta <b style={{ color: '#f4f2ef' }}>fiche d'intervention</b> — la tuile 🔧 <b style={{ color: '#a79fff' }}>La tête à Matthieu</b>.
          </p>

          <a href="/matthieu/presentation" onClick={close}
            style={{ display: 'block', textDecoration: 'none', width: '100%', marginTop: 16, padding: 15, borderRadius: 17, cursor: 'pointer',
              fontSize: 15.5, fontWeight: 900, color: '#fff', textAlign: 'center',
              background: 'linear-gradient(135deg,#7c74ff,#e23b2e)', boxShadow: '0 16px 32px -12px rgba(226,59,46,.6)' }}>
            Découvrir en détail →
          </a>
          <button onClick={close} style={{ width: '100%', marginTop: 8, padding: 10, border: 0, background: 'transparent', color: '#8f8aa0', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  )
}
