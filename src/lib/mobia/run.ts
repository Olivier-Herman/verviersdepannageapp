// src/lib/mobia/run.ts
//
// Mobia, assistant de Momo (Olivier 03/10/2026). Pour chaque nouveau mail du
// dossier « Claudy » d'info@ : comprendre la demande, chercher les faits
// (trois boîtes de VD, fiches VD Soft), puis préparer UN brouillon de réponse
// dans le fil, expédié depuis info@ et signé « Momo, Verviers Dépannage ».
// Jamais d'envoi. Lecture seule partout ailleurs.
//
// Ensuite : une notification à Momo (jamais de rappel) et un rapport au bureau
// des agents (activité + consommation).
//
// Garde-fous :
//   - un mail = une ligne mobia_mails posée AVANT le traitement : jamais deux
//     brouillons pour le même mail, même si deux passages se chevauchent ;
//   - boîtes limitées à info@, administration@, fourriere@ (verrou du code +
//     politique Microsoft du tenant, vérifiée le 03/10/2026) ;
//   - aucun nom de fournisseur ni de modèle d'IA dans ce qui sort.

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase'
import { getAppOnlyToken, searchAllMailboxes, isAllowedMailbox } from '@/lib/graph-mail-search'
import { createReplyDraft, findFolderIdByName, htmlToText } from '@/lib/mail-agent/graph'
import { sendNotification } from '@/lib/notifications/send'
import { REGLES_COMMUNES, EQUIPE_VD, FICHE, SAVOIR } from './consignes'

const MAILBOX = 'info@verviersdepannage.com'
const GRAPH = 'https://graph.microsoft.com/v1.0'
const MAX_TURNS = 14
const MAX_ATTEMPTS = 3
const MAX_MAILS_PER_RUN = 3
// Même service et même modèle que le bureau des agents ; surchargeable sans redéployer.
const MODEL = process.env.MOBIA_MODEL?.trim() || 'claude-opus-5'
// Tarifs du service d'IA (USD par million de jetons), donnés par le bureau le 03/10/2026.
const PRICE = { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25 }

type Usage = { entree: number; sortie: number; cache_lu: number; cache_ecrit: number }
type Mail = { id: string; key: string; subject: string; fromEmail: string; fromName: string; receivedAt: string }
export type MobiaResult = { key: string; subject: string; status: 'done' | 'error' | 'dry'; summary?: string; draftHtml?: string; error?: string; cost_usd?: number }

// ── Graph (lecture) ──────────────────────────────────────────────────────────

