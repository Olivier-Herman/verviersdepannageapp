// src/app/mission/page.tsx — Liste des missions du chauffeur connecté
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import Link       from 'next/link'
import AppShell   from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  assigned:    { label: 'À accepter',  color: 'text-blue-400'   },
  accepted:    { label: 'Acceptée',    color: 'text-indigo-400' },
  in_progress: { label: 'En cours',    color: 'text-orange-400' },
  delivering:  { label: 'En livraison',color: 'text-amber-400'  },
  parked:      { label: 'En dépôt',    color: 'text-purple-400' },
  completed:   { label: 'Terminée',    color: 'text-ink-muted'   },
}

export default async function MissionListPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, role, roles, name, nav_app')
    .eq('email', session.user.email!)
    .single()

  if (!user) redirect('/dashboard')

  const { data: missions } = await supabase
    .from('incoming_missions')
    .select('id, external_id, dossier_number, source, mission_type, status, client_name, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, received_at, assigned_at')
    .eq('assigned_to', user.id)
    .in('status', ['assigned', 'accepted', 'in_progress', 'delivering'])
    .order('assigned_at', { ascending: false })
    .limit(20)

  const active    = missions?.filter(m => m.status !== 'completed') || []
  const completed = missions?.filter(m => m.status === 'completed') || []

  return (
    <AppShell
      title="Mes Missions"
      userRole={user.role ?? (session.user as any).role ?? ''}
      userName={user.name ?? ''}
      userModules={(session.user as any).modules ?? []}
    >
      {/* Wrapper relatif pour positionner le FAB */}
      <AmbientBackground>
        <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto space-y-6 pb-24 ambient-fade-up">

          {active.length === 0 && completed.length === 0 && (
            <div className="text-center py-16 text-ink-faint">
              <p className="text-4xl mb-4">🚗</p>
              <p className="font-medium text-ink mb-1">Aucune mission assignée</p>
              <p className="text-sm mb-6">Les missions te seront notifiées automatiquement.</p>
              <Link href="/mission/new"
                className="inline-flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-semibold text-sm">
                + Nouvelle intervention
              </Link>
            </div>
          )}

          {active.length > 0 && (
            <div>
              <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">En cours</h2>
              <div className="space-y-2">
                {active.map(m => {
                  const st = STATUS_LABELS[m.status] || { label: m.status, color: 'text-ink-secondary' }
                  return (
                    <Link key={m.id} href={`/mission/${m.id}`}
                      className="block bg-surface border border hover:border-brand/50 rounded-2xl p-4 transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-ink-secondary text-xs font-mono">{m.dossier_number || m.external_id}</span>
                        <span className={`text-xs font-semibold ${st.color}`}>{st.label}</span>
                      </div>
                      <p className="text-ink font-semibold">{m.client_name || 'Client inconnu'}</p>
                      <p className="text-ink-secondary text-sm">{m.vehicle_brand} {m.vehicle_model} — {m.vehicle_plate}</p>
                      <p className="text-ink-muted text-xs mt-1">{m.incident_address}{m.incident_city ? `, ${m.incident_city}` : ''}</p>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">Terminées</h2>
              <div className="space-y-2">
                {completed.map(m => (
                  <Link key={m.id} href={`/mission/${m.id}`}
                    className="block bg-surface border border rounded-2xl p-4 opacity-60 hover:opacity-100 transition-all">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-ink-secondary text-xs font-mono">{m.dossier_number || m.external_id}</span>
                      <span className="text-ink-muted text-xs">Terminée</span>
                    </div>
                    <p className="text-ink font-semibold">{m.client_name || 'Client inconnu'}</p>
                    <p className="text-ink-secondary text-sm">{m.vehicle_plate}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* ── FAB Nouvelle intervention ─────────────────────────────────── */}
        <Link
          href="/mission/new"
          className="fixed bottom-6 right-5 w-16 h-16 bg-brand rounded-full shadow-2xl flex items-center justify-center text-ink text-3xl font-bold z-20 active:scale-95 transition-transform"
          title="Nouvelle intervention"
        >
          +
        </Link>
      </AmbientBackground>
    </AppShell>
  )
}
