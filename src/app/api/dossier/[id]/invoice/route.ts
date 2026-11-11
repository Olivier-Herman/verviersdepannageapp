import { invalidateDossierCache } from '@/lib/dossier/build'
// src/app/api/dossier/[id]/invoice/route.ts
//
// POST { mission_ids: string[] } — facture les groupes cochés du dossier :
// une facture Odoo brouillon par client, créée directement (pas de devis).
// Accès : admin / superadmin / module facturation, ET la Vue dossier ouverte au
// rôle (superadmin seul tant qu'Olivier n'a pas libéré). Olivier 07/09/2026.

import { withRoutingMode } from '@/lib/routing/mode'
import { NextResponse }        from 'next/server'
import { getServerSession }    from 'next-auth'
import { sessionAccess }       from '@/lib/access'
import { authOptions }         from '@/lib/auth'
import { isPreviewOn }         from '@/lib/feature-flags'
import { invoiceDossierGroups } from '@/lib/dossier/invoice'
import { createAdminClient }   from '@/lib/supabase'
import { odooRpc, withOdooActor } from '@/lib/odoo'

async function lireBande(): Promise<{ min: number; max: number }> {
  let band = { min: 50, max: 300 }
  try {
    const { data } = await createAdminClient().from('app_settings').select('value').eq('key', 'auto_invoice_autopost_band').maybeSingle()
    const v = data?.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null
    if (v && typeof v.min === 'number' && typeof v.max === 'number') band = v
  } catch { /* défaut */ }
  return band
}

async function validerDansFourchette(ids: number[], band: { min: number; max: number }, userId: string | null) {
  const valides: { odoo_id: number; name: string | null }[] = [], nonValides: { odoo_id: number; raison: string }[] = []
  for (const id of ids) {
    try {
      const mv = (await withOdooActor(userId, () => odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['amount_untaxed', 'state', 'partner_id'] })))?.[0]
      const amt = Number(mv?.amount_untaxed || 0)
      if (!mv || mv.state !== 'draft') { nonValides.push({ odoo_id: id, raison: 'déjà validée ou introuvable' }); continue }
      if (!mv.partner_id) { nonValides.push({ odoo_id: id, raison: 'client manquant' }); continue }
      if (amt < band.min || amt > band.max) { nonValides.push({ odoo_id: id, raison: `${amt.toFixed(2)} € HTVA hors fourchette (${band.min}–${band.max} €)` }); continue }
      await withOdooActor(userId, () => odooRpc('account.move', 'action_post', [[id]]))
      const after = (await withOdooActor(userId, () => odooRpc<any[]>('account.move', 'read', [[id]], { fields: ['name'] })))?.[0]
      valides.push({ odoo_id: id, name: after?.name || null })
    } catch (e: any) { nonValides.push({ odoo_id: id, raison: `validation refusée : ${String(e?.message || e).slice(0, 140)}` }) }
  }
  return { valides, nonValides }
}

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function handlePOST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  // Rôle principal OU rôles secondaires (roles[]) OU module facturation.
  if (!sessionAccess(session, { modules: ['facturation'] }).ok) {
    return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  }
  if (role !== 'superadmin' && !(await isPreviewOn('dossier_view', role, (session.user as any)?.id))) {
    return NextResponse.json({ error: 'Vue dossier non ouverte à ton rôle.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  const missionIds: string[] = Array.isArray(body.mission_ids) ? body.mission_ids.filter((x: any) => typeof x === 'string') : []
  if (!missionIds.length) return NextResponse.json({ error: 'Aucun groupe coché' }, { status: 400 })
  try {
    const periodTo: Record<string, string> = {}
    if (body.period_to && typeof body.period_to === 'object') for (const [k, v] of Object.entries(body.period_to)) if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) periodTo[k] = v
    const linesOverride: Record<string, any[]> | undefined = body.lines_override && typeof body.lines_override === 'object' ? body.lines_override : undefined
    const result = await invoiceDossierGroups({ anyMissionId: params.id, missionIds, actorUserId: user.id || null, dryRun: body.dry_run === true, periodTo, linesOverride, asQuote: body.quote === true })
    invalidateDossierCache()   // la liste (cache 90 s) doit refléter la facture
    // R3 (préversion ma_journee, Olivier 11/11/2026) : « Créer et valider ». Même règle que le robot :
    // facture validée d'un coup si son montant HTVA est dans la fourchette auto_invoice_autopost_band
    // et que le client est connu ; sinon elle reste en brouillon (dit dans la réponse).
    const band = await lireBande()
    let valides: { odoo_id: number; name: string | null }[] = [], nonValides: { odoo_id: number; raison: string }[] = []
    if (body.valider === true && body.dry_run !== true && body.quote !== true && Array.isArray((result as any).invoices) && (result as any).invoices.length
        && await isPreviewOn('ma_journee', role, user.id)) {
      const r = await validerDansFourchette((result as any).invoices.map((i: any) => Number(i.odoo_id)).filter(Boolean), band, user.id || null)
      valides = r.valides; nonValides = r.nonValides
      if (valides.length) {
        try { const { syncDraftInvoiceNumbers } = await import('@/lib/odoo-invoice'); const sb = createAdminClient(); await syncDraftInvoiceNumbers(sb, valides.map(v => v.odoo_id)); const { settleRootIfDone } = await import('@/lib/dossier/settle'); await settleRootIfDone(sb, params.id, null) } catch (e: any) { console.warn('[dossier/invoice] numéros après validation KO:', e?.message) }
        invalidateDossierCache()
      }
    }
    return NextResponse.json({ ok: true, ...result, band, valides, nonValides })
  } catch (e: any) {
    const msg = String(e?.message || e)
    const status = /Odoo|introuvable \(default_code\)/i.test(msg) ? 502 : 400
    console.error('[dossier/invoice]', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}

// Facturation d'un dossier : geste humain, le calcul d'itinéraire peut recourir à Google si
// OpenRouteService lâche (src/lib/routing/mode.ts, 02/10/2026). Robots : gratuit.
export async function POST(...args: Parameters<typeof handlePOST>) {
  const internal = !!process.env.NEXTAUTH_SECRET && args[0].headers.get('x-internal-secret') === process.env.NEXTAUTH_SECRET
  return withRoutingMode(internal ? 'free' : 'paid', () => handlePOST(...args))
}
