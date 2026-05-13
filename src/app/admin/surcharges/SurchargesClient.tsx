'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, X, AlertCircle } from 'lucide-react'

interface Client {
  key: string
  label: string
  kind: 'assistance' | 'hors_assistance'
  sort_order: number
  active: boolean
}

interface Schedule {
  id: string
  client_key: string
  weekday: number      // 1..7
  hour_start: number
  hour_end: number
  rate_dsp_pct: number | null
  rate_rem_pct: number | null
}

interface Range {
  hour_start: number
  hour_end: number
  rate_dsp_pct: number | null
  rate_rem_pct: number | null
}

const WEEKDAYS: Array<{ n: number; short: string; long: string }> = [
  { n: 1, short: 'Lun', long: 'Lundi' },
  { n: 2, short: 'Mar', long: 'Mardi' },
  { n: 3, short: 'Mer', long: 'Mercredi' },
  { n: 4, short: 'Jeu', long: 'Jeudi' },
  { n: 5, short: 'Ven', long: 'Vendredi' },
  { n: 6, short: 'Sam', long: 'Samedi' },
  { n: 7, short: 'Dim', long: 'Dim / Férié' },
]

const PROTECTED_KEYS = ['snc', 'accident_police']

export default function SurchargesClient({
  initialClients, initialSchedules,
}: {
  initialClients:   Client[]
  initialSchedules: Schedule[]
}) {
  const [clients,   setClients]   = useState<Client[]>(initialClients)
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules)
  const [tab,       setTab]       = useState<'assistance' | 'hors_assistance'>('assistance')
  const [editing,   setEditing]   = useState<{ client: Client; weekday: number } | null>(null)
  const [addingClient, setAddingClient] = useState(false)

  const visibleClients = useMemo(
    () => clients.filter(c => c.kind === tab).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
    [clients, tab]
  )

  const schedulesByCell = useMemo(() => {
    const map = new Map<string, Schedule[]>()
    for (const s of schedules) {
      const key = `${s.client_key}:${s.weekday}`
      const arr = map.get(key) || []
      arr.push(s)
      map.set(key, arr)
    }
    // tri intra-cellule par heure
    for (const arr of map.values()) arr.sort((a, b) => a.hour_start - b.hour_start)
    return map
  }, [schedules])

  async function refreshAll() {
    const res = await fetch('/api/admin/surcharges')
    const j = await res.json()
    setClients(j.clients || [])
    setSchedules(j.schedules || [])
  }

  async function deleteClient(c: Client) {
    if (PROTECTED_KEYS.includes(c.key)) return
    if (!confirm(`Supprimer "${c.label}" et toutes ses majorations ?`)) return
    const res = await fetch(`/api/admin/surcharges/client?key=${encodeURIComponent(c.key)}`, { method: 'DELETE' })
    if (!res.ok) { alert((await res.json()).error || 'Erreur'); return }
    refreshAll()
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-ink text-xl font-semibold">Majorations tarifaires</h1>
        <div className="flex gap-1 bg-surface-2 border rounded-xl p-1">
          <button
            onClick={() => setTab('assistance')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'assistance' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}
          >
            Assistance
          </button>
          <button
            onClick={() => setTab('hors_assistance')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${tab === 'hors_assistance' ? 'bg-brand text-white' : 'text-ink-secondary hover:text-ink'}`}
          >
            Hors assistance
          </button>
        </div>
      </div>

      <div className="bg-info-soft border border-info rounded-xl p-3 flex items-start gap-2">
        <AlertCircle className="text-info flex-shrink-0 mt-0.5" size={16} />
        <p className="text-ink-secondary text-xs leading-relaxed">
          La détection en facturation : si la source de la mission correspond à un client listé ici, sa grille s'applique.
          Sinon → grille <em>SNC</em>. Les jours fériés belges utilisent automatiquement la colonne <strong>Dim/Férié</strong>.
        </p>
      </div>

      <div className="bg-surface border rounded-2xl overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[800px]">
          <thead>
            <tr className="border-b bg-surface-2">
              <th className="text-left px-3 py-2 text-ink-muted text-xs font-medium uppercase tracking-wide sticky left-0 bg-surface-2 z-10 min-w-[150px]">Client</th>
              {WEEKDAYS.map(d => (
                <th key={d.n} className="text-left px-2 py-2 text-ink-muted text-xs font-medium uppercase tracking-wide min-w-[110px]">
                  {d.short}{d.n === 7 ? <span className="text-ink-faint normal-case font-normal"> / Férié</span> : ''}
                </th>
              ))}
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {visibleClients.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-ink-muted text-sm">
                  {tab === 'assistance' ? 'Aucun client d\'assistance. Cliquez sur "+ Ajouter".' : 'Aucun client.'}
                </td>
              </tr>
            ) : visibleClients.map(c => (
              <tr key={c.key} className="border-b last:border-b-0 hover:bg-surface-hover">
                <td className="px-3 py-2 sticky left-0 bg-surface z-10 group">
                  <p className="text-ink font-medium text-sm truncate">{c.label}</p>
                </td>
                {WEEKDAYS.map(d => {
                  const cellSchedules = schedulesByCell.get(`${c.key}:${d.n}`) || []
                  return (
                    <td
                      key={d.n}
                      onClick={() => setEditing({ client: c, weekday: d.n })}
                      className="px-2 py-2 cursor-pointer hover:bg-brand/5 transition border-l border-l-transparent hover:border-l-brand"
                    >
                      {cellSchedules.length === 0 ? (
                        <span className="text-ink-faint text-xs">—</span>
                      ) : (
                        <div className="space-y-1">
                          {cellSchedules.map(s => (
                            <CellRange key={s.id} s={s} />
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className="px-2 py-2">
                  {!PROTECTED_KEYS.includes(c.key) && (
                    <button
                      onClick={() => deleteClient(c)}
                      className="text-ink-faint hover:text-critical transition p-1"
                      title="Supprimer ce client"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tab === 'assistance' && (
        <button
          onClick={() => setAddingClient(true)}
          className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-medium transition flex items-center gap-2"
        >
          <Plus size={16} /> Ajouter un client
        </button>
      )}

      {editing && (
        <EditCellPanel
          client={editing.client}
          weekday={editing.weekday}
          weekdayLabel={WEEKDAYS[editing.weekday - 1].long}
          initialRanges={(schedulesByCell.get(`${editing.client.key}:${editing.weekday}`) || []).map(s => ({
            hour_start: s.hour_start, hour_end: s.hour_end,
            rate_dsp_pct: s.rate_dsp_pct, rate_rem_pct: s.rate_rem_pct,
          }))}
          // Plages des autres jours pour le selecteur "Copier depuis..."
          otherDays={WEEKDAYS
            .filter(d => d.n !== editing.weekday)
            .map(d => {
              const ranges = (schedulesByCell.get(`${editing.client.key}:${d.n}`) || []).map(s => ({
                hour_start: s.hour_start, hour_end: s.hour_end,
                rate_dsp_pct: s.rate_dsp_pct, rate_rem_pct: s.rate_rem_pct,
              }))
              return { weekday: d.n, label: d.long, ranges }
            })
            .filter(d => d.ranges.length > 0)
          }
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll() }}
        />
      )}

      {addingClient && (
        <AddClientModal
          onClose={() => setAddingClient(false)}
          onSaved={() => { setAddingClient(false); refreshAll() }}
        />
      )}
    </div>
  )
}

function CellRange({ s }: { s: Schedule }) {
  return (
    <div className="text-xs text-ink-secondary">
      <span className="font-mono">{s.hour_start}h-{s.hour_end === 24 ? '24h' : s.hour_end + 'h'}</span>
      <div className="text-ink-muted">
        {s.rate_dsp_pct != null && <span>D:{s.rate_dsp_pct}%</span>}
        {s.rate_dsp_pct != null && s.rate_rem_pct != null && <span> · </span>}
        {s.rate_rem_pct != null && <span>R:{s.rate_rem_pct}%</span>}
      </div>
    </div>
  )
}

function EditCellPanel({
  client, weekday, weekdayLabel, initialRanges, otherDays, onClose, onSaved,
}: {
  client: Client
  weekday: number
  weekdayLabel: string
  initialRanges: Range[]
  otherDays: { weekday: number; label: string; ranges: Range[] }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [ranges, setRanges] = useState<Range[]>(initialRanges.length > 0 ? initialRanges : [])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [copyFrom, setCopyFrom] = useState<string>('')

  function applyCopy() {
    if (!copyFrom) return
    const src = otherDays.find(d => String(d.weekday) === copyFrom)
    if (!src) return
    // Clone profond pour qu'editer l'une n'impacte pas l'autre
    setRanges(src.ranges.map(r => ({ ...r })))
    setCopyFrom('')
  }

  function addRange() {
    setRanges(r => [...r, { hour_start: 0, hour_end: 24, rate_dsp_pct: 0, rate_rem_pct: 0 }])
  }
  function updateRange(i: number, patch: Partial<Range>) {
    setRanges(r => r.map((x, idx) => idx === i ? { ...x, ...patch } : x))
  }
  function removeRange(i: number) {
    setRanges(r => r.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      // Cleanup : NaN → null pour les taux
      const cleaned = ranges.map(r => ({
        hour_start: Number(r.hour_start),
        hour_end:   Number(r.hour_end),
        rate_dsp_pct: r.rate_dsp_pct === null || r.rate_dsp_pct === undefined || isNaN(r.rate_dsp_pct as any) ? null : Number(r.rate_dsp_pct),
        rate_rem_pct: r.rate_rem_pct === null || r.rate_rem_pct === undefined || isNaN(r.rate_rem_pct as any) ? null : Number(r.rate_rem_pct),
      }))
      const res = await fetch('/api/admin/surcharges/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_key: client.key, weekday, ranges: cleaned }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      onSaved()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full sm:max-w-md h-full overflow-y-auto border-l">
        <div className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <p className="text-ink-muted text-xs">{client.label}</p>
            <h2 className="text-ink font-semibold">{weekdayLabel}</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">

          {/* Copier depuis un autre jour deja configure */}
          {otherDays.length > 0 && (
            <div className="bg-surface-2 border rounded-xl p-3 space-y-2">
              <p className="text-ink-muted text-xs">⚡ Copier les valeurs d'un autre jour</p>
              <div className="flex gap-2">
                <select
                  value={copyFrom}
                  onChange={e => setCopyFrom(e.target.value)}
                  className="flex-1 bg-surface border rounded-lg px-2 py-1.5 text-ink text-sm focus:outline-none focus:border-brand"
                >
                  <option value="">— Choisir un jour —</option>
                  {otherDays.map(d => (
                    <option key={d.weekday} value={String(d.weekday)}>
                      {d.label} ({d.ranges.length} plage{d.ranges.length > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={applyCopy}
                  disabled={!copyFrom}
                  className="px-3 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition whitespace-nowrap"
                >
                  Appliquer
                </button>
              </div>
              {ranges.length > 0 && copyFrom && (
                <p className="text-warning text-xs">⚠ Remplacera les {ranges.length} plage{ranges.length > 1 ? 's' : ''} actuelle{ranges.length > 1 ? 's' : ''}.</p>
              )}
            </div>
          )}

          {ranges.length === 0 ? (
            <p className="text-ink-muted text-sm text-center py-6">Aucune plage horaire. Cliquez sur "+ Ajouter une plage".</p>
          ) : ranges.map((r, i) => (
            <div key={i} className="border rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">De</label>
                    <select
                      value={r.hour_start}
                      onChange={e => updateRange(i, { hour_start: Number(e.target.value) })}
                      className="w-full bg-surface-2 border rounded-lg px-2 py-1.5 text-ink text-sm"
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>{h}h00</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-ink-muted text-xs mb-1">À</label>
                    <select
                      value={r.hour_end}
                      onChange={e => updateRange(i, { hour_end: Number(e.target.value) })}
                      className="w-full bg-surface-2 border rounded-lg px-2 py-1.5 text-ink text-sm"
                    >
                      {Array.from({ length: 24 }, (_, h) => h + 1).map(h => (
                        <option key={h} value={h}>{h === 24 ? '24h00' : h + 'h00'}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button onClick={() => removeRange(i)} className="text-ink-faint hover:text-critical mt-5">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-ink-muted text-xs mb-1">DSP %</label>
                  <input
                    type="number" step="0.5" min="0" max="200"
                    value={r.rate_dsp_pct ?? ''}
                    onChange={e => updateRange(i, { rate_dsp_pct: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="—"
                    className="w-full bg-surface-2 border rounded-lg px-2 py-1.5 text-ink text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-ink-muted text-xs mb-1">REM %</label>
                  <input
                    type="number" step="0.5" min="0" max="200"
                    value={r.rate_rem_pct ?? ''}
                    onChange={e => updateRange(i, { rate_rem_pct: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="—"
                    className="w-full bg-surface-2 border rounded-lg px-2 py-1.5 text-ink text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            onClick={addRange}
            className="w-full py-2 bg-surface-2 hover:bg-surface-hover border border-dashed rounded-xl text-ink-secondary hover:text-ink text-sm transition flex items-center justify-center gap-2"
          >
            <Plus size={16} /> Ajouter une plage
          </button>

          {error && (
            <div className="bg-critical-soft border border-critical rounded-lg p-2 text-critical text-xs">⚠ {error}</div>
          )}

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} disabled={saving} className="flex-1 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition">
              Annuler
            </button>
            <button onClick={save} disabled={saving} className="flex-1 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
              {saving ? '⏳…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AvailableSource {
  source:          string
  label:           string
  odoo_partner_id: number | null
  mission_count:   number
}

function AddClientModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [sources, setSources] = useState<AvailableSource[]>([])
  const [picked, setPicked]   = useState<AvailableSource | null>(null)
  const [filter, setFilter]   = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/surcharges/sources')
      .then(r => r.json())
      .then(j => setSources(j.sources || []))
      .catch(() => setError('Erreur chargement sources'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim()
    if (!q) return sources
    return sources.filter(s =>
      s.source.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
    )
  }, [sources, filter])

  async function save() {
    if (!picked) { setError('Sélectionne une source'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/surcharges/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: picked.source,
          label:  picked.label,
          kind:   'assistance',
        }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Erreur'); return }
      onSaved()
    } catch (e: any) {
      setError(e.message || 'Erreur réseau')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-4">
        <div>
          <h3 className="text-ink font-semibold">Ajouter un client d'assistance</h3>
          <p className="text-ink-muted text-xs mt-1">Choisis une source utilisée dans les missions.</p>
        </div>

        {!picked ? (
          <>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filtrer..."
              autoFocus
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand"
            />
            <div className="border rounded-xl max-h-64 overflow-y-auto bg-surface-2">
              {loading ? (
                <p className="text-ink-muted text-xs text-center py-4">⏳ Chargement…</p>
              ) : filtered.length === 0 ? (
                <p className="text-ink-muted text-xs text-center py-4">
                  {sources.length === 0
                    ? 'Aucune source disponible (toutes déjà ajoutées ou aucune mission)'
                    : 'Aucun résultat pour ce filtre'}
                </p>
              ) : (
                <ul>
                  {filtered.map(s => (
                    <li key={s.source}>
                      <button
                        type="button"
                        onClick={() => setPicked(s)}
                        className="w-full text-left px-3 py-2 hover:bg-surface-hover transition border-b last:border-b-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-ink text-sm font-medium truncate">{s.label}</p>
                          <p className="text-ink-muted text-xs font-mono truncate">{s.source}</p>
                        </div>
                        <span className="text-ink-muted text-xs flex-shrink-0">
                          {s.mission_count > 0 ? `${s.mission_count} mission${s.mission_count > 1 ? 's' : ''}` : '—'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="bg-success-soft border border-success rounded-xl p-3">
            <p className="text-ink-muted text-xs">Source sélectionnée</p>
            <p className="text-success font-semibold text-sm">{picked.label}</p>
            <p className="text-ink-muted text-xs font-mono">{picked.source}</p>
            <button onClick={() => { setPicked(null); setError(null) }} className="text-xs text-brand hover:underline mt-2">
              Changer
            </button>
          </div>
        )}

        {error && (
          <div className="bg-critical-soft border border-critical rounded-lg p-2 text-critical text-xs">⚠ {error}</div>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2 bg-surface-2 hover:bg-surface-hover border text-ink-secondary rounded-xl text-sm transition">
            Annuler
          </button>
          <button onClick={save} disabled={saving || !picked} className="flex-1 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition">
            {saving ? '⏳…' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  )
}
