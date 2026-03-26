// src/lib/missions/extractor.ts

import type { MissionSource, MissionSourceFormat } from '@/types'
import { createAdminClient } from '@/lib/supabase'

export interface ExtractedContent {
  textContent:  string
  pdfBase64?:   string
  sourceFormat: MissionSourceFormat
  rawContent:   string
}

// ── Détection source ──────────────────────────────────────────────────────────

export async function detectSource(fromEmail: string, subject: string): Promise<MissionSource> {
  try {
    const supabase = createAdminClient()
    const { data: senders, error } = await supabase
      .from('mission_senders')
      .select('email_pattern, source')
      .eq('active', true)

    if (error) {
      console.error('[Extractor] mission_senders error:', error.message, error.code)
    } else {
      console.log(`[Extractor] mission_senders: ${senders?.length ?? 0} entrées`)
    }

    if (senders?.length) {
      const from = fromEmail.toLowerCase()
      for (const sender of senders) {
        const pattern = sender.email_pattern.toLowerCase()
        if (from === pattern || from.includes(pattern)) {
          console.log(`[Extractor] Match DB: "${from}" → ${sender.source}`)
          return sender.source as MissionSource
        }
      }
    }
  } catch (e: any) {
    console.error('[Extractor] Exception detectSource:', e.message)
  }
  return detectSourceFallback(fromEmail, subject)
}

function detectSourceFallback(fromEmail: string, subject: string): MissionSource {
  const from = fromEmail.toLowerCase()
  const subj = subject.toLowerCase()
  if (from.includes('@touring.be'))          return 'touring'
  if (from.includes('@imabenelux.com')) {
    if (subj.startsWith('vivium_') || subj.includes('vivium')) return 'vivium'
    return 'ethias'
  }
  if (from.includes('@axa-assistance.com') || from.includes('donotreply@axa')) {
    if (subj.includes('ardenne')) return 'ardenne'
    return 'axa'
  }
  if (from.includes('@allianz') || from.includes('automotive.be@allianz') ||
      from.includes('@mondial-assistance') || from.includes('awp')) return 'mondial'
  if (from.includes('@vab.be')) return 'vab'
  return 'unknown'
}

// ── Parser RTF robuste (port JS de l'algorithme striprtf Python) ──────────────
// Basé sur https://github.com/joshy/striprtf
// Gère correctement les tableaux imbriqués et l'encodage Windows-1252

const RTF_PATTERN = /(\{)|(\})|\\([a-z]{1,32})(-?\d{1,10})? ?|\\'([0-9a-f]{2})|\\([^a-z])|([^\\{}\r\n]+)|[\r\n]+/gi

// Table de mapping Windows-1252 pour les caractères non-ASCII
const WIN1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž',
  0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›',
  0x9C: 'œ', 0x9E: 'ž', 0x9F: 'Ÿ',
  0xA0: ' ', 0xA1: '¡', 0xA2: '¢', 0xA3: '£', 0xA4: '¤', 0xA5: '¥', 0xA6: '¦',
  0xA7: '§', 0xA8: '¨', 0xA9: '©', 0xAA: 'ª', 0xAB: '«', 0xAC: '¬', 0xAE: '®',
  0xAF: '¯', 0xB0: '°', 0xB1: '±', 0xB2: '²', 0xB3: '³', 0xB4: '´', 0xB5: 'µ',
  0xB6: '¶', 0xB7: '·', 0xB8: '¸', 0xB9: '¹', 0xBA: 'º', 0xBB: '»',
  0xBC: '¼', 0xBD: '½', 0xBE: '¾', 0xBF: '¿',
  0xC0: 'À', 0xC1: 'Á', 0xC2: 'Â', 0xC3: 'Ã', 0xC4: 'Ä', 0xC5: 'Å', 0xC6: 'Æ',
  0xC7: 'Ç', 0xC8: 'È', 0xC9: 'É', 0xCA: 'Ê', 0xCB: 'Ë', 0xCC: 'Ì', 0xCD: 'Í',
  0xCE: 'Î', 0xCF: 'Ï', 0xD0: 'Ð', 0xD1: 'Ñ', 0xD2: 'Ò', 0xD3: 'Ó', 0xD4: 'Ô',
  0xD5: 'Õ', 0xD6: 'Ö', 0xD7: '×', 0xD8: 'Ø', 0xD9: 'Ù', 0xDA: 'Ú', 0xDB: 'Û',
  0xDC: 'Ü', 0xDD: 'Ý', 0xDE: 'Þ', 0xDF: 'ß',
  0xE0: 'à', 0xE1: 'á', 0xE2: 'â', 0xE3: 'ã', 0xE4: 'ä', 0xE5: 'å', 0xE6: 'æ',
  0xE7: 'ç', 0xE8: 'è', 0xE9: 'é', 0xEA: 'ê', 0xEB: 'ë', 0xEC: 'ì', 0xED: 'í',
  0xEE: 'î', 0xEF: 'ï', 0xF0: 'ð', 0xF1: 'ñ', 0xF2: 'ò', 0xF3: 'ó', 0xF4: 'ô',
  0xF5: 'õ', 0xF6: 'ö', 0xF7: '÷', 0xF8: 'ø', 0xF9: 'ù', 0xFA: 'ú', 0xFB: 'û',
  0xFC: 'ü', 0xFD: 'ý', 0xFE: 'þ', 0xFF: 'ÿ',
}

