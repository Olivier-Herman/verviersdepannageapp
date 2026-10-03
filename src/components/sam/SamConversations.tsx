'use client'

// « Échange avec Sam / Sonic » (Olivier 03/10/2026) : conversations terminées,
// résumé de 2-3 lignes en tête, puis la conversation complète ; sous chaque
// message albanais, sa traduction française. Rien n'est affiché s'il n'y en a
// pas. Les droits sont vérifiés par le serveur (chaque lecture est journalisée).

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

type Msg = { at: string; role: 'chauffeur' | 'agent'; agent: string | null; canal: string | null; texte: string; texte_fr: string | null; photo: boolean }
type Conv = { id: string; agent: string; chauffeur: string | null; mission_id: string | null; canal: string | null; started_at: string; ended_at: string; end_reason: string | null; summary: string | null; purged_at: string | null; messages: Msg[] }

const fmt = (v: string) => new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function SamConversations({ missionId, mine, all, showDriver }: { missionId?: string; mine?: boolean; all?: boolean; showDriver?: boolean }) {
  const { t } = useT()
  const [convs, setConvs] = useState<Conv[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => {
    const qs = all ? 'all=1' : missionId ? `mission_id=${encodeURIComponent(missionId)}` : 'mine=1'
    fetch(`/api/sam/conversations?${qs}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => setConvs(j?.conversations || [])).catch(() => setConvs([]))
  }, [missionId, mine, all])

  if (!convs || (convs.length === 0 && missionId)) return null
  const reason = (r: string | null) => r === 'action' ? t('sam.conv_end_action') : r === 'releve' ? t('sam.conv_end_releve') : t('sam.conv_end_idle')

  return (
    <section className="bg-surface border rounded-2xl p-4 flex flex-col gap-3">
      <h2 className="text-ink font-bold">{t('sam.conv_title')}</h2>
      {convs.length === 0 && <p className="text-ink-muted text-sm">{t('sam.conv_none')}</p>}
      {convs.map(c => {
        const isOpen = open.has(c.id)
        return (
          <article key={c.id} className="border rounded-xl p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
              <b className="text-ink text-sm">{c.agent}</b>
              {showDriver && c.chauffeur && <span>· {c.chauffeur}</span>}
              <span>· {fmt(c.started_at)} → {fmt(c.ended_at)}</span>
              {c.canal && <span>· {c.canal === 'telegram' ? 'Telegram' : 'app'}</span>}
              <span>· {reason(c.end_reason)}</span>
            </div>
            <p className="text-ink text-sm">{c.summary || t('sam.conv_summary_pending')}</p>
            {c.purged_at ? <p className="text-ink-muted text-xs">{t('sam.conv_purged')}</p> : (
              <>
                <button type="button" onClick={() => setOpen(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })}
                  className="self-start min-h-[44px] text-sm font-semibold text-brand">{isOpen ? '▾' : '▸'} {t('sam.conv_show')} ({c.messages.length})</button>
                {isOpen && (
                  <div className="flex flex-col gap-2 bg-surface-2 rounded-xl p-3">
                    {c.messages.map((m, i) => (
                      <div key={i} className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${m.role === 'chauffeur' ? 'self-end bg-brand/10 text-ink' : 'self-start bg-surface border text-ink'}`}>
                        <span className="block text-[11px] text-ink-muted">{m.role === 'chauffeur' ? (c.chauffeur || t('sam.conv_driver')) : m.agent} · {fmt(m.at)}{m.photo ? ' · 📷' : ''}</span>
                        <span className="whitespace-pre-wrap">{m.texte}</span>
                        {m.texte_fr && m.texte_fr.trim() !== m.texte.trim() && <span className="block mt-1 pt-1 border-t text-ink-secondary italic whitespace-pre-wrap">🇫🇷 {m.texte_fr}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        )
      })}
    </section>
  )
}
