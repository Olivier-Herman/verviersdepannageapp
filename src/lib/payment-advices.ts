// ============================================================
// VERVIERS DÉPANNAGE — Avis de paiement des assureurs (IMA, Mondial)
// ============================================================
//
// Les assureurs paient plusieurs factures en un virement et envoient le
// détail par mail. Ce module lit ces mails et rend un avis normalisé, que le
// moteur de réconciliation rapproche ensuite de la ligne bancaire.
//
// Différence avec Paynovate : ici l'argent n'a PAS encore été encaissé. La
// facture client est ouverte, l'assureur la paie. Le rapprochement lettre donc
// la ligne bancaire directement contre les factures — pas de compte d'attente,
// pas d'OD, pas de commission.
//
// Deux sources, deux traitements :
//
//   IMA    dfc@imabenelux.com · « IMA BENELUX - … - Avis de paiements »
//          → pièce jointe « Payment Items.CSV », UTF-16 tabulé. Donnée
//            structurée, lecture déterministe, aucun modèle en jeu.
//
//   AWP    accountancy.be@allianz.com · « Payment Advice Note from … »
//          → PDF avec couche texte, un par « Tiers » (BEVO…). Extraction via
//            Claude, comme les tarifs assistance (cf. anthropic-pdf.ts).
//
// GARDE-FOU COMMUN : la somme des lignes doit égaler le total annoncé. Un avis
// qui ne boucle pas est rendu avec `checksum.ok = false` et ne sera jamais
// rapproché automatiquement — ce contrôle est ce qui rend l'extraction par
// modèle acceptable ici : une erreur de lecture ne peut pas passer en silence.

import Anthropic            from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL }  from '@/lib/anthropic-model'
import { getAppOnlyToken }  from '@/lib/graph-mail-search'

export type AdviceProvider = 'ima' | 'awp'

export interface AdviceLine {
  invoiceRef: string          // n° de facture Odoo tel qu'annoncé
  amount:     number          // négatif = déduction (avoir, retenue)
  theirRef:   string | null   // référence interne de l'assureur
  invoiceDate: string | null  // ISO
}

/** La pièce jointe d'origine — gardée jusqu'au rapprochement, puis libérée. */
export interface AdviceDoc {
  name:  string
  mime:  string
  bytes: number
  b64:   string
}

export interface PaymentAdvice {
  provider:    AdviceProvider
  mailId:      string
  /**
   * Message-ID RFC822 — l'identité stable du mail. `mailId` (l'id Graph) encode
   * le dossier : déplacer un message lui en donne un nouveau, et l'avis passait
   * alors pour un nouveau. Celui-ci ne bouge jamais.
   */
  internetMessageId?: string | null
  subject:     string
  receivedAt:  string         // ISO
  adviceDate:  string | null  // date de virement annoncée
  reference:   string | null  // « BEVO831108 », n° d'avis…
  total:       number         // total annoncé par l'assureur
  lines:       AdviceLine[]
  /** La somme des lignes doit égaler le total. Sinon : pas de rapprochement auto. */
  checksum:    { linesSum: number; delta: number; ok: boolean }
  warnings:    string[]
  /** Présent à la lecture du mail, absent quand l'avis vient du cache. */
  doc?:        AdviceDoc | null
}

const MAILBOX = 'info@verviersdepannage.com'
const GRAPH   = 'https://graph.microsoft.com/v1.0'

const r2 = (n: number) => Math.round(n * 100) / 100

// ── Accès Graph ─────────────────────────────────────────────
// Note : on n'utilise pas fetchMailFull() de graph-mail-search — il annonce
// zéro pièce jointe alors que les mails IMA en portent deux.

/**
 * Graph rejette-t-il le JETON (et non la requête) ? Dans ce cas on peut
 * réessayer avec un jeton frais ; toute autre erreur doit remonter.
 *
 * POURQUOI : le 2026-08-31 on a découvert que ce cron échouait depuis le 24/08
 * sur « InvalidAuthenticationToken : the token is expired » — sans aucune
 * reprise, l'erreur faisait tomber TOUTE la lecture des avis, tous les jours,
 * en silence. Le module « réquisitoire » avait déjà reçu ce correctif ; il
 * n'avait jamais été reporté ici.
 */
function isTokenFailure(res: Response, body: any): boolean {
  return res.status === 401 || body?.error?.code === 'InvalidAuthenticationToken'
}

