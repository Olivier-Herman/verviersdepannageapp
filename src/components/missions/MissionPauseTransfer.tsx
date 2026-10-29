'use client'

// Pause et transfert d'une mission, côté chauffeur (Olivier 18/10/2026, maquette validée).
// « ⏸ Je reviens plus tard » (heure de retour + motif) et « 🔁 Transférer à un autre chauffeur »
// (après l'avoir appelé ; la mission ne lui passe qu'à son acceptation). Fermeture des volets
// par ✕ uniquement. Textes fr + sq (pause_transfer.*).
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

type M = { id: string; status: string; loaded_at?: string | null; paused_at?: string | null; pause_until?: string | null; pause_reason?: string | null; transfer_to?: string | null }

const fmtWhen = (iso: string) => new Intl.DateTimeFormat('fr-BE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export default function MissionPauseTransfer({ mission, onChanged }: { mission: M; onChanged: () => void }) {
  const { t } = useT()
  const [sheet, setSheet] = useState<null | 'pause' | 'transfer'>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toName, setToName] = useState<string | null>(null)
  const active = ['accepted', 'on_way', 'on_site', 'in_progress'].includes(mission.status) && !mission.loaded_at
  const canTransfer = (active || mission.status === 'assigned') && !mission.loaded_at

  useEffect(() => {
    if (!mission.transfer_to) { setToName(null); return }
    fetch(`/api/missions/${mission.id}/transfer`, { cache: 'no-store' }).then(r => r.json()).then(j => setToName((j.drivers || []).find((d: any) => d.id === mission.transfer_to)?.name || null)).catch(() => {})
  }, [mission.id, mission.transfer_to])

  const call = async (url: string, body: any) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || t('pause_transfer.error'))
      // Remise au dispatch : la mission n'est plus à lui → retour à « Mes missions » (29/10/2026).
      if (body?.action === 'release') { window.location.href = '/mission?remise=1'; return }
      setSheet(null); onChanged()
    } catch (e: any) { setErr(e?.message || t('pause_transfer.error')) } finally { setBusy(false) }
  }

  if (mission.paused_at) {
    return (
      <div className="relative rounded-2xl border-2 border-amber-500 bg-amber-50 p-4 text-amber-950 overflow-hidden">
        <span className="absolute right-3 top-3 -rotate-12 border-[3px] border-amber-600 text-amber-700 font-extrabold tracking-[.12em] text-sm px-2 py-0.5 rounded-md bg-white/70">{t('pause_transfer.stamp')}</span>
        <p className="pr-24 text-sm">{t('pause_transfer.paused_until', { when: mission.pause_until ? fmtWhen(mission.pause_until) : '—' })}{mission.pause_reason ? ` · ${mission.pause_reason}` : ''}</p>
        <button disabled={busy} onClick={() => call(`/api/missions/${mission.id}/pause`, { action: 'resume' })} className="mt-3 w-full min-h-[52px] rounded-2xl bg-green-700 text-white font-extrabold disabled:opacity-50">{t('pause_transfer.btn_resume')}</button>
        <button disabled={busy} onClick={() => setSheet('pause')} className="mt-2 w-full min-h-[46px] rounded-2xl border border-amber-700 bg-white text-amber-900 font-bold text-sm">{t('pause_transfer.btn_change')}</button>
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        {sheet === 'pause' && <PauseSheet initial={mission.pause_until} busy={busy} onClose={() => setSheet(null)} onSubmit={(until, reason, mode) => call(`/api/missions/${mission.id}/pause`, { action: mode === 'dispatch' ? 'release' : 'pause', until, reason })} />}
      </div>
    )
  }

  if (mission.transfer_to) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-blue-600 bg-blue-50 p-4 text-blue-950">
        <p className="text-sm">{t('pause_transfer.waiting', { name: toName || '…' })}</p>
        <button disabled={busy} onClick={() => call(`/api/missions/${mission.id}/transfer`, { action: 'cancel' })} className="mt-3 w-full min-h-[46px] rounded-2xl border border-blue-700 bg-white text-blue-900 font-bold text-sm disabled:opacity-50">{t('pause_transfer.btn_cancel_tr')}</button>
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      </div>
    )
  }

  if (!canTransfer) return null
  return (
    <div className="space-y-2">
      {active && <button onClick={() => setSheet('pause')} className="w-full min-h-[50px] rounded-2xl border-2 border-amber-600 bg-surface text-amber-700 font-extrabold">{t('pause_transfer.btn_pause')}</button>}
      <button onClick={() => setSheet('transfer')} className="w-full min-h-[46px] rounded-2xl border border bg-surface text-ink-secondary font-semibold text-sm">{t('pause_transfer.btn_transfer')}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {sheet === 'pause' && <PauseSheet busy={busy} onClose={() => setSheet(null)} onSubmit={(until, reason, mode) => call(`/api/missions/${mission.id}/pause`, { action: mode === 'dispatch' ? 'release' : 'pause', until, reason })} />}
      {sheet === 'transfer' && <TransferSheet missionId={mission.id} busy={busy} onClose={() => setSheet(null)} onSubmit={(to, reason) => call(`/api/missions/${mission.id}/transfer`, { action: 'request', to_user_id: to, reason, called: true })} />}
    </div>
  )
}

