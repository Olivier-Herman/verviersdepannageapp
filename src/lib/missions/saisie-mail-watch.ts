// src/lib/missions/saisie-mail-watch.ts
//
// VEILLE de la boîte fourriere@ pour le cycle Parquet (Olivier 2026-09-03) :
//
//   A. « Dossier 460036-26 – Changement de statut » (Taxation.Liege@just.fgov.be)
//      → « a reçu le statut Transféré au bureau de liquidation ». Le n° de dossier
//      = saisie_etats_frais.justinvoice_ref (posé au dépôt) → rattachement
//      infaillible. Liquidé ⇒ facture Odoo brouillon créée automatiquement
//      (référence Peppol ROJ-FJGK13 + JINV). Tout autre statut ⇒ note + alerte.
//
//   B. Retour SIGNÉ du Parquet par courriel (PDF en pièce jointe, expéditeur
//      just.fgov.be ou n° EDF-AAAA-NNNN cité) → même découpe/lecture que le scan
//      groupé (splitAndDispatch) : la page est rattachée à SON état de frais et
//      le passe en accepté/refusé. En mode Auto, dépôt JustInvoice dans la foulée.
//
// Dédup : une ligne saisie_mail_events par mail (source_email_id unique).
// Appelé par le cron poll-requisitoires (toutes les 10 min, même boîte).

import { listInboxMessages, getMessageBody, getPdfAttachments, type GraphMessage } from '@/lib/requisitoire/graph'
import { FOURRIERE_MAILBOX } from '@/lib/requisitoire/intake'
import { splitAndDispatch } from '@/lib/missions/saisie-scan-split'
import { createSaisieParquetInvoice } from '@/lib/missions/saisie-odoo-invoice'
import { depositEtatFrais } from '@/lib/justinvoice/deposit'
import { sendNotificationToRoles } from '@/lib/notifications/send'

const RE_STATUT   = /Dossier\s+(\d{5,}-\d{2})\s*[–—-]\s*Changement de statut/i
const RE_EDF      = /EDF-\d{4}-\d{3,}(?:-[A-Z])?/i
const MAX_SCANS   = 3          // PDF passés à Claude par run (coût)

export interface SaisieMailWatchSummary {
  scanned: number; liquidated: number; statuts: number; retours: number; ignored: number; errors: string[]
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

async function getAutoMode(sb: any): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'saisie_auto_send').maybeSingle()
  try { return data?.value ? JSON.parse(data.value) === true : false } catch { return false }
}

async function recordEvent(sb: any, msg: GraphMessage, kind: string, ref: string | null, outcome: string, efId?: string | null) {
  await sb.from('saisie_mail_events').insert({
    mailbox: FOURRIERE_MAILBOX, source_email_id: msg.id, kind, ref, subject: msg.subject, from_addr: msg.from,
    received_at: msg.receivedDateTime, ef_id: efId || null, outcome,
  }).then(() => {}, () => {})
}

