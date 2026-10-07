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
import { findFolderIdByName, listFolderMessages, listAllFolders, getMessageText, getPdfAttachments, moveMessage, findOrCreateFolder } from './graph'
import type { AgentMessage } from './graph'
import { refreshAwpSenders } from './handlers/awp-rejet'
import { refreshImaSenders } from './handlers/ima-rejet'
import { isSupplierCandidate, isWatchedReply, processSupplierMail, refreshInvoicePlatforms, setWatchedSenders, setWatchedConversations, FOURNISSEUR_DONE_FOLDER } from './handlers/fournisseur'
import { loadWatchedSenders, loadWatchedConversations, markPieceReceived, notePieceReplyWithoutDocument, scanPieceRequests, remindOldPieceRequests } from './pieces'
import { fixedRule } from './rules'
import { replyAddress as imaReplyAddress } from './handlers/ima-rejet'
import { forwardToAdmin, ADMIN_FORWARDED_CATEGORY } from './graph'
const OUT_MAILBOX_ADMIN = 'administration@verviersdepannage.com'
// Familles « facture » du tri et expéditeurs d'assistances (rejet, contestation, demande de facture ou d'avoir).
const ASSISTANCE_INVOICE_FAMILIES = new Set(['contestation', 'demande_avoir', 'demande_document', 'double_paiement', 'rappel_paiement'])
const ASSISTANCE_SENDER = /imabenelux|ima\.eu|touring\.be|vab\.be|allianz|awp|axa-assistance|ip-assistance|eurocross|europ-assistance|ethias|anwb|acl\.lu|race\.es|pv\.be|vivium/i
import { usualFolder, folderIdByPath } from './learned'
import { triageMail, isNoise, isAssistanceMission, isHandledElsewhere, twinInQueue, readAutoFamilies } from './triage'
import { executeDecision } from './actions'
import { handlerFor, handlerById } from './handlers'
import { findInvoiceByName, resolveTargetPartner, runChecks, creditAndRebill, postAndSendPeppol, duplicatePlan, creditInFull, type DuplicatePlan } from './odoo'
import { getBusinessText } from '@/lib/settings/business'
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
      // Règles fixes sans IA (lot 1, 06/10/2026) : corbeille ou dossier habituel, aucune carte.
      const rule = fixedRule(msg, mailbox)
      if (rule) {
        const here = folder.split('/').pop()!.trim().toLowerCase()
        const target = rule.kind === 'trash' ? null : rule.folder.toLowerCase()
        if (target !== here && !(rule.kind === 'trash' && /^(éléments supprimés|deleted items)$/.test(here))) {
          // Dossier absent de la boîte (ex. « Scrada - Livre de Caisse » dans administration@, 07/10/2026) :
          // créé sous la Boîte de réception ; un échec se voit dans les erreurs, jamais en silence.
          const fid = rule.kind === 'trash' ? 'deleteditems' : await findOrCreateFolder(mailbox, rule.folder).catch(() => null)
          if (!fid) report.errors.push(`${msg.subject} : dossier « ${rule.kind === 'file' ? rule.folder : ''} » introuvable et impossible à créer dans ${mailbox}`)
          else {
            const mv = await moveMessage(mailbox, msg.id, fid)
            if (mv.ok) {
              await upsert(sb, { handler: 'regle', mailbox, message_id: msg.id, folder, received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() },
                { status: 'skipped', mail_moved: true, blocked_reason: rule.kind === 'trash' ? `Corbeille : ${rule.why}` : `Classé dans « ${rule.folder} » : ${rule.why}` })
              report.applied++
            } else report.errors.push(`${msg.subject} : ${mv.error}`)
          }
        }
        report.skipped++; continue
      }
      const handler = handlerFor(msg.fromEmail, msg.subject)
      // Rejets arrivés dans info@ → transférés à administration@, d'où partent les réponses
      // (Olivier 07/10/2026). Rejet de la facture d'une autre société (nous en copie) → corbeille.
      if (handler && (handler.id === 'awp_rejet' || handler.id === 'ima_rejet')) {
        const base0 = { handler: 'regle', mailbox, message_id: msg.id, folder, received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() }
        if (handler.notOurs?.(msg.subject)) {
          const mv = await moveMessage(mailbox, msg.id, 'deleteditems')
          if (mv.ok) await upsert(sb, base0, { status: 'skipped', mail_moved: true, blocked_reason: 'Corbeille : rejet de la facture d’une autre société (nous sommes en copie)' })
          report.skipped++; continue
        }
        if (mailbox.toLowerCase() === MAIL_AGENT_MAILBOX.toLowerCase()) {
          if (!(msg.categories || []).includes(ADMIN_FORWARDED_CATEGORY)) {
            const f = await forwardToAdmin(mailbox, msg, OUT_MAILBOX_ADMIN)
            const doneId = await findOrCreateFolder(mailbox, handler.doneFolder || MAIL_AGENT_DONE_FOLDER)
            const mv = doneId ? await moveMessage(mailbox, msg.id, doneId) : { ok: false }
            await upsert(sb, base0, { status: 'skipped', mail_moved: !!mv.ok, blocked_reason: f.duplicate ? 'Déjà reçu dans administration@ : rien transféré, classé' : 'Transféré à administration@ (le rejet s’y traite et la réponse en part), classé' })
            report.applied++
          }
          report.skipped++; continue
        }
      }
      if (!handler) {
        // Facture fournisseur ? (Olivier 23/09/2026) — lue, vérifiée dans Odoo
        // par société, classée ou envoyée pour encodage. Jamais deux fois.
        // Réponse sans pièce jointe à une de nos demandes de pièces : Mobi est prévenu, le tri continue.
        if (!msg.hasAttachments && isWatchedReply(msg)) await notePieceReplyWithoutDocument(sb, msg.fromEmail, { conversationId: msg.conversationId, subject: msg.subject, preview: msg.bodyPreview }).catch(() => {})
        if (isSupplierCandidate(msg)) {
          const seen = await findKnownItem(sb, mailbox, 'fournisseur', msg, folder)
          // « Pas une facture » : déjà renvoyé au tri, on laisse le tri décider (il a sa propre mémoire).
          if (seen?.status === 'skipped') { if (!opts.triage) { report.skipped++; continue } }
          else if (seen && ['applied', 'ignored', 'to_verify', 'decided'].includes(seen.status)) { report.skipped++; continue }
          // Lecture ratée : retentée jusqu'à 3 fois, puis lecture humaine (audit du 06/10/2026).
          let attempts = 0
          if (seen?.status === 'retry') {
            const { data: it } = await sb.from('mail_agent_items').select('extracted').eq('id', seen.id).maybeSingle()
            attempts = Number(it?.extracted?.attempts || 0)
          }
          if (seen?.status !== 'skipped') {
          // En attente de la version Peppol : revérifiée après 24 h, sans relire le PDF (pas de nouvel appel IA).
          let known: any = null
          if (seen?.status === 'waiting') {
            const { data: it } = await sb.from('mail_agent_items').select('extracted').eq('id', seen.id).maybeSingle()
            if (!it?.extracted?.waitUntil || new Date(it.extracted.waitUntil).getTime() > Date.now()) { report.skipped++; continue }
            known = it.extracted
          }
          const base = { handler: 'fournisseur', mailbox, message_id: msg.id, folder, received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() }
          let goTriage = false
          try {
            const out = await processSupplierMail(sb, mailbox, msg, base, known ? { known, afterWait: true } : {})
            if (out.status === 'retry' && attempts + 1 >= 3) { out.status = 'to_verify'; out.note = 'Pièce non lisible automatiquement après 3 essais — lecture humaine requise' }
            await upsert(sb, base, { status: out.status, blocked_reason: out.note, extracted: out.status === 'retry' ? { attempts: attempts + 1 } : out.extracted })
            if (out.status === 'applied' || out.status === 'to_verify') await markPieceReceived(sb, msg.fromEmail, `${mailbox} · ${msg.subject || ''}`, { mailbox, messageId: msg.id, conversationId: msg.conversationId, subject: msg.subject })
            else if (out.status === 'skipped' && isWatchedReply(msg)) await notePieceReplyWithoutDocument(sb, msg.fromEmail, { conversationId: msg.conversationId, subject: msg.subject, preview: msg.bodyPreview }).catch(() => {})
            if (out.status === 'applied') { report.captured++; report.applied++ }
            else if (out.status === 'to_verify') { report.captured++; report.toVerify++ }
            else if (out.status === 'skipped') goTriage = true   // pas une facture → tri normal
            else report.skipped++
          } catch (e: any) { report.errors.push(`${msg.subject} : ${e?.message || String(e)}`) }
          if (!goTriage) continue
          }
        }
        // Triage quotidien (jour 1, Olivier 23/09/2026) : tout le reste, sauf le
        // bruit et les ordres de mission, devient une carte de décision.
        if (opts.triage && !isNoise(msg) && !isAssistanceMission(msg, folder) && !isHandledElsewhere(msg, folder)) {
          const seen = await findKnownItem(sb, mailbox, 'triage', msg, folder)
          if (seen) { report.skipped++; continue }
          const base = { handler: 'triage', mailbox, message_id: msg.id, folder, received_at: msg.receivedAt || null, from_email: msg.fromEmail, subject: msg.subject, updated_at: new Date().toISOString() }
          try {
            const twin = await twinInQueue(sb, msg)
            if (twin) {
              // Même fil dans les deux boîtes : on garde la copie d'administration@,
              // c'est de là que partent les réponses (Olivier 23/09/2026).
              if (mailbox.toLowerCase() === 'administration@verviersdepannage.com' && twin.mailbox.toLowerCase() !== mailbox.toLowerCase()) {
                await sb.from('mail_agent_items').update({ status: 'skipped', blocked_reason: 'Même fil repris depuis administration@ (réponse dans le fil)', updated_at: new Date().toISOString() }).eq('id', twin.id)
              } else {
                await upsert(sb, base, { status: 'skipped', blocked_reason: `Même fil déjà à décider (${twin.mailbox.split('@')[0]}@)`, extracted: { duplicateOf: twin.id } }); report.skipped++; continue
              }
            }
            const t = await triageMail(sb, mailbox, msg)
            if (!t) { report.skipped++; continue }
            // Demande d'une assistance sur une facture arrivée dans info@ → administration@ (07/10/2026).
            if (mailbox.toLowerCase() === MAIL_AGENT_MAILBOX.toLowerCase() && ASSISTANCE_INVOICE_FAMILIES.has(t.family) && ASSISTANCE_SENDER.test(msg.fromEmail || '') && !(msg.categories || []).includes(ADMIN_FORWARDED_CATEGORY)) {
              const f = await forwardToAdmin(mailbox, msg, OUT_MAILBOX_ADMIN)
              const doneId = await findOrCreateFolder(mailbox, MAIL_AGENT_DONE_FOLDER)
              const mv = doneId ? await moveMessage(mailbox, msg.id, doneId) : { ok: false }
              await upsert(sb, base, { status: 'skipped', mail_moved: !!mv.ok, blocked_reason: f.duplicate ? 'Déjà reçu dans administration@ : classé' : 'Demande d’assistance sur une facture : transférée à administration@', extracted: t })
              report.applied++; continue
            }
            // Classement appris (Olivier 06/10/2026) : dossier habituel de cet expéditeur.
            const uf = await usualFolder(sb, mailbox, msg.fromEmail).catch(() => null)
            if (t.family === 'info') {
              // Information sans demande : rangée là où l'on range d'habitude cet expéditeur ;
              // au moindre doute, une carte « Où classer ? » (le choix est ensuite retenu).
              if (uf?.sure) {
                const fid = await folderIdByPath(mailbox, uf.folder).catch(() => null)
                const mv = fid ? await moveMessage(mailbox, msg.id, fid) : { ok: false as const }
                if (mv.ok) {
                  await upsert(sb, base, { status: 'skipped', mail_moved: true, blocked_reason: `Information sans demande — classée dans « ${uf.folder} » (dossier habituel)`, extracted: { ...t, usualFolder: uf } })
                  report.applied++; continue
                }
              }
              await upsert(sb, base, { status: 'to_decide', blocked_reason: 'Où classer ce mail ?', extracted: { ...t, usualFolder: uf, proposals: [{ key: 'classer', label: 'Classer', ready: true }, { key: 'laisser', label: 'Laisser', ready: true }] } })
              report.captured++; report.toDecide = (report.toDecide || 0) + 1; continue
            }
            await upsert(sb, base, { status: 'to_decide', blocked_reason: t.asked || null, extracted: { ...t, usualFolder: uf } })
            report.captured++; report.toDecide = (report.toDecide || 0) + 1
            // Famille en automatique (jour 3) : l'action part tout de suite, avec le mode courant.
            const autoAction = (await readAutoFamilies(sb))[t.family]
            if (autoAction) {
              const { data: fresh } = await sb.from('mail_agent_items').select('*').eq('mailbox', mailbox).eq('message_id', msg.id).eq('handler', 'triage').maybeSingle()
              if (fresh) {
                const mode = await getMode(sb)
                const res = await executeDecision({ sb, item: fresh, actor: 'agent', mode, odooBase: process.env.ODOO_URL || '' }, autoAction)
                const now = new Date().toISOString()
                if (res.ok) {
                  let moved = false; try { const fid = await findOrCreateFolder(mailbox, MAIL_AGENT_DONE_FOLDER); if (fid) moved = (await moveMessage(mailbox, msg.id, fid)).ok } catch {}
                  await sb.from('mail_agent_items').update({ status: 'decided', mail_moved: moved, extracted: { ...t, decision: { action: autoAction, by: 'agent', at: now, result: res.note, links: res.links || [] } }, applied_at: now, applied_by: 'agent', updated_at: now }).eq('id', fresh.id)
                  report.applied++; report.toDecide = (report.toDecide || 1) - 1
                } else await sb.from('mail_agent_items').update({ error: `automatique refusé : ${res.error}`, updated_at: now }).eq('id', fresh.id)
              }
            }
          } catch (e: any) { report.errors.push(`${msg.subject} : ${e?.message || String(e)}`) }
          continue
        }
        report.skipped++; continue
      }

      // Un item déjà traité ne doit pas être rejoué.
      const existing = await findKnownItem(sb, mailbox, handler.id, msg, folder)
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
          extracted: { rawExcerpt: text.slice(0, 1200), ...(() => {
            const r = handler.id === 'ima_rejet' ? imaReplyAddress(text) : null
            return { replyTo: r?.email || msg.fromEmail || null, replyToPhrase: r?.phrase || 'adresse de réponse non indiquée, expéditeur utilisé' }
          })() },
        })
        report.captured++; report.toVerify++
        continue
      }

      // Doublon (Olivier 23/09/2026 : « Allianz envoie souvent en double ») : le
      // même rejet, même n° de facture, déjà capturé sous un autre mail → on
      // l'ignore, on ne crée pas deux fois l'avoir.
      // Toutes boîtes confondues : le même rejet arrive parfois sur info@ ET administration@ (06/10/2026).
      const { data: twin } = await sb.from('mail_agent_items').select('id, status, message_id, folder, extracted')
        .eq('handler', handler.id).neq('message_id', msg.id)
        .eq('extracted->>invoiceNumber', parsed.invoiceNumber)
        .in('status', ['ready', 'applied', 'blocked', 'to_verify']).limit(1).maybeSingle()
      if (twin) {
        // Rattaché à la carte existante : la carte d'origine note le doublon reçu.
        const dups = Array.isArray(twin.extracted?.duplicates) ? twin.extracted.duplicates : []
        await sb.from('mail_agent_items').update({ extracted: { ...(twin.extracted || {}), duplicates: [...dups, { mailbox, at: msg.receivedAt || new Date().toISOString(), subject: msg.subject }] } }).eq('id', twin.id)
        await upsert(sb, base, {
          status: 'ignored',
          blocked_reason: `Doublon : le rejet de la facture ${parsed.invoiceNumber} est déjà capturé (${twin.status}, dossier « ${twin.folder} »).`,
          extracted: { invoiceNumber: parsed.invoiceNumber, reason: parsed.reason, duplicateOf: twin.id },
        })
        // Classé avec les rejets traités (Olivier 23/09 : « classer les mails dans
        // les bons dossiers une fois traités ») : le doublon ne traîne pas.
        try { const doneId = await findOrCreateFolder(mailbox, handler.doneFolder || MAIL_AGENT_DONE_FOLDER); if (doneId) await moveMessage(mailbox, msg.id, doneId) } catch {}
        report.skipped++
        continue
      }
      const inv    = await findInvoiceByName(parsed.invoiceNumber)
      const target = await resolveTargetPartner(parsed.entity)
      const checks = await runChecks(inv, target, parsed.amount)
      // Dossier facturé deux fois : la facture à créditer est repérée (fiche + photos), Olivier
      // valide d'un clic au début (07/10/2026). Sans certitude, le blocage reste tel quel.
      let dupPlan: DuplicatePlan | null = null
      if (!checks.ok && inv && checks.details?.duplicates?.length) {
        dupPlan = await duplicatePlan(sb, [{ id: inv.id, name: inv.name }, ...checks.details.duplicates.map((d: any) => ({ id: d.id, name: d.name }))]).catch(() => null)
      }

      await upsert(sb, base, {
        status:              checks.ok ? 'ready' : 'blocked',
        blocked_reason:      dupPlan ? `Facturé deux fois : créditer ${dupPlan.credit.map(c => c.name).join(', ')} (doublon), puis corriger ${dupPlan.keep.name} — ${dupPlan.why}` : (checks.blocked || null),
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
          // Adresse de réponse lue dans le mail ou le PDF ; à défaut, l'expéditeur, signalé (07/10/2026).
          replyTo:       parsed.replyTo || msg.fromEmail || null,
          replyToPhrase: parsed.replyToPhrase || (parsed.replyTo ? null : 'adresse de réponse non indiquée, expéditeur utilisé'),
          ...(dupPlan ? { duplicatePlan: dupPlan } : {}),
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

  // Mode autonome : on applique tout ce qui est vert. En 'draft', seuls les rejets « mauvais
  // client » tout verts partent seuls (Olivier 07/10/2026, réglage mail_agent_rejets_auto).
  const rejetsAuto = (await getBusinessText('mail_agent_rejets_auto').catch(() => 'oui')).toLowerCase() === 'oui'
  const fullAuto = await getMode(sb) === 'auto'
  if (fullAuto || rejetsAuto) {
    let q = sb.from('mail_agent_items').select('id').eq('status', 'ready')
    if (!fullAuto) q = q.in('handler', ['awp_rejet', 'ima_rejet'])
    const { data: ready } = await q
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
  MAIL_AGENT_DONE_FOLDER.toLowerCase(), 'mondial automatic dispatch', 'ima payement', '01 - total - anomalie détectée',
  'éléments envoyés', 'elements envoyes', 'sent items', 'éléments supprimés', 'elements supprimes', 'deleted items',
  'courrier indésirable', 'courrier indesirable', 'junk email', 'junk e-mail', 'brouillons', 'drafts', 'boîte d\'envoi', 'boite d\'envoi', 'outbox',
  'archive', 'historique des conversations', 'conversation history', 'notes', 'journal', 'rss feeds', 'flux rss',
]
export async function scanAllFolders(opts: { mailbox?: string; limit?: number; sinceDays?: number; triage?: boolean; onlyFolders?: string[]; supplierOnlyFolders?: string[] } = {}): Promise<ScanReport & { folders: string[] }> {
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
    // Périmètre restreint (info@ : « 0 - Jona et Mobi » et « 0 - Scan Facturation »
    // avec leurs sous-dossiers, Olivier 23/09/2026 — « pour ne pas être noyés »).
    // Hors périmètre mais dossier « factures seulement » (racine de la Boîte de réception d'info@,
    // Olivier 06/10/2026) : lu pour les factures fournisseurs, jamais pour le tri des cartes.
    let triage = opts.triage
    // « Fournisseur Divers » : des règles Outlook y rangent directement des factures (Car Parts, Pepinster
    // Pneus, Univert) → lu pour les factures seulement, jamais pour le tri (audit du 06/10/2026).
    if (lname === FOURNISSEUR_DONE_FOLDER.toLowerCase()) triage = false
    if (opts.onlyFolders?.length && !opts.onlyFolders.some(o => f.path.toLowerCase().includes('/' + o.toLowerCase()))) {
      // Racine ET sous-dossiers (sumup, rgf, brandt, AS24…) de la Boîte de réception d'info@, factures seulement.
      const p = f.path.toLowerCase()
      if (!opts.supplierOnlyFolders?.some(o => p === '/' + o.toLowerCase() || p.startsWith('/' + o.toLowerCase() + '/'))) continue
      triage = false
    }
    const r = await scanFolder({ mailbox, folder: f.path.replace(/^\//, ''), folderId: f.id, limit: opts.limit ?? 50, since, triage })
    total.folders.push(f.path)
    total.scanned += r.scanned; total.captured += r.captured; total.ready += r.ready; total.blocked += r.blocked
    total.toVerify += r.toVerify; total.skipped += r.skipped; total.applied += r.applied; total.toDecide = (total.toDecide || 0) + (r.toDecide || 0); total.errors.push(...r.errors)
  }
  return total
}

/** Les deux boîtes administratives, triage compris (Olivier 23/09/2026). */
export const TRIAGE_MAILBOXES = ['info@verviersdepannage.com', 'administration@verviersdepannage.com', 'fourriere@verviersdepannage.be']
/** info@ : seulement ce que le bureau contrôle (Olivier 23/09/2026) ; administration@ : toute la boîte. */
export const MAILBOX_SCOPE: Record<string, string[] | undefined> = {
  'info@verviersdepannage.com': ['0 - Jona et Mobi', '0 - Scan Facturation'],
  'administration@verviersdepannage.com': undefined,
  'fourriere@verviersdepannage.be': undefined,   // tout, sauf ce que les modules Saisie / Domaine traitent (cf. isHandledElsewhere)
}
/** Dossiers lus pour les factures fournisseurs SEULEMENT, hors périmètre du tri (Olivier 06/10/2026). */
export const SUPPLIER_ONLY_SCOPE: Record<string, string[] | undefined> = {
  'info@verviersdepannage.com': ['Boîte de réception', 'Inbox'],
}
export async function scanMailboxes(opts: { sinceDays?: number; limit?: number } = {}): Promise<ScanReport & { folders: string[] }> {
  const sb = createAdminClient()
  const { data: st } = await sb.from('app_settings').select('value').eq('key', 'mail_agent_triage').maybeSingle()
  let triage = true; try { triage = st?.value ? JSON.parse(st.value) !== 'off' : true } catch {}
  await refreshInvoicePlatforms()
  const total: ScanReport & { folders: string[]; riga?: any } = { scanned: 0, captured: 0, ready: 0, blocked: 0, toVerify: 0, skipped: 0, applied: 0, toDecide: 0, errors: [], folders: [] }
  // Pièces réclamées : nos demandes envoyées sont relevées, leurs destinataires surveillés (Olivier 06/10/2026).
  for (const mb of ['info@verviersdepannage.com', 'administration@verviersdepannage.com']) await scanPieceRequests(sb, mb).catch(e => total.errors.push(`pièces réclamées (${mb}) : ${e?.message || e}`))
  setWatchedSenders(await loadWatchedSenders(sb).catch(() => []))
  setWatchedConversations(await loadWatchedConversations(sb).catch(() => []))
  await remindOldPieceRequests(sb).catch(() => {})
  // Mails de Dépannage Riga d'abord (Olivier 05/10/2026) : rangés dans « Dépannage
  // Riga » avant que le triage n'en fasse des cartes pour le bureau.
  try {
    const { sortRigaMailboxes } = await import('./riga')
    const r = await sortRigaMailboxes()
    total.riga = { checked: r.checked, moved: r.moved, doubtful: r.doubtful }
    total.applied += r.moved; total.captured += r.moved + r.doubtful; total.toVerify += r.doubtful
    total.errors.push(...r.errors)
  } catch (e: any) { total.errors.push(`Riga : ${e?.message || String(e)}`) }
  for (const mailbox of TRIAGE_MAILBOXES) {
    const r = await scanAllFolders({ ...opts, mailbox, triage, onlyFolders: MAILBOX_SCOPE[mailbox], supplierOnlyFolders: SUPPLIER_ONLY_SCOPE[mailbox] })
    total.scanned += r.scanned; total.captured += r.captured; total.ready += r.ready; total.blocked += r.blocked; total.toVerify += r.toVerify
    total.skipped += r.skipped; total.applied += r.applied; total.toDecide = (total.toDecide || 0) + (r.toDecide || 0); total.errors.push(...r.errors); total.folders.push(...r.folders.map(f => `${mailbox}:${f}`))
  }
  return total
}

/**
 * Retrouve un mail déjà connu de l'agent. Outlook donne un NOUVEL identifiant à
 * un mail déplacé : un mail classé (« Classer », « Mail auto-géré », ou à la
 * main dans Outlook) réapparaissait comme une nouvelle carte au scan suivant,
 * puisque le scan relit tous les dossiers (Olivier 28/09/2026). On le
 * reconnaît donc aussi à sa clé stable — boîte + réception + expéditeur +
 * objet — et on recale l'identifiant et le dossier sur l'item existant.
 */
async function findKnownItem(sb: any, mailbox: string, handler: string, msg: AgentMessage, folder: string): Promise<{ id: string; status: string } | null> {
  const { data: byId } = await sb.from('mail_agent_items').select('id, status')
    .eq('mailbox', mailbox).eq('message_id', msg.id).eq('handler', handler).maybeSingle()
  if (byId) return byId
  if (!msg.receivedAt) return null
  let q = sb.from('mail_agent_items').select('id, status, folder, extracted')
    .eq('mailbox', mailbox).eq('handler', handler).eq('received_at', msg.receivedAt)
  q = msg.fromEmail ? q.eq('from_email', msg.fromEmail) : q.is('from_email', null)
  q = msg.subject ? q.eq('subject', msg.subject) : q.is('subject', null)
  const { data: rows } = await q.order('id').limit(1)
  const moved = rows?.[0]
  if (!moved) return null
  // Carte encore ouverte dont le mail a été rangé à la main ailleurs : traitée dans la boîte →
  // fermée « Fait ailleurs » (pas pour un rejet : il faut une preuve, cf. settle.ts). 06/10/2026.
  const now = new Date().toISOString()
  if (['to_decide', 'to_verify', 'waiting'].includes(moved.status) && ['fournisseur', 'triage'].includes(handler) && moved.folder && moved.folder !== folder) {
    await sb.from('mail_agent_items').update({ message_id: msg.id, folder, status: 'decided', applied_at: now, applied_by: 'agent', updated_at: now,
      extracted: { ...(moved.extracted || {}), decision: { action: 'fait_ailleurs', by: 'agent', at: now, result: `Fait ailleurs : mail classé dans « ${folder} »` } } }).eq('id', moved.id)
    return { id: moved.id, status: 'decided' }
  }
  await sb.from('mail_agent_items').update({ message_id: msg.id, folder, updated_at: now }).eq('id', moved.id)
  return moved
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
    // Jusqu'au bout (07/10/2026) : la nouvelle facture est validée et envoyée par Peppol.
    if (res.newInvoiceId) {
      try { const sent = await postAndSendPeppol(res.newInvoiceId); res.newInvoiceName = sent.name; if (!sent.sent) res.warnings.push(sent.note) }
      catch (e: any) { res.warnings.push(`Nouvelle facture créée mais pas validée/envoyée : ${e?.message || e}`) }
    }

    // Classement du mail — jamais bloquant : la comptabilité est déjà faite.
    let moved = false
    const doneFolder = handlerById(item.handler)?.doneFolder || MAIL_AGENT_DONE_FOLDER
    const doneId = await findOrCreateFolder(item.mailbox, doneFolder)
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

/**
 * « Créditer le doublon et corriger » (Olivier 07/10/2026) : le doublon repéré est crédité en
 * entier, puis le module corrige la facture gardée (note de crédit, nouvelle facture au bon
 * client, validée et envoyée, mail classé). Si la facture rejetée est elle-même le doublon,
 * la carte passe sur la facture gardée : c'est le dossier qui est rejeté.
 */
export async function creditDuplicateAndApply(itemId: string, actor: string): Promise<ApplyResult & { credited?: string[] }> {
  const sb = createAdminClient()
  const { data: item } = await sb.from('mail_agent_items').select('*').eq('id', itemId).maybeSingle()
  const plan: DuplicatePlan | undefined = item?.extracted?.duplicatePlan
  if (!item || !plan) return { ok: false, error: 'Pas de doublon repéré sur cette carte' }
  const credited: string[] = []
  for (const c of plan.credit) credited.push(await creditInFull(c.id, `Doublon de ${plan.keep.name}`))
  await sb.from('mail_agent_items').update({ status: 'ready', blocked_reason: null, odoo_move_id: plan.keep.id, odoo_move_name: plan.keep.name, updated_at: new Date().toISOString() }).eq('id', itemId)
  const res = await applyItem(itemId, actor)
  if (res.ok) await sb.from('mail_agent_items').update({ blocked_reason: `Doublon ${plan.credit.map(c => c.name).join(', ')} crédité (${credited.join(', ')}) ; ${plan.keep.name} corrigée${res.warnings?.length ? ' · ' + res.warnings.join(' · ') : ''}` }).eq('id', itemId)
  return { ...res, credited }
}
