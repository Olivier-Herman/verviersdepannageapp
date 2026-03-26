// src/app/api/missions/source-lookup/route.ts
// Détermine la source depuis l'ID partenaire Odoo
// Si pas trouvé → prive. Si dispatcher modifie → propose d'ajouter.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const odooPartnerId = parseInt(searchParams.get('partner_id') || '0')

  if (!odooPartnerId) return NextResponse.json({ source: 'prive', found: false })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('mission_sources')
    .select('source, label')
    .eq('odoo_partner_id', odooPartnerId)
    .maybeSingle()

  return NextResponse.json({
    source: data?.source || 'prive',
    label:  data?.label  || null,
    found:  !!data,
  })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { odoo_partner_id, source, label } = await req.json()
  if (!odoo_partner_id || !source) {
    return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('mission_sources')
    .upsert(
      { odoo_partner_id, source, label },
      { onConflict: 'odoo_partner_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
