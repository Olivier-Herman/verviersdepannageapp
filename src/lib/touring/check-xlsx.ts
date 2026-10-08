// src/lib/touring/check-xlsx.ts
//
// ENVOI MENSUEL À TOURING BKO : EXCEL + SUIVI DE LA RÉPONSE (Olivier 08/10/2026 : « envoyer aussi le listing en
// xlsx et surveiller la réponse »). Le lien vers la page bloquait chez Touring (Mme Malfroy, 05/10).
//  1. L'envoi du 5 joint l'Excel des dossiers en attente (colonne « Votre réponse » à remplir).
//  2. L'envoi est inscrit au registre des pièces réclamées : sans réponse, brouillon de relance à J+7 et alerte
//     Telegram à J+14 (même mécanique que les demandes aux fournisseurs).
//  3. Quand Touring répond dans le fil avec l'Excel rempli, les réponses sont reportées dans « Check Touring »
//     (statut « répondu ») et Mobi est prévenu. Rien n'est APPLIQUÉ seul : chaque réponse se valide à l'écran.

import * as XLSX from 'xlsx'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { getBusinessNumber } from '@/lib/settings/business'
import { tgSend } from '@/lib/sam/telegram'

const G = 'https://graph.microsoft.com/v1.0'
const TYPE: Record<string, string> = { DSP: 'Dépannage', REM: 'Remorquage', REL: 'Relivraison', TRF: 'Transfert' }
export const ANSWER_COL = 'Votre réponse (déjà facturé + n° d’accord / à facturer hors COMEX / non couvert / autre)'
export const CHECK_REFERENCE = 'Check Touring'
const baseDossier = (d: string) => String(d || '').replace(/-REL-REL$/, '').trim().toUpperCase()

/** Excel des dossiers en attente de Touring (mêmes informations que la page). */
export async function buildCheckXlsx(sb: any): Promise<{ b64: string; count: number }> {
  const { data } = await sb.from('touring_check_dossiers').select('dossier_number, intervention_date, fiches, response_note').eq('status', 'pending').order('intervention_date')
  const rows = (data || []).map((r: any) => {
    const f = r.fiches || []
    return {
      'Dossier Touring': baseDossier(r.dossier_number),
      'Date': new Date(r.intervention_date).toLocaleDateString('fr-BE'),
      'Plaque': f.map((x: any) => x.plate).filter(Boolean).join(' / '),
      'Véhicule': [f[0]?.brand, f[0]?.model].filter(Boolean).join(' '),
      'Prestation(s)': f.map((x: any) => TYPE[x.kind] || x.kind || x.mission_type).join(' + '),
      'N° d’action': f.map((x: any) => String(x.external_id || '').replace(/^REL-REL-/, '')).join(' / '),
      'Lieu d’intervention': f[0]?.incident || '',
      'Destination': f.map((x: any) => x.destination).filter(Boolean).join(' / '),
      'Votre réponse précédente': r.response_note || '',
      [ANSWER_COL]: '',
    }
  })
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [16, 11, 12, 22, 22, 18, 40, 40, 40, 60].map(w => ({ wch: w }))
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dossiers à vérifier')
  return { b64: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })).toString('base64'), count: rows.length }
}