function Sheet({ title, text, onClose, children }: { title: string; text: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useT()
  return (
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full bg-white text-slate-900 rounded-t-3xl p-5 pb-8 relative" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}>
        <button onClick={onClose} aria-label={t('pause_transfer.close')} className="absolute top-3 right-3 w-11 h-11 rounded-xl border border-slate-300 text-lg">✕</button>
        <h3 className="text-lg font-extrabold pr-12">{title}</h3>
        <p className="text-sm text-slate-700 mt-1 mb-3">{text}</p>
        {children}
      </div>
    </div>
  )
}

function PauseSheet({ initial, busy, onClose, onSubmit }: { initial?: string | null; busy: boolean; onClose: () => void; onSubmit: (untilIso: string, reason: string | null, mode: 'garder' | 'dispatch') => void }) {
  const { t } = useT()
  // Je la garde (comme avant) ou je la remets au dispatch (Olivier 29/10/2026, maquette validée).
  const [mode, setMode] = useState<'garder' | 'dispatch'>('garder')
  const opt = (on: boolean) => `w-full flex gap-3 items-start text-left rounded-2xl border-2 p-3 min-h-[64px] ${on ? 'border-amber-600 bg-amber-50' : 'border-slate-200 bg-white'}`
  const start = initial ? new Date(initial) : new Date(Date.now() + 2 * 3600_000)
  const [d, setD] = useState(localDate(start)), [h, setH] = useState(localTime(start)), [reason, setReason] = useState('')
  const quick = (k: 'h1' | 'h2' | 'd14' | 'tm8') => {
    const n = new Date()
    const x = k === 'h1' ? new Date(n.getTime() + 3600_000) : k === 'h2' ? new Date(n.getTime() + 7200_000) : k === 'd14' ? new Date(n.getFullYear(), n.getMonth(), n.getDate(), 14, 0) : new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 8, 0)
    setD(localDate(x)); setH(localTime(x))
  }
  const chip = 'min-h-[44px] px-3 rounded-xl border border-slate-300 bg-slate-50 font-bold text-sm'
  return (
    <Sheet title={t('pause_transfer.pause_title')} text={t('pause_transfer.pause_text2')} onClose={onClose}>
      <div className="space-y-2 mb-3">
        <button type="button" onClick={() => setMode('garder')} className={opt(mode === 'garder')}>
          <span className="text-xl leading-none">🙋</span>
          <span><b className="block text-sm text-slate-900">{t('pause_transfer.mode_keep')}</b><span className="text-xs text-slate-700">{t('pause_transfer.mode_keep_txt')}</span></span>
        </button>
        <button type="button" onClick={() => setMode('dispatch')} className={opt(mode === 'dispatch')}>
          <span className="text-xl leading-none">📤</span>
          <span><b className="block text-sm text-slate-900">{t('pause_transfer.mode_dispatch')}</b><span className="text-xs text-slate-700">{t('pause_transfer.mode_dispatch_txt')}</span></span>
        </button>
      </div>
      <p className="text-xs font-bold text-slate-700 mb-1">{mode === 'garder' ? t('pause_transfer.when_keep') : t('pause_transfer.when_dispatch')}</p>
      <div className="flex flex-wrap gap-2">
        <button className={chip} onClick={() => quick('h1')}>{t('pause_transfer.in_1h')}</button>
        <button className={chip} onClick={() => quick('h2')}>{t('pause_transfer.in_2h')}</button>
        <button className={chip} onClick={() => quick('d14')}>{t('pause_transfer.at_14')}</button>
        <button className={chip} onClick={() => quick('tm8')}>{t('pause_transfer.tomorrow_8')}</button>
      </div>
      <div className="flex gap-2 mt-3">
        <input type="date" value={d} onChange={e => setD(e.target.value)} className="flex-1 min-w-0 min-h-[46px] rounded-xl border border-slate-300 px-2" />
        <input type="time" value={h} onChange={e => setH(e.target.value)} className="flex-1 min-w-0 min-h-[46px] rounded-xl border border-slate-300 px-2" />
      </div>
      <select value={reason} onChange={e => setReason(e.target.value)} className="mt-2 w-full min-h-[46px] rounded-xl border border-slate-300 px-2 bg-white">
        <option value="">{t('pause_transfer.reason')}</option>
        {(['r_piece', 'r_client', 'r_garage', 'r_urgent'] as const).map(k => <option key={k} value={t(`pause_transfer.${k}`)}>{t(`pause_transfer.${k}`)}</option>)}
      </select>
      <button disabled={busy || !d || !h} onClick={() => onSubmit(new Date(`${d}T${h}`).toISOString(), reason || null, mode)} className="mt-3 w-full min-h-[52px] rounded-2xl bg-amber-600 text-white font-extrabold disabled:opacity-50">{mode === 'dispatch' ? t('pause_transfer.btn_do_release') : t('pause_transfer.btn_do_pause')}</button>
    </Sheet>
  )
}

