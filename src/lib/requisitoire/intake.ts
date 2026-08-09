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
import { listInboxMessages, searchMessages, getPdfAttachments, getMessageBody, type GraphMessage, type GraphMessageBody } from './graph'
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
  autoAttached?: number
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

// Convertit un corps HTML de mail en TEXTE lisible (sans balises/styles/disclaimer).
function htmlToReadableText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n──────────\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// Échappe pour HTML ET convertit tout non-ASCII en entité numérique → fichier
// 100 % ASCII, donc rendu correct quel que soit le charset servi (fini les « Ã© »).
function toAsciiHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0080-\uffff]/g, c => `&#${c.charCodeAt(0)};`)
}

function fmtReceived(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Capture LISIBLE et autoportante du mail (preuve annexée quand pas de document). */
function buildMailCaptureHtml(body: GraphMessageBody): string {
  const text = body.contentType === 'html' ? htmlToReadableText(body.content) : body.content
  // Note : labels accentués écrits en entités pour rester 100 % ASCII.
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${toAsciiHtml(body.subject)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:24px auto;color:#111;line-height:1.55">
<div style="border:1px solid #ddd;border-radius:10px;padding:16px 20px;background:#f7f7f9;margin-bottom:20px">
  <div style="font-size:18px;font-weight:bold;margin-bottom:10px">${toAsciiHtml(body.subject) || '(sans objet)'}</div>
  <div style="color:#333;font-size:13px"><strong>De&nbsp;:</strong> ${toAsciiHtml(body.from)}</div>
  <div style="color:#333;font-size:13px"><strong>Re&#231;u&nbsp;:</strong> ${toAsciiHtml(fmtReceived(body.receivedDateTime))}</div>
  <div style="color:#888;font-size:11px;margin-top:10px">Capture automatique du mail (aucun document joint) &#8212; preuve annex&#233;e par VD Soft.</div>
</div>
<div style="white-space:pre-wrap;font-size:14px">${toAsciiHtml(text)}</div>
</body></html>`
}

export async function pollRequisitoires(opts?: { top?: number }): Promise<IntakeSummary> {
  const sb = createAdminClient()
  const summary: IntakeSummary = { scanned: 0, captured: 0, skipped: 0, errors: 0, autoAttached: 0 }
  const messages = await listInboxMessages(FOURRIERE_MAILBOX, opts?.top ?? 25)
  const budget = { remaining: MAX_PER_RUN }
  for (const msg of messages) {
    await processMessage(sb, FOURRIERE_MAILBOX, msg, summary, budget)
  }
  return summary
}

// Traite UN message : dédup (source_email_id), classification, extraction Claude,
// matching, auto-attache. Mutualisé entre le cron (pollRequisitoires) et la
// réconciliation mailbox-wide (reconcileRequisitoires). `budget.remaining` borne
// les appels Claude sur le run.
async function processMessage(
  sb: any, mailbox: string, msg: GraphMessage, summary: IntakeSummary, budget: { remaining: number },
): Promise<void> {
  summary.scanned++

  const { data: existing } = await sb
    .from('requisitoire_intake').select('id').eq('source_email_id', msg.id).maybeSingle()
  if (existing) { summary.skipped++; return }

  // Un mail d'une adresse police belge = à traiter systématiquement
  // (réquisitoire ou levée), même sans PJ ni mot-clé. Olivier 2026-07-01.
  const fromPolice = /@police\.belgium\.eu\s*>?\s*$/i.test((msg.from || '').trim())
  const looksLevee = fromPolice || LEVEE_KEYWORDS.some(k => `${msg.subject} ${msg.bodyPreview}`.toLowerCase().includes(k))

  try {
    const pdfs = msg.hasAttachments ? await getPdfAttachments(mailbox, msg.id) : []

    // Ni PDF, ni indice de levée / police → on ne dépense pas d'appel Claude.
    if (pdfs.length === 0 && !looksLevee) {
      if (msg.hasAttachments) {
        await sb.from('requisitoire_intake').insert({
          mailbox, source_email_id: msg.id, from_addr: msg.from,
          subject: msg.subject, received_at: msg.receivedDateTime, status: 'not_requisitoire', doc_type: 'autre',
        })
      }
      summary.skipped++; return
    }

    if (budget.remaining <= 0) { summary.skipped++; return }
    budget.remaining--

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
      const body = await getMessageBody(mailbox, msg.id)
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
        id: intakeId, mailbox, source_email_id: msg.id, from_addr: msg.from,
        subject: msg.subject, received_at: msg.receivedDateTime, file_name: fileName,
        doc_path: docPath, extracted: ex as any, status: 'not_requisitoire', doc_type: 'autre',
      })
      summary.skipped++; return
    }

    const match = await findRequisitoireCandidates(sb, ex)

    // Clé forte = plaque OU 5 derniers du VIN.
    const plateAlnum = (ex.plaque || '').replace(/[^A-Za-z0-9]/g, '')
    const vinAlnum   = (ex.vin || '').replace(/[^A-Za-z0-9]/g, '')
    const hasStrongKey = plateAlnum.length >= 4 || vinAlnum.length >= 5

    let status: string
    if (ex.doc_type === 'levee_saisie') {
      status = (hasStrongKey && ex.levee_date) ? 'pending' : 'to_verify'
    } else {
      status = hasStrongKey ? 'pending' : 'to_verify'
    }

    await sb.from('requisitoire_intake').insert({
      id: intakeId, mailbox, source_email_id: msg.id, from_addr: msg.from,
      subject: msg.subject, received_at: msg.receivedDateTime, file_name: fileName,
      doc_path: docPath, extracted: ex as any, doc_type: ex.doc_type,
      candidates: match.candidates as any,
      matched_mission_id: (status === 'pending' && match.confidence === 'high') ? match.best?.mission_id ?? null : null,
      confidence: match.confidence, status,
    })
    summary.captured++

    // Auto-rattachement (saisie/enlèvement UNIQUEMENT — pas les levées).
    if (match.autoAttach && match.best && ex.doc_type !== 'levee_saisie') {
      try {
        const { attachRequisitoire } = await import('@/lib/requisitoire/attach')
        const res = await attachRequisitoire(sb, intakeId, match.best.mission_id, null, {})
        if (res.ok) summary.autoAttached = (summary.autoAttached || 0) + 1
        else console.warn(`[requisitoire] auto-attache ${intakeId} refusée : ${res.error}`)
      } catch (e: any) {
        console.error(`[requisitoire] auto-attache ${intakeId} KO :`, e?.message)
      }
    }
  } catch (err: any) {
    console.error(`[requisitoire] mail ${msg.id} KO:`, err?.message)
    summary.errors++
  }
}

// ── Réconciliation MAILBOX-WIDE (ciblée) ─────────────────────────────────────
// Pour chaque fiche de saisie EN PARC SANS réquisitoire, cherche sa plaque / VIN /
// n° PV dans les DEUX boîtes (info@ + fourriere@, $search couvre TOUS les dossiers)
// et laisse processMessage extraire + matcher + attacher. Olivier 2026-08-10.
export const RECONCILE_MAILBOXES = ['info@verviersdepannage.com', FOURRIERE_MAILBOX]
const RECONCILE_SAISIE_SOURCES = ['police_saisie', 'police_rodeo', 'police_avp']

export interface ReconcileSummary extends IntakeSummary {
  fichesScanned: number; searchTerms: number; messagesFound: number; budgetLeft: number
}

export async function reconcileRequisitoires(opts?: { maxClaude?: number }): Promise<ReconcileSummary> {
  const sb = createAdminClient()
  const summary: ReconcileSummary = { scanned: 0, captured: 0, skipped: 0, errors: 0, autoAttached: 0, fichesScanned: 0, searchTerms: 0, messagesFound: 0, budgetLeft: 0 }
  const budget = { remaining: opts?.maxClaude ?? 80 }

  const { data: fiches } = await sb.from('incoming_missions')
    .select('id, vehicle_plate, vehicle_vin, police_pv_number')
    .in('source', RECONCILE_SAISIE_SOURCES).eq('status', 'parked').is('requisitoire_at', null).limit(3000)

  const seenMsg = new Set<string>()
  for (const f of (fiches || [])) {
    summary.fichesScanned++
    const terms = new Set<string>()
    if (f.vehicle_plate && f.vehicle_plate.replace(/[^A-Za-z0-9]/g, '').length >= 4) terms.add(f.vehicle_plate.trim())
    if (f.vehicle_vin && String(f.vehicle_vin).length >= 6) terms.add(String(f.vehicle_vin).trim())
    if (f.police_pv_number && String(f.police_pv_number).length >= 5) terms.add(String(f.police_pv_number).trim())

    for (const term of terms) {
      summary.searchTerms++
      for (const mb of RECONCILE_MAILBOXES) {
        let msgs: GraphMessage[] = []
        try { msgs = await searchMessages(mb, term, 25) } catch { summary.errors++; continue }
        for (const msg of msgs) {
          if (seenMsg.has(msg.id)) continue
          seenMsg.add(msg.id)
          summary.messagesFound++
          if (budget.remaining <= 0) { summary.skipped++; continue }
          await processMessage(sb, mb, msg, summary, budget)
        }
      }
    }
  }
  summary.budgetLeft = budget.remaining
  return summary
}

/**
 * Re-évalue les candidats des réquisitoires EN ATTENTE (pending / to_verify, non
 * encore attachés) avec la logique de matching COURANTE — sans re-extraire le PDF
 * (on réutilise `extracted`). Utile quand on améliore l'algo (ex : ciblage adresse
 * pour les réquisitoires sans plaque) : les anciens sont re-scorés et la bonne
 * fiche est enfin proposée. Olivier 2026-07-06.
 */
export async function rematchPendingRequisitoires(): Promise<{ scanned: number; updated: number; autoAttached: number }> {
  const sb = createAdminClient()
  // Toutes les lignes NON attachées (pending/to_verify), y compris celles qui ont
  // déjà un match suggéré (matched_mission_id non nul) : ce sont justement les
  // 'high' à auto-attacher. On ne filtre PAS sur matched_mission_id (sinon les
  // candidats forts déjà suggérés ne seraient jamais auto-rattachés). Olivier 2026-07-29.
  const { data: rows } = await sb.from('requisitoire_intake')
    .select('id, extracted, status, doc_type')
    .in('status', ['pending', 'to_verify'])
    .order('received_at', { ascending: false })
    .limit(300)

  let updated = 0, autoAttached = 0
  for (const row of (rows || [])) {
    const ex = (row as any).extracted
    if (!ex) continue
    try {
      const match = await findRequisitoireCandidates(sb, ex)
      await sb.from('requisitoire_intake').update({
        candidates:         match.candidates as any,
        confidence:         match.confidence,
        matched_mission_id: match.confidence === 'high' ? (match.best?.mission_id ?? null) : null,
      }).eq('id', (row as any).id)
      updated++

      // Auto-rattachement des anciens dossiers dont la fiche est apparue ENTRE-TEMPS.
      // Mêmes critères que la capture (clé forte + adresse précise + unique + date
      // ≤1j), saisie UNIQUEMENT (jamais les levées). Commande complète du bouton
      // « Rattacher » (annexion + PV + classement email). Olivier 2026-07-29.
      if (match.autoAttach && match.best && (row as any).doc_type !== 'levee_saisie') {
        const { attachRequisitoire } = await import('@/lib/requisitoire/attach')
        const res = await attachRequisitoire(sb, (row as any).id, match.best.mission_id, null, {})
        if (res.ok) autoAttached++
        else console.warn(`[requisitoire rematch] auto-attache ${(row as any).id} refusée : ${res.error}`)
      }
    } catch (e: any) {
      console.error('[requisitoire rematch]', (row as any).id, e?.message)
    }
  }
  return { scanned: rows?.length ?? 0, updated, autoAttached }
}
