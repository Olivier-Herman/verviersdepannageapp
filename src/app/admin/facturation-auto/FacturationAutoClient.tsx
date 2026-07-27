'use client'

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'

type Rules = Record<string, { dsp?: boolean; rem?: boolean }>
interface Source { key: string; label: string }

export default function FacturationAutoClient(props: {
  userRole: string; userName: string; userEmail?: string; userModules: string[]
}) {
  const [rules, setRules]     = useState<Rules>({})
  const [sources, setSources] = useState<Source[]>([])
  const [delay, setDelay]     = useState(2)
  const [stats, setStats]     = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [toast, setToast]     = useState<string | null>(null)
  const [q, setQ]             = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/auto-invoice-rules')
      const j = await r.json()
      if (r.ok) { setRules(j.rules || {}); setSources(j.sources || []); setDelay(j.delayHours ?? 2) }
      const s = await fetch('/api/admin/auto-invoice-stats?days=30').then(x => x.json()).catch(() => null)
      if (s && !s.error) setStats(s)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function saveDelay(h: number) {
    setBusy('delay')
    try {
      const r = await fetch('/api/admin/auto-invoice-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delayHours: h }),
      })
      if (r.ok) { setDelay(h); flash(`✅ Délai : ${h}h`) } else flash('⚠ Échec')
    } catch { flash('⚠ Erreur réseau') } finally { setBusy(null) }
  }

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2000) }

  async function toggle(source: string, type: 'dsp' | 'rem', enabled: boolean) {
    const key = `${source}:${type}`
    setBusy(key)
    // MAJ optimiste
    setRules(prev => ({ ...prev, [source]: { ...(prev[source] || {}), [type]: enabled } }))
    try {
      const r = await fetch('/api/admin/auto-invoice-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, type, enabled }),
      })
      const j = await r.json()
      if (!r.ok) { flash(`⚠ ${j.error || 'Échec'}`); await load() }
      else { setRules(j.rules || {}); flash(enabled ? '✅ Activé' : 'Désactivé') }
    } catch { flash('⚠ Erreur réseau'); await load() } finally { setBusy(null) }
  }

  const visible = sources.filter(s =>
    !q.trim() || `${s.label} ${s.key}`.toLowerCase().includes(q.toLowerCase()))
  const activeCount = Object.values(rules).reduce((n, r) => n + (r.dsp ? 1 : 0) + (r.rem ? 1 : 0), 0)

  const Switch = ({ on, disabled, onClick }: { on: boolean; disabled: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`relative w-12 h-7 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-ink-faint/40'}`}>
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition ${on ? 'translate-x-5' : ''}`} />
    </button>
  )

  return (
    <AppShell title="Facturation automatique" userRole={props.userRole} userName={props.userName} userEmail={props.userEmail} userModules={props.userModules}>
      <main className="p-4 max-w-3xl mx-auto space-y-4">
        {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] bg-surface border shadow-lg rounded-xl px-4 py-2 text-sm font-medium text-ink">{toast}</div>}

        <div>
          <h1 className="text-ink text-lg font-bold">🧾 Facturation automatique par source</h1>
          <p className="text-ink-muted text-sm mt-1">
            Quand c'est activé pour une source + un type, la <b>facture brouillon Odoo</b> est créée
            <b> automatiquement à la clôture</b> de la mission.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-amber-800 text-xs">
          ⚠ S'applique <b>uniquement</b> aux missions <b>sèches</b> (une seule fiche, pas de relivraison) et
          <b> uniquement si un vrai tarif est présent</b> sur la fiche. Jamais pour trajet à vide, transport ou missions combinées.
        </div>

        {/* Délai après clôture */}
        <div className="bg-surface border rounded-xl p-3 flex items-center gap-3 flex-wrap">
          <span className="text-ink text-sm font-medium">⏱️ Facturer <b>{delay}h</b> après la clôture</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4].map(h => (
              <button key={h} type="button" onClick={() => saveDelay(h)} disabled={busy === 'delay'}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-50 ${delay === h ? 'bg-brand text-white' : 'bg-surface-2 border text-ink-secondary'}`}>
                {h}h
              </button>
            ))}
          </div>
          <span className="text-ink-faint text-[11px]">fenêtre de correction avant facturation auto</span>
        </div>

        {/* Statistiques de couverture (30 j) */}
        {stats && (
          <div className="bg-surface border rounded-2xl p-4 space-y-2">
            <p className="text-ink text-sm font-semibold">📊 Couverture facturation (30 jours)</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2">
                <p className="text-emerald-700 text-xl font-bold">{stats.auto}</p>
                <p className="text-emerald-800 text-[11px]">🤖 Système (auto)</p>
              </div>
              <div className="bg-surface-2 border rounded-xl p-2">
                <p className="text-ink text-xl font-bold">{stats.manualTotal}</p>
                <p className="text-ink-muted text-[11px]">👤 Manuel</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-2">
                <p className="text-blue-700 text-xl font-bold">{stats.auto_pct}%</p>
                <p className="text-blue-800 text-[11px]">auto / total</p>
              </div>
            </div>
            {stats.manual?.length > 0 && (
              <div className="text-ink-secondary text-xs pt-1 border-t">
                Manuel par personne : {stats.manual.map((m: any) => `${m.name} (${m.count})`).join(' · ')}
              </div>
            )}
            {stats.lastRun && (
              <p className="text-ink-faint text-[11px]">Dernière passe auto : {stats.lastRun.invoiced} facturée(s) · {stats.lastRun.noTariff || 0} sans tarif · {stats.lastRun.combined || 0} combinée(s)</p>
            )}
          </div>
        )}

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Rechercher une source…"
          className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand" />

        {loading ? (
          <p className="text-ink-muted py-8 text-center">Chargement…</p>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2 border-b text-ink-muted text-xs uppercase tracking-wide">
              <span>Source</span><span className="w-16 text-center">DSP</span><span className="w-16 text-center">REM</span>
            </div>
            {visible.map(s => {
              const r = rules[s.key] || {}
              return (
                <div key={s.key} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-3 border-b last:border-0">
                  <div className="min-w-0">
                    <p className="text-ink text-sm font-medium truncate">{s.label}</p>
                    <p className="text-ink-faint text-[11px] font-mono truncate">{s.key}</p>
                  </div>
                  <div className="w-16 flex justify-center"><Switch on={!!r.dsp} disabled={busy === `${s.key}:dsp`} onClick={() => toggle(s.key, 'dsp', !r.dsp)} /></div>
                  <div className="w-16 flex justify-center"><Switch on={!!r.rem} disabled={busy === `${s.key}:rem`} onClick={() => toggle(s.key, 'rem', !r.rem)} /></div>
                </div>
              )
            })}
            {visible.length === 0 && <p className="text-ink-muted text-sm text-center py-6">Aucune source.</p>}
          </div>
        )}

        <p className="text-ink-faint text-xs text-center">{activeCount} règle{activeCount > 1 ? 's' : ''} active{activeCount > 1 ? 's' : ''}.</p>
      </main>
    </AppShell>
  )
}
