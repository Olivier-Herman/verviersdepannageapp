// POST /api/assistance/vehicules — { plaque, marque, modele, garageId } : un véhicule de plus, relié à un garage
// partenaire (Olivier 10/10/2026). Le garage d'un véhicule ne se change pas ici : seul le dispatch le réaffecte.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getClientSession, lireVehicule, avertirGarage } from '@/lib/espace/clients'
import { getBusinessText } from '@/lib/settings/business'
import { normEmail } from '@/lib/espace/session'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const s = await getClientSession()
  if (!s) return NextResponse.json({ error: 'Session expirée : reconnectez-vous.' }, { status: 401 })
  const v = await lireVehicule(await req.json().catch(() => ({})))
  if (typeof v === 'string') return NextResponse.json({ error: v }, { status: 400 })
  const estDemo = normEmail(s.client.email) === normEmail(await getBusinessText('vd_assistance_demo_email').catch(() => ''))
  if (!!v.societe.demo !== estDemo) return NextResponse.json({ error: 'Ce garage n’est pas disponible pour votre compte.' }, { status: 403 })
  const sb = createAdminClient()
  const { data: existe } = await sb.from('espace_vehicules').select('id').eq('client_id', s.client.id).eq('plaque', v.plaque).eq('active', true).maybeSingle()
  if (existe) return NextResponse.json({ error: 'Ce véhicule est déjà dans votre liste.' }, { status: 409 })
  const { error } = await sb.from('espace_vehicules').insert({ client_id: s.client.id, societe_id: v.societe.id, garage_id: v.garage.id, plaque: v.plaque, marque: v.marque, modele: v.modele })
  if (error) return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 })
  await avertirGarage(v.societe, s.client, v, v.garage.nom).catch(() => {})
  return NextResponse.json({ ok: true })
}