async function graph<T = any>(path: string, token: string): Promise<T> {
  const doFetch = (t: string) => fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${t}`, ConsistencyLevel: 'eventual' },
    cache: 'no-store',
  })
  let res  = await doFetch(token)
  let body = await res.json()
  if (isTokenFailure(res, body)) {
    const fresh = await getAppOnlyToken(true)   // force un jeton neuf
    if (fresh) { res = await doFetch(fresh); body = await res.json() }
  }
  if (body?.error) throw new Error(`Graph ${body.error.code} : ${body.error.message}`)
  return body as T
}

interface MailRef { id: string; subject: string; receivedDateTime: string; internetMessageId?: string }

/** Les mails d'un expéditeur, les plus récents d'abord. */
async function mailsFrom(sender: string, token: string, top = 12): Promise<MailRef[]> {
  const q = encodeURIComponent(`"from:${sender}"`)
  const j = await graph<{ value: MailRef[] }>(
    `/users/${MAILBOX}/messages?$search=${q}&$select=id,subject,receivedDateTime,internetMessageId&$top=${top}`,
    token,
  )
  return (j.value || []).sort((a, b) => b.receivedDateTime.localeCompare(a.receivedDateTime))
}

interface AttachmentRef { id: string; name: string; contentType: string; size: number }

async function attachmentsOf(messageId: string, token: string): Promise<AttachmentRef[]> {
  const j = await graph<{ value: AttachmentRef[] }>(
    `/users/${MAILBOX}/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
    token,
  )
  return j.value || []
}

