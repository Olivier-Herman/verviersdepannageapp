// src/lib/mail-agent/routing.ts
//
// AIGUILLAGE DES MAILS VERS LES MODULES (Olivier 08/10/2026) : « il doit dispatcher dans les bons
// modules » ; « il doit créer [une carte] uniquement pour ce qui est traitable par l'agent mail ».
//
// 1. Le CATALOGUE dit quel module prend quoi. Les règles (expéditeur, domaine, objet) tranchent
//    l'essentiel sans IA.
// 2. Après le tri, une carte n'est créée que si l'agent mail peut vraiment agir : un geste dont il a
//    les éléments (une facture ou une fiche reconnue pour un avoir, un document, un « déjà payé »…).
// 3. Sinon, l'IA reçoit le catalogue et choisit le module, ou « aucun ». Aucun = pas de carte : le
//    mail reste dans la boîte et sort dans le résumé du matin (« non pris en charge »).
// Le passage de main est tracé sur l'élément (« → Réconciliation : … ») pour vérifier l'aiguillage.

import { getBusinessText } from '@/lib/settings/business'
import { createWithModelFallback, ANTHROPIC_MODELS } from '@/lib/anthropic-model'
import { aiClient } from '@/lib/ai/usage'
import { getAppOnlyToken } from '@/lib/graph-mail-search'
import type { AgentMessage } from './graph'
import type { TriageResult } from './triage'

export type ModuleKey = 'agent_mail' | 'reconciliation' | 'victor' | 'missions' | 'saisies' | 'domaine' | 'achats' | 'pieces' | 'scrada' | 'aucun'

/** Catalogue des modules qui reçoivent du courrier. `description` sert aussi à l'IA. */
export const MODULES: Record<Exclude<ModuleKey, 'aucun'>, { label: string; description: string; url: string }> = {
  agent_mail:     { label: 'Agent mail', description: 'demande d’avoir, de document ou de duplicata, rappel de paiement, réclamation ou contestation qui porte sur une de NOS factures ou fiches reconnues ; double paiement à rembourser', url: '/mail-agent' },
  reconciliation: { label: 'Réconciliation', description: 'avis de paiement, détail d’un virement reçu, liste des factures réglées par un paiement (assurances, assistances)', url: '/facturation/paiements' },
  victor:         { label: 'Victor (cabinet comptable)', description: 'tout mail du cabinet comptable (THG) : listings annotés, questions comptables, pièces manquantes', url: '/admin/agents' },
  missions:       { label: 'Réception des missions', description: 'ordre de mission d’une assistance, proposition, annulation ou suivi d’une intervention', url: '/dispatch' },
  saisies:        { label: 'Saisies et fourrière', description: 'réquisitoire, levée de saisie, police, Parquet, état de frais de justice', url: '/saisies' },
  domaine:        { label: 'Domaine (SPF Finances)', description: 'Dates IN, vente d’épaves, Domaine', url: '/domaine' },
  achats:         { label: 'Encodage des achats', description: 'facture d’un fournisseur à encoder', url: '/mail-agent' },
  pieces:         { label: 'Pièces réclamées', description: 'réponse d’un fournisseur à une pièce ou un duplicata que nous avons demandé', url: '/mail-agent' },
  scrada:         { label: 'Encaissements Scrada', description: 'relevé CODA ou livre de caisse Scrada', url: '/especes' },
}

/** Modules qui savent RECEVOIR un mail remis par l'agent mail (catalogue extensible). */
const RECEIVING = new Set<ModuleKey>(['reconciliation'])

export interface Route { module: ModuleKey; label: string; why: string }
const route = (module: ModuleKey, why: string): Route => ({ module, label: module === 'aucun' ? 'Aucun module' : MODULES[module].label, why })

const ADVICE_SUBJECT = /avis de paiement|payment advice|d[ée]tail de (votre|notre) paiement|betalingsadvies|remittance|zahlungsavis|paiement du \d{2}\/\d{2}\/\d{4}/i
const domainOf = (a: string) => String(a || '').toLowerCase().split('@')[1] || ''

/** Règles du catalogue : sans IA, avant le tri. null = pas de règle, le tri continue. */
export async function routeByRules(msg: AgentMessage): Promise<Route | null> {
  const from = String(msg.fromEmail || '').toLowerCase()
  const comptable = (await getBusinessText('agents_domaine_comptable').catch(() => '')).toLowerCase().replace(/^@/, '')
  if (comptable && domainOf(from) === comptable) return route('victor', `mail du cabinet comptable (@${comptable})`)
  const adviceSenders = (await Promise.all(['mail_ima_avis_paiement', 'mail_awp_avis_paiement', 'mail_aps_avis_paiement'].map(k => getBusinessText(k).catch(() => ''))))
    .map(s => s.toLowerCase()).filter(Boolean)
  if (adviceSenders.includes(from)) return route('reconciliation', 'expéditeur des avis de paiement')
  if (ADVICE_SUBJECT.test(msg.subject || '')) return route('reconciliation', 'objet : avis ou détail de paiement')
  const scrada = (await getBusinessText('mail_scrada_coda').catch(() => '')).toLowerCase()
  if (scrada && from === scrada) return route('scrada', 'relevé Scrada')
  return null
}

