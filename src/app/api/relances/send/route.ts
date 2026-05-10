// ============================================================
// POST /api/relances/send
// ============================================================
// Envoi groupe de relances. Pour chaque partner_id :
//   1. fetch ses factures echues via le helper Odoo
//   2. determine le niveau effectif (force ou calcule)
//   3. genere PDF + XLSX
//   4. upload bucket reminders/<partnerId>/L<level>-<ts>.{ext} (TTL 1 an)
//   5. si NOT dryRun : envoie email via sendReminderEmail (Graph)
//   6. INSERT invoice_reminders avec dry_run = body.dryRun
//
// Body :
//   { partnerIds: number[], level: 1|2|3 | 'AUTO', dryRun: boolean }
//
// Reponse :
//   { ok: true, results: [{ partnerId, partnerName, level, ok, error?,
//     reference, totalDue, invoiceCount, pdfPath, xlsxPath,
//     reminderId? (uuid invoice_reminders), dryRun }] }
//
// Strategy : on traite chaque partner SEQUENTIELLEMENT pour eviter
// de saturer Graph (rate limits) et Odoo (1 fetch group au debut couvre tout).
// Si un envoi echoue (pas d email, Graph 5xx, etc.) on continue avec
// les autres et on remonte l erreur dans results[].

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { generateReminderPdf }       from '@/lib/relances/pdf'
import { generateReminderXlsx }      from '@/lib/relances/xlsx'
import { uploadReminderFile, SIGNED_URL_TTL_1Y } from '@/lib/relances/storage'
import { getOverdueInvoicesGroupedByPartner,
         computeLevel,
         type ReminderLevel,
         type PartnerOverdueGroup }  from '@/lib/relances/odoo'
import { groupToPdfData, groupToXlsxData,
         buildReminderReference }    from '@/lib/relances/transform'
import { sendReminderEmail }         from '@/lib/relances/email'

interface SendBody {
  partnerIds: number[]
  level:      1 | 2 | 3 | 'AUTO'
  dryRun:     boolean
}

