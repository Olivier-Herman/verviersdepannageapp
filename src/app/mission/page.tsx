// src/app/mission/page.tsx — Liste des missions du chauffeur connecté
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import Link       from 'next/link'
import AppShell   from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import NewInterventionButton from '@/components/mission/NewInterventionButton'

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

  // Missions clôturées il y a moins de 6h → gardées dans la liste pour que le
  // chauffeur puisse encore modifier leur clôture (bouton dans la fiche).
  const sixHAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  const { data: missions } = await supabase
    .from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, source, mission_type, status, client_name, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, received_at, assigned_at, completed_at, awaiting_payment, amount_to_collect, payment_amount')
    .eq('assigned_to', user.id)
    // Olivier 2026-06-17 : une mission 'parked' est en parc (fourrière) → elle
    // sort de la liste active du chauffeur. On garde le cas awaiting_payment
    // (mission à encaisser) même si parked.
    // + missions terminées (to_invoice/completed) des 6 dernières heures :
    // clôture encore modifiable par le chauffeur.
    .or(`status.in.(assigned,accepted,in_progress,delivering),awaiting_payment.eq.true,and(status.in.(to_invoice,completed),completed_at.gte.${sixHAgo})`)
    .order('assigned_at', { ascending: false })
    .limit(20)

  const CLOSED    = ['to_invoice', 'completed']
  const active    = missions?.filter(m => !CLOSED.includes(m.status)) || []
  const completed = missions?.filter(m =>  CLOSED.includes(m.status)) || []

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
              <NewInterventionButton variant="cta" />
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
                        <span className="text-ink-secondary text-xs font-mono">{(m as any).mission_number != null ? `#${(m as any).mission_number}` : (m.dossier_number || m.external_id)}</span>
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
              <h2 className="text-ink-muted text-xs font-semibold uppercase tracking-widest mb-3">Terminées récemment · clôture modifiable 6h</h2>
              <div className="space-y-2">
                {completed.map(m => (
                  <Link key={m.id} href={`/mission/${m.id}`}
                    className="block bg-surface border border rounded-2xl p-4 opacity-75 hover:opacity-100 transition-all">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-ink-secondary text-xs font-mono">{(m as any).mission_number != null ? `#${(m as any).mission_number}` : (m.dossier_number || m.external_id)}</span>
                      <span className="text-amber-600 text-xs font-semibold">✏️ Modifiable</span>
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
        <NewInterventionButton variant="fab" />
      </AmbientBackground>
    </AppShell>
  )
}