async function graph(path: string): Promise<any> {
  let token = await getAppOnlyToken()
  if (!token) throw new Error('Accès Microsoft non configuré')
  let r = await fetch(`${GRAPH}${path}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 401) { token = await getAppOnlyToken(true); r = await fetch(`${GRAPH}${path}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }) }
  if (!r.ok) throw new Error(`Graph ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function listClaudy(folderName: string): Promise<Mail[]> {
  const fid = await findFolderIdByName(MAILBOX, folderName)
  if (!fid) throw new Error(`Dossier « ${folderName} » introuvable dans info@`)
  const j = await graph(`/users/${encodeURIComponent(MAILBOX)}/mailFolders/${fid}/messages?$top=25&$orderby=receivedDateTime desc&$select=id,internetMessageId,subject,from,receivedDateTime`)
  return (j.value || []).map((m: any) => ({
    id: m.id, key: m.internetMessageId || m.id, subject: m.subject || '(sans objet)',
    fromEmail: m.from?.emailAddress?.address || '', fromName: m.from?.emailAddress?.name || '', receivedAt: m.receivedDateTime,
  }))
}

async function readMessage(mailbox: string, id: string, withFiles: boolean): Promise<{ text: string; files: any[] }> {
  if (!isAllowedMailbox(mailbox)) throw new Error('Boîte non autorisée')
  const base = `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}`
  const m = await graph(`${base}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments`)
  const who = (p: any) => p?.emailAddress ? `${p.emailAddress.name || ''} <${p.emailAddress.address}>` : ''
  const body = m.body?.contentType === 'html' ? htmlToText(m.body.content || '') : (m.body?.content || '')
  const files: any[] = []
  const names: string[] = []
  if (m.hasAttachments) {
    const a = await graph(`${base}/attachments?$select=id,name,contentType,size,isInline`)
    for (const at of a.value || []) {
      if (at.isInline) continue
      names.push(`${at.name} (${at.contentType}, ${Math.round((at.size || 0) / 1024)} Ko)`)
      if (!withFiles || (at.size || 0) > 8_000_000) continue
      const full = await graph(`${base}/attachments/${encodeURIComponent(at.id)}`)
      if (!full.contentBytes) continue
      if (/pdf/i.test(at.contentType || at.name)) files.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: full.contentBytes }, title: at.name })
      else if (/^image\/(png|jpe?g|gif|webp)$/i.test(at.contentType || '')) files.push({ type: 'image', source: { type: 'base64', media_type: at.contentType.toLowerCase().replace('jpg', 'jpeg'), data: full.contentBytes } })
    }
  }
  const text = [
    `Boîte : ${mailbox}`, `De : ${who(m.from)}`, `À : ${(m.toRecipients || []).map(who).join(', ')}`,
    m.ccRecipients?.length ? `Cc : ${m.ccRecipients.map(who).join(', ')}` : '',
    `Reçu : ${m.receivedDateTime}`, `Objet : ${m.subject || ''}`,
    names.length ? `Pièces jointes : ${names.join(' ; ')}` : 'Pièces jointes : aucune', '', body.slice(0, 20_000),
  ].filter(Boolean).join('\n')
  return { text, files }
}

// ── VD Soft (lecture) ────────────────────────────────────────────────────────

const FICHE_FIELDS = 'id, mission_number, external_id, dossier_number, source, mission_type, incident_type, incident_description, status, client_name, assisted_name, billed_to_name, vehicle_plate, vehicle_brand, vehicle_model, incident_address, destination_name, destination_address, received_at, assigned_at, accepted_at, on_way_at, on_site_at, loaded_at, completed_at, cancelled_at, cancelled_reason, parc_zone_key, parc_exit_at, parc_exit_reason, invoiced_at, estimated_htva, contract_label, remarks_general, remarks_billing, closing_notes, no_charge_reason, requisitoire_note, levee_saisie_note, domaine_note, abandon_at, abandon_data, assigned_to'

async function findFiches(q: string): Promise<any[]> {
  const sb = createAdminClient()
  const s = q.trim().replace(/[%,()]/g, '')
  if (s.length < 3) return []
  const plate = s.replace(/[-.\s]/g, '').toUpperCase()
  const ors = [`vehicle_plate.ilike.%${plate}%`, `dossier_number.ilike.%${s}%`, `external_id.ilike.%${s}%`, `client_name.ilike.%${s}%`]
  if (/^\d{6,}$/.test(s)) ors.push(`mission_number.eq.${s}`)
  const { data } = await sb.from('incoming_missions')
    .select('id, mission_number, dossier_number, source, mission_type, status, vehicle_plate, vehicle_brand, vehicle_model, client_name, received_at')
    .or(ors.join(',')).order('received_at', { ascending: false }).limit(15)
  return data || []
}

async function readFiche(id: string): Promise<any> {
  const sb = createAdminClient()
  let { data, error } = await sb.from('incoming_missions').select(`${FICHE_FIELDS}, raw_content, driver_photos`).eq('id', id).maybeSingle()
  if (error) {
    // Une colonne absente ne doit pas tout bloquer : repli sur la fiche complète, filtrée ensuite.
    const r = await sb.from('incoming_missions').select('*').eq('id', id).maybeSingle(); data = r.data
  }
  if (!data) return { erreur: 'fiche introuvable' }
  const keep = new Set([...FICHE_FIELDS.split(',').map(x => x.trim()), 'raw_content'])
  const out: any = {}
  for (const [k, v] of Object.entries(data)) if (keep.has(k) && v !== null && v !== '') out[k] = v
  if (typeof out.raw_content === 'string') out.raw_content = out.raw_content.slice(0, 4000)   // ordre reçu de l'assistance
  out.photos = Array.isArray((data as any).driver_photos) ? (data as any).driver_photos.length : 0
  if ((data as any).assigned_to) {
    const { data: u } = await sb.from('users').select('name').eq('id', (data as any).assigned_to).maybeSingle()
    out.chauffeur = u?.name || null
  }
  delete out.assigned_to
  return out
}

// ── Consignes ────────────────────────────────────────────────────────────────

function systemPrompt(): string {
  const today = new Date().toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  return `Tu es Mobia, l'assistant de Momo chez Verviers Dépannage. Nous sommes le ${today}.

