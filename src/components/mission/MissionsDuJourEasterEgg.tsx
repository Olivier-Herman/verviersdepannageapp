'use client'
// src/components/mission/MissionsDuJourEasterEgg.tsx
//
// Easter egg « Mes missions » : la date du jour (utile) sert de déclencheur —
// 3 taps rapides dessus → grand affichage festif du nombre de missions du jour
// pour le chauffeur. Olivier 2026-08-09.

import { useEffect, useRef, useState } from 'react'

// Message + emoji selon le nombre de missions du jour.
function vibe(n: number): { emoji: string; line: string } {
  if (n <= 0) return { emoji: '☕', line: 'La journée commence…' }
  if (n === 1) return { emoji: '🚗', line: 'Première de la journée !' }
  if (n <= 3) return { emoji: '💪', line: 'Bien lancé !' }
  if (n <= 6) return { emoji: '🔥', line: 'Grosse journée !' }
  if (n <= 9) return { emoji: '🚀', line: 'Machine de guerre !' }
  return { emoji: '🏆', line: 'Journée de légende !' }
}

export default function MissionsDuJourEasterEgg({ count, firstName }: { count: number; firstName?: string }) {
  const [open, setOpen] = useState(false)
  const taps = useRef<number[]>([])
  const dateLabel = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date())

  function onTap() {
    const now = Date.now()
    taps.current = [...taps.current.filter(t => now - t < 1400), now]
    if (taps.current.length >= 3) { taps.current = []; setOpen(true) }
  }

  // Fermeture auto après 6 s (ou au tap).
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), 6000)
    return () => clearTimeout(t)
  }, [open])

  const v = vibe(count)

  return (
    <>
      {/* Déclencheur discret : la date du jour, centrée, sobre. */}
      <div className="flex justify-center">
        <button
          onClick={onTap}
          aria-label="Date du jour"
          className="text-ink-faint text-[11px] font-medium uppercase tracking-widest select-none px-3 py-1 -mt-1 active:text-ink-muted transition-colors"
        >
          {dateLabel}
        </button>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/70 backdrop-blur-sm px-6 egg-fade"
        >
          {/* Confettis */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {Array.from({ length: 28 }).map((_, i) => (
              <span key={i} className="egg-confetti" style={{
                left: `${(i * 37) % 100}%`,
                background: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'][i % 5],
                animationDelay: `${(i % 10) * 0.12}s`,
                animationDuration: `${1.8 + (i % 5) * 0.25}s`,
              }} />
            ))}
          </div>

          <div className="relative text-center text-white egg-pop">
            <div className="text-6xl mb-2">{v.emoji}</div>
            <div className="text-[26vw] leading-none font-black tabular-nums drop-shadow-xl">{count}</div>
            <div className="text-lg font-bold mt-1">
              mission{count > 1 ? 's' : ''} aujourd’hui
            </div>
            <div className="text-white/80 text-sm mt-2">
              {firstName ? `${firstName}, ` : ''}{v.line}
            </div>
            <div className="text-white/40 text-[11px] mt-6 uppercase tracking-widest">Touche pour fermer</div>
          </div>
        </div>
      )}

      <style jsx>{`
        .egg-fade { animation: eggFade .2s ease-out; }
        @keyframes eggFade { from { opacity: 0 } to { opacity: 1 } }
        .egg-pop { animation: eggPop .5s cubic-bezier(.2,1.4,.4,1); }
        @keyframes eggPop { 0% { transform: scale(.5); opacity: 0 } 60% { transform: scale(1.06) } 100% { transform: scale(1); opacity: 1 } }
        .egg-confetti {
          position: absolute; top: -12px; width: 9px; height: 14px; border-radius: 2px;
          animation-name: eggFall; animation-timing-function: linear; animation-iteration-count: infinite;
          opacity: .9;
        }
        @keyframes eggFall {
          0% { transform: translateY(-20px) rotate(0deg); }
          100% { transform: translateY(110vh) rotate(540deg); }
        }
      `}</style>
    </>
  )
}
