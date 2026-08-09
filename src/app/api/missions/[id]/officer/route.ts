// src/app/api/missions/[id]/officer/route.ts
//
// Lie (ou crée) le CONTACT POLICIER d'une fiche depuis la vue Relance
// réquisitoires. Deux usages :
//   POST { partner_id, name }                    → lie un contact Odoo existant
//   POST { create:true, name, email?, phone?, company_id? } → crée le contact
//        (sous la société = zone de police) puis le lie
// Dans les deux cas : met à jour officer_partner_id + officer_name sur la fiche
// et renvoie l'email résolu (pour débloquer l'envoi de relance).
// Personnel fourrière / admin. Olivier 2026-08-09.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'
import { sessionAccess }     from '@/lib/access'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  const { id: actorId, ok } = sessionAccess(session, { modules: ['fourriere'] })
  if (!ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const body = await req.json().catch(() => ({} as any))
  const create    = !!body.create
  const companyId = Number(body.company_id) || null
  let   partnerId = Number(body.partner_id) || null
  let   name      = String(body.name || '').trim()

  try {
    // 1) Création d'un contact policier (sous la société = zone de police).
    if (create) {
      if (!name) return NextResponse.json({ error: 'Nom du policier requis' }, { status: 400 })
      const vals: Record<string, any> = { name, is_company: false }
      if (companyId)   vals.parent_id = companyId
      const email = String(body.email || '').trim()
      const phone = String(body.phone || '').trim()
      if (email) vals.email = email
      if (phone) vals.phone = phone
      partnerId = await odooRpc<number>('res.partner', 'create', [vals])
    }

    if (!partnerId) return NextResponse.json({ error: 'partner_id ou create requis' }, { status: 400 })

    // 2) Relit le contact (nom + email de vérité côté Odoo).
    const rows = await odooRpc<any[]>('res.partner', 'read', [[partnerId]], { fields: ['name', 'email'] })
    const p = rows?.[0]
    if (!name && p?.name) name = p.name
    const email = String(p?.email || '').trim()
    const emailOk = email && /@/.test(email) ? email : null

    // 3) Rattache à la fiche.
    const { error } = await sb.from('incoming_missions')
      .update({ officer_partner_id: partnerId, officer_name: name || null, updated_at: new Date().toISOString() })
      .eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('mission_logs').insert({
      mission_id: params.id, actor_id: actorId,
      action: create ? 'officer_created' : 'officer_linked',
      notes: `Policier ${create ? 'créé et ' : ''}rattaché : ${name || '—'}${emailOk ? ` <${emailOk}>` : ' (sans email)'}.`,
      metadata: { partner_id: partnerId, email: emailOk },
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, partner_id: partnerId, officer_name: name || null, email: emailOk })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur Odoo' }, { status: 500 })
  }
}
