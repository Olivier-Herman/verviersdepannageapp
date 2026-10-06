// src/lib/mail-agent/learned.ts
//
// CLASSEMENT APPRIS (Olivier 06/10/2026) : « classer dans le dossier où l'on classe d'habitude
// ce même expéditeur ; en cas d'hésitation, sur mon écran, je choisis le dossier, et Justine
// retient ce choix ».
//   - Chaque nuit : relevé des 180 derniers jours de chaque dossier de rangement (pas la
//     boîte de réception, ni les dossiers d'arrivée, ni corbeille, envoyés, indésirables).
//   - Sûr = choix d'Olivier, ou au moins 3 mails de l'expéditeur dont 80 % dans le même dossier.
//   - Le choix d'Olivier (source « choix ») n'est jamais écrasé par le relevé.

import { listAllFolders, folderSenders } from './graph'

// Dossiers qui ne sont pas des rangements : arrivée, système, et le dossier « fait » de l'agent.
const NOT_FILING = /^(boîte de réception|inbox|0 - jona et mobi|0 - scan facturation|mail auto-géré|éléments supprimés|deleted items|éléments envoyés|sent items|brouillons|drafts|courrier indésirable|junk email|archive|boîte d'envoi|outbox|historique des conversations|conversation history|notes|journal|flux rss|rss feeds)$/i

export interface UsualFolder { folder: string; mails: number; share: number; source: 'historique' | 'choix'; sure: boolean }

export async function learnSenderFolders(sb: any, mailbox: string, days = 180): Promise<{ folders: number; senders: number }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const folders = (await listAllFolders(mailbox)).filter(f => !NOT_FILING.test(f.name.trim()) && f.path.split('/').filter(Boolean).every(seg => !/^(éléments supprimés|deleted items|courrier indésirable|junk email|archive)$/i.test(seg)))
  const count = new Map<string, Map<string, number>>()   // expéditeur → dossier → nombre
  for (const f of folders) {
    let senders: string[] = []
    try { senders = await folderSenders(mailbox, f.id, since) } catch { continue }
    for (const s of senders) {
      if (!count.has(s)) count.set(s, new Map())
      const m = count.get(s)!
      m.set(f.path.replace(/^\//, ''), (m.get(f.path.replace(/^\//, '')) || 0) + 1)
    }
  }
  const { data: choices } = await sb.from('mail_sender_folders').select('sender').eq('mailbox', mailbox).eq('source', 'choix')
  const locked = new Set((choices || []).map((c: any) => c.sender))
  const rows: any[] = []
  for (const [sender, m] of count) {
    if (locked.has(sender)) continue
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    const [folder, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    rows.push({ mailbox, sender, folder, mails: total, share: Math.round((n / total) * 100) / 100, source: 'historique', updated_at: new Date().toISOString() })
  }
  for (let i = 0; i < rows.length; i += 500) await sb.from('mail_sender_folders').upsert(rows.slice(i, i + 500), { onConflict: 'mailbox,sender' })
  return { folders: folders.length, senders: rows.length }
}

export async function usualFolder(sb: any, mailbox: string, sender?: string | null): Promise<UsualFolder | null> {
  if (!sender) return null
  const { data } = await sb.from('mail_sender_folders').select('folder, mails, share, source').eq('mailbox', mailbox).eq('sender', sender.toLowerCase()).maybeSingle()
  if (!data) return null
  const sure = data.source === 'choix' || (data.mails >= 3 && Number(data.share) >= 0.8)
  return { folder: data.folder, mails: data.mails, share: Number(data.share), source: data.source, sure }
}

/** Le choix d'Olivier sur une carte « Où classer ? » : retenu pour cet expéditeur. */
export async function rememberChoice(sb: any, mailbox: string, sender: string | null | undefined, folder: string): Promise<void> {
  if (!sender) return
  await sb.from('mail_sender_folders').upsert({ mailbox, sender: sender.toLowerCase(), folder, mails: 0, share: 1, source: 'choix', updated_at: new Date().toISOString() }, { onConflict: 'mailbox,sender' })
}

/** Identifiant d'un dossier par son chemin (« Boîte de réception/rgf ») — les noms seuls se répètent. */
const pathCache = new Map<string, { at: number; list: { id: string; path: string }[] }>()
export async function folderIdByPath(mailbox: string, path: string): Promise<string | null> {
  const c = pathCache.get(mailbox)
  const list = c && Date.now() - c.at < 10 * 60_000 ? c.list : (await listAllFolders(mailbox)).map(f => ({ id: f.id, path: f.path.replace(/^\//, '') }))
  pathCache.set(mailbox, { at: Date.now(), list })
  const want = path.replace(/^\//, '').trim().toLowerCase()
  return list.find(f => f.path.toLowerCase() === want)?.id || null
}

/** Dossiers de rangement d'une boîte (pour la liste « Classer dans… »). */
export async function filingFolders(mailbox: string): Promise<string[]> {
  return (await listAllFolders(mailbox)).filter(f => !NOT_FILING.test(f.name.trim())).map(f => f.path.replace(/^\//, '')).sort((a, b) => a.localeCompare(b, 'fr'))
}
