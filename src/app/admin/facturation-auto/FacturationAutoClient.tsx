'use client'

import { useEffect, useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { AUTO_INVOICE_TYPES } from '@/lib/facturation/auto-invoice'

type Rules = Record<string, Record<string, boolean>>
interface Source { key: string; label: string }

export default function FacturationAutoClient(props: {
  userRole: string; userName: string; userEmail?: string; userModules: string[]
}) {
  const [rules, setRules]     = useState<Rules>({})
  const [sources, setSources] = useState<Source[]>([])
  const [delay, setDelay]     = useState(2)
  const [autos, setAutos]     = useState<{ allianzAutoClose: boolean; comexAutoAccept: boolean }>({ allianzAutoClose: true, comexAutoAccept: true })
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
      if (r.ok) { setRules(j.rules || {}); setSources(j.sources || []); setDelay(j.delayHours ?? 2); if (j.automations) setAutos(j.automations) }
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

  async function toggleAutomation(automation: 'allianzAutoClose' | 'comexAutoAccept', enabled: boolean) {
    setBusy(automation)
    setAutos(prev => ({ ...prev, [automation]: enabled }))   // optimiste
    try {
      const r = await fetch('/api/admin/auto-invoice-rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation, enabled }),
      })
      if (!r.ok) { flash('⚠ Échec'); await load() } else flash(enabled ? '✅ Activé' : 'Désactivé')
    } catch { flash('⚠ Erreur réseau'); await load() } finally { setBusy(null) }
  }

  async function toggle(source: string, type: string, enabled: boolean) {
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
  const activeCount = Object.values(rules).reduce((n, r) => n + Object.values(r || {}).filter(Boolean).length, 0)

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
          ⚠ Active le type que tu veux, par source. S'applique <b>uniquement</b> aux missions <b>sèches</b>
          (une seule fiche, pas de relivraison liée) et <b>uniquement si un vrai tarif est présent</b> sur la fiche.
          Les missions <b>combinées (REM+REL)</b> sont toujours exclues.
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

        {/* Automatisations de validation (crons) — pause/reprise via toggle */}
        <div className="bg-surface border rounded-2xl p-4 space-y-3">
          <p className="text-ink text-sm font-semibold">⚙️ Automatisations de validation</p>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ink text-sm font-medium">🔵 Auto-clôture Allianz</p>
              <p className="text-ink-faint text-[11px]">Clôture Hexalite auto à <b>fin de mission + 60 min</b> (toutes les 15 min).</p>
            </div>
            <Switch on={autos.allianzAutoClose} disabled={busy === 'allianzAutoClose'} onClick={() => toggleAutomation('allianzAutoClose', !autos.allianzAutoClose)} />
          </div>
          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <div className="min-w-0">
              <p className="text-ink text-sm font-medium">🟠 Auto-validation Touring COMEX</p>
              <p className="text-ink-faint text-[11px]">Valide les dossiers dont le <b>tarif matche</b> (verdict OK), toutes les heures.</p>
            </div>
            <Switch on={autos.comexAutoAccept} disabled={busy === 'comexAutoAccept'} onClick={() => toggleAutomation('comexAutoAccept', !autos.comexAutoAccept)} />
          </div>
        </div>

        {/* Statistiques de couverture (30 j) — détail par facturier */}
        {stats && (
          <div className="bg-surface border rounded-2xl p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-ink text-sm font-semibold">📊 Qui facture ? (30 jours)</p>
              <p className="text-ink-muted text-xs">{stats.total} facture{stats.total > 1 ? 's' : ''} · {stats.auto_pct}% auto</p>
            </div>
            {(() => {
              const rows = [
                { key: 'auto', name: '🤖 Système (auto)', count: stats.auto, hi: true },
                ...(stats.manual || []).map((m: any) => ({ key: m.user_id, name: `👤 ${m.name}`, count: m.count, hi: false })),
              ].filter(r => r.count > 0)
              const max = Math.max(1, ...rows.map(r => r.count))
              return (
                <div className="space-y-1.5">
                  {rows.map(r => {
                    const pct = stats.total ? Math.round((r.count / stats.total) * 100) : 0
                    return (
                      <div key={r.key} className="flex items-center gap-2">
                        <span className="w-40 text-sm text-ink truncate">{r.name}</span>
                        <div className="flex-1 h-5 bg-surface-2 rounded-md overflow-hidden">
                          <div className={`h-full rounded-md ${r.hi ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                        </div>
                        <span className="w-10 text-right text-sm font-bold text-ink tabular-nums">{r.count}</span>
                        <span className="w-12 text-right text-xs text-ink-muted tabular-nums">{pct}%</span>
                      </div>
                    )
                  })}
                  {rows.length === 0 && <p className="text-ink-muted text-sm">Aucune facture sur la période.</p>}
                </div>
              )
            })()}
            {stats.lastRun && (
              <p className="text-ink-faint text-[11px] border-t pt-2">Dernière passe auto : {stats.lastRun.invoiced} facturée(s) · {stats.lastRun.noTariff || 0} sans tarif · {stats.lastRun.combined || 0} combinée(s)</p>
            )}
          </div>
        )}

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Rechercher une source…"
          className="w-full bg-surface border rounded-xl px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-brand" />

        {loading ? (
          <p className="text-ink-muted py-8 text-center">Chargement…</p>
        ) : (
          <div className="bg-surface border rounded-2xl overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="flex items-center gap-3 px-4 py-2 border-b text-ink-muted text-xs uppercase tracking-wide">
                <span className="flex-1">Source</span>
                {AUTO_INVOICE_TYPES.map(t => <span key={t.key} className="w-16 text-center">{t.label}</span>)}
              </div>
              {visible.map(s => {
                const r = rules[s.key] || {}
                return (
                  <div key={s.key} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-ink text-sm font-medium truncate">{s.label}</p>
                      <p className="text-ink-faint text-[11px] font-mono truncate">{s.key}</p>
                    </div>
                    {AUTO_INVOICE_TYPES.map(t => (
                      <div key={t.key} className="w-16 flex justify-center">
                        <Switch on={!!r[t.key]} disabled={busy === `${s.key}:${t.key}`} onClick={() => toggle(s.key, t.key, !r[t.key])} />
                      </div>
                    ))}
                  </div>
                )
              })}
              {visible.length === 0 && <p className="text-ink-muted text-sm text-center py-6">Aucune source.</p>}
            </div>
          </div>
        )}

        <p className="text-ink-faint text-xs text-center">{activeCount} règle{activeCount > 1 ? 's' : ''} active{activeCount > 1 ? 's' : ''}.</p>
      </main>
    </AppShell>
  )
}
