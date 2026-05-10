// ============================================================
// GET /api/relances/preview-mock?level=1|2|3
// ============================================================
// CHECKPOINT 2 : genere un PDF mock avec donnees fictives, l upload dans
// le bucket privé 'reminders' (sous-prefixe 'mock/') et renvoie une
// signed URL pour validation visuelle Olivier avant toute integration
// data Odoo reelle.
//
// La route est protegee : module 'relances' actif sur user_modules.
// Pas de fallback admin/superadmin (convention projet).

export const dynamic     = 'force-dynamic'
export const maxDuration = 30   // @react-pdf/renderer : cold ~1s, gen ~500ms

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { generateReminderPdf, buildMockPdfData } from '@/lib/relances/pdf'
import { generateReminderXlsx, buildMockXlsxData } from '@/lib/relances/xlsx'
import { uploadReminderFile, SIGNED_URL_TTL_24H } from '@/lib/relances/storage'
import type { ReminderLevel }        from '@/lib/relances/odoo'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const userId = (session.user as any).id as string
  const supabase = createAdminClient()
  const { data: moduleRow } = await supabase
    .from('user_modules')
    .select('granted')
    .eq('user_id',   userId)
    .eq('module_id', 'relances')
    .eq('granted',   true)
    .maybeSingle()
  if (!moduleRow) {
    return NextResponse.json({ error: 'Module relances non activé' }, { status: 403 })
  }

  const url    = new URL(req.url)
  const lvlRaw = url.searchParams.get('level') || '1'
  const lvl    = parseInt(lvlRaw, 10)
  if (lvl !== 1 && lvl !== 2 && lvl !== 3) {
    return NextResponse.json({ error: 'level doit etre 1, 2 ou 3' }, { status: 400 })
  }

  const level = lvl as ReminderLevel
  const data  = buildMockPdfData(level)

  try {
    // Generations en parallele : PDF + XLSX a partir des memes donnees mock.
    const [pdfBuffer, xlsxBuffer] = await Promise.all([
      generateReminderPdf(data),
      Promise.resolve(generateReminderXlsx(buildMockXlsxData(level, data))),
    ])

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')

    // Upload PDF + XLSX en parallele (2 round-trips Storage independants)
    const [pdfUpload, xlsxUpload] = await Promise.all([
      uploadReminderFile({
        partnerId: 0,
        level,
        ext:       'pdf',
        buffer:    pdfBuffer,
        prefix:    'mock',
        fileName:  `checkpoint2-${ts}-L${level}.pdf`,
        ttlSec:    SIGNED_URL_TTL_24H,
      }),
      uploadReminderFile({
        partnerId: 0,
        level,
        ext:       'xlsx',
        buffer:    xlsxBuffer,
        prefix:    'mock',
        fileName:  `checkpoint2-${ts}-L${level}.xlsx`,
        ttlSec:    SIGNED_URL_TTL_24H,
      }),
    ])

    return NextResponse.json({
      ok:    true,
      level,
      ttl:   '24h',
      pdf: {
        signedUrl: pdfUpload.signedUrl,
        path:      pdfUpload.path,
        bytes:     pdfBuffer.length,
      },
      xlsx: {
        signedUrl: xlsxUpload.signedUrl,
        path:      xlsxUpload.path,
        bytes:     xlsxBuffer.length,
      },
      message: `PDF + XLSX mock L${level} generes et uploades. Ouvre les 2 signedUrl dans le navigateur pour validation.`,
    })
  } catch (e: any) {
    console.error('[relances/preview-mock]', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
