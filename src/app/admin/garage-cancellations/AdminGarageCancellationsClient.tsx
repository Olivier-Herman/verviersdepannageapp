'use client'

// UI dispatch pour valider/refuser les demandes d annulation garage.
// Olivier 2026-06-02. Cf [[project-espace-client-garages]] workflow annulation.

import { useState }   from 'react'
import { useRouter }  from 'next/navigation'
import Link           from 'next/link'

interface Req {
  id:             string
  mission_id:     string
  requested_at:   string
  reason:         string | null
  status:         string
  decided_at:     string | null
  decision_note:  string | null
  garage_partners: { id: string; name: string } | null
  incoming_missions: {
    id:             string
    mission_number: number | null
    mission_type:   string | null
    vehicle_plate:  string | null
    vehicle_brand:  string | null
    vehicle_model:  string | null
    status:         string
    accepted_at:    string | null
    on_way_at:      string | null
  } | null
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:              { label: '⏳ En attente',           color: 'bg-amber-50 border-amber-300 text-amber-900' },
  approved_total:       { label: '✓ Annulation totale',    color: 'bg-green-50 border-green-300 text-green-900' },
  approved_billing_dpr: { label: '€ Facturation DPR',      color: 'bg-blue-50 border-blue-300 text-blue-900' },
  refused:              { label: '✕ Refusée',              color: 'bg-gray-50 border-gray-300 text-gray-700' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AdminGarageCancellationsClient({ initialRequests }: { initialRequests: Req[] }) {
  const router = useRouter()
  const [requests, setRequests] = useState<Req[]>(initialRequests)
  const [decideOpen, setDecideOpen] = useState<{ id: string; decision: string } | null>(null)
  const [note, setNote]   = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  async function decide(id: string, decision: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/dispatch/garage-cancellations/${id}/decide`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ decision, note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erreur')
      setDecideOpen(null)
      setNote('')
      router.refresh()
      // Reload local
      setRequests(rs => rs.map(r => r.id === id ? { ...r, status: decision, decision_note: note, decided_at: new Date().toISOString() } : r))
    } catch (e: any) {
      setError(e?.message || 'Erreur')
    } finally { setBusy(false) }
  }

  const visible = requests.filter(r => filter === 'all' || r.status === 'pending')

  return (
    <div className="min-h-screen bg-surface max-w-4xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🚫 Demandes d&apos;annulation garage</h1>
            <p className="text-ink-muted text-xs">Quand un garage demande l&apos;annulation d&apos;une mission après acceptation. Décide : annulation totale (sans frais), facturation DPR, ou refus.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setFilter('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${filter === 'pending' ? 'bg-brand text-white' : 'bg-surface-2 border'}`}>
            En attente ({requests.filter(r => r.status === 'pending').length})
          </button>
          <button onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${filter === 'all' ? 'bg-brand text-white' : 'bg-surface-2 border'}`}>
            Toutes ({requests.length})
          </button>
        </div>

        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}

        {visible.length === 0 ? (
          <div className="bg-surface border rounded-2xl p-10 text-center text-ink-muted text-sm">
            {filter === 'pending' ? '✅ Aucune demande en attente' : 'Aucune demande'}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map(r => {
              const cfg = STATUS_LABEL[r.status] || { label: r.status, color: 'bg-gray-50 border-gray-300 text-gray-700' }
              const isPending = r.status === 'pending'
              const m = r.incoming_missions
              return (
                <li key={r.id} className={`border-2 rounded-2xl p-4 ${cfg.color}`}>
                  <div className="flex items-start gap-3">
                    <div className="text-2xl flex-shrink-0">🏢</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-bold text-sm">{cfg.label}</span>
                        <span className="text-xs opacity-75">— {r.garage_partners?.name || '?'}</span>
                      </div>
                      {m && (
                        <p className="text-sm font-semibold">
                          {m.mission_type === 'depannage' ? '🔧 DSP' : m.mission_type === 'remorquage' ? '🚛 REM' : ''}
                          {' '}
                          {m.vehicle_plate && <span className="font-mono">{m.vehicle_plate}</span>}
                          {(m.vehicle_brand || m.vehicle_model) && <span className="opacity-75"> · {[m.vehicle_brand, m.vehicle_model].filter(Boolean).join(' ')}</span>}
                          {m.mission_number && <span className="opacity-50 ml-2 font-mono text-xs">#{m.mission_number}</span>}
                        </p>
                      )}
                      {r.reason && (
                        <p className="text-sm mt-1 italic opacity-80">« {r.reason} »</p>
                      )}
                      <p className="text-xs opacity-60 mt-2">
                        Demandé le {fmtDate(r.requested_at)}
                        {m?.accepted_at && <span> · Mission acceptée le {fmtDate(m.accepted_at)}</span>}
                      </p>
                      {!isPending && r.decision_note && (
                        <p className="text-xs mt-1 opacity-75">Note dispatch : {r.decision_note}</p>
                      )}
                    </div>

                    {isPending && (
                      <div className="flex flex-col gap-1.5 flex-shrink-0">
                        <button onClick={() => { setNote(''); setDecideOpen({ id: r.id, decision: 'approved_total' }) }}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold">
                          ✓ Annulation totale
                        </button>
                        <button onClick={() => { setNote(''); setDecideOpen({ id: r.id, decision: 'approved_billing_dpr' }) }}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">
                          € Facturer DPR
                        </button>
                        <button onClick={() => { setNote(''); setDecideOpen({ id: r.id, decision: 'refused' }) }}
                          className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-xs font-semibold">
                          ✕ Refuser
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {decideOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4" onClick={() => !busy && setDecideOpen(null)}>
          <div className="bg-surface w-full max-w-md rounded-2xl border p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-ink font-bold text-base">
              {decideOpen.decision === 'approved_total'       && '✓ Confirmer : annulation totale'}
              {decideOpen.decision === 'approved_billing_dpr' && '€ Confirmer : facturation DPR'}
              {decideOpen.decision === 'refused'              && '✕ Confirmer : refuser la demande'}
            </h3>
            <p className="text-ink-secondary text-xs">
              {decideOpen.decision === 'approved_total'       && "La mission est annulée. Aucun frais facturé. Le garage est notifié."}
              {decideOpen.decision === 'approved_billing_dpr' && "La mission passe en 'Terminée' avec le tarif DPR (déplacement pour rien) du garage. Si non défini, fallback sur DSP."}
              {decideOpen.decision === 'refused'              && "La mission continue. Le garage est notifié que la demande est refusée."}
            </p>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Note (optionnelle, visible côté garage)"
              rows={2}
              className="w-full bg-surface-2 border rounded-xl px-3 py-2 text-ink text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setDecideOpen(null)} disabled={busy}
                className="flex-1 py-2.5 bg-surface-2 border text-ink-secondary rounded-xl text-sm">Annuler</button>
              <button onClick={() => decide(decideOpen.id, decideOpen.decision)} disabled={busy}
                className="flex-1 py-2.5 bg-brand text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {busy ? '⏳ ...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
