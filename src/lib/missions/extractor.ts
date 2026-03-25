// src/lib/missions/extractor.ts
// Détecte la source d'un email et extrait le contenu textuel
// selon le format (RTF Touring, DOCX VAB, PDF Mondial, plain text IMA/AXA)

import type { MissionSource, MissionSourceFormat } from '@/types'

export interface ExtractedContent {
  textContent: string
  pdfBase64?: string        // PDF Mondial → envoyé comme document natif à Claude
  sourceFormat: MissionSourceFormat
  rawContent: string        // Stocké en DB pour debug
}

// ── Détection source par expéditeur ──────────────────────────────────────────

export function detectSource(fromEmail: string, subject: string): MissionSource {
  const from = fromEmail.toLowerCase()
  const subj = subject.toLowerCase()

  if (from.includes('@touring.be'))          return 'touring'

  if (from.includes('@imabenelux.com')) {
    if (subj.startsWith('vivium_') || subj.includes('vivium')) return 'vivium'
    return 'ethias'   // ETHIAS, P&V et autres IMA = même format
  }

  if (from.includes('@axa-assistance.com') || from.includes('donotreply@axa')) {
    if (subj.includes('ardenne'))             return 'ardenne'
    return 'axa'
  }

  if (
    from.includes('@allianz') ||
    from.includes('automotive.be@allianz') ||
    from.includes('@mondial-assistance') ||
    from.includes('awp')
  ) return 'mondial'

  if (from.includes('@vab.be'))              return 'vab'

  return 'unknown'
}

// ── Extraction RTF (JS natif, pas de dépendance système) ─────────────────────

function extractRtfText(rtfRaw: string): string {
  let t = rtfRaw

  // Décoder les caractères Windows-1252 \'xx
  t = t.replace(/\\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    try { return Buffer.from([parseInt(hex, 16)]).toString('latin1') } catch { return '' }
  })

  // Séparateurs de cellules / lignes / paragraphes
  t = t.replace(/\\cell\b/g, ' | ')
  t = t.replace(/\\row\b/g,  '\n')
  t = t.replace(/\\par\b/g,  '\n')
  t = t.replace(/\\line\b/g, '\n')
  t = t.replace(/\\tab\b/g,  '\t')

  // Supprimer groupes imbriqués (plusieurs passes)
  for (let i = 0; i < 10; i++) {
    const prev = t
    t = t.replace(/\{[^{}]*\}/g, ' ')
    if (prev === t) break
  }

  // Mots de contrôle + accolades résiduelles
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
    subject:             string
    body:                { content: string; contentType: string }
    hasAttachments?:     boolean
  },
  attachments: Array<{
    name:         string
    contentType:  string
    contentBytes: string  // base64 depuis Graph
  }>,
  source: MissionSource
): Promise<ExtractedContent> {

  // === TOURING → RTF joint ===
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

  // === VAB → DOCX joint ===
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
        // Fallback sur le corps de l'email
      }
    }
  }

  // === MONDIAL / ALLIANZ → PDF joint ===
  if (source === 'mondial') {
    const pdfAtt = attachments.find(a =>
      a.name?.toLowerCase().endsWith('.pdf') ||
      a.contentType?.toLowerCase().includes('pdf')
    )
    if (pdfAtt) {
      return {
        textContent: `[Document PDF: ${pdfAtt.name}]`,
        pdfBase64:   pdfAtt.contentBytes,
        sourceFormat: 'pdf',
        rawContent:  `[PDF: ${pdfAtt.name}]`
      }
    }
  }

  // === IMA (ETHIAS/VIVIUM), AXA, ARDENNE → corps email ===
  const body = graphMessage.body
  let text   = ''

  if (body.contentType?.toLowerCase() === 'text') {
    text = body.content || ''
  } else {
    text = htmlToText(body.content || '')
  }

  return { textContent: text, sourceFormat: 'email_plain', rawContent: text }
}
