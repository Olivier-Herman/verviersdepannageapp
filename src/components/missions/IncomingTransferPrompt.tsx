'use client'

// Chauffeur B : un collègue lui transfère sa mission (Olivier 18/10/2026). Fenêtre bien
// distincte « 🔁 TRANSFERT DE <A> » ; la mission ne lui passe qu'en cliquant « Accepter ».
// Avant, il ne voit que le type, l'assistance et la commune (comme une mission verrouillée).
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useT } from '@/lib/i18n/I18nProvider'

type Tr = { id: string; mission_number: number | null; mission_type: string | null; source: string | null; incident_city: string | null; transfer_reason: string | null; from_name: string | null }

export default function IncomingTransferPrompt() {
  const { t } = useT()
  const { status } = useSession()
  const [list, setList] = useState<Tr[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (status !== 'authenticated') return
    let off = false
    const load = () => { if (document.visibilityState === 'visible') fetch('/api/missions/transfers/incoming', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (!off && j) setList(j.transfers || []) }).catch(() => {}) }
    load(); const iv = setInterval(load, 20_000)
    const onVis = () => load(); document.addEventListener('visibilitychange', onVis)
    return () => { off = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [status])
  const tr = list[0]
  if (!tr) return null
  const answer = async (action: 'accept' | 'refuse') => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/${tr.id}/transfer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || t('pause_transfer.error'))
      setList(l => l.slice(1))
      if (action === 'accept') window.location.href = `/mission/${tr.id}`
    } catch (e: any) { setErr(e?.message || t('pause_transfer.error')) } finally { setBusy(false) }
  }
  const from = tr.from_name || '—'
  return (
    <div className="fixed inset-0 z-[420] bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('pause_transfer.in_badge', { name: from })}>
      <div className="w-full max-w-sm rounded-3xl border-[3px] border-blue-600 bg-white text-slate-900 p-5 shadow-2xl">
        <span className="inline-block rounded-full bg-blue-600 text-white text-xs font-extrabold px-3 py-1">{t('pause_transfer.in_badge', { name: from })}</span>
        <p className="mt-3 font-extrabold text-lg">{t('pause_transfer.in_text', { name: from })}</p>
        {tr.transfer_reason && <p className="text-sm text-slate-700">{tr.transfer_reason}</p>}
        <p className="mt-2 text-sm text-slate-800">{[tr.mission_type, tr.source, tr.incident_city].filter(Boolean).join(' · ')}</p>
        <p className="mt-2 text-xs text-slate-600">{t('pause_transfer.in_hint')}</p>
        <button disabled={busy} onClick={() => answer('accept')} className="mt-4 w-full min-h-[52px] rounded-2xl bg-green-700 text-white font-extrabold disabled:opacity-50">{t('pause_transfer.btn_accept')}</button>
        <button disabled={busy} onClick={() => answer('refuse')} className="mt-2 w-full min-h-[46px] rounded-2xl border border-slate-300 text-slate-800 font-bold">{t('pause_transfer.btn_refuse')}</button>
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      </div>
    </div>
  )
}
