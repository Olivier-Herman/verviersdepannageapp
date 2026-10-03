'use client'

// « Relier Telegram » dans le profil (Olivier 03/10/2026) : lien à usage unique,
// valable 15 minutes, vers @VerviersDepannageBot. Telegram ne sert qu'à l'aide
// de Sam ; les notifications de mission restent dans VD Soft.

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

export default function TelegramLinkCard() {
  const { t } = useT()
  const [linked, setLinked] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(false)

  const load = () => fetch('/api/telegram/link', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => setLinked(!!j?.linked)).catch(() => setLinked(false))
  useEffect(() => { load() }, [])
  // Au retour de Telegram, l'état se met à jour tout seul.
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') load() }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f) }, [])

  const link = async () => {
    // Fenêtre ouverte DANS le clic (un window.open après un await est bloqué).
    const w = window.open('', '_blank')
    setBusy(true)
    try {
      const j = await fetch('/api/telegram/link', { method: 'POST' }).then(r => r.json())
      if (j?.url) { if (w) w.location.href = j.url; else window.location.href = j.url; setHint(true) }
      else w?.close()
    } catch { w?.close() } finally { setBusy(false) }
  }
  const unlink = async () => { setBusy(true); try { await fetch('/api/telegram/link', { method: 'DELETE' }); setLinked(false) } finally { setBusy(false) } }

  return (
    <div className="bg-surface border rounded-2xl p-5 flex flex-col gap-3">
      <h2 className="text-ink font-bold">{t('sam.tg_title')}</h2>
      {linked ? (
        <>
          <p className="text-emerald-800 text-sm font-semibold">✓ {t('sam.tg_linked')}</p>
          <button type="button" onClick={unlink} disabled={busy} className="min-h-[44px] rounded-xl border bg-surface-2 text-ink font-semibold disabled:opacity-50">{t('sam.tg_unlink')}</button>
        </>
      ) : (
        <>
          <p className="text-ink-secondary text-sm">{t('sam.tg_intro')}</p>
          <button type="button" onClick={link} disabled={busy || linked === null} className="min-h-[48px] rounded-xl bg-brand text-white font-bold disabled:opacity-50">{t('sam.tg_link')}</button>
          <p className="text-ink-muted text-xs">{hint ? t('sam.tg_open_hint') : t('sam.tg_link_note')}</p>
        </>
      )}
      <p className="text-ink-muted text-xs">{t('sam.tg_only_help')}</p>
    </div>
  )
}