Ta tâche maintenant : un nouveau mail est arrivé dans le dossier « Claudy » de la boîte info@. Comprends la demande, cherche les faits avec tes outils (lecture seule), puis appelle UNE fois l'outil ecrire_brouillon avec la réponse.

Règles de ce traitement :
- Le brouillon est une réponse au mail, en HTML simple (<p>, <ul>, <li>, <b>), dans la langue du correspondant. Il se termine par « Bien cordialement,<br>Momo<br>Verviers Dépannage ». Tu ne te fais jamais passer pour Olivier.
- Le texte est celui d'une personne du bureau : aucune mention d'IA, d'automatisation, de « notre système », du logiciel de facturation, ni d'aucun outil.
- Uniquement des faits trouvés dans le mail, les autres mails ou les fiches. Tout le reste en **[À COMPLÉTER PAR MOMO : …]** en gras.
- Pas de conclusion que les faits ne prouvent pas. Vérifie la chronologie : un élément reçu APRÈS l'intervention (nouvelle action de l'assistance, mail du lendemain) ne dit rien de ce qui s'est passé pendant. Dans le doute, donne le fait brut avec sa date, ou mets-le à compléter.
- Ne nomme pas les membres du personnel (chauffeur, collègues) dans le texte destiné au tiers ; écris « notre dépanneur ». Le nom du chauffeur peut aller dans le résumé pour Momo.
- Si un document doit être rempli ou produit, écris dans le brouillon **[DOCUMENT À JOINDRE PAR MOMO : …]** avec les données à y mettre ; tu ne peux pas encore produire de fichier.
- Argent (remise, remboursement, annulation de frais), faute, avocat, police, fraude possible : brouillon neutre d'accusé de réception et alerte dans le résumé.
- Le résumé pour Momo tient en UNE ligne, sans jargon.

Consignes de ton poste et de ton équipe :

${FICHE}

${SAVOIR}

${EQUIPE_VD}

