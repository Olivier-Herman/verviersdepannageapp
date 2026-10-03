'use client'

// Bouton « Aide » de l'app chauffeur → conversation avec Sam (Olivier 03/10/2026,
// maquette validée). L'app transmet l'écran exact et la mission ouverte ; le
// chauffeur peut joindre une photo lui-même (pas de capture automatique).
// Une action proposée par Sam ne part qu'après « Oui, fais-le », exécutée par
// le serveur avec les droits du chauffeur. Fermeture par ✕ uniquement.

import { useEffect, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

type Msg = { from: 'me' | 'sam'; text: string; photo?: boolean }
type Btn = { libelle: string; valeur: string }
type Action = { id: string; libelle: string } | null

async function compress(file: File): Promise<string | null> {
  try {
    const img = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.8).split(',')[1] || null
  } catch { return null }
}

export default function SamAide({ missionId, ecran }: { missionId?: string | null; ecran: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [buttons, setButtons] = useState<Btn[]>([])
  const [action, setAction] = useState<Action>(null)
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs, busy, action, buttons])

  const call = async (body: Record<string, any>) => {
    setBusy(true); setButtons([]); setAction(null); setOpenUrl(null)
    try {
      const r = await fetch('/api/sam/aide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setMsgs(m => [...m, { from: 'sam', text: j.error || t('sam.unavailable') }]); return }
      setMsgs(m => [...m, { from: 'sam', text: j.texte || '…' }])
      setButtons(Array.isArray(j.boutons) ? j.boutons : [])
      setAction(j.action ? { id: j.action.id, libelle: j.action.libelle } : null)
      setOpenUrl(j.open_url || null)
    } catch { setMsgs(m => [...m, { from: 'sam', text: t('sam.unavailable') }]) }
    finally { setBusy(false) }
  }

  const send = async (txt?: string) => {
    const value = (txt ?? text).trim()
    if ((!value && !photo) || busy) return
    setMsgs(m => [...m, { from: 'me', text: value || '📷', photo: !!photo }])
    const p = photo
    setText(''); setPhoto(null)
    // L'écran exact (sous-écran de la fiche) est publié par la fiche elle-même.
    const screen = (typeof window !== 'undefined' && (window as any).__samEcran) || ecran
    await call({ texte: value || '(photo)', ecran: screen, mission_id: missionId || null, photo: p })
  }

  const pickPhoto = async (f: File | undefined) => { if (f) setPhoto(await compress(f)) }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="fixed right-4 bottom-24 z-40 min-h-[52px] px-5 rounded-full bg-brand text-white font-bold shadow-lg flex items-center gap-2"
        aria-label={t('sam.help_button')}>
        <span aria-hidden>🆘</span>{t('sam.help_button')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
          <div className="bg-surface w-full sm:max-w-md h-[92vh] sm:h-[80vh] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden">
            <div className="bg-ink text-surface px-4 py-3 flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-emerald-700 text-white font-bold flex items-center justify-center">S</span>
              <span className="flex-1 min-w-0"><b className="block">{t('sam.title')}</b><span className="text-xs opacity-80">{t('sam.subtitle')}</span></span>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('sam.close')} className="w-11 h-11 rounded-full text-xl">✕</button>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5 bg-surface-2">
              {msgs.length === 0 && <p className="text-ink-secondary text-sm text-center py-6">{t('sam.intro')}</p>}
              {msgs.map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-wrap ${m.from === 'me' ? 'self-end bg-brand text-white rounded-br-md' : 'self-start bg-surface border text-ink rounded-bl-md'}`}>
                  {m.text}{m.photo ? ' 📷' : ''}
                </div>
              ))}
              {busy && <div className="self-start text-ink-muted text-sm italic px-1">{t('sam.typing')}</div>}
              {!busy && buttons.length > 0 && (
                <div className="self-stretch flex flex-col gap-2">
                  {buttons.map(b => (
                    <button key={b.libelle} type="button" onClick={() => send(b.libelle)}
                      className="min-h-[48px] text-left px-4 rounded-xl border-2 border-emerald-700 bg-surface text-ink font-semibold">{b.libelle}</button>
                  ))}
                </div>
              )}
              {!busy && action && (
                <div className="self-stretch rounded-2xl border-2 border-ink bg-surface p-3 flex flex-col gap-2.5">
                  <span className="font-semibold text-ink">{action.libelle}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setMsgs(m => [...m, { from: 'me', text: t('sam.yes_do_it') }]); call({ confirmer: true }) }}
                      className="flex-1 min-h-[48px] rounded-xl bg-emerald-700 text-white font-bold">{t('sam.yes_do_it')}</button>
                    <button type="button" onClick={() => { setMsgs(m => [...m, { from: 'me', text: t('sam.no') }]); call({ confirmer: false }) }}
                      className="flex-1 min-h-[48px] rounded-xl bg-surface-2 border text-ink font-semibold">{t('sam.no')}</button>
                  </div>
                  <span className="text-xs text-ink-secondary">{t('sam.do_it_note')}</span>
                </div>
              )}
              {!busy && openUrl && (
                <a href={openUrl} className="self-stretch min-h-[48px] rounded-xl bg-brand text-white font-bold flex items-center justify-center">{t('sam.open')}</a>
              )}
            </div>

            <div className="p-3 bg-surface border-t flex flex-col gap-2">
              {photo && (
                <div className="flex items-center gap-2 text-sm text-emerald-800">
                  <span>📷 {t('sam.photo_added')}</span>
                  <button type="button" onClick={() => setPhoto(null)} className="underline text-ink-secondary min-h-[44px] px-2">{t('sam.remove_photo')}</button>
                </div>
              )}
              <div className="flex gap-2 items-center">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
                <button type="button" onClick={() => fileRef.current?.click()} aria-label={t('sam.add_photo')}
                  className="w-12 h-12 shrink-0 rounded-full bg-surface-2 border text-xl">📷</button>
                <label htmlFor="sam-input" className="sr-only">{t('sam.placeholder')}</label>
                <input id="sam-input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }}
                  placeholder={t('sam.placeholder')} className="flex-1 min-w-0 h-12 px-4 rounded-full border bg-surface text-ink text-base" />
                <button type="button" onClick={() => send()} disabled={busy || (!text.trim() && !photo)} aria-label={t('sam.send')}
                  className="w-12 h-12 shrink-0 rounded-full bg-brand text-white text-xl disabled:opacity-40">➤</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