/** L'agent mail peut-il agir sur ce mail trié ? (un geste dont il a les éléments) */
export function treatableByMailAgent(t: TriageResult): boolean {
  const invoices = (t.facts?.invoices || []).filter((i: any) => !i.missing).length
  const fiches = (t.facts?.fiches || []).length
  switch (t.family) {
    case 'demande_avoir': case 'demande_document': case 'rappel_paiement': case 'contestation': return invoices > 0
    case 'reclamation': return invoices > 0 || fiches > 0
    case 'double_paiement': return invoices > 0 || t.amount != null
    case 'info': return true            // le classement appris s'en charge
    default: return false               // question_compta, autre : pas de geste à lui
  }
}

/** Pas de règle et pas traitable par l'agent mail : l'IA choisit dans le catalogue. */
export async function routeByAI(msg: AgentMessage, t: TriageResult): Promise<Route> {
  const catalogue = Object.entries(MODULES).filter(([k]) => k !== 'agent_mail').map(([k, m]) => `- ${k} : ${m.description}`).join('\n')
  try {
    const client = aiClient('mail-agent/routing', { apiKey: process.env.ANTHROPIC_API_KEY! })
    const r = await createWithModelFallback(client, ANTHROPIC_MODELS, { max_tokens: 200, messages: [{ role: 'user', content:
`Un mail reçu par une société de dépannage doit être confié au bon module. Modules :
${catalogue}
- aucun : aucun module ne traite ce mail.
Mail : de ${msg.fromEmail} · objet « ${msg.subject} » · résumé : ${t.summary} · attendu : ${t.asked || '—'}
Réponds UNIQUEMENT en JSON : {"module":"<clé>","why":"<raison en quelques mots>"}` }] })
    const text = (r.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    const key = String(j.module || 'aucun') as ModuleKey
    const why = String(j.why || '').slice(0, 120) || 'choix de l’IA'
    // Remise seulement à un module qui REÇOIT vraiment le mail (sinon il serait perdu) :
    // aujourd'hui la réconciliation (avis déposé). Les autres choix restent une suggestion.
    if (RECEIVING.has(key)) return route(key, why)
    if (key !== 'aucun' && key !== 'agent_mail' && MODULES[key as keyof typeof MODULES]) return route('aucun', `suggéré : ${MODULES[key as keyof typeof MODULES].label} — ${why}`)
  } catch { /* pas d'aiguillage = aucun module */ }
  return route('aucun', 'aucun module ne le traite')
}

// ── Passage de main ──────────────────────────────────────────────────────────

/**
 * Remet le mail au module. Renvoie la note tracée sur l'élément. Réconciliation : l'avis est lu
 * (texte, PDF ou captures d'écran) et déposé dans les avis de paiement, où le rapprochement le prend.
 */
export async function handOff(sb: any, mailbox: string, msg: AgentMessage, r: Route): Promise<string> {
  if (r.module === 'reconciliation') {
    const { data: known } = await sb.from('payment_advices').select('id').eq('mail_id', msg.id).maybeSingle()
    if (known) return 'avis déjà dans la réconciliation'
    // Les avis des expéditeurs habituels sont lus par la réconciliation elle-même (PDF / CSV).
    const adviceSenders = (await Promise.all(['mail_ima_avis_paiement', 'mail_awp_avis_paiement', 'mail_aps_avis_paiement'].map(k => getBusinessText(k).catch(() => '')))).map(s => s.toLowerCase())
    if (adviceSenders.includes(String(msg.fromEmail || '').toLowerCase())) return 'lu par la réconciliation à son prochain passage'
    const a = await readAdviceAnyFormat(mailbox, msg)
    if (!a) return 'aucun détail de paiement lisible : à rapprocher à la main'
    const { error } = await sb.from('payment_advices').upsert({
      provider: a.provider, mail_id: msg.id, internet_message_id: (msg as any).internetMessageId ?? null, subject: msg.subject, received_at: msg.receivedAt,
      advice_date: a.adviceDate, reference: a.reference, total: a.total, lines: a.lines, checksum: a.checksum, warnings: a.warnings,
      parse_error: a.lines.length ? null : 'Aucune ligne extraite', fetched_at: new Date().toISOString(),
    }, { onConflict: 'mail_id' })
    if (error) return `avis lu mais non déposé (${error.message})`
    return `avis déposé : ${a.lines.length} facture(s), ${a.total.toFixed(2)} €${a.checksum.ok ? '' : ' (le total ne boucle pas : rapprochement à la main)'}`
  }
  if (r.module === 'victor') return 'Victor le lit dans la boîte et répond au cabinet'
  if (r.module === 'aucun') return 'non pris en charge : reste dans la boîte, signalé dans le résumé du matin'
  return `pris en charge par ${r.label}`
}

/** Détail de paiement lu par l'IA dans le corps, un PDF ou des captures d'écran (ex. Allianz, SAP). */
async function readAdviceAnyFormat(mailbox: string, msg: AgentMessage) {
  const token = await getAppOnlyToken(); if (!token) return null
  const H = { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' }
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(msg.id)}`
  const m = await (await fetch(`${base}?$select=body`, { headers: H, cache: 'no-store' })).json().catch(() => ({}))
  const atts = (await (await fetch(`${base}/attachments`, { headers: H, cache: 'no-store' })).json().catch(() => ({}))).value || []
  const content: any[] = []
  for (const a of atts.slice(0, 6)) {
    if (!a.contentBytes || a.size < 4000) continue                 // logos de signature
    if (/^image\/(png|jpe?g|gif|webp)$/.test(a.contentType)) content.push({ type: 'image', source: { type: 'base64', media_type: a.contentType === 'image/jpg' ? 'image/jpeg' : a.contentType, data: a.contentBytes } })
    else if (a.contentType === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.contentBytes } })
  }
  content.push({ type: 'text', text:
`Corps du mail (objet « ${msg.subject} ») :
${String(m.body?.content || '').slice(0, 6000)}

Extrais le détail du paiement reçu par Verviers Dépannage (factures réglées par ce virement). Lignes = nos factures payées : montant POSITIF pour une facture, NÉGATIF pour une note de crédit ou une retenue ; n'inclus pas la ligne du paiement lui-même. Une ligne par facture, même si plusieurs factures ont le même montant : n'en fusionne ni n'en saute aucune. Réponds UNIQUEMENT en JSON :
{"payer":"<allianz|ima|autre>","adviceDate":"<AAAA-MM-JJ du virement ou null>","reference":"<référence du paiement ou null>","total":<montant du virement>,"lines":[{"invoiceRef":"<n° tel qu'écrit>","amount":<nombre>,"theirRef":"<leur référence ou null>","invoiceDate":"<AAAA-MM-JJ ou null>"}]}` })
  try {
    const client = aiClient('mail-agent/routing-advice', { apiKey: process.env.ANTHROPIC_API_KEY! })
    const ask = async (extra?: string) => {
      const msgs: any[] = [{ role: 'user', content }]
      if (extra) msgs.push({ role: 'assistant', content: extra }, { role: 'user', content: 'Le total des lignes ne correspond pas au montant du virement. Relis CHAQUE ligne des captures, une par une, sans en sauter (attention aux lignes en bas d’image), et renvoie le JSON complet corrigé.' })
      const r = await createWithModelFallback(client, ANTHROPIC_MODELS, { max_tokens: 4000, messages: msgs })
      const text = (r.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      const lines = (Array.isArray(j.lines) ? j.lines : []).map((l: any) => ({ invoiceRef: String(l.invoiceRef || '').trim(), amount: Math.round(Number(l.amount) * 100) / 100, theirRef: l.theirRef ? String(l.theirRef) : null, invoiceDate: l.invoiceDate || null }))
        .filter((l: any) => l.invoiceRef && Number.isFinite(l.amount))
      const total = Math.round(Number(j.total || 0) * 100) / 100
      const linesSum = Math.round(lines.reduce((s: number, l: any) => s + l.amount, 0) * 100) / 100
      return { j, text, lines, total, linesSum, delta: Math.round((total - linesSum) * 100) / 100 }
    }
    // Garde-fou de la réconciliation : la somme des lignes doit égaler le virement. Une relecture si ça ne boucle pas.
    let x = await ask()
    if (Math.abs(x.delta) >= 0.01) { const y = await ask(x.text).catch(() => null); if (y && Math.abs(y.delta) < Math.abs(x.delta)) x = y }
    const { j, lines, total, linesSum, delta } = x
    return {
      provider: (j.payer === 'ima' ? 'ima' : 'awp') as 'ima' | 'awp', adviceDate: j.adviceDate || null, reference: j.reference || null, total, lines,
      checksum: { linesSum, delta, ok: Math.abs(delta) < 0.01 },
      warnings: [`Lu par l’agent mail (${String(j.payer || 'autre')}, détail envoyé en ${content.length > 1 ? 'capture ou PDF' : 'texte'})`],
    }
  } catch { return null }
}