function TransferSheet({ missionId, busy, onClose, onSubmit }: { missionId: string; busy: boolean; onClose: () => void; onSubmit: (to: string, reason: string) => void }) {
  const { t } = useT()
  const [drivers, setDrivers] = useState<{ id: string; name: string; occupe: boolean }[] | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [reason, setReason] = useState(t('pause_transfer.t_truck'))
  const [called, setCalled] = useState(false)
  useEffect(() => { fetch(`/api/missions/${missionId}/transfer`, { cache: 'no-store' }).then(r => r.json()).then(j => setDrivers(j.drivers || [])).catch(() => setDrivers([])) }, [missionId])
  return (
    <Sheet title={t('pause_transfer.transfer_title')} text={t('pause_transfer.transfer_text')} onClose={onClose}>
      <div className="grid gap-2 max-h-[38vh] overflow-y-auto">
        {drivers === null && <p className="text-sm text-slate-600">…</p>}
        {(drivers || []).map(d => (
          <button key={d.id} onClick={() => setTo(d.id)} aria-pressed={to === d.id}
            className={`flex items-center justify-between min-h-[52px] px-3 rounded-xl border font-bold ${to === d.id ? 'border-2 border-blue-600 bg-blue-50' : 'border-slate-300 bg-slate-50'}`}>
            <span>{d.name}</span><span className={`text-xs font-bold ${d.occupe ? 'text-blue-700' : 'text-green-700'}`}>{d.occupe ? t('pause_transfer.busy') : t('pause_transfer.free')}</span>
          </button>
        ))}
      </div>
      <select value={reason} onChange={e => setReason(e.target.value)} className="mt-3 w-full min-h-[46px] rounded-xl border border-slate-300 px-2 bg-white">
        {(['t_truck', 't_far', 't_end', 't_other'] as const).map(k => <option key={k} value={t(`pause_transfer.${k}`)}>{t(`pause_transfer.${k}`)}</option>)}
      </select>
      <label className="flex items-center gap-3 min-h-[48px] mt-2 font-bold text-sm"><input type="checkbox" checked={called} onChange={e => setCalled(e.target.checked)} className="w-6 h-6" />{t('pause_transfer.called')}</label>
      <button disabled={busy || !to || !called} onClick={() => to && onSubmit(to, reason)} className="mt-2 w-full min-h-[52px] rounded-2xl bg-red-700 text-white font-extrabold disabled:opacity-45">{t('pause_transfer.btn_propose')}</button>
    </Sheet>
  )
}
