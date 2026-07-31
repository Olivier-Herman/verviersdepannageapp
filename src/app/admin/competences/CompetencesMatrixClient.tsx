'use client'

import { useState } from 'react'
import Link         from 'next/link'

type User  = { id: string; name: string | null; role: string | null }
type Motif = { id: string; label: string; kind: string; service: string | null }
type Link_ = { user_id: string; motif_id: string }

const KIND_ICON: Record<string, string> = { visit: '🪪', call: '📞', both: '🪪📞' }

export default function CompetencesMatrixClient({ users, motifs, links }: { users: User[]; motifs: Motif[]; links: Link_[] }) {
  const [set, setSet]   = useState<Set<string>>(new Set(links.map(l => `${l.user_id}|${l.motif_id}`)))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const has = (u: string, m: string) => set.has(`${u}|${m}`)

  async function toggle(userId: string, motifId: string) {
    const key = `${userId}|${motifId}`
    const on  = !set.has(key)
    // optimiste
    setSet(prev => { const n = new Set(prev); on ? n.add(key) : n.delete(key); return n })
    setBusy(key); setError(null)
    try {
      const res = await fetch('/api/admin/competences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, motif_id: motifId, on }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur')
    } catch (e: any) {
      setError(e.message)
      setSet(prev => { const n = new Set(prev); on ? n.delete(key) : n.add(key); return n })  // rollback
    } finally { setBusy(null) }
  }

  return (
    <div className="min-h-screen bg-surface max-w-6xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🧩 Compétences réception</h1>
            <p className="text-ink-muted text-xs">Coche qui traite quel motif. Un employé ne reçoit que les visites/appels de ses compétences.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-3">
        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}
        {!motifs.length ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            Aucun motif actif. Crée d'abord des motifs dans <Link href="/admin/reception-motifs" className="text-brand underline">Motifs de réception</Link>.
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-2xl bg-surface">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-2 border-b border-r px-3 py-2 text-left text-ink-muted text-xs font-semibold min-w-[150px]">Employé</th>
                  {motifs.map(m => (
                    <th key={m.id} className="border-b px-2 py-2 text-center text-ink text-xs font-semibold min-w-[76px] max-w-[110px] align-bottom">
                      <div className="whitespace-normal leading-tight">{KIND_ICON[m.kind] || ''} {m.label}</div>
                      {m.service && <div className="text-ink-faint font-normal mt-0.5">{m.service}</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 bg-surface border-b border-r px-3 py-2 text-ink font-medium min-w-[150px]">
                      {u.name || '—'} <span className="text-ink-faint text-[10px]">{u.role}</span>
                    </td>
                    {motifs.map(m => {
                      const key = `${u.id}|${m.id}`
                      const on  = has(u.id, m.id)
                      return (
                        <td key={m.id} className="border-b text-center px-2 py-1.5">
                          <button onClick={() => toggle(u.id, m.id)} disabled={busy === key}
                            className={`w-7 h-7 rounded-lg border text-sm transition-colors disabled:opacity-40 ${on ? 'bg-brand border-brand text-white' : 'bg-surface-2 border text-ink-faint hover:border-brand/40'}`}
                            title={on ? 'Compétent — cliquer pour retirer' : 'Cliquer pour activer'}>
                            {on ? '✓' : ''}
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
        <p className="text-ink-faint text-xs">💾 Chaque clic est enregistré immédiatement.</p>
      </div>
    </div>
  )
}
