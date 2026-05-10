// ============================================================
// POST /api/relances/preview
// ============================================================
// Genere un apercu PDF + XLSX a partir des VRAIES donnees Odoo d'un
// partner specifique. Utilise par le bouton "Apercu" de l UI avant
// d envoyer la relance pour verification finale.
//
// Body :
//   { partnerId: number, level: 1|2|3 }
//
// Reponse :
//   { ok: true, pdf: { signedUrl, path, bytes }, xlsx: { ... },
//     totalDue, invoiceCount, reference }
//
// Storage : reminders/preview/<partnerId>/<ts>-L<level>.{pdf|xlsx}
// TTL signed URL : 24h (apercu temporaire, pas un envoi reel)
//
// Pas d insertion en base invoice_reminders : preview ne trace rien.
// Le tracking est fait uniquement par /api/relances/send.

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { generateReminderPdf }       from '@/lib/relances/pdf'
import { generateReminderXlsx }      from '@/lib/relances/xlsx'
import { uploadReminderFile, SIGNED_URL_TTL_24H } from '@/lib/relances/storage'
import { getOverdueInvoicesGroupedByPartner,
         type ReminderLevel }        from '@/lib/relances/odoo'
import { groupToPdfData, groupToXlsxData,
         buildReminderReference }    from '@/lib/relances/transform'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const userId   = (session.user as any).id as string
  const supabase = createAdminClient()
  const { data: moduleRow } = await supabase
    .from('user_modules')
    .select('granted')
    .eq('user_id',   userId)
    .eq('module_id', 'relances')
    .eq('granted',   true)
    .maybeSingle()
  if (!moduleRow) return NextResponse.json({ error: 'Module relances non activé' }, { status: 403 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON body requis' }, { status: 400 })
  }
  const partnerId = parseInt(String(body?.partnerId), 10)
  const lvlNum    = parseInt(String(body?.level), 10)
  if (!partnerId || (lvlNum !== 1 && lvlNum !== 2 && lvlNum !== 3)) {
    return NextResponse.json({ error: 'partnerId (number) et level (1|2|3) requis' }, { status: 400 })
  }
  const level = lvlNum as ReminderLevel

  // Pull factures echues pour CE partner depuis Odoo (via le helper global,
  // puis filtre cote Node — la perf est acceptable pour un apercu unique).
  let groups
  try {
    const r = await getOverdueInvoicesGroupedByPartner()
    groups  = r.groups
  } catch (e: any) {
    console.error('[relances/preview] Odoo:', e.message)
    return NextResponse.json({ error: `Erreur Odoo : ${e.message}` }, { status: 502 })
  }

  const group = groups.find(g => g.partnerId === partnerId)
  if (!group) {
    return NextResponse.json(
      { error: `Aucune facture echue trouvee pour le partner ${partnerId}` },
      { status: 404 }
    )
  }

  const today    = new Date().toISOString().slice(0, 10)
  const ref      = buildReminderReference({ partnerId, level, date: today })
  const pdfData  = groupToPdfData(group,  level, ref, today)
  const xlsxData = groupToXlsxData(group, level, ref, today)

  try {
    const [pdfBuffer, xlsxBuffer] = await Promise.all([
      generateReminderPdf(pdfData),
      Promise.resolve(generateReminderXlsx(xlsxData)),
    ])

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')

    const [pdfUpload, xlsxUpload] = await Promise.all([
      uploadReminderFile({
        partnerId,
        level,
        ext:       'pdf',
        buffer:    pdfBuffer,
        prefix:    'preview',
        fileName:  `${partnerId}/${ts}-L${level}.pdf`,
        ttlSec:    SIGNED_URL_TTL_24H,
      }),
      uploadReminderFile({
        partnerId,
        level,
        ext:       'xlsx',
        buffer:    xlsxBuffer,
        prefix:    'preview',
        fileName:  `${partnerId}/${ts}-L${level}.xlsx`,
        ttlSec:    SIGNED_URL_TTL_24H,
      }),
    ])

    return NextResponse.json({
      ok:           true,
      partnerId,
      partnerName:  group.partnerName,
      level,
      reference:    ref,
      totalDue:     group.totalResidual,
      invoiceCount: group.invoices.length,
      ttl:          '24h',
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
    })
  } catch (e: any) {
    console.error('[relances/preview]', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
