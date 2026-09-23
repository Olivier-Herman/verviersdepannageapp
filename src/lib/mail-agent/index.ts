// src/lib/mail-agent/index.ts
//
// Orchestration de l'agent mail.
//
// Deux temps, volontairement séparés :
//   1. scanFolder()  → LECTURE SEULE. Capture les mails, les analyse, passe les
//                      garde-fous et pose un diagnostic dans mail_agent_items.
//                      Ne touche jamais à Odoo en écriture.
//   2. applyItem()   → ÉCRITURE. Rejoue la manip Odoo sur un item 'ready'.
//
// Ce découpage permet de tout faire tourner et de tout relire AVANT qu'une
// seule écriture comptable ne parte. Le mode ('draft' | 'auto', réglable dans
// app_settings sans redéploiement) décide si applyItem est déclenché
// automatiquement à la fin du scan ou s'il attend une main humaine.
//
// L'orchestrateur ne connaît AUCUN assisteur : il délègue au registre de
// handlers (cf handlers/index.ts). Ajouter Logicx ou VAB = un fichier de plus,
// zéro modification ici.

import { createAdminClient } from '@/lib/supabase'
import { findFolderIdByName, listFolderMessages, listAllFolders, getMessageText, getPdfAttachments, moveMessage } from './graph'
import { refreshAwpSenders } from './handlers/awp-rejet'
import { refreshImaSenders } from './handlers/ima-rejet'
import { isSupplierCandidate, processSupplierMail } from './handlers/fournisseur'
import { triageMail, isNoise, isAssistanceMission } from './triage'
import { handlerFor, handlerById } from './handlers'
import { findInvoiceByName, resolveTargetPartner, runChecks, creditAndRebill } from './odoo'
import type { RejectEntity } from './handlers/types'

export const MAIL_AGENT_MAILBOX = 'info@verviersdepannage.com'
export const MAIL_AGENT_FOLDER  = '0 - Jona et Mobi'
/** Dossier de repli si le handler n'en impose pas. */
export const MAIL_AGENT_DONE_FOLDER = 'Mail auto-géré'

export type MailAgentMode = 'draft' | 'auto'

/** Niveau d'autonomie. Défaut prudent : 'draft'. */
export async function getMode(sb: any): Promise<MailAgentMode> {
  try {
    const { data } = await sb.from('app_settings').select('value').eq('key', 'mail_agent_mode').maybeSingle()
    // app_settings.value est du TEXTE : toujours JSON.parse à la lecture.
    const raw = data?.value
    if (typeof raw === 'string') {
      const v = raw.trim().startsWith('"') ? JSON.parse(raw) : raw
      if (v === 'auto') return 'auto'
    }
  } catch { /* défaut ci-dessous */ }
  return 'draft'
}

export interface ScanReport {
  toDecide?: number
  scanned:   number
  captured:  number
  ready:     number
  blocked:   number
  toVerify:  number
  skipped:   number
  applied:   number
  errors:    string[]
}

/**
 * Parcourt le dossier, analyse ce qui relève d'un handler connu, et met à jour
 * la file. Idempotent : un mail déjà capturé est ré-analysé mais jamais
 * dupliqué (index unique mailbox+message_id+handler), et un item déjà appliqué
 * n'est plus touché.
 */
