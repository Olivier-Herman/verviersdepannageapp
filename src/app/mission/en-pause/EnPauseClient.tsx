'use client'
// Liste des missions remises au dispatch en pause : tout chauffeur peut en prendre une (Olivier 29/10/2026).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'
import { pauseWhen } from '@/components/missions/PauseBadge'

type P = { id: string; mission_number: number | null; source: string | null; mission_type: string | null; vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; incident_address: string | null; incident_city: string | null; pause_until: string | null; pause_reason: string | null; pause_released_at: string | null; released_by: string | null; km: number | null }

export function PauseTabs({ active, count }: { active: 'mine' | 'paused'; count: number }) {
  const { t } = useT()
  const cls = (on: boolean) => `flex-1 min-h-[44px] rounded-xl border text-sm font-bold flex items-center justify-center ${on ? 'bg-amber-500 border-amber-500 text-amber-950' : 'bg-surface text-ink'}`
  return (
    <div className="flex gap-2">
      <Link href="/mission" className={cls(active === 'mine')}>{t('pause_transfer.tab_mine')}</Link>
      <Link href="/mission/en-pause" className={cls(active === 'paused')}>{t('pause_transfer.tab_paused', { n: count })}</Link>
    </div>
  )
}

export default function EnPauseClient() {
  const { t } = useT()
  const [list, setList] = useState<P[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => fetch('/api/missions/en-pause', { cache: 'no-store' }).then(r => r.json()).then(j => setList(j.missions || [])).catch(() => setErr(t('pause_transfer.error')))
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const take = async (m: P) => {
    setBusy(m.id); setErr('')
    try {
      const r = await fetch(`/api/missions/${m.id}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'take' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || t('pause_transfer.error'))
      window.location.href = `/mission/${m.id}?reprise=1`
    } catch (e: any) { setErr(e?.message || t('pause_transfer.error')); setBusy(null); load() }
  }

  return (
    <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto space-y-4 pb-24">
      <PauseTabs active="paused" count={list?.length ?? 0} />
      <div>
        <h1 className="text-ink text-lg font-bold">{t('pause_transfer.paused_title')}</h1>
        <p className="text-ink-muted text-xs">{t('pause_transfer.paused_sub')}</p>
      </div>
      {err && <p className="text-red-600 dark:text-red-400 text-sm font-semibold">{err}</p>}
      {!list && !err && <p className="text-ink-muted text-sm">…</p>}
      {list && list.length === 0 && <p className="text-ink-muted text-sm text-center py-10">{t('pause_transfer.paused_empty')}</p>}
      {list?.map(m => (
        <div key={m.id} className="bg-surface border-2 border-orange-500 rounded-2xl p-4">
          <span className="inline-block bg-amber-400 text-amber-950 text-[11px] font-extrabold rounded px-1.5 py-0.5">⏸ {t('pause_transfer.stamp')}</span>
          <p className="text-ink font-bold mt-1">{m.vehicle_plate || '—'} · {m.source || ''} · {m.mission_type || ''}</p>
          <p className="text-ink-secondary text-sm">{m.incident_address || m.incident_city || ''}{m.km != null ? ` · ${m.km} km` : ''}</p>
          <p className="text-ink-muted text-xs mt-1">
            {t('pause_transfer.paused_by', { name: m.released_by || '—', when: m.pause_released_at ? pauseWhen(m.pause_released_at) : '' })}
            {m.pause_reason ? ` · ${m.pause_reason}` : ''} · {t('pause_transfer.resume_from', { when: pauseWhen(m.pause_until) })}
          </p>
          <button type="button" disabled={!!busy} onClick={() => take(m)} className="mt-3 w-full min-h-[52px] rounded-2xl bg-green-700 text-white font-extrabold disabled:opacity-50">
            {busy === m.id ? '…' : t('pause_transfer.btn_take')}
          </button>
        </div>
      ))}
    </div>
  )
}
