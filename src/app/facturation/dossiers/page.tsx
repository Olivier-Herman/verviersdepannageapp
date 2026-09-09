// src/app/facturation/dossiers/page.tsx
//
// Facturation PAR DOSSIER (Olivier 07/09/2026, maquette validée) : une ligne =
// un dossier, lettres des groupes (prêt / facturé / en cours / rien), reste à
// facturer, éligibilité auto, factures reliées. « Facturer » = la même modale
// que la Vue dossier (une facture Odoo par client, créée directement).
// Preview superadmin (flag dossier_view). Le module /facturation actuel reste
// inchangé.

import { getServerSession }  from 'next-auth'
import { redirect }          from 'next/navigation'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isPreviewOn }       from '@/lib/feature-flags'
import { buildDossier, type Dossier } from '@/lib/dossier/build'
import { getAutoInvoiceRules, checkAutoInvoiceEligible } from '@/lib/facturation/auto-invoice'
import AppShell              from '@/components/layout/AppShell'
import DossiersClient        from './DossiersClient'

export const dynamic = 'force-dynamic'

const MAX_DOSSIERS = 80

export default async function FacturationDossiersPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const u = session.user as any
  const role: string = u.role || ''
  const modules: string[] = u.modules || []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) redirect('/dashboard?error=access_denied')
  if (role !== 'superadmin' && !(await isPreviewOn('dossier_view', role, u.id))) redirect('/facturation')

  const sb = createAdminClient()

  // Racines candidates : fiches à facturer + gardiennages terminés pas encore
  // facturés + fiches facturées récemment (onglet « Facturées »).
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [{ data: toInv }, { data: legsDone }, { data: recent }, { data: legsOpen }] = await Promise.all([
    sb.from('incoming_missions').select('id, parent_mission_id, completed_at')
      .eq('status', 'to_invoice').eq('dossier_leg', false).is('archived_at', null)
      .not('external_id', 'like', 'PROCESSING_%').order('completed_at', { ascending: false }).limit(300),
    sb.from('incoming_missions').select('id, parent_mission_id, parc_exit_at')
      .eq('dossier_leg', true).not('parc_exit_at', 'is', null).is('invoice_odoo_id', null).is('invoice_number', null)
      .order('parc_exit_at', { ascending: false }).limit(200),
    sb.from('incoming_missions').select('id, parent_mission_id, invoiced_at')
      .eq('dossier_leg', false).gte('invoiced_at', since30).order('invoiced_at', { ascending: false }).limit(120),
    // Gardiennages ouverts depuis 7 nuits ou plus : à ne pas oublier (onglet En cours, facturation partielle).
    sb.from('incoming_missions').select('id, parent_mission_id, parked_at')
      .eq('dossier_leg', true).is('parc_exit_at', null).lte('parked_at', since7).order('parked_at', { ascending: true }).limit(60),
  ])
  const rootOf = (m: any) => m.parent_mission_id || m.id
  const seen = new Set<string>()
  const roots: string[] = []
  for (const m of [...(toInv || []), ...(legsDone || []), ...(recent || []), ...(legsOpen || [])]) {
    const r = rootOf(m); if (seen.has(r)) continue; seen.add(r); roots.push(r)
    if (roots.length >= MAX_DOSSIERS) break
  }

  // Un gardiennage terminé mais sans facture ne vaut une ligne que si les
  // postes n'ont pas déjà été réglés par une facture partielle.
  const dossiers: Dossier[] = []
  // Construction LÉGÈRE (montants figés) : la page doit s'afficher tout de
  // suite. Tarifer les 80 dossiers ici mettait 24 s avant le premier pixel
  // (Olivier 09/09/2026) — chaque fiche enchaîne requêtes et itinéraires.
  // Le client redemande ensuite chaque dossier tarifé (mode=list) et remplace
  // les montants au fur et à mesure : l'écran est utilisable en 2 s et
  // l'information reste juste, c'est de là qu'on facture.
  for (const batch of chunk(roots, 40)) {
    const built = await Promise.all(batch.map(id => buildDossier(id, { light: true, cache: true }).catch(() => null)))
    for (const d of built) if (d) dossiers.push(d)
  }

  // Éligibilité auto (règles source/type sur la racine) — même moteur que le cron.
  const rules = await getAutoInvoiceRules(sb)
  const rootRows = dossiers.length
    ? (await sb.from('incoming_missions').select('id, source, mission_type, parent_mission_id, billed_to_name').in('id', dossiers.map(d => d.root_id))).data || []
    : []
  const autoById: Record<string, boolean> = {}
  for (const r of rootRows) autoById[(r as any).id] = checkAutoInvoiceEligible(r as any, rules).eligible

  // Touring : dossiers présents dans COMEX BKO → circuit « validation Touring »
  // (page /touring-comex), pas de facture Odoo d'ici tant que ce n'est pas accepté.
  const comexById: Record<string, { verdict: string | null; montant: number | null; accepted_at: string | null; dossier: string | null }> = {}
  if (dossiers.length) {
    const { data: cx } = await sb.from('touring_comex_dossiers').select('mission_id, mission_ids, verdict, montant, accepted_at, dossier, in_comex').eq('in_comex', true)
    for (const c of cx || []) {
      const ids = [(c as any).mission_id, ...(Array.isArray((c as any).mission_ids) ? (c as any).mission_ids : [])].filter(Boolean)
      for (const d of dossiers) if (d.legs.some(l => ids.includes(l.mission_id)) || ids.includes(d.root_id)) comexById[d.root_id] = { verdict: (c as any).verdict || null, montant: (c as any).montant ?? null, accepted_at: (c as any).accepted_at || null, dossier: (c as any).dossier || null }
    }
  }

  return (
    <AppShell title="Facturation par dossier" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={role} userModules={modules}>
      <DossiersClient initial={dossiers} autoById={autoById} comexById={comexById} isSuperadmin={role === 'superadmin'} capped={roots.length >= MAX_DOSSIERS} />
    </AppShell>
  )
}

function chunk<T>(arr: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