export async function scanFolder(opts: { mailbox?: string; folder?: string; folderId?: string; limit?: number; since?: string; triage?: boolean } = {}): Promise<ScanReport> {
  const sb      = createAdminClient()
  const mailbox = opts.mailbox || MAIL_AGENT_MAILBOX
  const folder  = opts.folder  || MAIL_AGENT_FOLDER
  const report: ScanReport = { scanned: 0, captured: 0, ready: 0, blocked: 0, toVerify: 0, skipped: 0, applied: 0, errors: [] }

  // Listes d'expéditeurs lues AVANT de détecter (au démarrage à froid la lecture
  // asynchrone n'était pas finie et tout passait en « skipped »).
  await Promise.all([refreshAwpSenders(), refreshImaSenders()]).catch(() => {})
  const folderId = opts.folderId || await findFolderIdByName(mailbox, folder)
  if (!folderId) {
    report.errors.push(`Dossier Outlook « ${folder} » introuvable dans ${mailbox}`)
    return report
  }

  const messages = await listFolderMessages(mailbox, folderId, opts.limit || 100, opts.since)
  report.scanned = messages.length

  for (const msg of messages) {
    try {
      const handler = handlerFor(msg.fromEmail, msg.subject)
      if (!handler) {
        // Facture fournisseur ? (Olivier 23/09/2026) — lue, vérifiée dans Odoo
        // par société, classée ou envoyée pour encodage. Jamais deux fois.
        if (isSupplierCandidate(msg)) {
          const { data: seen } = await sb.from('mail_agent_items').select('id, status').eq('mailbox', mailbox).eq('message_id', msg.id).eq('handler', 'fournisseur').maybeSingle()
          if (seen && ['applied', 'ignored', 'skipped', 'to_verify'].includes(seen.status)) { report.skipped++; continue }
          const base = { handler: 'fournisseur', mailbox, message_id: msg.id, folder, received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() }
          try {
            const out = await processSupplierMail(sb, mailbox, msg, base)
            await upsert(sb, base, { status: out.status, blocked_reason: out.note, extracted: out.extracted })
            if (out.status === 'applied') { report.captured++; report.applied++ }
            else if (out.status === 'to_verify') { report.captured++; report.toVerify++ }
            else report.skipped++
          } catch (e: any) { report.errors.push(`${msg.subject} : ${e?.message || String(e)}`) }
          continue
        }
        // Triage quotidien (jour 1, Olivier 23/09/2026) : tout le reste, sauf le
        // bruit et les ordres de mission, devient une carte de décision.
        if (opts.triage && !isNoise(msg) && !isAssistanceMission(msg)) {
          const { data: seen } = await sb.from('mail_agent_items').select('id, status').eq('mailbox', mailbox).eq('message_id', msg.id).eq('handler', 'triage').maybeSingle()
          if (seen) { report.skipped++; continue }
          const base = { handler: 'triage', mailbox, message_id: msg.id, folder, received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() }
          try {
            const t = await triageMail(sb, mailbox, msg)
            if (!t) { report.skipped++; continue }
            if (t.family === 'info' && !t.invoice_numbers.length && !t.plates.length) {
              await upsert(sb, base, { status: 'skipped', blocked_reason: 'Information sans demande — rien à décider', extracted: t })
              report.skipped++; continue
            }
            await upsert(sb, base, { status: 'to_decide', blocked_reason: t.asked || null, extracted: t })
            report.captured++; report.toDecide = (report.toDecide || 0) + 1
          } catch (e: any) { report.errors.push(`${msg.subject} : ${e?.message || String(e)}`) }
          continue
        }
        report.skipped++; continue
      }

      // Un item déjà traité ne doit pas être rejoué.
      const { data: existing } = await sb.from('mail_agent_items')
        .select('id, status')
        .eq('mailbox', mailbox).eq('message_id', msg.id).eq('handler', handler.id)
        .maybeSingle()
      if (existing && ['applied', 'ignored'].includes(existing.status)) { report.skipped++; continue }

      const base = {
        handler:     handler.id,
        mailbox,
        message_id:  msg.id,
        folder,
        received_at: msg.receivedAt || null,
        from_email:  msg.fromEmail,
        subject:     msg.subject,
        updated_at:  new Date().toISOString(),
      }

      // Rejet destiné à un autre prestataire (on est en simple copie).
      if (handler.notOurs?.(msg.subject)) {
        await upsert(sb, base, {
          status: 'blocked',
          blocked_reason: "Ce rejet porte sur la facture d'un tiers — le numéro n'appartient pas à notre numérotation. Nous sommes en copie.",
          extracted: null,
        })
        report.captured++; report.blocked++
        continue
      }

      const text   = await getMessageText(mailbox, msg.id)
      // Les PJ ne sont téléchargées que si le handler en a besoin (Allianz oui,
      // IMA non) : inutile de tirer des mégaoctets pour rien à chaque passage.
      const parsed = await handler.extract({
        subject: msg.subject,
        text,
        pdfs: () => getPdfAttachments(mailbox, msg.id),
      })

      if (!parsed) {
        // Document non exploitable avec certitude : on ne devine pas.
        await upsert(sb, base, {
          status: 'to_verify',
          blocked_reason: `Mail non exploitable automatiquement (${handler.label}) — lecture humaine requise`,
          extracted: { rawExcerpt: text.slice(0, 1200) },
        })
        report.captured++; report.toVerify++
        continue
      }

      // Doublon (Olivier 23/09/2026 : « Allianz envoie souvent en double ») : le
      // même rejet, même n° de facture, déjà capturé sous un autre mail → on
      // l'ignore, on ne crée pas deux fois l'avoir.
      const { data: twin } = await sb.from('mail_agent_items').select('id, status, message_id, folder')
        .eq('mailbox', mailbox).eq('handler', handler.id).neq('message_id', msg.id)
        .eq('extracted->>invoiceNumber', parsed.invoiceNumber)
        .in('status', ['ready', 'applied', 'blocked', 'to_verify']).limit(1).maybeSingle()
      if (twin) {
        await upsert(sb, base, {
          status: 'ignored',
          blocked_reason: `Doublon : le rejet de la facture ${parsed.invoiceNumber} est déjà capturé (${twin.status}, dossier « ${twin.folder} »).`,
          extracted: { invoiceNumber: parsed.invoiceNumber, reason: parsed.reason, duplicateOf: twin.id },
        })
        // Classé avec les rejets traités (Olivier 23/09 : « classer les mails dans
        // les bons dossiers une fois traités ») : le doublon ne traîne pas.
        try { const doneId = await findFolderIdByName(mailbox, handler.doneFolder || MAIL_AGENT_DONE_FOLDER); if (doneId) await moveMessage(mailbox, msg.id, doneId) } catch {}
        report.skipped++
        continue
      }
      const inv    = await findInvoiceByName(parsed.invoiceNumber)
      const target = await resolveTargetPartner(parsed.entity)
      const checks = await runChecks(inv, target, parsed.amount)

      await upsert(sb, base, {
        status:              checks.ok ? 'ready' : 'blocked',
        blocked_reason:      checks.blocked || null,
        extracted: {
          invoiceNumber: parsed.invoiceNumber,
          amount:        parsed.amount,
          entityKey:     parsed.entity.key,
          entityLabel:   parsed.entity.label,
          entityVat:     parsed.entity.vat,
          zeroVat:       parsed.entity.zeroVat,
          mailReference: parsed.mailReference,
          reason:        parsed.reason,
          odooRef:       inv?.ref || null,
        },
        checks:              checks.details,
        odoo_move_id:        inv?.id   || null,
        odoo_move_name:      inv?.name || null,
        target_partner_id:   target?.id   || null,
        target_partner_name: target?.name || null,
      })
      report.captured++
      if (checks.ok) report.ready++; else report.blocked++
    } catch (e: any) {
      report.errors.push(`${msg.subject} : ${e?.message || String(e)}`)
    }
  }

  // Mode autonome : on applique tout ce qui est vert. En 'draft' on s'arrête ici.
  if (await getMode(sb) === 'auto') {
    const { data: ready } = await sb.from('mail_agent_items').select('id').eq('status', 'ready')
    for (const r of ready || []) {
      const res = await applyItem(r.id, 'agent')
      if (res.ok) report.applied++
      else report.errors.push(res.error || 'échec application')
    }
  }

  return report
}

