// src/app/api/admin/towsoft-migration/import-photos/route.ts
//
// POST /api/admin/towsoft-migration/import-photos
// Olivier 2026-06-04 : active le flag "scrape photos archive TowSoft" dans
// app_settings. Le scrape lui-meme n est PAS encore implemente (chantier
// post-prod). Pour l instant, le bouton sert juste a signaler la decision
// et tracer la date d activation.
//
// Quand on l implementera : un cron dedie filtrera flag_scanned=false AND
// detail_payload->>'photos_imported'='true' IS DISTINCT FROM 'true' et
// scrapera /Src/router.php?controller=Photo/PhotoImpound/...

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sb = createAdminClient()

  const { error } = await sb
    .from('app_settings')
    .upsert({
      key: 'towsoft_archive_photos_import',
      value: {
        enabled:     true,
        activated_at: new Date().toISOString(),
        activated_by: user.id,
      },
    }, { onConflict: 'key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    message: '✓ Flag active. L import des photos archive sera planifie ulterieurement (chantier post-prod).',
  })
}
