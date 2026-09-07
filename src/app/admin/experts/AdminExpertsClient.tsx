'use client'

// Accès experts (QR A4 à l'accueil → /expert) : qui est inscrit, pour quels
// bureaux, statut de chaque demande, visites faites, révocation d'un
// téléphone — et qui reçoit les popups de validation. Olivier 2026-09-07.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Bureau = { id: string; bureau: string; status: 'pending' | 'approved' | 'refused' | 'revoked'; requested_at: string; decided_at: string | null; decided_by_name: string | null }
type Device = {
  id: string; first_name: string; user_agent: string | null; created_at: string; last_seen_at: string; revoked_at: string | null; revoked_by_name: string | null
  bureaus: Bureau[]; visits: number; vehicles: number; last_visit_at: string | null
}
type Candidate = { id: string; name: string; role: string }
type Snap = { devices: Device[]; recipients: string[]; candidates: Candidate[] }

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const STATUS: Record<Bureau['status'], { label: string; cls: string }> = {
  pending:  { label: 'En attente', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Validé',     cls: 'bg-green-100 text-green-800' },
  refused:  { label: 'Refusé',     cls: 'bg-red-100 text-red-800' },
  revoked:  { label: 'Révoqué',    cls: 'bg-slate-200 text-slate-700' },
}
const deviceLabel = (ua?: string | null) => /iPhone/i.test(ua || '') ? 'iPhone' : /Android/i.test(ua || '') ? 'Android' : /iPad/i.test(ua || '') ? 'iPad' : 'téléphone'

export default function AdminExpertsClient() {
  const [snap, setSnap] = useState<Snap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRevoked, setShowRevoked] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/experts', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setSnap(j)
    } catch (e: any) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(payload: any) {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/admin/experts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setSnap(j)
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const devices = (snap?.devices || []).filter(d => showRevoked || !d.revoked_at)
  const pendingCount = (snap?.devices || []).flatMap(d => d.bureaus).filter(b => b.status === 'pending').length
  const recipients = new Set(snap?.recipients || [])
  const toggleRecipient = (id: string) => {
    const next = new Set(recipients); next.has(id) ? next.delete(id) : next.add(id)
    post({ action: 'recipients', ids: Array.from(next) })
  }

  return (
    <div className="min-h-screen bg-surface max-w-3xl mx-auto flex flex-col">
      <div className="bg-surface-2 border-b border-app px-5 pt-12 pb-4">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin" className="w-10 h-10 flex items-center justify-center bg-surface-hover rounded-xl text-ink text-lg">←</Link>
          <div className="flex-1">
            <h1 className="text-ink font-bold text-lg">🪪 Accès experts</h1>
            <p className="text-ink-muted text-xs">Téléphones inscrits via le QR de l'accueil (/expert), bureaux validés, visites, révocation — et destinataires des popups.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 space-y-6">
        {error && <p className="text-critical text-sm bg-critical-soft border border-critical rounded-xl px-3 py-2">⚠️ {error}</p>}
        {!snap && !error && <p className="text-ink-muted text-sm">Chargement…</p>}

        {/* ── Destinataires des popups ─────────────────────────────── */}
        {snap && (
          <section className="space-y-2">
            <h2 className="text-ink font-semibold text-sm">Qui reçoit les popups experts (validation d'accès, visites, questions)</h2>
            <p className="text-ink-muted text-xs">Le premier qui répond décide ; le popup se ferme chez les autres. Sans sélection : tous les comptes bureau (dispatcher / admin) qui ont le module Fourrière.</p>
            <div className="flex flex-wrap gap-1.5">
              {snap.candidates.map(c => (
                <button key={c.id} onClick={() => toggleRecipient(c.id)} disabled={busy}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${recipients.has(c.id) ? 'bg-brand text-white border-brand' : 'bg-surface-2 text-ink border-app'}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Experts inscrits ─────────────────────────────────────── */}
        {snap && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ink font-semibold text-sm">Experts inscrits ({devices.length}){pendingCount > 0 && <span className="ml-2 text-xs px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800">{pendingCount} en attente</span>}</h2>
              <label className="flex items-center gap-2 text-ink-secondary text-xs">
                <input type="checkbox" checked={showRevoked} onChange={e => setShowRevoked(e.target.checked)} /> Afficher les révoqués
              </label>
            </div>
            {devices.length === 0 && <p className="text-ink-muted text-sm">Aucun expert inscrit pour l'instant. L'inscription se fait en scannant l'affiche à l'accueil.</p>}
            <ul className="space-y-2">
              {devices.map(d => (
                <li key={d.id} className={`bg-surface-2 border border-app rounded-xl px-4 py-3 space-y-2 ${d.revoked_at ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-ink font-semibold">{d.first_name} <span className="text-ink-muted font-normal text-xs">· {deviceLabel(d.user_agent)} · inscrit le {fmt(d.created_at)} · vu le {fmt(d.last_seen_at)}</span></p>
                      <p className="text-ink-secondary text-xs">{d.visits} visite{d.visits > 1 ? 's' : ''} · {d.vehicles} véhicule{d.vehicles > 1 ? 's' : ''}{d.last_visit_at ? ` · dernière le ${fmt(d.last_visit_at)}` : ''}</p>
                      {d.revoked_at && <p className="text-critical text-xs">Révoqué le {fmt(d.revoked_at)}{d.revoked_by_name ? ` par ${d.revoked_by_name}` : ''} — son téléphone doit repasser par le QR.</p>}
                    </div>
                    {d.revoked_at
                      ? <button onClick={() => post({ action: 'restore_device', id: d.id })} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-app text-ink">Rétablir</button>
                      : <button onClick={() => { if (confirm(`Révoquer l'accès de ${d.first_name} ? Son téléphone ne pourra plus rien consulter.`)) post({ action: 'revoke_device', id: d.id }) }} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg bg-red-100 text-red-800">Révoquer</button>}
                  </div>
                  <ul className="space-y-1">
                    {d.bureaus.map(b => (
                      <li key={b.id} className="flex items-center gap-2 flex-wrap text-sm">
                        <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${STATUS[b.status].cls}`}>{STATUS[b.status].label}</span>
                        <span className="text-ink">{b.bureau}</span>
                        <span className="text-ink-muted text-xs">demandé le {fmt(b.requested_at)}{b.decided_at ? ` · décidé le ${fmt(b.decided_at)}${b.decided_by_name ? ` par ${b.decided_by_name}` : ''}` : ''}</span>
                        {!d.revoked_at && (
                          <span className="ml-auto flex gap-1">
                            {b.status !== 'approved' && <button onClick={() => post({ action: 'bureau', id: b.id, status: 'approved' })} disabled={busy} className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-800">Valider</button>}
                            {b.status === 'pending' && <button onClick={() => post({ action: 'bureau', id: b.id, status: 'refused' })} disabled={busy} className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-800">Refuser</button>}
                            {b.status === 'approved' && <button onClick={() => post({ action: 'bureau', id: b.id, status: 'revoked' })} disabled={busy} className="text-xs px-2 py-1 rounded-lg bg-slate-200 text-slate-700">Retirer</button>}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
