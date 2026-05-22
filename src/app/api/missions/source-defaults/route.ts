// src/app/api/missions/source-defaults/route.ts
//
// GET /api/missions/source-defaults?source=<key>
// Retourne les valeurs par defaut associees a une source dans le catalog
// (mission_source_catalog) : actuellement le client a facturer par defaut.
//
// Utilise dans /dispatch/new pour auto-completer le client facture quand le
// dispatcher choisit une source (ex: Touring -> Touring SA). Le dispatcher
// peut toujours surcharger le choix.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const source = (searchParams.get('source') || '').trim().toLowerCase()
  if (!source) {
    return NextResponse.json({ ok: false, error: 'source manquante' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data } = await sb
    .from('mission_source_catalog')
    .select('key, label, default_billed_to_id, default_billed_to_name')
    .eq('key', source)
    .maybeSingle()

  return NextResponse.json({
    ok:                      true,
    source,
    found:                   !!data,
    default_billed_to_id:    data?.default_billed_to_id   || null,
    default_billed_to_name:  data?.default_billed_to_name || null,
  })
}
