'use client'

// « Le standard » — l'assistant du site public.
//
// Branché sur Claude via /api/site/assistant. L'historique reste dans l'onglet :
// rien n'est stocké côté serveur, un visiteur anonyme n'a pas de dossier chez
// nous. Le premier message rappelle le numéro : quelqu'un en panne ne doit pas
// perdre du temps à discuter avec une machine. Olivier 2026-08-21.

import { useEffect, useRef, useState } from 'react'
import { TEL } from '../_data'

type Msg = { role: 'user' | 'assistant'; content: string }

const AMORCES = [
  'Ma voiture a été enlevée, que faire ?',
  'Combien coûte la fourrière ?',
  'Vous venez jusqu’à Malmedy ?',
  'Vous transportez des voitures de collection ?',
  'Vous vendez des véhicules ?',
]

const BONJOUR =
  `Bonjour — ici le standard de Verviers Dépannage. Posez votre question sur le dépannage, `
+ `la fourrière, nos tarifs, notre zone d’intervention ou les véhicules à vendre.\n\n`
+ `Si vous êtes en panne maintenant, n’attendez pas : appelez le ${TEL}.`

export default function Assistant() {
  const [open, setOpen]   = useState(false)
  const [msgs, setMsgs]   = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy]   = useState(false)
  const logRef   = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [msgs, busy])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  function start() {
    setOpen(true)
    if (!msgs.length) setMsgs([{ role: 'assistant', content: BONJOUR }])
    setTimeout(() => inputRef.current?.focus(), 60)
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setDraft(''); setBusy(true)
    try {
      const r = await fetch('/api/site/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // On n'envoie pas le message d'accueil : il n'apporte rien au modèle.
        body: JSON.stringify({ messages: next.filter(m => m.content !== BONJOUR) }),
      })
      const j = await r.json().catch(() => ({}))
      setMsgs([...next, {
        role: 'assistant',
        content: j?.reply || `Je n’arrive pas à répondre pour l’instant. Appelez le ${TEL}.`,
      }])
    } catch {
      setMsgs([...next, {
        role: 'assistant',
        content: `La connexion a lâché. Appelez le ${TEL}, quelqu’un décroche 24h/24.`,
      }])
    } finally { setBusy(false) }
  }

  return (
    <div className="vdsite-dock">
      {open && (
        <div className="chat" role="dialog" aria-label="Assistant Verviers Dépannage">
          <div className="chat-head">
            <span className="dotline" aria-hidden="true" />
            <span><b>Le standard</b><small>ASSISTANT EN LIGNE · 24H/24</small></span>
            <button className="chat-close" onClick={() => setOpen(false)} aria-label="Fermer">✕</button>
          </div>

          <div className="chat-log" ref={logRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role === 'user' ? 'me' : 'bot'}`}>
                {m.content.split('\n').map((line, j) => <p key={j}>{line || ' '}</p>)}
              </div>
            ))}
            {busy && <div className="msg bot typing"><i /><i /><i /></div>}
          </div>

          {msgs.length <= 1 && (
            <div className="chips">
              {AMORCES.map(a => (
                <button key={a} type="button" className="chip" onClick={() => ask(a)}>{a}</button>
              ))}
            </div>
          )}

          <form className="chat-form" onSubmit={e => { e.preventDefault(); ask(draft) }}>
            <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
              placeholder="Posez votre question…" aria-label="Votre question"
              autoComplete="off" maxLength={600} disabled={busy} />
            <button type="submit" disabled={busy || !draft.trim()}>Envoyer</button>
          </form>
        </div>
      )}

      <button className="dock-btn" onClick={() => (open ? setOpen(false) : start())}>
        <span className="wave" aria-hidden="true"><i /><i /><i /><i /></span>
        {open ? 'Fermer' : 'Une question ?'}
      </button>
    </div>
  )
}
