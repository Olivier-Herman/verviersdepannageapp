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
import { loadFacturationDossiers, loadComexById, refreshTodoCountFrom, MAX_DOSSIERS } from '@/lib/dossier/todo-count'
import { getAutoInvoiceRules, checkAutoInvoiceEligible } from '@/lib/facturation/auto-invoice'
import AppShell              from '@/components/layout/AppShell'
import DossiersClient        from './DossiersClient'
import { billingGroups } from '@/lib/missions/source-catalog'

export const dynamic = 'force-dynamic'


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

  // Racines candidates + construction LÉGÈRE : dans lib/dossier/todo-count.ts,
  // partagée avec le cron qui alimente la pastille du menu (même moteur, même
  // chiffre que la puce « Toutes (hors Touring) »). Construction légère : la
  // page doit s'afficher tout de suite ; le client redemande ensuite chaque
  // dossier tarifé (mode=list) et remplace les montants au fur et à mesure.
  const { dossiers, roots } = await loadFacturationDossiers(sb)

  // Éligibilité auto (règles source/type sur la racine) — même moteur que le cron.
  const rules = await getAutoInvoiceRules(sb)
  const rootRows = dossiers.length
    ? (await sb.from('incoming_missions').select('id, source, mission_type, parent_mission_id, billed_to_name').in('id', dossiers.map(d => d.root_id))).data || []
    : []
  const autoById: Record<string, boolean> = {}
  for (const r of rootRows) autoById[(r as any).id] = checkAutoInvoiceEligible(r as any, rules).eligible

  // Touring : dossiers présents dans COMEX BKO → circuit « validation Touring »
  // (page /touring-comex), pas de facture Odoo d'ici tant que ce n'est pas accepté.
  const comexById = await loadComexById(sb, dossiers)
  // La pastille du menu reprend ce chiffre (cache), sans attendre le cron. Le
  // comptage précis reconstruit les candidats en complet : après la réponse,
  // pour ne pas retarder l'affichage (waitUntil garde la fonction vivante).
  const refresh = refreshTodoCountFrom(sb, dossiers, comexById).catch(() => {})
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(refresh) } catch { /* hors Vercel : la promesse suit son cours */ }

  return (
    <AppShell title="Facturation par dossier" userName={u.name || ''} userEmail={u.email || undefined} userId={u.id} userRole={role} userModules={modules}>
      <DossiersClient initial={dossiers} autoById={autoById} comexById={comexById} isSuperadmin={role === 'superadmin'} billingGroups={await billingGroups()} capped={roots.length >= MAX_DOSSIERS} />
    </AppShell>
  )
}

