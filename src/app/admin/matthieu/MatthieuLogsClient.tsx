'use client'
// src/app/admin/matthieu/MatthieuLogsClient.tsx
// Supervision des conversations « La tête à Matthieu » (superadmin).

import { useEffect, useState } from 'react'
import { Wrench, RefreshCw, X } from 'lucide-react'

const fmt = (s: string) => { try { return new Date(s).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return s } }

export default function MatthieuLogsClient() {
  const [convs, setConvs]   = useState<any[]>([])
  const [loading, setLoad]  = useState(true)
  const [open, setOpen]     = useState<any | null>(null)
  const [thread, setThread] = useState<any[]>([])
  const [tLoad, setTLoad]   = useState(false)

  const load = () => { setLoad(true); fetch('/api/admin/mecano/conversations', { cache: 'no-store' }).then(r => r.json()).then(j => setConvs(j.conversations || [])).finally(() => setLoad(false)) }
  useEffect(() => { load() }, [])

  const openConv = async (c: any) => {
    setOpen(c); setThread([]); setTLoad(true)
    try { const j = await (await fetch(`/api/admin/mecano/conversations?id=${encodeURIComponent(c.conversation_id)}`, { cache: 'no-store' })).json(); setThread(j.messages || []) } finally { setTLoad(false) }
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-500"><Wrench size={20} /></div>
        <div className="flex-1">
          <h1 className="text-ink text-xl font-semibold">La tête à Matthieu — conversations</h1>
          <p className="text-ink-muted text-sm">Supervision de tous les échanges avec l'assistant mécano.</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-surface-2" title="Recharger"><RefreshCw size={16} /></button>
      </div>

      {loading ? <p className="text-ink-muted text-sm">Chargement…</p>
        : convs.length === 0 ? <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">Aucune conversation pour l'instant.</div>
        : (
        <div className="flex flex-col gap-2">
          {convs.map(c => (
            <button key={c.conversation_id} onClick={() => openConv(c)} className="bg-surface border rounded-2xl p-3.5 text-left hover:border-indigo-500/40 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ink text-sm">{c.user_real || c.user_name || '—'}</span>
                  {c.user_email && <span className="text-[11px] text-ink-muted">{c.user_email}</span>}
                  {c.brand && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">🔧 {c.brand} {c.model || ''}</span>}
                  {c.mission_number && <span className="text-[11px] text-ink-muted">#{c.mission_number}{c.plate ? ` · ${c.plate}` : ''}</span>}
                  {c.archived ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-ink-muted/10 text-ink-muted">archivée</span>
                    : c.mission_id ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">active</span> : null}
                </div>
                <p className="text-ink-secondary text-xs mt-0.5 truncate">{c.last_user_msg || '…'}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-ink-muted text-[11px]">{fmt(c.last_at)}</p>
                <p className="text-ink-muted text-[11px]">{c.count} msg</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Fil */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(null)}>
          <div className="bg-surface border rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b">
              <Wrench size={16} className="text-indigo-500" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink text-sm">{open.user_real || open.user_name} · {open.brand} {open.model}</p>
                <p className="text-ink-muted text-[11px]">{open.user_email ? `${open.user_email} · ` : ''}{open.mission_number ? `Mission #${open.mission_number}` : 'Bureau'} · {open.count} messages</p>
              </div>
              <button onClick={() => setOpen(null)} className="p-1.5 text-ink-muted hover:text-ink">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-surface-2">
              {tLoad ? <p className="text-ink-muted text-sm text-center">Chargement…</p> : thread.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand text-white' : 'bg-surface border text-ink'}`}>{m.content}{m.images_count ? '  📷' : ''}</div>
                  {(m.attachments || []).map((a: any, j: number) => (
                    <span key={j} className="mt-1 text-[11px] text-indigo-600 dark:text-indigo-300">📄 {a.title}</span>
                  ))}
                  <span className="text-[10px] text-ink-muted mt-0.5">{fmt(m.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
