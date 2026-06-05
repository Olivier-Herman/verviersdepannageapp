'use client'

/**
 * AdminCobrowseListClient
 * -------------------------------------------------------------------------
 * Liste les sessions pending + actives. Polling 3 sec.
 * - Pending : bouton "Rejoindre" -> POST /api/cobrowse/[id]/join puis redirect
 *   vers /admin/cobrowse/[id]
 * - Active : bouton "Voir" -> direct vers viewer
 */

import { useEffect, useState } from 'react'
import { useRouter }            from 'next/navigation'
import { LifeBuoy, Eye, X, Clock, User, Globe } from 'lucide-react'

type Sess = {
  id:              string
  user_id:         string
  user_message:    string | null
  user_url:        string | null
  user_agent:      string | null
  status:          'pending' | 'active'
  started_at:      string
  admin_id:        string | null
  admin_joined_at: string | null
  user:            { id: string; name: string | null; email: string | null; role: string | null } | null
}

export default function AdminCobrowseListClient() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Sess[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const fetchList = async () => {
      try {
        const r = await fetch('/api/cobrowse/pending', { cache: 'no-store' })
        const j = await r.json()
        setSessions(j.sessions || [])
      } catch {}
      setLoaded(true)
    }
    fetchList()
    const iv = setInterval(fetchList, 3000)
    return () => clearInterval(iv)
  }, [])

  const join = async (id: string) => {
    setBusy(id)
    try {
      const r = await fetch(`/api/cobrowse/${id}/join`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Erreur')
      router.push(`/admin/cobrowse/${id}`)
    } catch (e: any) {
      alert('Erreur : ' + (e?.message || e))
      setBusy(null)
    }
  }

  const stop = async (id: string) => {
    if (!confirm('Annuler cette demande ?')) return
    setBusy(id)
    try {
      await fetch(`/api/cobrowse/${id}/stop`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: 'admin_cancel' }),
      })
      setSessions(s => s.filter(x => x.id !== id))
    } finally {
      setBusy(null)
    }
  }

  const pending = sessions.filter(s => s.status === 'pending')
  const active  = sessions.filter(s => s.status === 'active')

  if (!loaded) {
    return <div className="text-ink-secondary text-sm">Chargement...</div>
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
          <LifeBuoy size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">Demandes d aide</h1>
          <p className="text-sm text-ink-secondary">
            Sessions de co-browsing en attente ou en cours
          </p>
        </div>
      </header>

      {/* Pending */}
      <section>
        <h2 className="text-sm font-semibold text-ink-secondary uppercase tracking-wide mb-2">
          En attente ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="bg-surface-2 border border-dashed rounded-xl p-6 text-center text-ink-secondary text-sm">
            Aucune demande en attente
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map(s => <Row key={s.id} sess={s} busy={busy === s.id} onJoin={join} onStop={stop} />)}
          </div>
        )}
      </section>

      {/* Active */}
      {active.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink-secondary uppercase tracking-wide mb-2">
            En cours ({active.length})
          </h2>
          <div className="space-y-2">
            {active.map(s => (
              <Row key={s.id} sess={s} busy={busy === s.id} onJoin={join} onStop={stop} isActive />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Row({
  sess, busy, onJoin, onStop, isActive,
}: {
  sess: Sess; busy: boolean; isActive?: boolean
  onJoin: (id: string) => void; onStop: (id: string) => void
}) {
  const router = useRouter()
  const elapsedMin = Math.floor((Date.now() - new Date(sess.started_at).getTime()) / 60000)

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border ${
      isActive ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
        isActive ? 'bg-emerald-200 text-emerald-700' : 'bg-amber-200 text-amber-700'
      }`}>
        <User size={18} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <strong className="text-ink">{sess.user?.name || 'Sans nom'}</strong>
          <span className="text-xs text-ink-secondary">{sess.user?.role}</span>
          <span className="text-xs text-ink-secondary inline-flex items-center gap-1">
            <Clock size={11} />
            {elapsedMin === 0 ? 'à l instant' : `il y a ${elapsedMin} min`}
          </span>
        </div>
        {sess.user_message && (
          <p className="text-sm text-ink mt-1 italic">« {sess.user_message} »</p>
        )}
        {sess.user_url && (
          <p className="text-xs text-ink-secondary mt-1 inline-flex items-center gap-1 truncate">
            <Globe size={11} />
            <span className="truncate">{sess.user_url.replace(/^https?:\/\/[^/]+/, '')}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 flex-shrink-0">
        {isActive ? (
          <button
            type="button"
            onClick={() => router.push(`/admin/cobrowse/${sess.id}`)}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <Eye size={14} /> Voir
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onJoin(sess.id)}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <LifeBuoy size={14} /> Rejoindre
          </button>
        )}
        <button
          type="button"
          onClick={() => onStop(sess.id)}
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-white border border-red-200 text-red-700 text-sm hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <X size={14} /> {isActive ? 'Terminer' : 'Refuser'}
        </button>
      </div>
    </div>
  )
}
