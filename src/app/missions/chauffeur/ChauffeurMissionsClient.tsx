'use client'
// src/app/missions/chauffeur/ChauffeurMissionsClient.tsx — voir page.tsx.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import MissionStamp from '@/components/missions/MissionStamp'
import { statusFr } from '@/lib/missions/status-label'
import { missionKind } from '@/lib/missions/mission-types'
import { getSourceLabel, type SourceDisplay } from '@/lib/missions/source-display'

type Driver = { id: string; name: string; active: boolean }
type Row = {
  id: string; mission_number: number | null; status: string; mission_type: string | null; incident_type: string | null; source: string | null
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; client_name: string | null
  incident_city: string | null; incident_address: string | null; destination_address: string | null
  assigned_at: string | null; received_at: string | null; completed_at: string | null; cancelled_at: string | null; parked_at: string | null
  invoice_number: string | null; invoice_method: 'manual' | 'auto' | null; dossier_number: string | null; parent_mission_id: string | null; estimated_htva: number | null
  ref_at: string | null
}

const fmt = (v: string | null) => v ? new Date(v).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const KIND_LABEL: Record<string, string> = { REM: 'Remorquage', DSP: 'Dépannage', REL: 'Relivraison', Transport: 'Transport', DPR: 'Trajet à vide', Autre: 'Autre' }
const KIND_CLS: Record<string, string> = { REM: 'bg-blue-600/10 text-blue-700 dark:text-blue-300', DSP: 'bg-amber-500/15 text-amber-800 dark:text-amber-300', REL: 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-300', Transport: 'bg-violet-600/10 text-violet-700 dark:text-violet-300' }

export default function ChauffeurMissionsClient({ drivers, catalogSources, initialDriver, userRole, userName, userEmail, userId, userModules }: {
  drivers: Driver[]; catalogSources: SourceDisplay[]; initialDriver: string
  userRole: string; userName: string; userEmail: string; userId: string; userModules: string[]
}) {
  const [driver, setDriver] = useState<string>(initialDriver && drivers.some(d => d.id === initialDriver) ? initialDriver : '')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = async (id: string, before?: string | null) => {
    if (!id) { setRows([]); setTotal(null); setNextBefore(null); return }
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/missions/by-driver?driver=${encodeURIComponent(id)}${before ? `&before=${encodeURIComponent(before)}` : ''}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(prev => before ? [...prev, ...j.missions] : j.missions)
      setTotal(j.total); setNextBefore(j.more ? j.next_before : null)
    } catch (e: any) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }
  useEffect(() => { load(driver) ; if (typeof window !== 'undefined') { const u = new URL(window.location.href); if (driver) u.searchParams.set('driver', driver); else u.searchParams.delete('driver'); window.history.replaceState(null, '', u.toString()) } }, [driver]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return rows
    return rows.filter(m => [m.vehicle_plate, m.vehicle_brand, m.vehicle_model, m.client_name, m.incident_city, m.incident_address, m.destination_address, m.dossier_number, String(m.mission_number || '')].some(v => String(v || '').toLowerCase().includes(f)))
  }, [rows, filter])
  const driverName = drivers.find(d => d.id === driver)?.name || ''

  return (
    <AppShell title="Missions par chauffeur" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userId={userId || undefined} userModules={userModules}>
      <div className="px-3 lg:px-6 py-5 space-y-4 max-w-6xl mx-auto">
        <div className="bg-surface border rounded-2xl px-5 py-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-xs text-ink-muted uppercase tracking-wider">
            Chauffeur
            <select value={driver} onChange={e => setDriver(e.target.value)} className="border rounded-xl px-3 py-2 bg-surface text-ink text-sm min-w-[220px] normal-case tracking-normal">
              <option value="">— choisir —</option>
              {drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              {drivers.some(d => !d.active) && <optgroup label="Inactifs">{drivers.filter(d => !d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted uppercase tracking-wider flex-1 min-w-[200px]">
            Filtrer dans la liste
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="plaque, client, ville, dossier…" className="border rounded-xl px-3 py-2 bg-surface text-ink text-sm normal-case tracking-normal" />
          </label>
          {driver && <p className="text-sm text-ink-secondary">{total != null ? <><b className="text-ink">{total}</b> mission{total > 1 ? 's' : ''} pour {driverName}</> : loading ? 'Chargement…' : ''}{filter && shown.length !== rows.length ? ` · ${shown.length} affichée${shown.length > 1 ? 's' : ''}` : ''}</p>}
        </div>

        {err && <div className="rounded-xl px-4 py-2.5 text-sm bg-red-600/10 border border-red-600/40 text-red-700 dark:text-red-300">{err}</div>}
        {!driver && <p className="text-ink-muted text-sm px-1">Choisis un chauffeur pour voir toutes ses missions, la plus récente en haut.</p>}

        {driver && (
          <div className="bg-surface border rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-ink-muted">
                  <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Fiche</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Source</th><th className="text-left px-3 py-2">Véhicule</th><th className="text-left px-3 py-2">Client · lieu</th><th className="text-left px-3 py-2">État</th></tr>
                </thead>
                <tbody>
                  {shown.map(m => {
                    const kind = missionKind(m)
                    return (
                      <tr key={m.id} className="border-t hover:bg-surface-hover/50">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-ink-secondary">{fmt(m.ref_at)}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><Link href={`/dispatch/${m.id}`} className="text-brand font-semibold hover:underline">#{m.mission_number}</Link>{m.dossier_number ? <span className="block text-[11px] font-mono text-ink-faint">{m.dossier_number}</span> : null}</td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${KIND_CLS[kind] || 'bg-surface-2 text-ink-secondary'}`}>{KIND_LABEL[kind] || kind}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-secondary">{getSourceLabel(m.source, catalogSources)}</td>
                        <td className="px-3 py-2"><span className="font-mono font-semibold text-ink">{m.vehicle_plate || '—'}</span>{(m.vehicle_brand || m.vehicle_model) && <span className="block text-xs text-ink-secondary">{[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}</span>}</td>
                        <td className="px-3 py-2 text-ink-secondary max-w-[320px]"><span className="block truncate">{m.client_name || '—'}</span><span className="block text-xs truncate text-ink-muted">{m.incident_city || m.incident_address || ''}{m.destination_address ? ` → ${m.destination_address}` : ''}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap"><span className="text-xs text-ink-secondary mr-2">{statusFr(m.status)}</span><MissionStamp mission={m} size="small" /></td>
                      </tr>
                    )
                  })}
                  {!loading && driver && shown.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">Aucune mission{filter ? ' pour ce filtre' : ''}.</td></tr>}
                </tbody>
              </table>
            </div>
            {(nextBefore || loading) && (
              <div className="border-t px-3 py-3 text-center">
                <button disabled={loading} onClick={() => load(driver, nextBefore)} className="px-4 py-2 rounded-xl border bg-surface text-ink-secondary hover:text-ink text-sm font-semibold disabled:opacity-50">{loading ? 'Chargement…' : 'Charger les plus anciennes'}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