function rtfToText(rtf: string): string {
  const stack: boolean[] = []   // true = groupe ignoré (destination spéciale)
  let ignore = false
  const out: string[] = []

  // Mots de contrôle qui indiquent des destinations à ignorer
  const ignoredWords = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object',
    'header', 'footer', 'footnote', 'comment', 'fldinst', 'datafield'
  ])

  RTF_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = RTF_PATTERN.exec(rtf)) !== null) {
    const [, openBrace, closeBrace, word, , hex, special, text] = match

    if (openBrace) {
      // Pousser l'état courant sur la pile
      stack.push(ignore)
    } else if (closeBrace) {
      // Restaurer l'état précédent
      ignore = stack.pop() ?? false
    } else if (word) {
      const w = word.toLowerCase()
      // Commandes structurelles
      if (ignoredWords.has(w)) {
        ignore = true
      } else if (w === 'par' || w === 'pard' || w === 'sect' || w === 'page') {
        if (!ignore) out.push('\n')
      } else if (w === 'line' || w === 'softline') {
        if (!ignore) out.push('\n')
      } else if (w === 'tab') {
        if (!ignore) out.push('\t')
      } else if (w === 'cell' || w === 'nestcell') {
        if (!ignore) out.push(' | ')
      } else if (w === 'row' || w === 'nestrow') {
        if (!ignore) out.push('\n')
      } else if (w === 'lquote') {
        if (!ignore) out.push('\u2018')
      } else if (w === 'rquote') {
        if (!ignore) out.push('\u2019')
      } else if (w === 'ldblquote') {
        if (!ignore) out.push('\u201C')
      } else if (w === 'rdblquote') {
        if (!ignore) out.push('\u201D')
      } else if (w === 'bullet') {
        if (!ignore) out.push('•')
      } else if (w === 'endash') {
        if (!ignore) out.push('–')
      } else if (w === 'emdash') {
        if (!ignore) out.push('—')
      }
      // Tous les autres mots de contrôle sont ignorés (formatage)
    } else if (hex) {
      // Caractère hexadécimal Windows-1252
      if (!ignore) {
        const code = parseInt(hex, 16)
        const char = WIN1252[code] || (code > 127 ? String.fromCharCode(code) : String.fromCharCode(code))
        out.push(char)
      }
    } else if (special) {
      // Caractères spéciaux échappés
      if (!ignore) {
        if (special === '\n' || special === '\r') out.push('\n')
        else if (special === '\\') out.push('\\')
        else if (special === '{') out.push('{')
        else if (special === '}') out.push('}')
        else if (special === '~') out.push('\u00A0') // non-breaking space
        else if (special === '-') out.push('\u00AD') // soft hyphen
      }
    } else if (text) {
      // Texte brut
      if (!ignore) out.push(text)
    }
  }

  return out.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── HTML → texte plain ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<a[^>]+href="([^"]+)"[^>]*>/gi, ' $1 ') // conserver les URLs des liens
    .replace(/<a[^>]+href='([^']+)'[^>]*>/gi, ' $1 ') // idem avec guillemets simples
    .replace(/<br\s*\/?>/gi,  '\n')
    .replace(/<\/p>/gi,       '\n')
    .replace(/<\/div>/gi,     '\n')
    .replace(/<\/tr>/gi,      '\n')
    .replace(/<\/td>/gi,      ' | ')
    .replace(/<[^>]+>/g,      '')
    .replace(/&nbsp;/g,       ' ')
    .replace(/&lt;/g,         '<')
    .replace(/&gt;/g,         '>')
    .replace(/&amp;/g,        '&')
    .replace(/&eacute;/g,     'é')
    .replace(/&egrave;/g,     'è')
    .replace(/&agrave;/g,     'à')
    .replace(/&ecirc;/g,      'ê')
    .replace(/&#[0-9]+;/g,    '')
    .replace(/[ \t]+/g,       ' ')
    .replace(/\n{3,}/g,       '\n\n')
    .trim()
}

