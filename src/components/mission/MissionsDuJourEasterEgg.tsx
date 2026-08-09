'use client'
// src/components/mission/MissionsDuJourEasterEgg.tsx
//
// Easter egg « Mes missions » : la date du jour (utile) sert de déclencheur —
// 3 taps rapides dessus → grand affichage festif du nombre de missions du jour
// + RECORD PERSO (concours) avec commentaires en langage familier.
// Olivier 2026-08-09.

import { useEffect, useRef, useState } from 'react'

// Une punchline familière/taquine, tirée au hasard selon le contexte.
function punch(count: number, record: number, newRecord: boolean, name?: string): { emoji: string; title: string; line: string } {
  const who = name || ''
  const reste = Math.max(1, record - count + 1)

  if (newRecord)
    return { emoji: '🏆', title: 'NOUVEAU RECORD !', line: pick([
      `T’es une machine ${who} 🔥`, 'Personne te suit là, gros !', 'Record explosé, respect total 💪',
      'Flash a pris sa retraite, c’est toi le patron ⚡', 'Faut appeler le Guinness ou quoi ? 🏆',
      'Le camion va demander une augmentation 😅', 'T’as mangé du lion ce matin ? 🦁',
      'On arrête tout, c’est jour de fête 🎉', 'Mode turbo activé, personne comprend 🚀',
      'Même ton camion est fier de toi 🥹',
    ]) }

  if (count > 0 && count === record)
    return { emoji: '⚡', title: 'Record égalé !', line: pick([
      `Un p’tit dernier et tu pètes ton record ${who} !`,
      'À un cheveu du record… tu vas pas t’arrêter là ?',
      'T’égales ton record, encore un coup de collier 💪', 'Le record te tend les bras, vas-y !',
    ]) }

  if (count <= 0)
    return { emoji: '☕', title: 'Ça démarre', line: pick([
      `Allez ${who}, chauffe le moteur, la journée t’attend !`,
      'Le camion s’ennuie… faut le réveiller 😜', 'T’es sûr que t’as tourné la clé ?',
      'Zéro pointé… le café d’abord, on t’en veut pas ☕', 'La journée est vierge, à toi de jouer 🎬',
      'Même l’escargot a déjà commencé, là 🐌',
    ]) }

  if (count <= 2)
    return { emoji: '🐌', title: `${count} au compteur`, line: pick([
      'Eh ben, faut pas être en train de mourir quand on attend que t’arrives 😅',
      'T’as troqué ton super camion contre un ultra-escargot ? 🐌',
      'Le compteur a pas encore chauffé, on dirait…',
      `Record perso : ${record}. Faut se bouger un peu là 😏`,
      'Deux missions ? T’as fait la sieste entre les deux ? 😴',
      'À ce rythme, la retraite avant la prochaine 😅', 'Le GPS t’a envoyé faire un tour touristique ?',
      'T’attends que les missions viennent à toi ou quoi ?',
    ]) }

  if (count <= 5)
    return { emoji: '💪', title: `${count} au compteur`, line: pick([
      `Ça déroule ${who}, encore ${reste} et t’exploses ton record 🔥`,
      'Rythme de croisière, continue comme ça 👌', `Plus que ${reste} pour le record, t’es chaud !`,
      'Tranquille, ça avance bien 😎', 'Bon tempo, on sent le pro 💪',
      'Le camion connaît la route par cœur maintenant 🛣️',
    ]) }

  if (count <= 9)
    return { emoji: '🚀', title: `${count} au compteur`, line: pick([
      'Flash n’a qu’à bien se tenir, tu viens de le dépasser ⚡',
      'On t’a mis un moteur d’avion ou quoi ? 🚀', `Le camion fume, doucement 😎 (record : ${record})`,
      'T’enchaînes comme d’autres respirent 🔥', 'Les clients te voient à peine passer 💨',
      'Y’a le feu ? Non, c’est juste toi qui carbures 🔥',
    ]) }

  return { emoji: '🏆', title: `${count} au compteur`, line: pick([
    'Machine de guerre, personne te suit 🏆', 'Tu roules pour deux, là !', 'Faut te clôner, c’est pas humain 😳',
    'T’as un jumeau qui bosse en même temps ? 👯', 'Le patron va t’ériger une statue 🗿',
    'Même ton camion demande grâce 😂', 'T’es plus un chauffeur, t’es une légende 🦸',
  ]) }
}
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

export default function MissionsDuJourEasterEgg({
  count, record, newRecord, firstName,
}: { count: number; record: number; newRecord: boolean; firstName?: string }) {
  const [open, setOpen] = useState(false)
  const [card, setCard] = useState<{ emoji: string; title: string; line: string }>({ emoji: '🚗', title: '', line: '' })
  const [line, setLine] = useState('')
  const taps = useRef<number[]>([])
  const dateLabel = new Intl.DateTimeFormat('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date())

  function onTap() {
    const now = Date.now()
    taps.current = [...taps.current.filter(t => now - t < 1400), now]
    if (taps.current.length >= 3) {
      taps.current = []
      const c = punch(count, record, newRecord, firstName)   // vanne statique : instantané
      setCard(c); setLine(c.line); setOpen(true)
    }
  }

  // Auto-fermeture + génération d'une vanne FRAÎCHE via Claude (remplace la statique
  // dès qu'elle arrive ; si pas de clé / lent / erreur → on garde la statique).
  useEffect(() => {
    if (!open) return
    const closeT = setTimeout(() => setOpen(false), 7000)
    const ctrl = new AbortController()
    fetch('/api/mission/punchline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ count, record, newRecord, firstName }),
    }).then(r => r.json()).then(d => { if (d?.line) setLine(d.line) }).catch(() => {})
    return () => { clearTimeout(closeT); ctrl.abort() }
  }, [open, count, record, newRecord, firstName])

  const p = card
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

            <div className="text-white/85 text-[15px] mt-4 font-medium leading-snug min-h-[2.5em] flex items-center justify-center">{line}</div>
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
