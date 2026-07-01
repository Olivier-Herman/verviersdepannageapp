// src/lib/requisitoire/intake.ts
//
// Capture des réquisitoires reçus dans fourriere@ : poll la boîte → pour chaque
// mail non déjà traité avec PJ PDF, Claude lit le PDF → extraction → matching
// multi-signal → ligne en file d'attente (requisitoire_intake, statut 'pending').
//
// OPTION A (démarrage) : AUCUNE annexion automatique. On ne fait que capturer +
// proposer des fiches candidates. Un humain rattache ensuite (attach.ts).
//
// Dedup : une ligne par source_email_id (index unique) → on ne re-paie jamais
// l'appel Claude pour un mail déjà vu. Le « classement » du mail (catégorie
// Outlook) se fait à l'annexion, pas ici (on garde le mail visible tant que
// non rattaché).
//
// Olivier 2026-07-01. Cf [[project_assistant_mail_module]].

import { randomUUID }        from 'crypto'
import { createAdminClient } from '@/lib/supabase'
import { listInboxMessages, getPdfAttachments } from './graph'
import { extractRequisitoireFromPdf }           from './extract'
import { findRequisitoireCandidates }           from './match'

export const FOURRIERE_MAILBOX = 'fourriere@verviersdepannage.be'
const BUCKET       = 'mission-remarks'   // réutilise le bucket des remarques/documents
const MAX_PER_RUN  = 6                    // borne les appels Claude (maxDuration 60s)

export interface IntakeSummary {
  scanned:  number   // mails examinés
  captured: number   // réquisitoires mis en file (pending)
  skipped:  number   // déjà traités / sans PDF / non réquisitoire
  errors:   number
}

/**
 * Poll la boîte fourriere@ et capture les nouveaux réquisitoires.
 * `top` = nombre de mails récents à examiner.
 */
export async function pollRequisitoires(opts?: { top?: number }): Promise<IntakeSummary> {
  const sb = createAdminClient()
  const summary: IntakeSummary = { scanned: 0, captured: 0, skipped: 0, errors: 0 }

  const messages = await listInboxMessages(FOURRIERE_MAILBOX, opts?.top ?? 25)
  let processed = 0

  for (const msg of messages) {
    summary.scanned++

    // Déjà capturé ? (dedup par email → pas de re-coût Claude)
    const { data: existing } = await sb
      .from('requisitoire_intake').select('id').eq('source_email_id', msg.id).maybeSingle()
    if (existing) { summary.skipped++; continue }

    if (!msg.hasAttachments) { summary.skipped++; continue }
    if (processed >= MAX_PER_RUN) { summary.skipped++; continue }  // le reste au prochain run

    try {
      const pdfs = await getPdfAttachments(FOURRIERE_MAILBOX, msg.id)
      if (pdfs.length === 0) {
        // PJ mais pas de PDF → marque non-réquisitoire pour ne pas re-scanner.
        await sb.from('requisitoire_intake').insert({
          mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, from_addr: msg.from,
          subject: msg.subject, received_at: msg.receivedDateTime, status: 'not_requisitoire',
        })
        summary.skipped++; continue
      }

      processed++
      const pdf = pdfs[0]  // 1er PDF (v1 : un réquisitoire = un PDF)
      const intakeId = randomUUID()

      // 1. Stocker le PDF (bucket mission-remarks, préfixe _intake).
      const safeName = pdf.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'requisitoire.pdf'
      const docPath  = `_intake/${intakeId}/${safeName}`
      const buf = Buffer.from(pdf.contentBytes, 'base64')
      const { error: upErr } = await sb.storage.from(BUCKET).upload(docPath, buf, {
        contentType: 'application/pdf', upsert: false,
      })
      if (upErr) throw new Error(`upload PDF: ${upErr.message}`)

      // 2. Claude lit le PDF.
      const ex = await extractRequisitoireFromPdf(pdf.contentBytes)

      // 3. Non-réquisitoire → on garde une trace (dedup) mais pas de matching.
      if (!ex.is_requisitoire) {
        await sb.from('requisitoire_intake').insert({
          id: intakeId, mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, from_addr: msg.from,
          subject: msg.subject, received_at: msg.receivedDateTime, file_name: pdf.name,
          doc_path: docPath, extracted: ex as any, status: 'not_requisitoire',
        })
        summary.skipped++; continue
      }

      // 4. Matching multi-signal.
      const match = await findRequisitoireCandidates(sb, ex)

      // Sans clé forte (ni plaque, ni 5 derniers du VIN), on ne peut pas
      // rapprocher de façon fiable → statut « à vérifier » (revue humaine).
      const plateAlnum = (ex.plaque || '').replace(/[^A-Za-z0-9]/g, '')
      const vinAlnum   = (ex.vin || '').replace(/[^A-Za-z0-9]/g, '')
      const hasStrongKey = plateAlnum.length >= 4 || vinAlnum.length >= 5
      const status = hasStrongKey ? 'pending' : 'to_verify'

      await sb.from('requisitoire_intake').insert({
        id: intakeId, mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, from_addr: msg.from,
        subject: msg.subject, received_at: msg.receivedDateTime, file_name: pdf.name,
        doc_path: docPath, extracted: ex as any,
        candidates: match.candidates as any,
        matched_mission_id: (status === 'pending' && match.confidence === 'high') ? match.best?.mission_id ?? null : null,
        confidence: match.confidence, status,
      })
      summary.captured++
    } catch (err: any) {
      // On n'insère PAS de ligne → le mail sera re-tenté au prochain run
      // (résilient aux erreurs transitoires Claude/Graph).
      console.error(`[requisitoire] mail ${msg.id} KO:`, err?.message)
      summary.errors++
    }
  }

  return summary
}