function extractEmailBody(body: { content: string; contentType: string }): string {
  if (!body?.content) return ''
  if (body.contentType?.toLowerCase() === 'text') return body.content
  return htmlToText(body.content)
}

// ── Extraction principale ─────────────────────────────────────────────────────

export async function extractContent(
  graphMessage: {
    subject:         string
    body:            { content: string; contentType: string }
    hasAttachments?: boolean
  },
  attachments: Array<{ name: string; contentType: string; contentBytes: string }>,
  source: MissionSource
): Promise<ExtractedContent> {

  // === TOURING → RTF joint en priorité ===
  if (source === 'touring') {
    const rtfAtt = attachments.find(a =>
      a.contentBytes &&
      (a.name?.toLowerCase().endsWith('.rtf') ||
       a.contentType?.toLowerCase().includes('rtf') ||
       a.contentType?.toLowerCase().includes('octet-stream'))
    )
    if (rtfAtt?.contentBytes) {
      try {
        const rtfRaw = Buffer.from(rtfAtt.contentBytes, 'base64').toString('latin1')
        const text   = rtfToText(rtfRaw)
        if (text && text.length > 20) {
          console.log(`[Extractor] RTF parsé: ${text.length} chars`)
          return { textContent: text, sourceFormat: 'rtf', rawContent: text }
        }
        console.warn(`[Extractor] RTF vide après parsing (${text.length} chars)`)
      } catch (e: any) {
        console.error('[Extractor] Erreur parsing RTF:', e.message)
      }
    }
    // Fallback corps email (RI@touring.be avec body HTML)
    const bodyText = extractEmailBody(graphMessage.body)
    return { textContent: bodyText, sourceFormat: 'email_plain', rawContent: bodyText }
  }

  // === VAB → DOCX joint ===
  if (source === 'vab') {
    const docxAtt = attachments.find(a =>
      a.contentBytes &&
      (a.name?.toLowerCase().endsWith('.docx') ||
       a.contentType?.toLowerCase().includes('openxmlformats') ||
       a.contentType?.toLowerCase().includes('docx'))
    )
    if (docxAtt?.contentBytes) {
      try {
        const mammoth = await import('mammoth')
        const buffer  = Buffer.from(docxAtt.contentBytes, 'base64')
        const result  = await mammoth.extractRawText({ buffer })
        const text    = result.value.trim()
        if (text) return { textContent: text, sourceFormat: 'docx', rawContent: text }
      } catch (e) {
        console.error('[Extractor] Mammoth error:', e)
      }
    }
    const bodyText = extractEmailBody(graphMessage.body)
    return { textContent: bodyText, sourceFormat: 'email_plain', rawContent: bodyText }
  }

  // === MONDIAL / ALLIANZ → PDF joint ===
  if (source === 'mondial') {
    const pdfAtt = attachments.find(a =>
      a.contentBytes &&
      (a.name?.toLowerCase().endsWith('.pdf') ||
       a.contentType?.toLowerCase().includes('pdf'))
    )
    if (pdfAtt?.contentBytes) {
      return {
        textContent:  `[Document PDF: ${pdfAtt.name}]`,
        pdfBase64:    pdfAtt.contentBytes,
        sourceFormat: 'pdf',
        rawContent:   `[PDF: ${pdfAtt.name}]`
      }
    }
    const bodyText = extractEmailBody(graphMessage.body)
    return { textContent: bodyText, sourceFormat: 'email_plain', rawContent: bodyText }
  }

  // === IMA, AXA, ARDENNE → corps email ===
  const bodyText = extractEmailBody(graphMessage.body)
  return { textContent: bodyText, sourceFormat: 'email_plain', rawContent: bodyText }
}