/** Inscrit l'envoi du mois au registre de suivi (retrouvé dans les éléments envoyés par son objet). */
export async function registerCheckSend(sb: any, mailbox: string, subject: string, to: string): Promise<boolean> {
  const tok = await getAppOnlyToken(); if (!tok) return false
  const f = encodeURIComponent(`subject eq '${subject.replace(/'/g, "''")}'`)
  const j = await (await fetch(`${G}/users/${encodeURIComponent(mailbox)}/mailFolders/sentitems/messages?$filter=${f}&$top=5&$select=id,sentDateTime,conversationId`, { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' })).json().catch(() => ({}))
  const m = (j.value || []).sort((a: any, b: any) => String(b.sentDateTime).localeCompare(String(a.sentDateTime)))[0]
  if (!m) return false
  const { error } = await sb.from('mail_piece_requests').upsert({ message_id: m.id, mailbox, emails: [to.toLowerCase()], subject, requested_at: m.sentDateTime, conversation_id: m.conversationId, fournisseur: 'Touring BKO', reference: `${CHECK_REFERENCE} — ${subject}` }, { onConflict: 'message_id' })
  return !error
}

/** Lit l'Excel renvoyé : « Dossier Touring » → réponse (lignes remplies seulement). */
export function parseCheckReply(bytes: Buffer): { dossier: string; answer: string }[] {
  const wb = XLSX.read(bytes, { type: 'buffer' })
  const out: { dossier: string; answer: string }[] = []
  for (const name of wb.SheetNames) {
    for (const row of XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[name], { defval: '' })) {
      const keys = Object.keys(row)
      const dk = keys.find(k => /dossier/i.test(k)); const ak = keys.find(k => /votre r[ée]ponse/i.test(k) && !/pr[ée]c[ée]dente/i.test(k))
      const dossier = dk ? baseDossier(row[dk]) : ''; const answer = ak ? String(row[ak] || '').trim() : ''
      if (dossier && answer) out.push({ dossier, answer })
    }
  }
  return out
}

/** Classe une réponse libre dans les codes de « Check Touring » (pour l'affichage ; l'application reste humaine). */
export function codeFor(answer: string): { code: string; note: string } {
  const a = answer.toLowerCase()
  const accord = answer.match(/\b(20\d{2}AC\d{4,})\b/i)?.[1]
  if (accord && /factur/.test(a) && !/hors\s*comex/.test(a)) return { code: 'already_invoiced', note: accord.toUpperCase() }
  if (/non\s*couvert|105/.test(a)) return { code: 'not_covered', note: answer }
  if (/d[ée]placement/.test(a) && /hors\s*comex/.test(a)) return { code: 'deplacement_hors_comex', note: answer }
  if (/hors\s*comex/.test(a) && !accord) return { code: 'invoice_hors_comex', note: answer }
  return { code: 'other', note: answer }
}

/** Réponses de Touring dans le fil d'un envoi suivi : Excel lu, réponses reportées, Mobi prévenu. */
export async function processCheckReplies(sb: any): Promise<{ replies: number; answers: number }> {
  const out = { replies: 0, answers: 0 }
  const tok = await getAppOnlyToken(); if (!tok) return out
  const H = { Authorization: `Bearer ${tok}` }
  const { data: reqs } = await sb.from('mail_piece_requests').select('*').eq('status', 'open').like('reference', `${CHECK_REFERENCE}%`)
  for (const q of reqs || []) {
    if (!q.conversation_id) continue
    const f = encodeURIComponent(`conversationId eq '${q.conversation_id}'`)
    const j = await (await fetch(`${G}/users/${encodeURIComponent(q.mailbox)}/messages?$filter=${f}&$top=20&$select=id,from,receivedDateTime,hasAttachments`, { headers: H, cache: 'no-store' })).json().catch(() => ({}))
    const replies = (j.value || []).filter((m: any) => m.receivedDateTime > q.requested_at && m.id !== q.message_id && !/verviersdepannage/i.test(m.from?.emailAddress?.address || ''))
    if (!replies.length) continue
    let answers = 0
    for (const m of replies.filter((x: any) => x.hasAttachments)) {
      const a = await (await fetch(`${G}/users/${encodeURIComponent(q.mailbox)}/messages/${m.id}/attachments`, { headers: H, cache: 'no-store' })).json().catch(() => ({}))
      for (const x of (a.value || []).filter((x: any) => /\.xlsx?$/i.test(x.name || '') && x.contentBytes)) {
        for (const r of parseCheckReply(Buffer.from(x.contentBytes, 'base64'))) {
          const { code, note } = codeFor(r.answer)
          const { data: rows } = await sb.from('touring_check_dossiers').select('id, dossier_number').eq('status', 'pending')
          const hit = (rows || []).find((d: any) => baseDossier(d.dossier_number) === r.dossier)
          if (!hit) continue
          await sb.from('touring_check_dossiers').update({ status: 'answered', response_code: code, response_note: note, answered_at: new Date().toISOString() }).eq('id', hit.id)
          answers++
        }
      }
    }
    const last = replies.map((m: any) => m.receivedDateTime).sort().pop()
    await sb.from('mail_piece_requests').update({ status: answers ? 'received' : 'open', last_reply_at: last }).eq('id', q.id)
    out.replies++; out.answers += answers
    if (answers || !q.last_reply_at || q.last_reply_at < last) {
      try { await tgSend(await getBusinessNumber('telegram_chat_mobi'), answers ? `Touring a répondu à la liste « ${q.subject} » : ${answers} réponse(s) reportée(s) dans Check Touring, à valider.` : `Touring a répondu à « ${q.subject} » sans Excel rempli : à lire dans ${q.mailbox}.`, [], 'Check Touring') } catch { /* jamais bloquant */ }
    }
  }
  return out
}
