'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

interface Period {
  id: number
  kind: 'day' | 'night' | 'autodispatch_night'
  hour_start: number
  hour_end: number
  cross_midnight: boolean
  label: string | null
  active: boolean
  updated_at: string
}

const KIND_INFO: Record<Period['kind'], { title: string; desc: string; emoji: string }> = {
  day: {
    emoji: '☀️',
    title: 'Plages de jour',
    desc: 'Un chauffeur "Garde jour" est en service quand l\'heure tombe dans AU MOINS UNE de ces plages.',
  },
  night: {
    emoji: '🌙',
    title: 'Plages de nuit',
    desc: 'Un chauffeur "Garde nuit" est en service quand l\'heure tombe dans AU MOINS UNE de ces plages. Cross-midnight typique.',
  },
  autodispatch_night: {
    emoji: '⚡',
    title: 'Plages auto-dispatch nuit',
    desc: 'Pendant ces plages, l\'auto-dispatch respecte STRICT le priority_order (l\'ordre du dispatcher prime sur l\'ETA).',
  },
}

const KIND_DEFAULTS: Record<Period['kind'], Partial<Period>> = {
  day:                { hour_start: 7,  hour_end: 20, cross_midnight: false },
  night:              { hour_start: 17, hour_end: 9,  cross_midnight: true  },
  autodispatch_night: { hour_start: 18, hour_end: 8,  cross_midnight: true  },
}

function fmtHour(h: number): string {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}`
}

export default function GardeScheduleClient({ initialPeriods }: { initialPeriods: Period[] }) {
  const [periods, setPeriods] = useState<Period[]>(initialPeriods)
  const [saving, setSaving]   = useState<number | null>(null)
  const [adding, setAdding]   = useState<Period['kind'] | null>(null)
  const [msg, setMsg]         = useState<string | null>(null)

  const updateField = (id: number, field: keyof Period, value: any) => {
    setPeriods(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  const save = async (p: Period) => {
    setSaving(p.id); setMsg(null)
    try {
      const r = await fetch('/api/admin/schedule-periods', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:             p.id,
          hour_start:     p.hour_start,
          hour_end:       p.hour_end,
          cross_midnight: p.cross_midnight,
          active:         p.active,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setMsg('✓ Sauvegarde')
      setTimeout(() => setMsg(null), 2500)
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setSaving(null)
    }
  }

  const addNew = async (kind: Period['kind']) => {
    setAdding(kind); setMsg(null)
    try {
      const defaults = KIND_DEFAULTS[kind]
      const r = await fetch('/api/admin/schedule-periods', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          kind,
          hour_start:     defaults.hour_start,
          hour_end:       defaults.hour_end,
          cross_midnight: defaults.cross_midnight,
          active:         true,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setPeriods(prev => [...prev, j.period])
      setMsg('✓ Nouvelle plage ajoutée')
      setTimeout(() => setMsg(null), 2500)
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setAdding(null)
    }
  }

  const remove = async (p: Period) => {
    if (!window.confirm(`Supprimer cette plage ${KIND_INFO[p.kind].title.toLowerCase()} (${fmtHour(p.hour_start)} → ${fmtHour(p.hour_end)}) ?`)) return
    setMsg(null)
    try {
      const r = await fetch(`/api/admin/schedule-periods?id=${p.id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setPeriods(prev => prev.filter(x => x.id !== p.id))
      setMsg('✓ Plage supprimée')
      setTimeout(() => setMsg(null), 2500)
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    }
  }

  const kinds: Period['kind'][] = ['day', 'night', 'autodispatch_night']

  return (
    <div className="px-4 lg:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin"
          className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">Plages de garde</h1>
      </div>

      <p className="text-ink-muted text-sm mb-4">
        Heures en local Belgique. Modifications appliquees immediatement (cache 60s cote serveur).
        Plusieurs plages possibles par type — un chauffeur est en service dès qu&apos;une plage active matche.
      </p>

      {msg && (
        <div className="mb-4 px-3 py-2 bg-surface border rounded-lg text-sm">{msg}</div>
      )}

      <div className="space-y-6">
        {kinds.map(kind => {
          const info = KIND_INFO[kind]
          const list = periods.filter(p => p.kind === kind)
          return (
            <section key={kind} className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{info.emoji}</span>
                <div className="flex-1">
                  <h2 className="font-semibold text-ink">{info.title}</h2>
                  <p className="text-ink-muted text-xs mt-0.5">{info.desc}</p>
                </div>
                <button
                  onClick={() => addNew(kind)}
                  disabled={adding === kind}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
                >
                  <Plus size={14} />
                  {adding === kind ? '⏳' : 'Ajouter'}
                </button>
              </div>

              {list.length === 0 && (
                <div className="text-center py-6 border-2 border-dashed rounded-card text-ink-muted text-sm">
                  Aucune plage configurée — clique sur Ajouter.
                </div>
              )}

              {list.map(p => (
                <div key={p.id} className="bg-surface border rounded-card p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-muted mb-1">Debut (h)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        value={p.hour_start}
                        onChange={e => updateField(p.id, 'hour_start', parseFloat(e.target.value) || 0)}
                        className="w-full bg-surface border rounded-md px-3 py-2 text-sm"
                      />
                      <p className="text-[10px] text-ink-faint mt-1">= {fmtHour(p.hour_start)}</p>
                    </div>
                    <div>
                      <label className="block text-xs text-ink-muted mb-1">Fin (h)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        max="24"
                        value={p.hour_end}
                        onChange={e => updateField(p.id, 'hour_end', parseFloat(e.target.value) || 0)}
                        className="w-full bg-surface border rounded-md px-3 py-2 text-sm"
                      />
                      <p className="text-[10px] text-ink-faint mt-1">= {fmtHour(p.hour_end)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={p.cross_midnight}
                        onChange={e => updateField(p.id, 'cross_midnight', e.target.checked)}
                        className="w-4 h-4 accent-brand"
                      />
                      <span>Cross-midnight</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={p.active}
                        onChange={e => updateField(p.id, 'active', e.target.checked)}
                        className="w-4 h-4 accent-brand"
                      />
                      <span>Active</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <p className="text-xs text-ink-faint">
                      Plage : <span className="font-mono text-ink">{fmtHour(p.hour_start)} → {fmtHour(p.hour_end)}</span>
                      {p.cross_midnight && <span className="text-ink-muted ml-1">(le lendemain)</span>}
                      {!p.active && <span className="text-ink-muted ml-2">· inactive</span>}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => remove(p)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-lg transition"
                      >
                        <Trash2 size={14} />
                        Supprimer
                      </button>
                      <button
                        onClick={() => save(p)}
                        disabled={saving === p.id}
                        className="px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
                      >
                        {saving === p.id ? '⏳' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