async function attachmentBytes(messageId: string, attachmentId: string, token: string): Promise<Buffer> {
  const url = `${GRAPH}/users/${MAILBOX}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`
  const doFetch = (t: string) => fetch(url, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' })
  let res = await doFetch(token)
  if (res.status === 401) {
    const fresh = await getAppOnlyToken(true)
    if (fresh) res = await doFetch(fresh)
  }
  if (!res.ok) throw new Error(`Pièce jointe illisible (HTTP ${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

// ── IMA : le CSV ────────────────────────────────────────────

/** « 13.07.2026 » ou « 13/07/2026 » → ISO. */
function frDateToIso(v: string): string | null {
  const m = String(v || '').trim().match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** « 1 234,56 » / « 1,234.56 » / « -106,48 » → nombre. */
function euToNumber(v: string): number {
  let s = String(v || '').trim().replace(/\s/g, '')
  if (!s) return 0
  // Séparateur décimal = le dernier signe rencontré ; l'autre est un millier.
  const lastComma = s.lastIndexOf(',')
  const lastDot   = s.lastIndexOf('.')
  if (lastComma > lastDot)      s = s.replace(/\./g, '').replace(',', '.')
  else if (lastDot > lastComma) s = s.replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Le CSV IMA est en UTF-16 avec des retours chariot seuls et des tabulations.
 * Colonnes : Code Société · Nom société · N° Dossier · N° Mandatement ·
 * N° Facture · Date facture · Montant · Devise · … · Compte · Libellé
 */
function parseImaCsv(bytes: Buffer): { lines: AdviceLine[]; warnings: string[] } {
  const warnings: string[] = []

  // UTF-16 si un octet nul apparaît tôt (le BOM est retiré par toString).
  const looksUtf16 = bytes.length > 4 && (bytes[1] === 0 || bytes[0] === 0xFF || bytes[0] === 0xFE)
  const text = looksUtf16 ? bytes.toString('utf16le').replace(/^﻿/, '') : bytes.toString('utf8')

  const rows = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(r => r.trim())
  if (rows.length < 2) return { lines: [], warnings: ['CSV IMA vide'] }

  const head = rows[0].split('\t').map(h => h.trim())
  const col = (needle: string) => head.findIndex(h => h.toLowerCase().includes(needle))
  const iInv  = col('facture')            // « N° Facture »
  const iDate = head.findIndex(h => /date\s*facture/i.test(h))
  const iAmt  = head.findIndex(h => /montant/i.test(h))
  const iRef  = head.findIndex(h => /libell/i.test(h))
  const iDoss = head.findIndex(h => /dossier/i.test(h))

  if (iInv < 0 || iAmt < 0) {
    return { lines: [], warnings: [`Colonnes IMA inattendues : ${head.join(' | ').slice(0, 160)}`] }
  }

  const lines: AdviceLine[] = []
  for (const row of rows.slice(1)) {
    const c = row.split('\t').map(x => x.trim())
    const invoiceRef = c[iInv] || ''
    if (!invoiceRef) { warnings.push('Ligne IMA sans numéro de facture, ignorée'); continue }
    lines.push({
      invoiceRef,
      amount:      r2(euToNumber(c[iAmt])),
      theirRef:    (iRef >= 0 ? c[iRef] : '') || (iDoss >= 0 ? c[iDoss] : '') || null,
      invoiceDate: iDate >= 0 ? frDateToIso(c[iDate]) : null,
    })
  }
  return { lines, warnings }
}

/** Un avis IMA : le CSV joint suffit, aucun modèle en jeu. */
async function readImaAdvice(mail: MailRef, token: string): Promise<PaymentAdvice> {
  const atts = await attachmentsOf(mail.id, token)
  const csv  = atts.find(a => /\.csv$/i.test(a.name))
  if (!csv) return emptyAdvice('ima', mail, ['Aucun CSV joint à cet avis'])

  const bytes = await attachmentBytes(mail.id, csv.id, token)
  const { lines, warnings } = parseImaCsv(bytes)
  // IMA n'annonce pas de total dans le CSV : le total EST la somme des lignes.
  // Le contrôle se fait alors contre la ligne bancaire, pas contre le fichier.
  const sum = r2(lines.reduce((s, l) => s + l.amount, 0))
  return {
    provider: 'ima',
    mailId: mail.id, subject: mail.subject, receivedAt: mail.receivedDateTime,
    adviceDate: mail.receivedDateTime.slice(0, 10),
    reference: mail.subject.match(/-\s*(\w+)\s*-/)?.[1] ?? null,
    total: sum,
    lines,
    checksum: { linesSum: sum, delta: 0, ok: lines.length > 0 },
    warnings,
    doc: { name: csv.name, mime: csv.contentType || 'text/csv', bytes: bytes.length, b64: bytes.toString('base64') },
  }
}

// ── AWP / Mondial : le PDF ──────────────────────────────────

const AWP_PROMPT = `Ce PDF est un avis de virement d'AWP P&C (Allianz Partners) vers Verviers Dépannage.

Rends UNIQUEMENT un objet JSON, sans texte autour, de la forme :
{
  "adviceDate": "AAAA-MM-JJ",        // « Date de virement »
  "reference":  "BEVO831108",         // le « Tiers » de l'avis
  "total":      117.39,               // le « Total » annoncé
  "lines": [
    { "invoiceRef": "2026/08/237", "amount": 117.39, "theirRef": "1900031646", "invoiceDate": "2026-08-10" }
  ]
}

Règles :
- « N° de facture » → invoiceRef, tel quel, sans rien reformater.
- « Références » → theirRef ; « Date de facture » → invoiceDate au format ISO.
- Montants en nombres décimaux avec un point. Une ligne négative reste négative.
- Reprends TOUTES les lignes du tableau, même s'il y en a beaucoup.
- Si une valeur est absente, mets null. N'invente jamais un montant ni un numéro.`

function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY absente')
  return new Anthropic({ apiKey })
}

async function extractAwpPdf(pdf: Buffer): Promise<{
  adviceDate: string | null; reference: string | null; total: number; lines: AdviceLine[]
}> {
  const res = await anthropic().messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
        { type: 'text', text: AWP_PROMPT },
      ],
    }],
  })

  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Claude n\'a rien renvoyé pour cet avis AWP')

  const cleaned = block.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  let raw: any
  try { raw = JSON.parse(cleaned) } catch (e: any) {
    throw new Error(`Réponse Claude illisible (${e.message}) — ${cleaned.slice(0, 160)}`)
  }

  return {
    adviceDate: raw.adviceDate ?? null,
    reference:  raw.reference ?? null,
    total:      r2(Number(raw.total) || 0),
    lines: (Array.isArray(raw.lines) ? raw.lines : [])
      .filter((l: any) => l?.invoiceRef)
      .map((l: any) => ({
        invoiceRef:  String(l.invoiceRef).trim(),
        amount:      r2(Number(l.amount) || 0),
        theirRef:    l.theirRef ? String(l.theirRef) : null,
        invoiceDate: l.invoiceDate ? String(l.invoiceDate).slice(0, 10) : null,
      })),
  }
}

/**
 * Un avis AWP : le PDF passe par Claude. C'est l'étape coûteuse du module —
 * d'où le cache, qui garantit qu'un même PDF n'est lu qu'une fois.
 * Un mail = un avis = un « Tiers » ; plusieurs peuvent arriver le même jour.
 */
