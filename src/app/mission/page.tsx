// src/app/mission/page.tsx — Liste des missions du chauffeur connecté
import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import Link       from 'next/link'
import AppShell   from '@/components/layout/AppShell'
import AmbientBackground from '@/components/AmbientBackground'
import NewInterventionButton from '@/components/mission/NewInterventionButton'
import ParcRelivraisonButton from '@/components/mission/ParcRelivraisonButton'
import MissionsDuJourEasterEgg from '@/components/mission/MissionsDuJourEasterEgg'

export const dynamic = 'force-dynamic'

// Début du jour courant (Europe/Brussels) en ISO UTC — pour compter les missions
// « du jour » du chauffeur (easter egg). Robuste été/hiver via l'offset courant.
function belgianTodayStartISO(): string {
  const now = new Date()
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(now).split('-').map(Number)
  const offsetMs = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Brussels' })).getTime()
                 - new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs).toISOString()
}

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
    .select('id, mission_number, external_id, dossier_number, source, mission_type, status, client_name, vehicle_plate, vehicle_brand, vehicle_model, incident_address, incident_city, received_at, assigned_at, completed_at, parked_at, awaiting_payment, amount_to_collect, payment_amount')
    .eq('assigned_to', user.id)
    // Olivier 2026-06-17 : une mission 'parked' est en parc (fourrière) → elle
    // sort de la liste active du chauffeur. On garde le cas awaiting_payment
    // (mission à encaisser) même si parked.
    // + missions terminées (to_invoice/completed) des 6 dernières heures :
    // clôture encore modifiable par le chauffeur.
    // + missions MISES EN PARC dans les 6 dernières heures : une mise en parc
    //   fait sortir la mission de la liste à la seconde même. Le 29/08, Fred a
    //   montré un écran VIDE à Jona après une mission qu'il venait de faire —
    //   elle avait été forcée en parc entre-temps, et plus rien ne prouvait à
    //   l'écran qu'il l'avait faite. Un chauffeur doit voir sa journée finir.
    //   (Olivier 2026-08-31, cas 1BIL216.)
    .or(`status.in.(assigned,accepted,in_progress,delivering),awaiting_payment.eq.true,and(status.in.(to_invoice,completed),completed_at.gte.${sixHAgo}),and(status.eq.parked,parked_at.gte.${sixHAgo})`)
    .order('assigned_at', { ascending: false })
    .limit(20)

  const CLOSED    = ['to_invoice', 'completed']
  const active    = missions?.filter(m => !CLOSED.includes(m.status)) || []

  // Easter egg : missions du chauffeur AUJOURD'HUI + RECORD PERSO (meilleure journée).
  // On récupère les dates d'assignation (léger : timestamps only), on groupe par
  // jour belge et on prend le max. Le jour courant est inclus → on distingue le
  // record HORS aujourd'hui pour détecter un nouveau record.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())
  const { data: hist } = await supabase
    .from('incoming_missions')
    .select('assigned_at')
    .eq('assigned_to', user.id)
    .not('assigned_at', 'is', null)
    .order('assigned_at', { ascending: false })
    .limit(6000)
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' })
  const byDay = new Map<string, number>()
  for (const r of hist || []) {
    const k = dayFmt.format(new Date((r as any).assigned_at))
    byDay.set(k, (byDay.get(k) || 0) + 1)
  }
  const todayCount = byDay.get(todayKey) || 0
  let prevBest = 0
  for (const [k, n] of byDay) if (k !== todayKey && n > prevBest) prevBest = n
  const record    = Math.max(prevBest, todayCount)
  const newRecord = todayCount > prevBest && todayCount > 0

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

          {/* Easter egg discret : date du jour → 3 taps = compteur du jour + record perso */}
          <MissionsDuJourEasterEgg count={todayCount} record={record} newRecord={newRecord} firstName={(user.name || '').split(' ')[0]} />

          {active.length === 0 && (
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

        </div>

        {/* ── FAB Nouvelle intervention ─────────────────────────────────── */}
        <NewInterventionButton variant="fab" />
        {/* Parc de relivraison : le chauffeur peut sortir lui-même un véhicule du
            parc K sans avoir à scanner un QR qui n'est pas encore collé dessus. */}
        <ParcRelivraisonButton />
      </AmbientBackground>
    </AppShell>
  )
}