interface SendResult {
  partnerId:    number
  partnerName?: string
  level?:       ReminderLevel
  ok:           boolean
  error?:       string
  reference?:   string
  totalDue?:    number
  invoiceCount?: number
  pdfPath?:     string
  xlsxPath?:    string
  reminderId?:  string
  dryRun:       boolean
}

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

  let body: SendBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON body requis' }, { status: 400 })
  }
  const { partnerIds, level: levelRaw, dryRun } = body
  if (!Array.isArray(partnerIds) || partnerIds.length === 0) {
    return NextResponse.json({ error: 'partnerIds (number[]) requis' }, { status: 400 })
  }
  if (levelRaw !== 'AUTO' && levelRaw !== 1 && levelRaw !== 2 && levelRaw !== 3) {
    return NextResponse.json({ error: 'level doit etre AUTO, 1, 2 ou 3' }, { status: 400 })
  }
  if (typeof dryRun !== 'boolean') {
    return NextResponse.json({ error: 'dryRun (boolean) requis' }, { status: 400 })
  }

  // Pull factures Odoo une seule fois pour tous les partners demandes.
  let allGroups: PartnerOverdueGroup[]
  try {
    const r = await getOverdueInvoicesGroupedByPartner()
    allGroups = r.groups
  } catch (e: any) {
    console.error('[relances/send] Odoo:', e.message)
    return NextResponse.json({ error: `Erreur Odoo : ${e.message}` }, { status: 502 })
  }

  const today   = new Date().toISOString().slice(0, 10)
  const results: SendResult[] = []

  for (const partnerId of partnerIds) {
    const result: SendResult = { partnerId, ok: false, dryRun }

    try {
      const group = allGroups.find(g => g.partnerId === partnerId)
      if (!group) {
        result.error = 'Aucune facture echue trouvee pour ce partner'
        results.push(result)
        continue
      }
      result.partnerName = group.partnerName

      // Niveau effectif : AUTO = celui calcule, sinon force
      const effectiveLevel: ReminderLevel = levelRaw === 'AUTO'
        ? (computeLevel(group.maxDaysOverdue) || 1)
        : levelRaw
      result.level = effectiveLevel

      const ref       = buildReminderReference({ partnerId, level: effectiveLevel, date: today })
      const pdfData   = groupToPdfData(group,  effectiveLevel, ref, today)
      const xlsxData  = groupToXlsxData(group, effectiveLevel, ref, today)
      const totalDue  = group.totalResidual
      result.reference    = ref
      result.totalDue     = totalDue
      result.invoiceCount = group.invoices.length

      // Generation des fichiers
      const [pdfBuffer, xlsxBuffer] = await Promise.all([
        generateReminderPdf(pdfData),
        Promise.resolve(generateReminderXlsx(xlsxData)),
      ])

      // Upload bucket (TTL 1 an pour archive)
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
      const [pdfUpload, xlsxUpload] = await Promise.all([
        uploadReminderFile({
          partnerId,
          level:    effectiveLevel,
          ext:      'pdf',
          buffer:   pdfBuffer,
          fileName: `${partnerId}/L${effectiveLevel}-${ts}.pdf`,
          ttlSec:   SIGNED_URL_TTL_1Y,
        }),
        uploadReminderFile({
          partnerId,
          level:    effectiveLevel,
          ext:      'xlsx',
          buffer:   xlsxBuffer,
          fileName: `${partnerId}/L${effectiveLevel}-${ts}.xlsx`,
          ttlSec:   SIGNED_URL_TTL_1Y,
        }),
      ])
      result.pdfPath  = pdfUpload.path
      result.xlsxPath = xlsxUpload.path

      // Envoi email (sauf si dryRun)
      let messageId: string | null = null
      let emailTo: string = group.partnerEmail || ''
      if (!dryRun) {
        if (!group.partnerEmail) {
          result.error = 'Pas d email partner — relance non envoyee (mais fichiers generes)'
          results.push(result)
          continue
        }
        try {
          const r = await sendReminderEmail({
            to:           group.partnerEmail,
            toName:       group.partnerName,
            level:        effectiveLevel,
            partnerName:  group.partnerName,
            reference:    ref,
            totalDue,
            invoiceCount: group.invoices.length,
            pdfBuffer,
            xlsxBuffer,
          })
          messageId = r.messageId
        } catch (e: any) {
          result.error = `Graph sendMail : ${e.message}`
          // On insere quand meme la ligne tracking pour audit (avec error noted)
        }
      }

      // Tracking en base : 1 ligne invoice_reminders
      const { data: insertedRow, error: insertErr } = await supabase
        .from('invoice_reminders')
        .insert({
          partner_id_odoo:    partnerId,
          partner_name:       group.partnerName,
          level:              effectiveLevel,
          sent_by_user_id:    userId,
          email_to:           emailTo || 'pas-de-email',
          invoice_count:      group.invoices.length,
          total_amount:       totalDue,
          invoice_ids_odoo:   group.invoices.map(i => i.id),
          pdf_url:            pdfUpload.path,
          xlsx_url:           xlsxUpload.path,
          graph_message_id:   messageId,
          dry_run:            dryRun,
        })
        .select('id').single()

      if (insertErr) {
        result.error = `${result.error ? result.error + ' | ' : ''}Insert tracking: ${insertErr.message}`
      } else {
        result.reminderId = insertedRow.id
      }

      result.ok = !result.error
    } catch (e: any) {
      console.error(`[relances/send] partner ${partnerId}:`, e)
      result.error = e.message
    }

    results.push(result)
  }

  const successCount = results.filter(r => r.ok).length
  return NextResponse.json({
    ok:       successCount > 0,
    total:    partnerIds.length,
    success:  successCount,
    failed:   partnerIds.length - successCount,
    dryRun,
    results,
  })
}