async function readAwpAdvice(mail: MailRef, token: string): Promise<PaymentAdvice> {
  const atts = await attachmentsOf(mail.id, token)
  const pdf  = atts.find(a => /\.pdf$/i.test(a.name))
  if (!pdf) return emptyAdvice('awp', mail, ['Aucun PDF joint à cet avis'])

  const bytes = await attachmentBytes(mail.id, pdf.id, token)
  const doc   = { name: pdf.name, mime: pdf.contentType || 'application/pdf', bytes: bytes.length, b64: bytes.toString('base64') }

  try {
    const x     = await extractAwpPdf(bytes)
    const sum   = r2(x.lines.reduce((s, l) => s + l.amount, 0))
    const delta = r2(sum - x.total)
    return {
      provider: 'awp',
      mailId: mail.id, subject: mail.subject, receivedAt: mail.receivedDateTime,
      adviceDate: x.adviceDate ?? mail.receivedDateTime.slice(0, 10),
      // Le « Tiers » figure aussi dans l'objet du mail — filet si le PDF muet.
      reference: x.reference ?? mail.subject.match(/\b(BEVO\d+)\b/i)?.[1] ?? null,
      total: x.total,
      lines: x.lines,
      checksum: { linesSum: sum, delta, ok: x.lines.length > 0 && Math.abs(delta) < 0.005 },
      warnings: Math.abs(delta) < 0.005 ? [] : [
        `Le détail ne boucle pas : ${sum.toFixed(2)} € de lignes pour un total annoncé de ${x.total.toFixed(2)} €`,
      ],
      doc,
    }
  } catch (e: any) {
    return { ...emptyAdvice('awp', mail, [String(e?.message || e)]), doc }
  }
}

function emptyAdvice(provider: AdviceProvider, mail: MailRef, warnings: string[]): PaymentAdvice {
  return {
    provider, mailId: mail.id, subject: mail.subject, receivedAt: mail.receivedDateTime,
    adviceDate: mail.receivedDateTime.slice(0, 10), reference: null,
    total: 0, lines: [],
    checksum: { linesSum: 0, delta: 0, ok: false },
    warnings,
    doc: null,
  }
}

// ── Lister, puis lire ───────────────────────────────────────
//
// Deux temps volontairement séparés : lister les mails est rapide (une requête
// Graph par expéditeur), les lire est lent (une requête par pièce jointe, plus
// Claude sur chaque PDF). Le cache s'intercale entre les deux et ne fait relire
// que ce qu'il n'a jamais vu.

/** Où les avis arrivent, et à quoi on les reconnaît. */
const SOURCES = [
  { provider: 'ima' as const, sender: 'dfc@imabenelux.com',         subject: /avis de paiement/i },
  { provider: 'awp' as const, sender: 'accountancy.be@allianz.com', subject: /payment advice note/i },
]

export interface AdviceMailRef {
  provider:   AdviceProvider
  id:         string
  subject:    string
  receivedAt: string
  /** Message-ID RFC822 — stable, contrairement à `id`. */
  internetMessageId?: string | null
}

/** Les mails d'avis reçus depuis `sinceIso`, sans ouvrir la moindre pièce jointe. */
export async function listAdviceMails(sinceIso: string): Promise<AdviceMailRef[]> {
  const token = await getAppOnlyToken()
  if (!token) throw new Error('Microsoft Graph non configuré (AZURE_AD_*)')

  const out: AdviceMailRef[] = []
  for (const src of SOURCES) {
    const mails = (await mailsFrom(src.sender, token))
      .filter(m => m.receivedDateTime >= sinceIso && src.subject.test(m.subject))
    for (const m of mails) {
      out.push({
        provider: src.provider, id: m.id, subject: m.subject, receivedAt: m.receivedDateTime,
        internetMessageId: m.internetMessageId ?? null,
      })
    }
  }
  return out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

/** Lit un avis : pièce jointe téléchargée et détail extrait. C'est l'étape lente. */
export async function readAdviceMail(ref: AdviceMailRef): Promise<PaymentAdvice> {
  const token = await getAppOnlyToken()
  if (!token) throw new Error('Microsoft Graph non configuré (AZURE_AD_*)')

  const mail: MailRef = { id: ref.id, subject: ref.subject, receivedDateTime: ref.receivedAt }
  const advice = ref.provider === 'ima' ? await readImaAdvice(mail, token) : await readAwpAdvice(mail, token)
  return { ...advice, internetMessageId: ref.internetMessageId ?? null }
}

/**
 * Les avis des deux assureurs, du plus récent au plus ancien, lus en direct.
 * Chemin de secours : l'écran passe par le cache (cf. advice-cache.ts).
 */
export async function readAllAdvices(sinceIso: string): Promise<PaymentAdvice[]> {
  const refs = await listAdviceMails(sinceIso)
  const out: PaymentAdvice[] = []
  for (const ref of refs) out.push(await readAdviceMail(ref))
  return out
}
