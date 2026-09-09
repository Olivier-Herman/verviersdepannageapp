// src/app/api/dossier/[id]/verify-invoices/route.ts
//
// POST — « Facturation OK » depuis la Vue dossier (Olivier 08/09/2026) : pour
// les brouillons Odoo du dossier, lit leur état ; s'ils sont confirmés, écrit
// le numéro sur les fiches et les lignes comptables. Même mécanique que le
// cron sync-invoice-urls (toutes les 20 min), mais à la demande.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { syncDraftInvoiceNumbers } from '@/lib/odoo-invoice'
import { buildDossier, invalidateDossierCache } from '@/lib/dossier/build'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  if (!['admin', 'superadmin'].includes(String(user.role || '')) && !modules.includes('facturation')) return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
  const sb = createAdminClient()
  // Vraie racine + tous les niveaux (REL de REL) : on passe par le dossier lui-même.
  const d = await buildDossier(params.id, { light: true })
  if (!d) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 })
  const ids = Array.from(new Set([d.root_id, ...d.legs.map(l => l.mission_id)]))
  const { data: rows } = await sb.from('incoming_missions').select('id, invoice_odoo_id, invoice_number').in('id', ids)
  const { data: items } = ids.length ? await sb.from('mission_billed_items').select('invoice_odoo_id, invoice_number').in('mission_id', ids) : { data: [] as any[] }
  const draftIds = Array.from(new Set([
    ...(rows || []).filter((r: any) => r.invoice_odoo_id && !r.invoice_number).map((r: any) => Number(r.invoice_odoo_id)),
    ...(items || []).filter((it: any) => it.invoice_odoo_id && !it.invoice_number).map((it: any) => Number(it.invoice_odoo_id)),
  ]))
  if (!draftIds.length) return NextResponse.json({ ok: true, synced: {}, pending: [] , message: 'Aucun brouillon en attente sur ce dossier.' })
  const synced = await syncDraftInvoiceNumbers(sb, draftIds)
  invalidateDossierCache()
  if (Object.keys(synced).length) { try { const { settleRootIfDone } = await import('@/lib/dossier/settle'); await settleRootIfDone(sb, params.id, null); invalidateDossierCache() } catch (e: any) { console.warn('[dossier/verify] settle KO:', e?.message) } }
  const pending = draftIds.filter(id => !synced[id])
  return NextResponse.json({ ok: true, synced, pending,
    message: Object.keys(synced).length
      ? `Facturation OK : ${Object.values(synced).join(', ')}${pending.length ? ` · ${pending.length} brouillon(s) encore à confirmer dans Odoo` : ''}`
      : `Toujours en brouillon dans Odoo (${pending.map(id => '#' + id).join(', ')}) : confirme la facture dans Odoo, puis reviens ici.` })
}
