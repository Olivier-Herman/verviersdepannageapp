// src/lib/requisitoire/info-forward.ts
//
// RÉQUISITOIRES ET LEVÉES ARRIVÉS DANS INFO@ (Olivier 06/10/2026) : ils sont transférés à
// fourriere@, où le module Réquisitoires les lit comme les autres (il reste la seule voie).
// Pas d'IA : expéditeur police (ou objet qui parle de réquisitoire, saisie, levée), ni
// facture ni état de frais.
// Doublons : la police écrit parfois aux deux adresses dans le même mail. Si le même
// message (même internetMessageId) est déjà dans fourriere@, rien n'est transféré.
// Dans tous les cas, le mail d'info@ est marqué puis classé dans « Mail auto-géré » :
// il n'est jamais transféré deux fois.

import { FOURRIERE_MAILBOX, RECONCILE_MAILBOXES } from './intake'
import {
  listPoliceMailsSince, hasInternetMessageId, forwardMessage, folderDisplayName, tagMessage, moveMessageToFolder,
  AUTO_MANAGED_FOLDER, INFO_FORWARD_MARK, INFO_FORWARDED_CATEGORY,
} from './graph'

const INFO = RECONCILE_MAILBOXES.find(m => m !== FOURRIERE_MAILBOX) as string
// Mise en service : les mails plus anciens ont été traités à la main.
const DEPUIS = '2026-10-06T17:00:00Z'
const OURS = /@(verviersdepannage\.(com|be)|hoos\.cloud|verviers-depannage\.odoo\.com)\s*$/i
const POLICE_SENDER = /@([a-z0-9-]+\.)*(police[a-z0-9-]*\.[a-z.]+|just\.fgov\.be)\s*$/i
const ABOUT = /r[ée]quisitoire|lev[ée]e de saisie|mainlev[ée]e|lev[ée]e d.immobilisation|saisie/i
const NOT_FOR_US = /facture|factuur|invoice|[ée]tat de frais/i
const SKIP_FOLDERS = new Set(['mail auto-géré', 'éléments supprimés', 'deleted items', 'courrier indésirable', 'junk email', 'brouillons', 'drafts', 'éléments envoyés', 'sent items', "boîte d'envoi", 'outbox'])
const fr = (iso: string) => new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export interface InfoForwardSummary { seen: number; forwarded: number; duplicates: number; errors: string[] }

export async function forwardPoliceFromInfo(): Promise<InfoForwardSummary> {
  const out: InfoForwardSummary = { seen: 0, forwarded: 0, duplicates: 0, errors: [] }
  const since = new Date(Math.max(Date.parse(DEPUIS), Date.now() - 3 * 86_400_000)).toISOString()
  const mails = await listPoliceMailsSince(INFO, since)
  const folders = new Map<string, string>()
  for (const m of mails) {
    if (m.categories.includes(INFO_FORWARDED_CATEGORY)) continue
    if (OURS.test(m.from)) continue
    if (!(POLICE_SENDER.test(m.from) || ABOUT.test(m.subject))) continue
    if (NOT_FOR_US.test(m.subject)) continue
    if (!folders.has(m.parentFolderId)) folders.set(m.parentFolderId, (await folderDisplayName(INFO, m.parentFolderId)).toLowerCase())
    if (SKIP_FOLDERS.has(folders.get(m.parentFolderId) || '')) continue
    out.seen++
    try {
      const dup = !!m.internetMessageId && await hasInternetMessageId(FOURRIERE_MAILBOX, m.internetMessageId)
      if (dup) out.duplicates++
      else {
        await forwardMessage(INFO, m.id, FOURRIERE_MAILBOX, `${INFO_FORWARD_MARK} — reçu le ${fr(m.receivedDateTime)} de ${m.from}.`)
        out.forwarded++
      }
      await tagMessage(INFO, m.id, INFO_FORWARDED_CATEGORY, m.categories)
      const mv = await moveMessageToFolder(INFO, m.id, AUTO_MANAGED_FOLDER)
      if (!mv.ok) out.errors.push(`${m.subject} : classement impossible (${mv.error})`)
    } catch (e: any) {
      out.errors.push(`${m.subject} : ${e?.message || e}`)
    }
  }
  return out
}
