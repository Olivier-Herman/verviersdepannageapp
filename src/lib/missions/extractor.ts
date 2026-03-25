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

export async function detectSource(
  fromEmail: string,
  subject:   string
): Promise<MissionSource> {
  try {
    const supabase = createAdminClient()

    const { data: senders, error } = await supabase
      .from('mission_senders')
      .select('email_pattern, source')
      .eq('active', true)

    if (error) {
      console.error('[Extractor] Supabase mission_senders error:', error.message, error.code)
    } else {
      console.log(`[Extractor] mission_senders: ${senders?.length ?? 0} entrées chargées`)
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

  if (
    from.includes('@allianz') ||
    from.includes('automotive.be@allianz') ||
    from.includes('@mondial-assistance') ||
    from.includes('awp')
  ) return 'mondial'

  if (from.includes('@vab.be')) return 'vab'

  return 'unknown'
}

// ── Extraction RTF ────────────────────────────────────────────────────────────

function extractRtfText(rtfRaw: string): string {
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

// ── Extraction principale ─────────────────────────────────────────────────────

export async function extractContent(
  graphMessage: {
    subject:         string
    body:            { content: string; contentType: string }
    hasAttachments?: boolean
  },
  attachments: Array<{
    name:         string
    contentType:  string
    contentBytes: string
  }>,
  source: MissionSource
): Promise<ExtractedContent> {

  if (source === 'touring') {
    const rtfAtt = attachments.find(a =>
      a.name?.toLowerCase().endsWith('.rtf') ||
      a.contentType?.toLowerCase().includes('rtf')
    )
    if (rtfAtt) {
      const rtfRaw = Buffer.from(rtfAtt.contentBytes, 'base64').toString('latin1')
      const text   = extractRtfText(rtfRaw)
      return { textContent: text, sourceFormat: 'rtf', rawContent: text }
    }
  }

  if (source === 'vab') {
    const docxAtt = attachments.find(a =>
      a.name?.toLowerCase().endsWith('.docx') ||
      a.contentType?.toLowerCase().includes('openxmlformats') ||
      a.contentType?.toLowerCase().includes('docx')
    )
    if (docxAtt) {
      try {
        const mammoth = await import('mammoth')
        const buffer  = Buffer.from(docxAtt.contentBytes, 'base64')
        const result  = await mammoth.extractRawText({ buffer })
        const text    = result.value.trim()
        return { textContent: text, sourceFormat: 'docx', rawContent: text }
      } catch (e) {
        console.error('[Extractor] Mammoth DOCX error:', e)
      }
    }
  }

  if (source === 'mondial') {
    const pdfAtt = attachments.find(a =>
      a.name?.toLowerCase().endsWith('.pdf') ||
      a.contentType?.toLowerCase().includes('pdf')
    )
    if (pdfAtt) {
      return {
        textContent:  `[Document PDF: ${pdfAtt.name}]`,
        pdfBase64:    pdfAtt.contentBytes,
        sourceFormat: 'pdf',
        rawContent:   `[PDF: ${pdfAtt.name}]`
      }
    }
  }

  const body = graphMessage.body
  let text   = ''

  if (body.contentType?.toLowerCase() === 'text') {
    text = body.content || ''
  } else {
    text = htmlToText(body.content || '')
  }

  return { textContent: text, sourceFormat: 'email_plain', rawContent: text }
}
