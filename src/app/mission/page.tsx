// src/app/mission/page.tsx — Liste des missions du chauffeur connecté
import { getServerSession } from 'next-auth'
import { redirect }         from 'next/navigation'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  assigned:    { label: 'À accepter',  color: 'text-blue-400' },
  accepted:    { label: 'Acceptée',    color: 'text-indigo-400' },
  in_progress: { label: 'En cours',    color: 'text-orange-400' },
  completed:   { label: 'Terminée',    color: 'text-zinc-500' },
}

export default async function MissionListPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const supabase = createAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('id, role, name')
    .eq('email', session.user.email!)
    .single()

  if (!user) redirect('/dashboard')

  const { data: missions } = await supabase
    .from('incoming_missions')
    .select('id, external_id, dossier_number, source, mission_type, status, client_name, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, received_at, assigned_at')
    .eq('assigned_to', user.id)
    .in('status', ['assigned', 'accepted', 'in_progress', 'completed'])
    .order('assigned_at', { ascending: false })
    .limit(20)

  const active    = missions?.filter(m => m.status !== 'completed') || []
  const completed = missions?.filter(m => m.status === 'completed') || []

  return (
    <AppShell title="Mes Missions" userRole={(session.user as any).role} userName={user.name ?? ''}>
      <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto space-y-6">

        {active.length === 0 && completed.length === 0 && (
          <div className="text-center py-16 text-zinc-600">
            <p className="text-4xl mb-4">🚗</p>
            <p className="font-medium text-white mb-1">Aucune mission assignée</p>
            <p className="text-sm">Les missions te seront notifiées automatiquement.</p>
          </div>
        )}

        {active.length > 0 && (
          <div>
            <h2 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3">En cours</h2>
            <div className="space-y-2">
              {active.map(m => {
                const st = STATUS_LABELS[m.status] || { label: m.status, color: 'text-zinc-400' }
                return (
                  <Link key={m.id} href={`/mission/${m.id}`}
                    className="block bg-[#1A1A1A] border border-[#2a2a2a] hover:border-brand/50 rounded-2xl p-4 transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-zinc-400 text-xs font-mono">{m.dossier_number || m.external_id}</span>
                      <span className={`text-xs font-semibold ${st.color}`}>{st.label}</span>
                    </div>
                    <p className="text-white font-semibold">{m.client_name || 'Client inconnu'}</p>
                    <p className="text-zinc-400 text-sm">{m.vehicle_brand} {m.vehicle_model} — {m.vehicle_plate}</p>
                    <p className="text-zinc-500 text-xs mt-1">{m.incident_address}{m.incident_city ? `, ${m.incident_city}` : ''}</p>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {completed.length > 0 && (
          <div>
            <h2 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3">Terminées</h2>
            <div className="space-y-2">
              {completed.map(m => (
                <Link key={m.id} href={`/mission/${m.id}`}
                  className="block bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4 opacity-60 hover:opacity-100 transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-400 text-xs font-mono">{m.dossier_number || m.external_id}</span>
                    <span className="text-zinc-500 text-xs">Terminée</span>
                  </div>
                  <p className="text-white font-semibold">{m.client_name || 'Client inconnu'}</p>
                  <p className="text-zinc-400 text-sm">{m.vehicle_plate}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
