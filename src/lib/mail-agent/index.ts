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

import { createAdminClient } from '@/lib/supabase'
import { findFolderIdByName, listFolderMessages, getMessageText, moveMessage } from './graph'
import { detect, extract, IMA_DONE_FOLDER } from './handlers/ima-rejet'
import { findInvoiceByName, resolveTargetPartner, runChecks, creditAndRebill } from './odoo'

export const MAIL_AGENT_MAILBOX = 'info@verviersdepannage.com'
export const MAIL_AGENT_FOLDER  = '0 - Jona et Mobi'
// Dossier de classement par défaut ; chaque handler peut imposer le sien.
export const MAIL_AGENT_DONE_FOLDER = IMA_DONE_FOLDER

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
export async function scanFolder(opts: { mailbox?: string; folder?: string; limit?: number } = {}): Promise<ScanReport> {
  const sb      = createAdminClient()
  const mailbox = opts.mailbox || MAIL_AGENT_MAILBOX
  const folder  = opts.folder  || MAIL_AGENT_FOLDER
  const report: ScanReport = { scanned: 0, captured: 0, ready: 0, blocked: 0, toVerify: 0, skipped: 0, applied: 0, errors: [] }

  const folderId = await findFolderIdByName(mailbox, folder)
  if (!folderId) {
    report.errors.push(`Dossier Outlook « ${folder} » introuvable dans ${mailbox}`)
    return report
  }

  const messages = await listFolderMessages(mailbox, folderId, opts.limit || 100)
  report.scanned = messages.length

  for (const msg of messages) {
    try {
      if (!detect(msg.fromEmail, msg.subject)) { report.skipped++; continue }

      // Un item déjà traité ne doit pas être rejoué.
      const { data: existing } = await sb.from('mail_agent_items')
        .select('id, status')
        .eq('mailbox', mailbox).eq('message_id', msg.id).eq('handler', 'ima_rejet')
        .maybeSingle()
      if (existing && ['applied', 'ignored'].includes(existing.status)) { report.skipped++; continue }

      const text = await getMessageText(mailbox, msg.id)
      const parsed = extract(msg.subject, text)

      const base = {
        handler:     'ima_rejet',
        mailbox,
        message_id:  msg.id,
        folder,
        received_at: msg.receivedAt || null,
        from_email:  msg.fromEmail,
        subject:     msg.subject,
        updated_at:  new Date().toISOString(),
      }

      if (!parsed) {
        // Gabarit inconnu : on ne devine pas, on demande un œil humain.
        await upsert(sb, base, {
          status: 'to_verify',
          blocked_reason: "Mail non reconnu comme un gabarit de rejet IMA connu — lecture humaine requise",
          extracted: { rawExcerpt: text.slice(0, 1200) },
        })
        report.captured++; report.toVerify++
        continue
      }

      const inv    = await findInvoiceByName(parsed.invoiceNumber)
      const target = await resolveTargetPartner(parsed.entity)
      const checks = await runChecks(inv, target, parsed.amount)

      const extracted = {
        invoiceNumber: parsed.invoiceNumber,
        amount:        parsed.amount,
        entityKey:     parsed.entity.key,
        entityLabel:   parsed.entity.label,
        entityVat:     parsed.entity.vat,
        zeroVat:       parsed.entity.zeroVat,
        mailReference: parsed.mailReference,
        reason:        parsed.reason,
        odooRef:       inv?.ref || null,
      }

      await upsert(sb, base, {
        status:              checks.ok ? 'ready' : 'blocked',
        blocked_reason:      checks.blocked || null,
        extracted,
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

  const { IMA_ENTITIES } = await import('./handlers/ima-rejet')
  const entity = IMA_ENTITIES[item.extracted?.entityKey as keyof typeof IMA_ENTITIES]
  if (!entity) return { ok: false, error: 'Entité destinataire inconnue sur cet item' }

  try {
    const inv    = await findInvoiceByName(item.odoo_move_name)
    const target = await resolveTargetPartner(entity)
    const checks = await runChecks(inv, target, item.extracted?.amount ?? null)
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
    const doneFolder = item.handler === 'ima_rejet' ? IMA_DONE_FOLDER : MAIL_AGENT_DONE_FOLDER
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
