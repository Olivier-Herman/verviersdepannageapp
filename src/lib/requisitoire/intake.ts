// src/lib/requisitoire/intake.ts
//
// Capture des documents police reçus dans fourriere@ : poll la boîte → pour
// chaque mail non déjà traité :
//   - avec PJ PDF                     → Claude lit le PDF ;
//   - sans PJ mais qui ressemble à une levée (mots-clés) → Claude lit le CORPS,
//     et on annexe une CAPTURE HTML du mail comme preuve.
// → classification (réquisitoire / levée de saisie / autre) + matching multi-signal
// → ligne en file d'attente (requisitoire_intake).
//
// OPTION A : AUCUNE annexion automatique. Un humain rattache ensuite (attach.ts).
// Dedup : une ligne par source_email_id → on ne re-paie jamais l'appel Claude.
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { randomUUID }        from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { listInboxMessages, getPdfAttachments, getMessageBody, type GraphMessageBody } from './graph'
import { extractRequisitoireFromPdf, extractRequisitoireFromText } from './extract'
import { findRequisitoireCandidates } from './match'

export const FOURRIERE_MAILBOX = 'fourriere@verviersdepannage.be'
const BUCKET       = 'mission-remarks'
const MAX_PER_RUN  = 6

// Mots-clés qui déclenchent la lecture d'un mail SANS pièce jointe (levée).
const LEVEE_KEYWORDS = ['levée', 'levee', 'mainlevée', 'mainlevee', 'main levée', 'restitution', 'saisie', 'restitué', 'restitue']

export interface IntakeSummary {
  scanned:  number
  captured: number
  skipped:  number
  errors:   number
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Capture HTML autoportante du mail (preuve annexée quand pas de document). */
function buildMailCaptureHtml(body: GraphMessageBody): string {
  const safeBody = body.contentType === 'html'
    ? body.content.replace(/<script[\s\S]*?<\/script>/gi, '')
    : `<pre style="white-space:pre-wrap;font-family:inherit">${body.content.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c])}</pre>`
  const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c])
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${esc(body.subject)}</title></head>
<body style="font-family:Arial,sans-serif;max-width:800px;margin:20px auto;color:#111">
<div style="border:1px solid #ccc;border-radius:8px;padding:12px 16px;background:#f7f7f7;margin-bottom:16px">
  <div><strong>De :</strong> ${esc(body.from)}</div>
  <div><strong>Reçu :</strong> ${esc(body.receivedDateTime)}</div>
  <div><strong>Objet :</strong> ${esc(body.subject)}</div>
  <div style="color:#777;font-size:12px;margin-top:6px">Capture automatique du mail (aucun document joint) — preuve annexée par VD Soft.</div>
</div>
${safeBody}
</body></html>`
}

export async function pollRequisitoires(opts?: { top?: number }): Promise<IntakeSummary> {
  const sb = createAdminClient()
  const summary: IntakeSummary = { scanned: 0, captured: 0, skipped: 0, errors: 0 }

  const messages = await listInboxMessages(FOURRIERE_MAILBOX, opts?.top ?? 25)
  let processed = 0

  for (const msg of messages) {
    summary.scanned++

    const { data: existing } = await sb
      .from('requisitoire_intake').select('id').eq('source_email_id', msg.id).maybeSingle()
    if (existing) { summary.skipped++; continue }

    const looksLevee = LEVEE_KEYWORDS.some(k => `${msg.subject} ${msg.bodyPreview}`.toLowerCase().includes(k))

    try {
      const pdfs = msg.hasAttachments ? await getPdfAttachments(FOURRIERE_MAILBOX, msg.id) : []

      // Ni PDF, ni indice de levée → on ne dépense pas d'appel Claude.
      if (pdfs.length === 0 && !looksLevee) {
        if (msg.hasAttachments) {
          // PJ mais pas de PDF → trace pour ne pas re-scanner.
          await sb.from('requisitoire_intake').insert({
            mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, from_addr: msg.from,
            subject: msg.subject, received_at: msg.receivedDateTime, status: 'not_requisitoire', doc_type: 'autre',
          })
        }
        summary.skipped++; continue
      }

      if (processed >= MAX_PER_RUN) { summary.skipped++; continue }
      processed++

      const intakeId = randomUUID()
      let docPath: string | null = null
      let fileName: string | null = null
      let ex

      if (pdfs.length > 0) {
        const pdf = pdfs[0]
        const safeName = pdf.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document.pdf'
        docPath  = `_intake/${intakeId}/${safeName}`
        fileName = pdf.name
        const { error: upErr } = await sb.storage.from(BUCKET).upload(docPath, Buffer.from(pdf.contentBytes, 'base64'), {
          contentType: 'application/pdf', upsert: false,
        })
        if (upErr) throw new Error(`upload PDF: ${upErr.message}`)
        ex = await extractRequisitoireFromPdf(pdf.contentBytes)
      } else {
        // Levée probable sans document → lire le corps + annexer une capture HTML.
        const body = await getMessageBody(FOURRIERE_MAILBOX, msg.id)
        const text = body.contentType === 'html' ? stripHtml(body.content) : body.content
        ex = await extractRequisitoireFromText(`Objet: ${body.subject}\n\n${text}`)
        docPath  = `_intake/${intakeId}/mail.html`
        fileName = 'mail.html'
        const { error: upErr } = await sb.storage.from(BUCKET).upload(docPath, Buffer.from(buildMailCaptureHtml(body), 'utf8'), {
          contentType: 'text/html; charset=utf-8', upsert: false,
        })
        if (upErr) throw new Error(`upload capture mail: ${upErr.message}`)
      }

      // Type 'autre' → trace, pas de matching.
      if (ex.doc_type === 'autre') {
        await sb.from('requisitoire_intake').insert({
          id: intakeId, mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, from_addr: msg.from,
          subject: msg.subject, received_at: msg.receivedDateTime, file_name: fileName,
          doc_path: docPath, extracted: ex as any, status: 'not_requisitoire', doc_type: 'autre',
        })
        summary.skipped++; continue
      }

      const match = await findRequisitoireCandidates(sb, ex)

      // Clé forte = plaque OU 5 derniers du VIN.
      const plateAlnum = (ex.plaque || '').replace(/[^A-Za-z0-9]/g, '')
      const vinAlnum   = (ex.vin || '').replace(/[^A-Za-z0-9]/g, '')
      const hasStrongKey = plateAlnum.length >= 4 || vinAlnum.length >= 5

      // Statut : réquisitoire → pending si clé forte, sinon à vérifier.
      //          levée → pending si clé forte ET date de levée, sinon à vérifier
      //          (la date pilote le gardiennage, on ne lève pas sans elle).
      let status: string
      if (ex.doc_type === 'levee_saisie') {
        status = (hasStrongKey && ex.levee_date) ? 'pending' : 'to_verify'
      } else {
        status = hasStrongKey ? 'pending' : 'to_verify'
      }

      await sb.from('requisitoire_intake').insert({
        id: intakeId, mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, from_addr: msg.from,
        subject: msg.subject, received_at: msg.receivedDateTime, file_name: fileName,
        doc_path: docPath, extracted: ex as any, doc_type: ex.doc_type,
        candidates: match.candidates as any,
        matched_mission_id: (status === 'pending' && match.confidence === 'high') ? match.best?.mission_id ?? null : null,
        confidence: match.confidence, status,
      })
      summary.captured++
    } catch (err: any) {
      console.error(`[requisitoire] mail ${msg.id} KO:`, err?.message)
      summary.errors++
    }
  }

  return summary
}
