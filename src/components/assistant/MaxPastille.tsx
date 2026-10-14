'use client'

// Max en pastille (Olivier 14/10/2026, maquette v2 validée, look « dispatcheur ») : en bas à
// droite de VD Soft pour les personnes qui ont Max. Il voit la fiche ouverte (dispatch,
// mission, dossier) et répond dans un volet, avec le même encadré Confirmer / Annuler que la
// page Max. Fermeture par ✕ uniquement. Une conversation par jour, reprise d'une page à l'autre.

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { MessageView, toolResults, type ActionRow, type Message } from '@/components/assistant/MessageParts'

type Fiche = { id: string; numero: number | null; plaque: string | null; statut: string; client_facture: string | null; source: string | null }

const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'
/** Écran et fiche lus dans l'adresse de la page. */
function readPage(path: string): { ecran: string; ficheId: string | null } {
  const rules: [RegExp, string][] = [
    [new RegExp(`^/dispatch/dossier/${UUID}`, 'i'), 'Vue dossier'],
    [new RegExp(`^/dispatch/${UUID}`, 'i'), 'Fiche du dispatch'],
    [new RegExp(`^/facturation/dossiers/${UUID}`, 'i'), 'Dossier de facturation'],
    [new RegExp(`^/mission/${UUID}`, 'i'), 'Fiche mission'],
  ]
  for (const [re, ecran] of rules) { const m = path.match(re); if (m) return { ecran, ficheId: m[1] } }
  const named: [string, string][] = [['/facturation/dossiers', 'Liste À facturer'], ['/facturation', 'Facturation'], ['/fourriere', 'Fourrière'], ['/dispatch', 'Dispatch'], ['/recherche', 'Recherche'], ['/missions-terminees', 'Missions terminées']]
  const n = named.find(([p]) => path === p || path.startsWith(p + '/'))
  return { ecran: n ? n[1] : 'VD Soft', ficheId: null }
}

const today = () => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())
const hello = (prenom: string) => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date())) % 24
  return h < 6 ? `Encore debout ${prenom} ? 🌙 Moi aussi.` : h < 11 ? `Salut ${prenom} ! ☕ Bien réveillé ?` : h < 14 ? `Salut ${prenom} ! 🍝` : h < 19 ? `Salut ${prenom} ! 👋` : `Encore là ${prenom} ? 🌙 Je suis là aussi.`
}

