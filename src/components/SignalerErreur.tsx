'use client'

// « Signaler à Sam / Sonic » sous une erreur affichée au chauffeur (Olivier 26/10/2026, maquette validée).
// L'erreur est enregistrée dès qu'elle s'affiche (référence à l'écran), même si le chauffeur ne la signale pas ;
// le bouton ouvre une fenêtre où il peut ajouter un mot, puis l'erreur part dans sa conversation avec Sam,
// au bureau et chez Mobi (/api/sam/signaler). Fonctionne aussi hors des fournisseurs de l'app (plantage global).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/lib/i18n/I18nProvider'
import { refErreur } from '@/lib/erreurs/ref'

export type OuErreur = 'creation' | 'mission' | 'action' | 'global'

// Une erreur n'est enregistrée qu'une fois par affichage de page (la même peut se réafficher à chaque essai).
const dejaVues = new Map<string, Promise<string | null>>()

function agentDuMoment(): 'Sam' | 'Sonic' {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date())) % 24
  return h >= 8 && h < 20 ? 'Sam' : 'Sonic'
}

function enregistrer(message: string, where: OuErreur, missionId?: string | null, context?: Record<string, any> | null): Promise<string | null> {
  const k = `${where}|${missionId || ''}|${message}`
  if (!dejaVues.has(k)) {
    dejaVues.set(k, fetch('/api/client-error', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: where === 'mission' || where === 'global' ? 'error' : 'warn', message, where, mission_id: missionId || null, context: context || null, url: location.pathname }),
    }).then(r => r.json()).then(j => j?.id || null).catch(() => null))
  }
  return dejaVues.get(k)!
}

interface Props {
  message: string
  where: OuErreur
  missionId?: string | null
  /** Ce que le chauffeur avait encodé (plaque, adresse, type…) : aide à corriger. */
  context?: Record<string, any> | null
  /** Ligne d'erreur déjà enregistrée côté serveur (la route l'a renvoyée) : pas de second enregistrement. */
  errorId?: string | null
  className?: string
}

export default function SignalerErreur({ message, where, missionId = null, context = null, errorId = null, className = '' }: Props) {
  const { t } = useT()
  const [id, setId] = useState<string | null>(errorId)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [rep, setRep] = useState<{ agent: string; texte: string; ref: string } | null>(null)
  const [fail, setFail] = useState(false)
  const [mounted, setMounted] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const ctxRef = useRef(context); ctxRef.current = context
  const agent = rep?.agent || agentDuMoment()

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    setRep(null); setFail(false)
    if (errorId) { setId(errorId); return }
    if (!message) return
    let alive = true
    enregistrer(message, where, missionId, ctxRef.current).then(x => { if (alive) setId(x) })
    return () => { alive = false }
  }, [message, where, missionId, errorId])
  useEffect(() => { if (open) closeRef.current?.focus() }, [open])

  async function envoyer() {
    setBusy(true); setFail(false)
    try {
      const r = await fetch('/api/sam/signaler', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error_id: id, message, where, mission_id: missionId, context: ctxRef.current, note }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error()
      setRep({ agent: j.agent, texte: j.texte, ref: j.ref })
    } catch { setFail(true) } finally { setBusy(false) }
  }

  if (!message) return null
  const ref = rep?.ref || refErreur(id)

  return (
    <span className={`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {rep ? (
        <span className="text-sm font-semibold text-green-700 dark:text-green-300">{t('signaler.done')}{ref ? ` (${ref})` : ''}</span>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold text-white active:bg-teal-800">
          {t('signaler.btn', { agent })}
        </button>
      )}
      {ref && !rep && <span className="font-mono text-xs opacity-75">{t('signaler.ref', { ref })}</span>}

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[400] flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true">
          <div className="relative w-full max-w-md space-y-3 rounded-t-3xl bg-white p-4 pb-6 text-gray-900 sm:rounded-3xl dark:bg-slate-800 dark:text-slate-100"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={t('signaler.close')}
              className="absolute right-3 top-3 h-11 w-11 rounded-xl border border-gray-300 text-lg text-gray-800 dark:border-slate-600 dark:text-slate-100">✕</button>
            <div className="flex gap-3 pr-14">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-amber-100 text-2xl">🧑‍🔧</div>
              <div className="rounded-2xl rounded-tl-sm bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
                <b>{agent}</b><br />{rep ? rep.texte : t('signaler.intro')}
              </div>
            </div>
            {rep ? (
              <>
                <p className="rounded-xl bg-green-100 px-3 py-2 text-sm font-semibold text-green-800">{t('signaler.done')}{ref ? ` (${ref})` : ''}</p>
                <button type="button" onClick={() => setOpen(false)}
                  className="min-h-[50px] w-full rounded-2xl bg-gray-100 font-bold text-gray-800 dark:bg-slate-700 dark:text-slate-100">{t('signaler.close')}</button>
              </>
            ) : (
              <>
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">⚠️ {message}{ref ? <span className="ml-1 font-mono text-xs opacity-75">· {ref}</span> : null}</p>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={t('signaler.placeholder')}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
                <p className="text-xs text-gray-700 dark:text-slate-300">{t('signaler.sent_with')}</p>
                {fail && <p className="text-sm font-semibold text-red-700 dark:text-red-300">{t('signaler.failed')}</p>}
                <button type="button" onClick={envoyer} disabled={busy}
                  className="min-h-[50px] w-full rounded-2xl bg-blue-700 font-bold text-white disabled:opacity-60">
                  {busy ? t('signaler.sending') : t('signaler.send', { agent })}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