// ── A. Changement de statut JustInvoice ─────────────────────────────────────
async function handleStatut(sb: any, msg: GraphMessage, ref: string, out: SaisieMailWatchSummary): Promise<void> {
  const body = await getMessageBody(FOURRIERE_MAILBOX, msg.id)
  const text = body.contentType === 'html' ? stripHtml(body.content) : body.content
  const statut = (text.match(/a reçu le statut\s+(.+?)(?:\.\s|\.$|\sVous pouvez)/i)?.[1] || '').trim() || 'inconnu'
  const link = body.content.match(/https:\/\/justinvoice\.just\.fgov\.be\/[^\s"'<>]+/i)?.[0]?.replace(/&amp;/g, '&') || null

  const { data: ef } = await sb.from('saisie_etats_frais')
    .select('id, numero, dossier_id, status, justinvoice_ref').eq('justinvoice_ref', ref).maybeSingle()
  if (!ef) {
    // Dossier inconnu de VD Soft (ancien système) → on note, sans alerter.
    await recordEvent(sb, msg, 'statut', ref, `inconnu : ${statut}`)
    out.ignored++; return
  }

  const now = new Date().toISOString()
  const liquide = /liquidation/i.test(statut)
  if (liquide) {
    if (['depose', 'accepte'].includes(ef.status)) {
      await sb.from('saisie_etats_frais').update({ status: 'liquide', liquide_at: now, status_note: statut, justinvoice_detail_url: link }).eq('id', ef.id)
      await sb.from('saisie_dossiers').update({ state: 'liquide', updated_at: now, notes: `Transféré au bureau de liquidation (${ref}) — ${ef.numero}.` }).eq('id', ef.dossier_id)
    } else {
      await sb.from('saisie_etats_frais').update({ liquide_at: ef.liquide_at || now, status_note: statut, justinvoice_detail_url: link }).eq('id', ef.id)
    }
    // Facture Odoo brouillon dans la foulée (process : facture APRÈS liquidation).
    let factureMsg = ''
    if (['depose', 'accepte', 'liquide'].includes(ef.status)) {
      const inv = await createSaisieParquetInvoice(sb, ef.dossier_id, ef.id)
      factureMsg = inv.ok ? `facture Odoo brouillon #${inv.odooId} créée` : `facture Odoo NON créée : ${inv.error}`
      if (!inv.ok) out.errors.push(`${ef.numero} : ${inv.error}`)
    } else factureMsg = `déjà « ${ef.status} »`
    await recordEvent(sb, msg, 'liquidation', ref, factureMsg, ef.id)
    out.liquidated++
    const { data: d } = await sb.from('saisie_dossiers').select('vehicle_plate, mission_id').eq('id', ef.dossier_id).maybeSingle()
    if (d?.mission_id) {
      await sb.from('mission_remarks').insert({ mission_id: d.mission_id, text: `⚖️ JustInvoice ${ref} : transféré au bureau de liquidation — ${factureMsg}` }).then(() => {}, () => {})
    }
    await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
      title: `Saisie ${d?.vehicle_plate || ''} : liquidation OK`,
      body: `${ef.numero} (JustInvoice ${ref}) — ${factureMsg}. À poster dans Odoo.`,
      action_url: '/fourriere/saisies',
    }).catch(() => {})
    return
  }

  // Autre statut (refus, demande de correction, clôture…) → trace + alerte humaine.
  await sb.from('saisie_etats_frais').update({ status_note: statut, justinvoice_detail_url: link }).eq('id', ef.id)
  await recordEvent(sb, msg, 'statut', ref, statut, ef.id)
  out.statuts++
  const { data: d } = await sb.from('saisie_dossiers').select('vehicle_plate').eq('id', ef.dossier_id).maybeSingle()
  await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
    title: `Saisie ${d?.vehicle_plate || ''} : statut JustInvoice « ${statut} »`,
    body: `${ef.numero} (dossier ${ref}) — à vérifier sur JustInvoice.`,
    action_url: '/fourriere/saisies',
  }).catch(() => {})
}