export default function MaxPastille({ userName }: { userName: string }) {
  const pathname = usePathname() || ''
  const prenom = (userName || '').split(' ')[0] || ''
  const page = readPage(pathname)
  const [fiche, setFiche] = useState<Fiche | null>(null)
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState(false)
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [actions, setActions] = useState<Record<string, ActionRow>>({})
  const [sending, setSending] = useState(false)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [party, setParty] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)

  // Fiche ouverte : numéro et plaque pour la bulle et le bandeau.
  useEffect(() => {
    setFiche(null); setHint(false)
    if (!page.ficheId) return
    let off = false
    fetch(`/api/assistant/contexte?id=${page.ficheId}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => {
      if (off || !j?.fiche) return
      setFiche(j.fiche)
      // Bulle « j'ai vu la fiche » : une fois par fiche et par session.
      try { const k = `max_hint_${j.fiche.id}`; if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); setHint(true); setTimeout(() => setHint(false), 9000) } } catch { setHint(true) }
    }).catch(() => {})
    return () => { off = true }
  }, [page.ficheId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, sending, open])

  const keepActions = (list?: ActionRow[]) => setActions(Object.fromEntries((list || []).map(a => [a.id, a])))

  // Conversation du jour (la même d'une page à l'autre), créée au premier message.
  async function openPanel() {
    setOpen(true); setHint(false)
    if (convId) return
    try {
      const j = await fetch('/api/assistant/conversations?mode=bureau', { cache: 'no-store' }).then(r => r.json())
      const c = (j.conversations || []).find((x: any) => x.title?.startsWith(`Max · ${today()}`))
      if (c) {
        setConvId(c.id)
        const d = await fetch(`/api/assistant/conversations/${c.id}`, { cache: 'no-store' }).then(r => r.json())
        setMessages(d.messages || []); keepActions(d.actions)
      }
    } catch {}
  }

  async function ensureConv(): Promise<string | null> {
    if (convId) return convId
    const r = await fetch('/api/assistant/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'bureau', title: `Max · ${today()}` }) })
    const j = await r.json().catch(() => ({}))
    if (!j.conversation) return null
    setConvId(j.conversation.id); return j.conversation.id
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if (!text || sending) return
    setInput(''); setSending(true)
    setMessages(m => [...m, { id: 'tmp-' + Date.now(), role: 'user', content: { type: 'text', text }, created_at: new Date().toISOString() }])
    try {
      const id = await ensureConv()
      if (!id) throw new Error('Max ne répond pas, réessaie dans un instant.')
      const r = await fetch(`/api/assistant/conversations/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, contexte: { ecran: page.ecran, fiche: fiche ? { id: fiche.id, numero: fiche.numero, plaque: fiche.plaque } : null } }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Max a eu un souci, réessaie.')
      setMessages(j.messages || []); keepActions(j.actions)
    } catch (e: any) {
      setMessages(m => [...m, { id: 'err-' + Date.now(), role: 'assistant', content: [{ type: 'text', text: `😕 ${e.message}` }], created_at: new Date().toISOString() }])
    } finally { setSending(false) }
  }

  async function decide(actionId: string, decision: 'confirmer' | 'annuler') {
    if (!convId || deciding) return
    setDeciding(actionId)
    try {
      const r = await fetch(`/api/assistant/actions/${actionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const j = await r.json().catch(() => ({}))
      if (j.status === 'faite') setParty(p => p + 1)
      const d = await fetch(`/api/assistant/conversations/${convId}`, { cache: 'no-store' }).then(x => x.json())
      setMessages(d.messages || []); keepActions(d.actions)
    } finally { setDeciding(null) }
  }

  if (pathname.startsWith('/assistant-bureau')) return null

  const suggestions = fiche
    ? [fiche.statut === 'à facturer' ? 'Pourquoi elle est encore à facturer ?' : 'Explique-moi ce dossier', 'Il y a des mails sur cette fiche ?', 'D’où vient le montant ?']
    : ['Trouve-moi une fiche…', 'Pourquoi un dossier est à facturer ?', 'Cherche un mail']
  const results = toolResults(messages)

  return (
    <>
      {!open && (
        <div className="fixed z-40 right-4 lg:right-6 flex items-end gap-2" style={{ bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' }}>
          {hint && fiche && (
            <div className="hidden sm:block max-w-[240px] bg-surface text-ink border rounded-2xl rounded-br-sm px-3 py-2 text-[13px] shadow-lg max-pop">
              J’ai vu la fiche <b>{fiche.plaque || `#${fiche.numero}`}</b>. Un souci dessus ? 👀
            </div>
          )}
          <button onClick={openPanel} aria-label="Ouvrir Max" title="Max, ton compagnon de bureau"
            className="relative w-16 h-16 rounded-full border-[3px] border-orange-500 bg-surface shadow-xl max-bob focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/max/max.jpg" alt="Max" className="w-full h-full rounded-full object-cover" />
            <span className="absolute right-0.5 bottom-0.5 w-4 h-4 rounded-full bg-green-500 border-[3px] border-white" />
          </button>
        </div>
      )}

      {open && (
        <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-[430px] bg-surface border-l shadow-2xl flex flex-col max-slide" aria-label="Max">
          <div className="flex items-center gap-3 px-4 pb-3 text-white" style={{ paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))', background: 'linear-gradient(135deg,#0e6b62,#0a4f48)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/max/max-grand.jpg" alt="" className="w-14 h-14 rounded-full object-cover border-[3px] border-orange-500 bg-white" />
            <div className="min-w-0">
              <p className="text-lg font-extrabold leading-tight">Max</p>
              <p className="text-xs opacity-90 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> En ligne · ton compagnon de bureau</p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Fermer" className="ml-auto w-11 h-11 rounded-xl border border-white/40 bg-white/10 text-lg">✕</button>
          </div>

          <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-teal-50 text-teal-900 text-[13px]">
            📍 {fiche
              ? <>Je suis sur la même page que toi : <b>fiche #{fiche.numero} · {fiche.plaque || 'sans plaque'}</b>{fiche.statut ? `, ${fiche.statut}` : ''}.</>
              : <>Tu es sur : <b>{page.ecran}</b>. Donne-moi une plaque ou un numéro de fiche, ou décris-la-moi.</>}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex items-end gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/max/max.jpg" alt="" className="w-8 h-8 rounded-full object-cover" />
                <div className="bg-surface-2 border rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-ink">
                  <p>{hello(prenom)}</p>
                  <p className="mt-1">{fiche ? 'Je regarde cette fiche avec toi ?' : 'Dis-moi ce que tu cherches, je fouille pour toi.'}</p>
                </div>
              </div>
            )}
            {messages.map(m => <MessageView key={m.id} message={m} results={results} actions={actions} deciding={deciding} onDecide={decide} />)}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-1.5 pl-10">
                {suggestions.map(s => (
                  <button key={s} onClick={() => s.endsWith('…') ? setInput(s.replace('…', ' ')) : send(s)} className="min-h-[36px] px-3 rounded-full border border-teal-700 text-teal-800 bg-surface text-[12.5px] font-semibold">{s}</button>
                ))}
              </div>
            )}
            {sending && (
              <div className="flex items-end gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/max/max.jpg" alt="" className="w-8 h-8 rounded-full object-cover" />
                <div className="bg-surface-2 border rounded-2xl rounded-bl-sm px-3 py-3 flex gap-1" aria-label="Max cherche">
                  <span className="w-2 h-2 rounded-full bg-ink-faint max-dot" /><span className="w-2 h-2 rounded-full bg-ink-faint max-dot [animation-delay:.15s]" /><span className="w-2 h-2 rounded-full bg-ink-faint max-dot [animation-delay:.3s]" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={e => { e.preventDefault(); send() }} className="border-t p-3 flex gap-2" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Écris à Max…" disabled={sending}
              className="flex-1 min-w-0 h-11 rounded-xl border bg-surface-2 px-3 text-sm text-ink focus:outline-none focus:border-teal-700" />
            <button disabled={sending || !input.trim()} aria-label="Envoyer" className="w-12 h-11 rounded-xl bg-teal-700 text-white text-lg disabled:opacity-50">➤</button>
          </form>
        </aside>
      )}
      {party > 0 && <Confetti key={party} />}
      <style jsx global>{`
        @media (prefers-reduced-motion: no-preference) {
          .max-bob { animation: maxBob 3.2s ease-in-out infinite }
          @keyframes maxBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
          .max-pop { animation: maxPop .35s ease-out both .3s }
          @keyframes maxPop { from { opacity: 0; transform: translateY(6px) scale(.96) } }
          .max-slide { animation: maxSlide .2s ease-out }
          @keyframes maxSlide { from { transform: translateX(30px); opacity: .6 } }
          .max-dot { animation: maxDot 1s infinite }
          @keyframes maxDot { 0%,80%,100% { opacity: .25; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-3px) } }
        }
      `}</style>
    </>
  )
}

/** Petits confettis aux couleurs VD quand une correction est faite. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDone(true); return }
    const c = ref.current; if (!c) return
    c.width = window.innerWidth; c.height = window.innerHeight
    const x = c.getContext('2d'); if (!x) return
    const cols = ['#f97316', '#0e6b62', '#22c55e', '#fcd34d', '#c8102e']
    const ps = Array.from({ length: 90 }, () => ({ x: window.innerWidth - 220 + Math.random() * 180, y: window.innerHeight - 280, vx: (Math.random() - 0.6) * 7, vy: -Math.random() * 9 - 3, s: 4 + Math.random() * 5, c: cols[Math.floor(Math.random() * 5)], r: Math.random() * 6 }))
    let t = 0, raf = 0
    const f = () => {
      x.clearRect(0, 0, c.width, c.height)
      for (const p of ps) { p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.r += 0.1; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); x.restore() }
      if (++t < 90) raf = requestAnimationFrame(f); else setDone(true)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (done) return null
  return <canvas ref={ref} className="fixed inset-0 z-[60] pointer-events-none" />
}