// Dossiers où l'agent ne regarde PAS : ses propres dossiers « fait », et les
// dossiers système. Tout le reste est scanné (Olivier 23/09/2026 : « l'agent
// mail doit avoir une vue partout »).
const SKIP_FOLDERS = [
  MAIL_AGENT_DONE_FOLDER.toLowerCase(), 'mondial automatic dispatch', 'ima payement', 'fournisseur divers', '01 - total - anomalie détectée',
  'éléments envoyés', 'elements envoyes', 'sent items', 'éléments supprimés', 'elements supprimes', 'deleted items',
  'courrier indésirable', 'courrier indesirable', 'junk email', 'junk e-mail', 'brouillons', 'drafts', 'boîte d\'envoi', 'boite d\'envoi', 'outbox',
  'archive', 'historique des conversations', 'conversation history', 'notes', 'journal', 'rss feeds', 'flux rss',
]
export async function scanAllFolders(opts: { mailbox?: string; limit?: number; sinceDays?: number; triage?: boolean } = {}): Promise<ScanReport & { folders: string[] }> {
  const mailbox = opts.mailbox || MAIL_AGENT_MAILBOX
  // Incrémental : par défaut les 45 derniers jours (bouton Scanner) ; le cron
  // passe J-1 toutes les 15 min (Olivier 23/09), un rejet ne reste jamais plus d'un quart
  // d'heure sans être vu. Sans borne, 185 dossiers × 11 000 mails = plus de 10 min.
  const since = new Date(Date.now() - (opts.sinceDays ?? 45) * 86400_000).toISOString()
  const total: ScanReport & { folders: string[] } = { scanned: 0, captured: 0, ready: 0, blocked: 0, toVerify: 0, skipped: 0, applied: 0, errors: [], folders: [] }
  let folders: { id: string; name: string; path: string }[] = []
  try { folders = await listAllFolders(mailbox) } catch (e: any) { total.errors.push(`liste des dossiers : ${e?.message}`); return total }
  for (const f of folders) {
    const lname = f.name.trim().toLowerCase()
    if (SKIP_FOLDERS.some(sk => lname === sk)) continue
    const r = await scanFolder({ mailbox, folder: f.path.replace(/^\//, ''), folderId: f.id, limit: opts.limit ?? 50, since, triage: opts.triage })
    total.folders.push(f.path)
    total.scanned += r.scanned; total.captured += r.captured; total.ready += r.ready; total.blocked += r.blocked
    total.toVerify += r.toVerify; total.skipped += r.skipped; total.applied += r.applied; total.errors.push(...r.errors)
  }
  return total
}

/** Les deux boîtes administratives, triage compris (Olivier 23/09/2026). */
export const TRIAGE_MAILBOXES = ['info@verviersdepannage.com', 'administration@verviersdepannage.com']
export async function scanMailboxes(opts: { sinceDays?: number; limit?: number } = {}): Promise<ScanReport & { folders: string[] }> {
  const sb = createAdminClient()
  const { data: st } = await sb.from('app_settings').select('value').eq('key', 'mail_agent_triage').maybeSingle()
  let triage = true; try { triage = st?.value ? JSON.parse(st.value) !== 'off' : true } catch {}
  const total: ScanReport & { folders: string[] } = { scanned: 0, captured: 0, ready: 0, blocked: 0, toVerify: 0, skipped: 0, applied: 0, toDecide: 0, errors: [], folders: [] }
  for (const mailbox of TRIAGE_MAILBOXES) {
    const r = await scanAllFolders({ ...opts, mailbox, triage })
    total.scanned += r.scanned; total.captured += r.captured; total.ready += r.ready; total.blocked += r.blocked; total.toVerify += r.toVerify
    total.skipped += r.skipped; total.applied += r.applied; total.toDecide = (total.toDecide || 0) + (r.toDecide || 0); total.errors.push(...r.errors); total.folders.push(...r.folders.map(f => `${mailbox}:${f}`))
  }
  return total
}

async function upsert(sb: any, base: Record<string, any>, patch: Record<string, any>) {
  await sb.from('mail_agent_items')
    .upsert({ ...base, ...patch }, { onConflict: 'mailbox,message_id,handler' })
}

export interface ApplyResult {
  ok:     boolean
  error?: string
  creditNoteName?: string | null
  newInvoiceName?: string | null
  warnings?: string[]
}

/**
 * Applique un item : extourne + refacturation dans Odoo, puis classement du
 * mail. Les garde-fous sont REJOUÉS ici — l'état d'Odoo a pu changer entre le
 * scan et la validation humaine.
 */
export async function applyItem(itemId: string, actor: string): Promise<ApplyResult> {
  const sb = createAdminClient()
  const { data: item } = await sb.from('mail_agent_items').select('*').eq('id', itemId).maybeSingle()
  if (!item)                      return { ok: false, error: 'Item introuvable' }
  if (item.status === 'applied')  return { ok: false, error: 'Déjà appliqué' }
  if (!item.odoo_move_name)       return { ok: false, error: 'Aucune facture Odoo rattachée' }

  // L'entité est reconstruite depuis ce que le scan a extrait : elle est fixe
  // chez IMA mais lue dans le PDF chez Allianz — pas de table en dur.
  const x = item.extracted || {}
  if (!x.entityVat) return { ok: false, error: 'Entité destinataire inconnue sur cet item' }
  const entity: RejectEntity = {
    key:     x.entityKey   || 'inconnu',
    label:   x.entityLabel || x.entityVat,
    vat:     x.entityVat,
    zeroVat: Boolean(x.zeroVat),
  }

  try {
    const inv    = await findInvoiceByName(item.odoo_move_name)
    const target = await resolveTargetPartner(entity)
    const checks = await runChecks(inv, target, x.amount ?? null)
    if (!checks.ok || !inv || !target) {
      await sb.from('mail_agent_items').update({
        status: 'blocked', blocked_reason: checks.blocked, checks: checks.details,
        updated_at: new Date().toISOString(),
      }).eq('id', itemId)
      return { ok: false, error: checks.blocked || 'Garde-fou rouge' }
    }

    const res = await creditAndRebill(inv, target, entity)

    // Classement du mail — jamais bloquant : la comptabilité est déjà faite.
    let moved = false
    const doneFolder = handlerById(item.handler)?.doneFolder || MAIL_AGENT_DONE_FOLDER
    const doneId = await findFolderIdByName(item.mailbox, doneFolder)
    if (doneId) moved = (await moveMessage(item.mailbox, item.message_id, doneId)).ok

    await sb.from('mail_agent_items').update({
      status:            'applied',
      credit_note_id:    res.creditNoteId,
      credit_note_name:  res.creditNoteName,
      new_invoice_id:    res.newInvoiceId,
      new_invoice_name:  res.newInvoiceName,
      blocked_reason:    res.warnings.length ? res.warnings.join(' · ') : null,
      mail_moved:        moved,
      applied_at:        new Date().toISOString(),
      applied_by:        actor,
      updated_at:        new Date().toISOString(),
    }).eq('id', itemId)

    return { ok: true, creditNoteName: res.creditNoteName, newInvoiceName: res.newInvoiceName, warnings: res.warnings }
  } catch (e: any) {
    const msg = e?.message || String(e)
    await sb.from('mail_agent_items').update({ status: 'error', error: msg, updated_at: new Date().toISOString() }).eq('id', itemId)
    return { ok: false, error: msg }
  }
}
