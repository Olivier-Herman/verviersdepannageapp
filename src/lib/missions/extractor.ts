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

// ── Extraction RTF via striprtf ───────────────────────────────────────────────

async function extractRtf(base64Content: string): Promise<string> {
  try {
    // Décoder le base64 en latin1 (encoding Windows RTF)
    const rtfRaw = Buffer.from(base64Content, 'base64').toString('latin1')

    // Utiliser striprtf (npm) — robuste sur les gros RTF Touring
    const { rtfToText } = await import('striprtf')
    const text = rtfToText(rtfRaw)

    if (text && text.trim().length > 10) {
      console.log(`[Extractor] RTF extrait via striprtf: ${text.length} chars`)
      return text.trim()
    }

    // Fallback parser manuel si striprtf retourne vide
    console.warn('[Extractor] striprtf vide — fallback parser manuel')
    return extractRtfManual(rtfRaw)
  } catch (e: any) {
    console.error('[Extractor] Erreur striprtf:', e.message)
    // Fallback parser manuel
    const rtfRaw = Buffer.from(base64Content, 'base64').toString('latin1')
    return extractRtfManual(rtfRaw)
  }
}

function extractRtfManual(rtfRaw: string): string {
  let t = rtfRaw
  t = t.replace(/\\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    try { return Buffer.from([parseInt(hex, 16)]).toString('latin1') } catch { return '' }
  })
  t = t.replace(/\\cell\b/g, ' | ')
  t = t.replace(/\\row\b/g,  '\n')
  t = t.replace(/\\par\b/g,  '\n')
  t = t.replace(/\\line\b/g, '\n')
  t = t.replace(/\\tab\b/g,  '\t')
  for (let i = 0; i < 10; i++) {
    const prev = t
    t = t.replace(/\{[^{}]*\}/g, ' ')
    if (prev === t) break
  }
  t = t.replace(/\\[*]?[a-zA-Z]+[-]?\d* ?/g, ' ')
  t = t.replace(/[{}\\]/g, ' ')
  t = t.replace(/[ \t]+/g, ' ')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

// ── HTML → texte plain ────────────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
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
      const text = await extractRtf(rtfAtt.contentBytes)
      if (text && text.length > 20) {
        return { textContent: text, sourceFormat: 'rtf', rawContent: text }
      }
    }
    // Fallback corps email
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
