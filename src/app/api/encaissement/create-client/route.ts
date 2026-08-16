// src/app/api/encaissement/create-client/route.ts
//
// POST — crée (ou retrouve) le client dans Odoo DÈS la validation des infos client
// dans le module d'encaissement chauffeur, sans attendre la validation du paiement.
// Renvoie l'id du partner Odoo pour que la soumission finale du paiement le relie
// (au lieu de le recréer). Olivier 2026-08-16.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { withOdooActor, findOrCreatePartner } from '@/lib/odoo'
import { parseAddressForOdoo } from '@/app/api/interventions/route'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const name = String(b.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Nom du client requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: actor } = await sb.from('users').select('id').eq('email', session.user.email).maybeSingle()

  // street/zip/city fournis directement, sinon parse de l'adresse texte.
  let street = String(b.street || '').trim()
  let zip    = String(b.zip || '').trim()
  let city   = String(b.city || '').trim()
  if (!street && b.address) { const p = parseAddressForOdoo(String(b.address)); street = p.street; zip = p.zip; city = p.city }

  try {
    const partnerId = await withOdooActor((actor as any)?.id || (session.user as any).id, () =>
      findOrCreatePartner({
        name,
        phone:       b.phone || undefined,
        email:       b.email || undefined,
        street,
        zip,
        city,
        countryCode: b.countryCode || 'BE',
      }),
    )
    if (!partnerId) return NextResponse.json({ error: 'Client Odoo non créé' }, { status: 502 })
    return NextResponse.json({ id: partnerId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Erreur Odoo' }, { status: 500 })
  }
}
