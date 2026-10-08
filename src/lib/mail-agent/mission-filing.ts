// src/lib/mail-agent/mission-filing.ts
//
// Rangement des mails d'une mission d'assistance acceptée (Olivier 08/10/2026 : « tu transfères
// juste les mails liés à la mission acceptée »). Quand une mission d'assistance est prise en
// charge dans VD Soft, les mails de la boîte de réception d'info@ qui portent SON numéro de
// dossier vont dans le dossier habituel de l'assistance (IMA MISSION, TOURING MISSION, VAB
// MISSION, IPA MISSION, MONDIAL Automatic Dispatch, ANWB MISSION, eurocross…). Rien d'autre
// n'est touché : pas de mail sans numéro de dossier, jamais un dossier de litige ou de paiement,
// et seulement vers un dossier que l'expéditeur utilise déjà (appris chaque nuit).

import { getAppOnlyToken } from '@/lib/graph-mail-search'
import { usualFolder, folderIdByPath } from './learned'
import { moveMessage } from './graph'

const G = 'https://graph.microsoft.com/v1.0'
const BOX = 'info@verviersdepannage.com'
/** Une mission acceptée = prise en charge (ni en attente, ni annulée, ni écartée). */
const NOT_ACCEPTED = ['new', 'dispatching', 'pending', 'cancelled', 'parse_error', 'ignored']
const ASSISTANCE_SOURCES = ['touring', 'vab', 'axa', 'mondial', 'allianz', 'kaze', 'ima', 'ethias', 'pv', 'vivium', 'baloise', 'anwb', 'eurocross', 'acl', 'adac', 'sia_couvert']
const MISSION_FOLDER = /mission|mondial|eurocross|clients divers/i
const NEVER = /payement|paiement|litige|factur/i

export async function fileAcceptedMissionMails(sb: any, opts: { dryRun?: boolean; days?: number; limit?: number } = {}): Promise<{ missions: number; moved: string[]; skipped: string[] }> {
  const out = { missions: 0, moved: [] as string[], skipped: [] as string[] }
  const tok = await getAppOnlyToken()
  if (!tok) return out
  const since = new Date(Date.now() - (opts.days ?? 14) * 86_400_000).toISOString()
  const { data: missions } = await sb.from('incoming_missions').select('mission_number, dossier_number, source, status')
    .gte('updated_at', since).not('dossier_number', 'is', null).in('source', ASSISTANCE_SOURCES)
    .not('status', 'in', `(${NOT_ACCEPTED.join(',')})`).order('updated_at', { ascending: false }).limit(opts.limit ?? 60)
  for (const m of missions || []) {
    const ref = String(m.dossier_number || '').trim()
    if (ref.length < 6) continue
    out.missions++
    const r = await fetch(`${G}/users/${encodeURIComponent(BOX)}/mailFolders/inbox/messages?$search=${encodeURIComponent(`"${ref}"`)}&$select=id,subject,from,bodyPreview&$top=25`, { headers: { Authorization: `Bearer ${tok}`, ConsistencyLevel: 'eventual' }, cache: 'no-store' })
    if (!r.ok) continue
    for (const msg of (await r.json()).value || []) {
      // Le numéro doit vraiment figurer dans l'objet ou le début du mail (la recherche plein texte est large).
      if (!`${msg.subject || ''} ${msg.bodyPreview || ''}`.includes(ref)) continue
      const sender = String(msg.from?.emailAddress?.address || '').toLowerCase()
      const usual = await usualFolder(sb, BOX, sender)
      const label = `n° ${m.mission_number} ${ref} · ${sender} · ${String(msg.subject || '').slice(0, 60)}`
      if (!usual?.sure || !MISSION_FOLDER.test(usual.folder) || NEVER.test(usual.folder)) { out.skipped.push(`${label} (dossier habituel : ${usual?.folder || 'aucun'})`); continue }
      if (opts.dryRun) { out.moved.push(`${label} → ${usual.folder}`); continue }
      const fid = await folderIdByPath(BOX, usual.folder)
      if (!fid) { out.skipped.push(`${label} (dossier « ${usual.folder} » introuvable)`); continue }
      const mv = await moveMessage(BOX, msg.id, fid)
      if (mv.ok) out.moved.push(`${label} → ${usual.folder}`)
      else out.skipped.push(`${label} (${mv.error})`)
    }
  }
  return out
}
