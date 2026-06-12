'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'

interface Vd {
  id: string; mission_number: number | null; external_id: string | null
  source: string | null; status: string | null
  destination_address: string | null; received_at: string | null
}
interface Row {
  assignmentId: string; caseId: string; assignmentNumber: string
  plate: string | null; brand: string | null; model: string | null
  product: string | null; serviceType: string | null; dispatchTime: string | null
  breakdown: any; vdsoft: Vd | null
}

interface Props { userRole: string; userName: string; userEmail?: string | null; userModules: string[] }

function fmt(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return d }
}

export default function AllianzClotureClient({ userRole, userName, userEmail, userModules }: Props) {
  const [rows, setRows]       = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [result, setResult]   = useState<Record<string, any>>({})

  async function load() {
    setLoading(true); setErr(null); setNeedsAuth(false)
    try {
      const r = await fetch('/api/facturation/allianz/list')
      const j = await r.json()
      if (r.status === 503 && j.needsAuth) { setNeedsAuth(true); setErr(j.error); return }
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setRows(j.rows || [])
    } catch (e: any) { setErr(e.message) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  // Récupère la distance (km total) de la mission VD Soft liée.
  async function fetchKm(missionId: string): Promise<number | null> {
    try {
      const r = await fetch(`/api/missions/${missionId}/km`)
      const j = await r.json()
      return typeof j.total_km === 'number' ? j.total_km : null
    } catch { return null }
  }

  async function runClose(row: Row, dryRun: boolean) {
    if (!row.vdsoft) { setResult(p => ({ ...p, [row.assignmentId]: { error: 'Mission non rapprochée VD Soft — impossible de récupérer la distance.' } })); return }
    setBusyId(row.assignmentId + (dryRun ? ':dry' : ':real'))
    setResult(p => ({ ...p, [row.assignmentId]: null }))
    try {
      const km = await fetchKm(row.vdsoft.id)
      const dest = row.vdsoft.destination_address
      const body = {
        assignmentId:  row.assignmentId,
        caseId:        row.caseId,
        receivedIso:   row.vdsoft.received_at || row.dispatchTime,
        distanceKm:    km ?? 0,
        destination:   dest ? { name: dest, countryCode: 'BE', countryName: 'Belgique' } : undefined,
        tariffZip:     row.breakdown?.zipCode || null,
        tariffLat:     row.breakdown?.latitude || null,
        tariffLng:     row.breakdown?.longitude || null,
        dryRun,
      }
      const r = await fetch('/api/facturation/allianz/close', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      setResult(p => ({ ...p, [row.assignmentId]: { ...j, _km: km } }))
      if (!dryRun && j.ok) setTimeout(load, 1500)
    } catch (e: any) {
      setResult(p => ({ ...p, [row.assignmentId]: { error: e.message } }))
    } finally { setBusyId(null) }
  }

  return (
    <AppShell title="Clôture Allianz" userRole={userRole} userName={userName} userEmail={userEmail || undefined} userModules={userModules}>
      <AmbientBackground>
        <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Link href="/facturation" className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-ink-secondary hover:text-ink text-sm">← Facturation</Link>
              <h1 className="text-lg font-semibold text-ink">🟦 Clôture Allianz (Mondial / AWP)</h1>
            </div>
            <button onClick={load} disabled={loading} className="px-3 py-2 bg-surface-2 hover:bg-surface-hover border rounded-xl text-sm disabled:opacity-50">
              {loading ? '⏳…' : 'Rafraîchir'}
            </button>
          </div>

          {needsAuth && (
            <div className="bg-warning/10 border border-warning/40 rounded-2xl p-4 text-sm text-warning">
              ⚠ Connexion Allianz expirée. Le token Hexalite doit être renouvelé (OTP). {err}
            </div>
          )}
          {err && !needsAuth && <div className="bg-critical/10 border border-critical/40 rounded-2xl p-3 text-sm text-critical">{err}</div>}

          {!loading && rows.length === 0 && !err && (
            <div className="bg-surface border rounded-2xl p-8 text-center text-ink-muted text-sm">Aucune mission Allianz à clôturer.</div>
          )}

          <div className="space-y-2">
            {rows.map(row => {
              const res = result[row.assignmentId]
              return (
                <div key={row.assignmentId} className="bg-surface border rounded-2xl p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-ink">{row.plate || '—'}</span>
                        <span className="text-ink-secondary text-sm">{[row.brand, row.model].filter(Boolean).join(' ')}</span>
                        <span className="text-ink-muted text-xs">#{row.assignmentNumber}</span>
                        {row.vdsoft
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-success/15 text-success">VD Soft ✓ {row.vdsoft.mission_number ? '#' + row.vdsoft.mission_number : ''}</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] bg-warning/15 text-warning">non rapprochée</span>}
                      </div>
                      <div className="text-ink-muted text-[11px] mt-0.5">
                        {row.product || '—'} · {row.serviceType || '—'} · {fmt(row.dispatchTime)}
                        {row.breakdown?.city ? ` · ${row.breakdown.city}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => runClose(row, true)} disabled={!!busyId || !row.vdsoft}
                        className="px-3 py-1.5 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs font-semibold disabled:opacity-50">
                        {busyId === row.assignmentId + ':dry' ? '⏳…' : '🧪 Tester'}
                      </button>
                      <button
                        onClick={() => { if (confirm(`Clôturer la mission Allianz #${row.assignmentNumber} (${row.plate || '?'}) ?\nAffectation manuelle + soumission du résultat sur la plateforme Allianz.`)) runClose(row, false) }}
                        disabled={!!busyId || !row.vdsoft}
                        className="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                        {busyId === row.assignmentId + ':real' ? '⏳…' : 'Clôturer'}
                      </button>
                    </div>
                  </div>

                  {res && (
                    <div className="mt-2 border-t pt-2 text-xs">
                      {res.error && <div className="text-critical">⚠ {res.error}</div>}
                      {res.steps && (
                        <ul className="space-y-0.5 mb-2">
                          {res.steps.map((s: any, i: number) => (
                            <li key={i} className={s.ok ? 'text-ink-secondary' : 'text-critical'}>
                              {s.ok ? '✓' : '✗'} {s.step}{s.detail ? ` — ${s.detail}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {typeof res._km === 'number' && <div className="text-ink-muted">Distance VD Soft : {res._km} km</div>}
                      {res.payload && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-brand">Voir le payload qui serait soumis</summary>
                          <pre className="mt-1 bg-surface-2 border rounded-lg p-2 overflow-x-auto text-[10px] leading-tight">{JSON.stringify(res.payload, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </AmbientBackground>
    </AppShell>
  )
}
