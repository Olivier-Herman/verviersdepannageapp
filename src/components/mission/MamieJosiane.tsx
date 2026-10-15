'use client'
// Mamie Josiane, fan n° 1 de Franck (Olivier 15/10/2026) : une blague, réservée aux comptes du réglage
// « mamie_josiane_users ». Elle apparaît APRÈS chaque pointage (jamais avant : elle ne retarde rien),
// et reste jusqu'au toucher sur « Merci Mamie ». Images : public/noprecache/josiane/1..6.jpg.
import { useEffect, useState } from 'react'

const REPLIQUES = [
  '',
  'FRANCK !!! Tu as accepté ?! Je l’ai su avant tout le monde, j’ai mes sources 😍',
  'Il est en route, il est en route ! Pouet pouet 🎺 Attention aux radars mon chéri !',
  'Je ne t’espionne pas, j’admire. Nuance. 🔭',
  'Il charge ! Il charge ! Je te tricote un petit quelque chose en attendant 🧶',
  'ARRIVÉÉÉ ! Je n’ai plus de voix, j’ai tout crié depuis Verviers 📣',
  'Je l’ai fini cette nuit, il est réfléchissant et il te va comme un gant. Mon champion ! 🏅😭',
]
const COULEURS = ['#e2557e', '#f5d90a', '#1d5fd6', '#0f7a4d', '#ff8a3d']

export default function MamieJosiane({ step, onClose, missionId }: { step: number | null; onClose: () => void; missionId?: string }) {
  const [show, setShow] = useState(false)
  // Elle reste jusqu'au « Merci Mamie » (15/10/2026 : partie seule en 6 s, Franck ne l'a pas vue) ;
  // chaque apparition et sa fermeture sont notées sur la fiche.
  const trace = (ferme: boolean) => { if (missionId && step) fetch(`/api/missions/${missionId}/josiane`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, ferme }) }).catch(() => {}) }
  useEffect(() => {
    if (!step) return
    setShow(true)
    trace(false)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!step || !show) return null
  return (
    <div className="fixed inset-0 z-[95] flex flex-col items-center justify-end bg-black/40 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
      <style>{`
        @keyframes mj-pop{0%{transform:translateY(120%) rotate(-8deg)}70%{transform:translateY(-6%) rotate(3deg)}100%{transform:translateY(0) rotate(0)}}
        @keyframes mj-in{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
        @keyframes mj-fall{to{transform:translateY(110vh) rotate(720deg)}}
      `}</style>
      {step === 6 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 70 }).map((_, k) => (
            <i key={k} style={{ position: 'absolute', top: -14, left: `${(k * 37) % 100}%`, width: 9, height: 14, borderRadius: 2, background: COULEURS[k % COULEURS.length],
              animation: `mj-fall ${1.6 + (k % 7) * 0.25}s linear ${(k % 5) * 0.12}s forwards` }} />
          ))}
        </div>
      )}
      <img src={`/noprecache/josiane/${step}.jpg`} alt="" className="w-[280px] max-w-[80vw] aspect-square rounded-[28px] object-cover shadow-2xl"
        style={{ animation: 'mj-pop .7s cubic-bezier(.2,1.6,.4,1) both' }} />
      <p className="relative mx-4 mt-4 max-w-[300px] rounded-[20px] bg-white px-4 py-3 text-center text-[17px] font-bold leading-snug text-gray-900"
        style={{ animation: 'mj-in .4s .55s ease-out both' }}>{REPLIQUES[step]}</p>
      <button type="button" onClick={() => { trace(true); setShow(false); onClose() }}
        className="mt-4 min-h-[48px] rounded-2xl bg-pink-600 px-6 font-bold text-white" style={{ animation: 'mj-in .3s 1s both' }}>
        Merci Mamie 🙈
      </button>
    </div>
  )
}

/** Étape atteinte par la mission (1 acceptée … 4 chargée, 6 clôturée) — la 5 (arrivée) vient du bouton. */
/** Seuls comptent les pointages faits DEPUIS l'attribution au chauffeur : une mission réattribuée garde
 *  ceux du chauffeur précédent (1WXM962 : accepté et en route par Fred Palm, puis donnée à Franck). */
export function etapeJosiane(m: { status?: string | null; assigned_at?: string | null; accepted_at?: string | null; on_way_at?: string | null; on_site_at?: string | null; loaded_at?: string | null; completed_at?: string | null; parked_at?: string | null }): number {
  const depuis = m.assigned_at ? Date.parse(m.assigned_at) : 0
  const fait = (t?: string | null) => !!t && Date.parse(t) >= depuis
  if (['completed', 'to_invoice', 'invoiced', 'parked'].includes(String(m.status)) && (fait(m.completed_at) || fait(m.parked_at))) return 6
  if (fait(m.loaded_at)) return 4
  if (fait(m.on_site_at)) return 3
  if (fait(m.on_way_at)) return 2
  if (fait(m.accepted_at)) return 1
  return 0
}
