// src/app/api/missions/[id]/saisie-etats/route.ts
//
// États de frais d'une mission saisie (pour affichage sur la fiche) : liste des
// états de frais du dossier + leur statut + réf JustInvoice + lien facture Odoo.
// Olivier 2026-08-10.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { buildInvoiceMoveUrl } from '@/lib/odoo-quote'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()

  const { data: dossier } = await sb.from('saisie_dossiers')
    .select('id, ef_number, state, recipient, justinvoice_ref, odoo_invoice_id')
    .eq('mission_id', params.id).maybeSingle()
  if (!dossier) return NextResponse.json({ dossier: null, etats: [] })

  const { data: etats } = await sb.from('saisie_etats_frais')
    .select('id, numero, status, recipient, period_from, period_to, total_htva, total_tvac, justinvoice_ref, odoo_invoice_id, created_at')
    .eq('dossier_id', dossier.id)
    .order('created_at', { ascending: true }).order('id', { ascending: true })

  const withLinks = (etats || []).map((e: any) => ({
    ...e,
    odoo_url: e.odoo_invoice_id ? buildInvoiceMoveUrl(e.odoo_invoice_id) : null,
  }))

  return NextResponse.json({ dossier, etats: withLinks })
}