${REGLES_COMMUNES}`
}

const TOOLS: any[] = [
  { name: 'chercher_mails', description: 'Cherche dans les trois boîtes de VD (info@, administration@, fourriere@) : plaque, nom, numéro de dossier, objet… Renvoie les mails trouvés (boîte, id, objet, expéditeur, date, aperçu).',
    input_schema: { type: 'object', properties: { recherche: { type: 'string' } }, required: ['recherche'] } },
  { name: 'lire_mail', description: 'Lit un mail trouvé par chercher_mails (texte complet et liste des pièces jointes).',
    input_schema: { type: 'object', properties: { boite: { type: 'string', enum: ['info@verviersdepannage.com', 'administration@verviersdepannage.com', 'fourriere@verviersdepannage.be'] }, id: { type: 'string' } }, required: ['boite', 'id'] } },
  { name: 'chercher_fiches', description: 'Cherche des fiches mission dans VD Soft par plaque, numéro de dossier de l’assistance, numéro de mission ou nom du client.',
    input_schema: { type: 'object', properties: { recherche: { type: 'string' } }, required: ['recherche'] } },
  { name: 'lire_fiche', description: 'Lit une fiche mission de VD Soft (heures, adresses, destination, statut, parc, notes, ordre reçu de l’assistance, nombre de photos, chauffeur).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'ecrire_brouillon', description: 'Termine le traitement : crée le brouillon de réponse dans le fil (jamais envoyé) et donne la ligne de résumé pour Momo.',
    input_schema: { type: 'object', properties: { html: { type: 'string' }, resume_pour_momo: { type: 'string' } }, required: ['html', 'resume_pour_momo'] } },
]

async function runTool(name: string, input: any): Promise<string> {
  try {
    if (name === 'chercher_mails') {
      const hits = await searchAllMailboxes(String(input.recherche || ''), 8)
      return JSON.stringify(hits.map(h => ({ boite: h.category === 'email_info' ? 'info@verviersdepannage.com' : h.category === 'email_fourriere' ? 'fourriere@verviersdepannage.be' : 'administration@verviersdepannage.com', id: h.id, objet: h.subject, de: h.from, date: h.receivedAt, apercu: h.bodyPreview })))
    }
    if (name === 'lire_mail') return (await readMessage(String(input.boite), String(input.id), false)).text
    if (name === 'chercher_fiches') return JSON.stringify(await findFiches(String(input.recherche || '')))
    if (name === 'lire_fiche') return JSON.stringify(await readFiche(String(input.id)))
    return 'Outil inconnu'
  } catch (e: any) { return `Erreur : ${e?.message || e}` }
}

// ── Boucle d'agent ───────────────────────────────────────────────────────────

async function draftFor(mail: Mail): Promise<{ html: string; summary: string; usage: Usage }> {
  const client = new Anthropic()
  const usage: Usage = { entree: 0, sortie: 0, cache_lu: 0, cache_ecrit: 0 }
  const { text, files } = await readMessage(MAILBOX, mail.id, true)
  const messages: any[] = [{ role: 'user', content: [
    { type: 'text', text: `Nouveau mail dans le dossier Claudy :\n\n${text}` },
    ...files,
  ] }]
  const system = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }]
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res: any = await client.messages.create({ model: MODEL, max_tokens: 4000, system: system as any, tools: TOOLS, messages })
    usage.entree += res.usage?.input_tokens || 0
    usage.sortie += res.usage?.output_tokens || 0
    usage.cache_lu += res.usage?.cache_read_input_tokens || 0
    usage.cache_ecrit += res.usage?.cache_creation_input_tokens || 0
    messages.push({ role: 'assistant', content: res.content })
    const calls = (res.content || []).filter((b: any) => b.type === 'tool_use')
    const final = calls.find((c: any) => c.name === 'ecrire_brouillon')
    if (final) {
      let html = String(final.input?.html || '').trim()
      if (!html) throw new Error('Brouillon vide')
      if (!/Momo/.test(html.slice(-300))) html += '<p>Bien cordialement,<br>Momo<br>Verviers Dépannage</p>'
      return { html, summary: String(final.input?.resume_pour_momo || mail.subject).replace(/\s+/g, ' ').slice(0, 260), usage }
    }
    if (!calls.length) {
      messages.push({ role: 'user', content: 'Termine en appelant ecrire_brouillon.' })
      continue
    }
    const results = []
    for (const c of calls) results.push({ type: 'tool_result', tool_use_id: c.id, content: (await runTool(c.name, c.input)).slice(0, 30_000) })
    messages.push({ role: 'user', content: results })
  }
  throw new Error('Pas de brouillon après le nombre maximal d’étapes')
}

const cost = (u: Usage) => Math.round(((u.entree * PRICE.input + u.sortie * PRICE.output + u.cache_lu * PRICE.cacheRead + u.cache_ecrit * PRICE.cacheWrite5m) / 1e6) * 10000) / 10000

async function report(subject: string, u: Usage | null, ok: boolean) {
  const url = process.env.MOBIOUEB_ADRESSE, secret = process.env.MOBIOUEB_EXTERNE_SECRET
  if (!url || !secret) return
  try {
    await fetch(`${url.replace(/\/$/, '')}/api/externe/activite`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'mobia', action: ok ? `Brouillon prêt pour Claudy : ${subject}` : `Échec du brouillon pour Claudy : ${subject}`,
        conso: u ? { modele: MODEL, entree: u.entree, sortie: u.sortie, cache_lu: u.cache_lu, cache_ecrit: u.cache_ecrit, cout_usd: cost(u) } : undefined }),
    })
  } catch (e: any) { console.warn('[mobia] rapport bureau KO:', e?.message) }
}

async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await createAdminClient().from('app_settings').select('value').eq('key', key).maybeSingle()
  if (!data?.value) return fallback
  try { return JSON.parse(String(data.value)) as T } catch { return fallback }
}

/** Heure de Bruxelles (0-23). */
export function brusselsHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(d)) % 24
}

/**
 * Un passage : traite les nouveaux mails du dossier (au plus MAX_MAILS_PER_RUN).
 * `dryKey` : essai sur un mail donné (même déjà traité), sans brouillon ni
 * notification ni écriture — pour valider avant la bascule.
 */
export async function runMobia(opts: { dryKey?: string } = {}): Promise<{ checked: number; results: MobiaResult[] }> {
  const sb = createAdminClient()
  const folder = await setting<string>('mobia_dossier', 'Claudy')
  const mails = await listClaudy(folder)

  if (opts.dryKey) {
    const m = mails.find(x => x.key === opts.dryKey || x.id === opts.dryKey || x.id.endsWith(opts.dryKey!))
    if (!m) return { checked: mails.length, results: [{ key: opts.dryKey, subject: '', status: 'error', error: 'mail introuvable dans le dossier' }] }
    const d = await draftFor(m)
    return { checked: mails.length, results: [{ key: m.key, subject: m.subject, status: 'dry', summary: d.summary, draftHtml: d.html, cost_usd: cost(d.usage) }] }
  }

  const { data: known } = await sb.from('mobia_mails').select('key, status, attempts, updated_at').in('key', mails.map(m => m.key))
  const byKey = new Map((known || []).map((k: any) => [k.key, k]))
  // Un passage coupé net (délai dépassé) laisse 'processing' : repris après 15 min.
  const stale = (k: any) => k.status === 'processing' && Date.now() - new Date(k.updated_at).getTime() > 15 * 60_000
  const todo = mails
    .filter(m => { const k: any = byKey.get(m.key); return !k || ((k.status === 'error' || stale(k)) && k.attempts < MAX_ATTEMPTS) })
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(0, MAX_MAILS_PER_RUN)

  const results: MobiaResult[] = []
  for (const m of todo) {
    // Réservation : seul le passage qui pose (ou reprend) la ligne traite le mail.
    const prev: any = byKey.get(m.key)
    let claimed = false
    if (!prev) {
      const { error } = await sb.from('mobia_mails').insert({ key: m.key, message_id: m.id, subject: m.subject, from_email: m.fromEmail, received_at: m.receivedAt, status: 'processing', attempts: 1 })
      claimed = !error
    } else {
      const { data } = await sb.from('mobia_mails').update({ status: 'processing', attempts: prev.attempts + 1, message_id: m.id, updated_at: new Date().toISOString() })
        .eq('key', m.key).eq('status', prev.status).eq('attempts', prev.attempts).select('key')
      claimed = !!data?.length
    }
    if (!claimed) continue

    let usage: Usage | null = null
    try {
      const d = await draftFor(m)
      usage = d.usage
      const r = await createReplyDraft(MAILBOX, m.id, d.html, { fromMailbox: MAILBOX })
      if (!r.ok) throw new Error(`Brouillon refusé : ${r.error || 'erreur inconnue'}`)
      await sb.from('mobia_mails').update({ status: 'done', draft_id: r.id || null, summary: d.summary, usage: d.usage, cost_usd: cost(d.usage), error: null, updated_at: new Date().toISOString() }).eq('key', m.key)
      const ids = await setting<string[]>('mobia_notify_user_ids', [])
      for (const uid of ids) {
        await sendNotification(uid, 'mobia_draft', {
          title: `Brouillon prêt : réponse à ${folder} — ${m.subject}`.slice(0, 140),
          body: d.summary,
          data: { mailbox: MAILBOX, draft_id: r.id || null },
        }).catch(() => null)
      }
      await report(m.subject, d.usage, true)
      results.push({ key: m.key, subject: m.subject, status: 'done', summary: d.summary, cost_usd: cost(d.usage) })
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 500)
      console.error('[mobia]', m.subject, msg)
      await sb.from('mobia_mails').update({ status: 'error', error: msg, usage, cost_usd: usage ? cost(usage) : null, updated_at: new Date().toISOString() }).eq('key', m.key)
      await report(m.subject, usage, false)
      // Dernier essai raté : ça doit se voir à l'écran, une seule fois.
      if ((prev?.attempts || 0) + 1 >= MAX_ATTEMPTS) {
        const ids = await setting<string[]>('mobia_notify_user_ids', [])
        for (const uid of ids) await sendNotification(uid, 'mobia_draft', { title: `Pas de brouillon : ${folder} — ${m.subject}`.slice(0, 140), body: 'Mobia n’a pas pu préparer la réponse à ce mail : à traiter à la main.' }).catch(() => null)
      }
      results.push({ key: m.key, subject: m.subject, status: 'error', error: msg })
    }
  }
  return { checked: mails.length, results }
}
