// src/app/admin/page.tsx
//
// Page Réglages (ex-Administration), option C validée par Olivier le 11/11/2026 :
// recherche, « Au quotidien », 8 rubriques, « Rangé ». Le contenu vient du catalogue
// unique src/lib/admin/reglages.ts ; ici on ne calcule que l'accès et les alertes.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { readAxaHealth, axaDownSince } from '@/lib/axa/health'
import { isPreviewOn }       from '@/lib/feature-flags'
import ReglagesClient        from './ReglagesClient'
import ReglagesV2Client, { type ChiffresReglages } from './ReglagesV2Client'
import { BUSINESS_SETTINGS } from '@/lib/settings/business-registry'

export const dynamic = 'force-dynamic'

export default async function AdminPage({ searchParams }: { searchParams?: { apercu?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const user = session.user as any
  const isAdmin = ['admin', 'superadmin'].some(r => (user.roles || [user.role]).includes(r))
  if (!isAdmin) redirect('/dashboard?error=access_denied')

  const sb = createAdminClient()
  const [obd, axaHealth, srcMissing] = await Promise.all([
    isPreviewOn('obd_diagnostic', user.role, user.id),
    readAxaHealth(sb).catch(() => null),
    sb.from('mission_source_catalog').select('*', { count: 'exact', head: true }).eq('active', true).is('default_billed_to_id', null)
      .then(r => r.count || 0, () => 0),
  ])

  // Alertes à traiter, rattachées à la page qui les règle (affichées en tête et sur l'écran).
  const alertes: Record<string, string> = {}
  if (axaHealth && !axaHealth.ok) alertes['/admin/axa'] = `AXA go&assist déconnecté ${axaDownSince(axaHealth)} : réamorcer la connexion`
  if (srcMissing > 0) alertes['/admin/sources'] = `${srcMissing} source${srcMissing > 1 ? 's' : ''} sans client facturé par défaut`

  // Aperçu du nouvel habillage (Olivier 11/11/2026) : /admin?apercu=1, tant qu'il n'est pas validé.
  if (searchParams?.apercu === '1') {
    const n = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count || 0, () => 0)
    const tete = (t: string) => sb.from(t).select('*', { count: 'exact', head: true })
    const depuis30j = new Date(Date.now() - 30 * 864e5).toISOString()
    const depuis24h = new Date(Date.now() - 864e5).toISOString()
    const [aValider, demandes, caisse30, sources, depots, camions, tarifs, majorations, zones, emplacements, motifs, utilisateurs, garages, erreurs] = await Promise.all([
      n(tete('agent_proposals').eq('status', 'to_validate')),
      n(tete('site_requests').eq('status', 'nouveau')),
      n(tete('cash_register').gte('created_at', depuis30j)),
      n(tete('mission_source_catalog').eq('active', true)),
      n(tete('depots').eq('active', true)),
      n(tete('trucks')),
      n(tete('source_tariffs')),
      n(tete('surcharge_schedules')),
      n(tete('parc_zones')),
      n(tete('parc_slots')),
      n(tete('reception_motifs')),
      n(tete('users').eq('active', true)),
      n(tete('garage_partners')),
      n(tete('error_logs').eq('level', 'error').gte('created_at', depuis24h)),
    ])
    const pl = (k: number, un: string, plusieurs: string) => `${k} ${k > 1 ? plusieurs : un}`
    const chiffres: ChiffresReglages = {
      etat: [
        ...(axaHealth ? [{ label: 'Connexion AXA', valeur: axaHealth.ok ? 'Branchée' : 'Coupée', ok: !!axaHealth.ok, href: '/admin/axa' }] : []),
        { label: 'Erreurs depuis hier', valeur: String(erreurs), ok: erreurs === 0, ...(user.role === 'superadmin' ? { href: '/admin/logs' } : {}) },
        { label: 'Comptes actifs', valeur: String(utilisateurs), href: '/admin/users' },
        { label: 'Sources actives', valeur: String(sources), href: '/admin/sources' },
      ],
      quotidien: {
        '/admin/agents':        { n: aValider, legende: aValider ? pl(aValider, 'proposition à valider', 'propositions à valider') : 'Rien à valider' },
        '/paiements':           { legende: 'Lot du jour à 14 h 30' },
        '/admin/cash':          { legende: `${pl(caisse30, 'mouvement', 'mouvements')} en 30 jours` },
        '/admin/demandes-site': { n: demandes, legende: demandes ? pl(demandes, 'demande à traiter', 'demandes à traiter') : 'Aucune demande en attente' },
      },
      rubriques: {
        missions:      `${pl(sources, 'source', 'sources')} · ${pl(depots, 'dépôt', 'dépôts')} · ${pl(camions, 'dépanneuse', 'dépanneuses')}`,
        prix:          `${pl(tarifs, 'grille', 'grilles')} · ${pl(majorations, 'majoration', 'majorations')}`,
        parc:          `${pl(zones, 'zone', 'zones')} · ${pl(emplacements, 'emplacement', 'emplacements')}`,
        accueil:       pl(motifs, 'motif de visite', 'motifs de visite'),
        personnes:     `${pl(utilisateurs, 'compte actif', 'comptes actifs')} · ${pl(garages, 'garage', 'garages')}`,
        notifications: 'Destinataires et sons',
        general:       `${BUSINESS_SETTINGS.length + 4} réglages`,
        surveillance:  erreurs ? `${pl(erreurs, 'erreur', 'erreurs')} depuis hier` : 'Aucune erreur depuis hier',
      },
    }
    const prenom = String(user.name || '').trim().split(/\s+/)[0] || ''
    return <ReglagesV2Client superadmin={user.role === 'superadmin'} obd={obd} alertes={alertes} chiffres={chiffres} prenom={prenom} />
  }

  return <ReglagesClient superadmin={user.role === 'superadmin'} obd={obd} alertes={alertes} />
}
