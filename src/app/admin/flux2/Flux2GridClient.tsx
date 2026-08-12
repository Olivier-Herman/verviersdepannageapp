'use client'
// src/app/admin/flux2/Flux2GridClient.tsx
//
// Une case = un couple (chauffeur, assistance). Cochée : ce chauffeur clôture
// SES missions de CETTE assistance avec le nouvel écran « Action ». Décochée : il
// garde l'écran actuel. Sauvegarde immédiate, case par case.

import { useEffect, useState } from 'react'

interface Assistance { key: string; label: string; integrated?: boolean }
interface Driver { id: string; name: string }

export default function Flux2GridClient() {
  const [assistances, setAssistances] = useState<Assistance[]>([])
  const [drivers, setDrivers]         = useState<Driver[]>([])
  const [enabled, setEnabled]         = useState<Record<string, boolean>>({})
  const [saving, setSaving]           = useState<string | null>(null)
  const [err, setErr]                 = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    fetch('/api/admin/flux2', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErr(d.error); return }
        setAssistances(d.assistances || []); setDrivers(d.drivers || []); setEnabled(d.enabled || {})
      })
      .catch(() => setErr('Chargement impossible'))
      .finally(() => setLoading(false))
  }, [])

  async function toggle(driverId: string, key: string) {
    const cell = `${driverId}|${key}`
    const next = !enabled[cell]
    setSaving(cell); setErr(null)
    setEnabled(p => ({ ...p, [cell]: next }))          // optimiste
    try {
      const r = await fetch('/api/admin/flux2', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId, assistanceKey: key, enabled: next }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Erreur')
    } catch (e: any) {
      setEnabled(p => ({ ...p, [cell]: !next }))       // rollback
      setErr(e?.message || 'Sauvegarde impossible')
    } finally { setSaving(null) }
  }

  const countFor = (key: string) => drivers.filter(d => enabled[`${d.id}|${key}`]).length

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">Déploiement du flux 2</h1>
        <p className="text-ink-secondary text-sm mt-1 max-w-2xl">
          Une case cochée : ce chauffeur clôture ses missions de cette assistance avec le nouvel écran
          « Action ». Décochée : il garde l'écran actuel, inchangé. Cocher une assistance n'ouvre
          qu'elle — les autres restent fermées.
        </p>
      </div>

      {err && <div className="bg-critical-soft text-critical rounded-xl px-3 py-2 text-sm">{err}</div>}
      {loading && <p className="text-ink-muted text-sm">Chargement…</p>}

      {!loading && drivers.length > 0 && (
        <div className="border rounded-2xl overflow-x-auto bg-surface">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b">
                <th className="text-left font-semibold text-ink px-4 py-3 sticky left-0 bg-surface-2 z-10">Chauffeur</th>
                {assistances.map(a => (
                  <th key={a.key} className="px-3 py-3 font-semibold text-ink text-center whitespace-nowrap">
                    {a.integrated && <span title="La clôture part aussi chez l'assisteur">🔗 </span>}
                    {a.label}
                    <span className="block text-[11px] font-normal text-ink-muted">
                      {countFor(a.key)}/{drivers.length}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5 text-ink font-medium whitespace-nowrap sticky left-0 bg-surface z-10">{d.name}</td>
                  {assistances.map(a => {
                    const cell = `${d.id}|${a.key}`
                    const on = !!enabled[cell]
                    return (
                      <td key={a.key} className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => toggle(d.id, a.key)}
                          disabled={saving === cell}
                          aria-pressed={on}
                          aria-label={`${d.name} — ${a.label}`}
                          className={`w-7 h-7 rounded-lg border-2 transition disabled:opacity-40 ${
                            on ? 'bg-success-fill border-success-fill text-white' : 'bg-surface border-strong text-transparent hover:border-success'
                          }`}>
                          ✓
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && drivers.length === 0 && !err && (
        <p className="text-ink-muted text-sm">Aucun chauffeur actif trouvé.</p>
      )}

      <p className="text-ink-muted text-xs max-w-2xl">
        🔗 = la clôture part aussi chez l'assisteur (Touring, VAB, AXA, Kaze). Sans le lien,
        les écrans sont les mêmes mais tout reste dans VD Soft — c'est le cas d'ANWB, du privé
        ou de la police.<br />
        Les superadmins voient toujours le flux 2, sans être cochés — pour pouvoir vérifier.
        Une modification s'applique en moins d'une minute, sans redéploiement.
      </p>
    </div>
  )
}
