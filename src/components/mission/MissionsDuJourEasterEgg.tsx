'use client'
// src/components/mission/MissionsDuJourEasterEgg.tsx
//
// Easter egg « Mes missions » : la date du jour (utile) sert de déclencheur —
// 3 taps rapides dessus → grand affichage festif du nombre de missions du jour
// + RECORD PERSO (concours) avec commentaires en langage familier.
// Olivier 2026-08-09.

import { useEffect, useRef, useState } from 'react'

// Une punchline familière, choisie selon le contexte (déterministe côté client).
function punch(count: number, record: number, newRecord: boolean, name?: string): { emoji: string; title: string; line: string } {
  const who = name ? `${name}` : ''
  if (count <= 0)
    return { emoji: '☕', title: 'Ça démarre', line: `Allez ${who}, chauffe le moteur, la journée t’attend !` }
  if (newRecord)
    return { emoji: '🏆', title: 'NOUVEAU RECORD !', line: pick([
      `T’es une machine ${who} 🔥`, 'Personne te suit là, gros !', 'Ça c’est du taf, respect 💪', 'En feu aujourd’hui, tranquille 🚀',
    ], count) }
  if (count === record)
    return { emoji: '⚡', title: 'Record égalé !', line: `T’es à ta meilleure journée ${who} — un p’tit dernier pour le péter ?` }
  const reste = record - count + 1
  return { emoji: '💪', title: `${count} au compteur`, line: pick([
    `Record perso : ${record}. Plus que ${reste} pour le péter !`,
    `Ça déroule ${who}, encore ${reste} et t’exploses ton record 🔥`,
    `T’es chaud, ${reste} de plus et c’est le record !`,
  ], count) }
}
function pick<T>(arr: T[], seed: number): T { return arr[Math.abs(seed) % arr.length] }

export default function MissionsDuJourEasterEgg({
  count, record, newRecord, firstName,
}: { count: number; record: number; newRecord: boolean; firstName?: string }) {
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

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), 6500)
    return () => clearTimeout(t)
  }, [open])

  const p = punch(count, record, newRecord, firstName)
  const confettiN = newRecord ? 44 : 26

  return (
    <>
      {/* Déclencheur discret : la date du jour. */}
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
          className={`fixed inset-0 z-[200] flex items-center justify-center backdrop-blur-md px-6 egg-fade ${newRecord ? 'egg-bg-record' : 'bg-ink/95'}`}
        >
          {/* Confettis */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {Array.from({ length: confettiN }).map((_, i) => (
              <span key={i} className="egg-confetti" style={{
                left: `${(i * 37) % 100}%`,
                background: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'][i % 5],
                animationDelay: `${(i % 10) * 0.1}s`,
                animationDuration: `${1.7 + (i % 5) * 0.25}s`,
              }} />
            ))}
          </div>

          <div className="relative text-center text-white egg-pop max-w-sm">
            <div className="text-6xl mb-1">{p.emoji}</div>
            {newRecord && (
              <div className="inline-block text-amber-300 font-black tracking-widest text-sm uppercase mb-1 egg-shine">★ {p.title} ★</div>
            )}
            <div className="text-[26vw] sm:text-[150px] leading-none font-black tabular-nums drop-shadow-xl">{count}</div>
            <div className="text-lg font-bold mt-1">mission{count > 1 ? 's' : ''} aujourd’hui</div>

            {/* Concours : record perso */}
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/12 border border-white/20 px-4 py-1.5 text-sm font-semibold">
              <span>🥇 Record perso</span>
              <span className="tabular-nums font-black text-amber-300">{Math.max(record, count)}</span>
            </div>

            <div className="text-white/85 text-[15px] mt-4 font-medium leading-snug">{p.line}</div>
            <div className="text-white/40 text-[11px] mt-6 uppercase tracking-widest">Touche pour fermer</div>
          </div>
        </div>
      )}

      <style jsx>{`
        .egg-fade { animation: eggFade .2s ease-out; }
        @keyframes eggFade { from { opacity: 0 } to { opacity: 1 } }
        .egg-bg-record { background: radial-gradient(120% 120% at 50% 0%, rgba(180,83,9,.97), rgba(12,14,18,.98)); }
        .egg-pop { animation: eggPop .5s cubic-bezier(.2,1.4,.4,1); }
        @keyframes eggPop { 0% { transform: scale(.5); opacity: 0 } 60% { transform: scale(1.06) } 100% { transform: scale(1); opacity: 1 } }
        .egg-shine { animation: eggShine 1.4s ease-in-out infinite; }
        @keyframes eggShine { 0%,100% { opacity: .7 } 50% { opacity: 1; text-shadow: 0 0 14px rgba(252,211,77,.8) } }
        .egg-confetti {
          position: absolute; top: -14px; width: 9px; height: 14px; border-radius: 2px;
          animation-name: eggFall; animation-timing-function: linear; animation-iteration-count: infinite; opacity: .9;
        }
        @keyframes eggFall {
          0% { transform: translateY(-20px) rotate(0deg); }
          100% { transform: translateY(110vh) rotate(540deg); }
        }
      `}</style>
    </>
  )
}