// ── B. Retour signé par courriel ────────────────────────────────────────────
async function handleRetour(sb: any, msg: GraphMessage, out: SaisieMailWatchSummary, auto: boolean): Promise<void> {
  const pdfs = await getPdfAttachments(FOURRIERE_MAILBOX, msg.id)
  if (pdfs.length === 0) { await recordEvent(sb, msg, 'ignore', null, 'pas de PDF'); out.ignored++; return }

  let attached = 0, refused = 0, unmatched = 0
  const notes: string[] = []
  const deposited: string[] = []
  for (const pdf of pdfs.slice(0, 3)) {
    const res = await splitAndDispatch(sb, Buffer.from(pdf.contentBytes, 'base64'), null)
    attached += res.attached; refused += res.refused; unmatched += res.unmatched
    for (const r of res.results) {
      notes.push(`p${r.page} ${r.numero || '?'} ${r.note}`)
      // Mode Auto : accepté ⇒ dépôt JustInvoice immédiat.
      if (auto && r.matched && !r.refus && r.dossierId && r.numero) {
        const { data: ef } = await sb.from('saisie_etats_frais').select('id').eq('numero', r.numero).maybeSingle()
        if (ef) {
          const dep = await depositEtatFrais(sb, r.dossierId, ef.id)
          if (dep.ok) deposited.push(`${r.numero} → ${dep.ref || 'déposé'}`)
          else out.errors.push(`${r.numero} : dépôt JustInvoice KO — ${dep.error}`)
        }
      }
    }
  }
  const outcome = `${attached} accepté(s), ${refused} refus, ${unmatched} non reconnu(s)${deposited.length ? ' ; déposés : ' + deposited.join(', ') : ''} — ${notes.join(' | ')}`.slice(0, 900)
  await recordEvent(sb, msg, 'retour_signe', notes.find(n => RE_EDF.test(n))?.match(RE_EDF)?.[0] || null, outcome)
  if (attached + refused + unmatched === 0) { out.ignored++; return }
  out.retours++
  await sendNotificationToRoles(['admin', 'superadmin'], 'saisie_facturation', {
    title: `Retour Parquet par mail : ${attached} validé(s)${refused ? `, ${refused} refus` : ''}${unmatched ? `, ${unmatched} à vérifier` : ''}`,
    body: `${msg.subject || '(sans objet)'} — ${deposited.length ? 'déposé(s) sur JustInvoice : ' + deposited.join(', ') : auto ? '' : 'à déposer sur JustInvoice.'}`.trim(),
    action_url: '/fourriere/saisies',
  }).catch(() => {})
}

/** Un passage sur la boîte fourrière : statuts JustInvoice + retours signés.
 *  `opts.messages` permet un rescan ciblé (ex. searchMessages sur toute la boîte). */
export async function pollSaisieMailbox(sb: any, opts?: { top?: number; messages?: GraphMessage[] }): Promise<SaisieMailWatchSummary> {
  const out: SaisieMailWatchSummary = { scanned: 0, liquidated: 0, statuts: 0, retours: 0, ignored: 0, errors: [] }
  const messages = opts?.messages ?? await listInboxMessages(FOURRIERE_MAILBOX, opts?.top ?? 40)
  if (!messages.length) return out
  const { data: seen } = await sb.from('saisie_mail_events').select('source_email_id').in('source_email_id', messages.map(m => m.id))
  const seenIds = new Set((seen || []).map((s: any) => s.source_email_id))
  const auto = await getAutoMode(sb)
  let scanBudget = MAX_SCANS

  for (const msg of messages) {
    if (seenIds.has(msg.id)) continue
    const fromJustice = /@[a-z0-9.-]*just\.fgov\.be\s*>?\s*$/i.test((msg.from || '').trim())
    const statut = RE_STATUT.exec(msg.subject || '')
    const mentionsEdf = RE_EDF.test(`${msg.subject} ${msg.bodyPreview}`)
    if (!statut && !mentionsEdf && !(fromJustice && msg.hasAttachments)) continue   // pas pour nous, on laisse l'intake réquisitoire faire
    out.scanned++
    try {
      if (statut) { await handleStatut(sb, msg, statut[1], out); continue }
      if (msg.hasAttachments && (mentionsEdf || fromJustice)) {
        if (scanBudget <= 0) { out.ignored++; continue }   // pas d'event → repris au run suivant
        scanBudget--
        await handleRetour(sb, msg, out, auto); continue
      }
      await recordEvent(sb, msg, 'ignore', null, 'mention EDF sans PDF')
      out.ignored++
    } catch (e: any) {
      out.errors.push(`${msg.subject || msg.id} : ${e?.message || e}`)
    }
  }
  return out
}
