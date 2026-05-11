// ============================================================
// Module Relance — Templates mail + sendReminderEmail
// ============================================================
// Reutilise emailLayout() et helpers existants de src/lib/emails.ts
// pour rester coherent avec les autres mails VD (Rapport encaissements,
// Police Accident, etc.) — meme bandeau rouge, meme tagline 24H/7J,
// meme footer.
//
// Envoi via Microsoft Graph sendMail avec 2 attachments (PDF + XLSX).
// Pattern copie de sendAdvancePurchaseEmail (lib/emails.ts:322).

import {
  BRAND_RED, FROM_EMAIL, getAppToken,
  emailLayout, infoRow, badge, divider,
} from '@/lib/emails'
import { formatEur }          from '@/lib/format'
import type { ReminderLevel } from './odoo'
import { COMPANY }            from '@/config/company'

interface ReminderEmailParams {
  to:           string         // partner email
  toName?:      string         // partner name (optional, for display)
  level:        ReminderLevel
  partnerName:  string
  reference:    string
  totalDue:     number
  invoiceCount: number
  pdfBuffer:    Buffer
  xlsxBuffer:   Buffer
  pdfFilename?: string
  xlsxFilename?: string
}

const LEVEL_TITLES: Record<ReminderLevel, string> = {
  1: 'Rappel amical',
  2: 'Relance — second rappel',
  3: '⚠ Mise en demeure',
}

const LEVEL_BADGE_COLORS: Record<ReminderLevel, string> = {
  1: '#1F75D9',  // bleu (info, ton amical)
  2: '#D97706',  // orange (warning, ton ferme)
  3: '#B91C1C',  // rouge (critical, mise en demeure)
}

const LEVEL_INTROS: Record<ReminderLevel, string> = {
  1: `Sauf erreur de notre part, nos services constatent que les factures reprises ci-dessous, dont la date d'échéance est dépassée, restent impayées à ce jour. Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais.`,
  2: `Nous attirons à nouveau votre attention sur le fait que les factures reprises ci-dessous restent impayées malgré notre précédent rappel. Nous vous prions de procéder au règlement sous huitaine à compter de la présente.`,
  3: `Malgré nos précédents rappels, nous constatons que les factures reprises ci-dessous demeurent impayées à ce jour. Conformément à nos conditions générales de vente, nous vous mettons en demeure de procéder au règlement intégral du solde dû sous quinze jours à dater de la présente, sous peine de poursuites judiciaires sans nouvel avis et de l'application des intérêts de retard et de l'indemnité forfaitaire prévus contractuellement.`,
}

const LEVEL_CLOSINGS: Record<ReminderLevel, string> = {
  1: `Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de la présente. Pour toute question relative à ce dossier, n'hésitez pas à nous contacter.`,
  2: `Si ce paiement a été effectué entre-temps, nous vous prions de ne pas tenir compte de la présente.`,
  3: `À défaut de règlement dans le délai mentionné ci-dessus, le dossier sera transmis à notre conseil sans nouvel avis. Les frais et indemnités prévus aux conditions générales seront alors mis à votre charge.`,
}

// formatEur centralise dans @/lib/format

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

export function buildReminderHtml(opts: {
  level:         ReminderLevel
  partnerName:   string
  reference:     string
  totalDue:      number
  invoiceCount:  number
  sentDate:      string  // YYYY-MM-DD
}): string {
  const { level, partnerName, reference, totalDue, invoiceCount, sentDate } = opts
  const accent = LEVEL_BADGE_COLORS[level]
  const title  = LEVEL_TITLES[level]

  const dateFr = (() => {
    const [y, m, d] = sentDate.split('-')
    return `${d}/${m}/${y}`
  })()

  const content = `
    <p style="margin:0 0 6px;font-size:13px;color:#888;">Madame, Monsieur,</p>
    <p style="margin:0 0 18px;font-size:22px;font-weight:700;color:#111;line-height:1.25;">
      ${escapeHtml(title)}
    </p>

    <div style="margin-bottom:20px;">
      ${badge(accent, `Niveau L${level}`)}
    </div>

    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;text-align:justify;">
      ${escapeHtml(LEVEL_INTROS[level])}
    </p>

    <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Référence',     `<strong>${escapeHtml(reference)}</strong>`)}
        ${infoRow('Date',          escapeHtml(dateFr))}
        ${infoRow('Client',        `<strong>${escapeHtml(partnerName)}</strong>`)}
        ${infoRow('Factures',      `${invoiceCount} facture${invoiceCount > 1 ? 's' : ''} échue${invoiceCount > 1 ? 's' : ''}`)}
      </table>
    </div>

    <!-- Total a regler -->
    <div style="background:${accent}10;border:1px solid ${accent}40;border-radius:10px;padding:16px 20px;margin-bottom:20px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;color:#666;letter-spacing:0.5px;text-transform:uppercase;">Total à régler</p>
      <p style="margin:0;font-size:28px;font-weight:800;color:${accent};letter-spacing:-0.5px;">
        ${formatEur(totalDue)}
      </p>
    </div>

    ${divider()}

    <!-- IBAN + communication -->
    <p style="margin:0 0 8px;font-size:13px;color:#888;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">
      Modalités de paiement
    </p>
    <p style="margin:0 0 6px;font-size:14px;color:#333;line-height:1.6;">
      Veuillez verser le montant total de <strong>${formatEur(totalDue)}</strong> sur le compte :
    </p>
    <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#111;font-family:'Menlo','Monaco',monospace;">
      ${escapeHtml(COMPANY.iban)}
    </p>
    <p style="margin:0 0 24px;font-size:13px;color:#666;">
      Communication structurée : <strong>${escapeHtml(reference)}</strong>
    </p>

    <p style="margin:0 0 20px;font-size:14px;color:#333;line-height:1.6;text-align:justify;">
      ${escapeHtml(LEVEL_CLOSINGS[level])}
    </p>

    <p style="margin:24px 0 0;font-size:13px;color:#666;line-height:1.6;">
      📎 Vous trouverez en pièces jointes le détail complet de cette relance au format PDF
      ainsi qu'un export Excel reprenant l'ensemble des factures concernées.
    </p>

    <p style="margin:32px 0 4px;font-size:13px;color:#666;">Cordialement,</p>
    <p style="margin:0;font-size:14px;font-weight:700;color:#111;">Le service Comptabilité</p>
    <p style="margin:0;font-size:13px;color:#888;">${escapeHtml(COMPANY.name)}</p>
  `

  return emailLayout(content, title)
}

/**
 * Envoi mail relance via Microsoft Graph avec 2 attachments (PDF + XLSX).
 * Pattern copie de sendAdvancePurchaseEmail.
 */
export async function sendReminderEmail(params: ReminderEmailParams): Promise<{ messageId: string | null }> {
  const {
    to, toName, level, partnerName, reference, totalDue, invoiceCount,
    pdfBuffer, xlsxBuffer, pdfFilename, xlsxFilename,
  } = params

  const sentDate = new Date().toISOString().slice(0, 10)
  const subject  = level === 3
    ? `MISE EN DEMEURE — ${reference} — ${formatEur(totalDue)}`
    : `Relance L${level} — ${reference} — ${formatEur(totalDue)}`

  const html = buildReminderHtml({
    level, partnerName, reference, totalDue, invoiceCount, sentDate,
  })

  const pdfName  = pdfFilename  || `Relance-${reference}.pdf`
  const xlsxName = xlsxFilename || `Relance-${reference}.xlsx`

  const token = await getAppToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body:         { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to, ...(toName ? { name: toName } : {}) } }],
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name:          pdfName,
            contentType:   'application/pdf',
            contentBytes:  pdfBuffer.toString('base64'),
          },
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name:          xlsxName,
            contentType:   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentBytes:  xlsxBuffer.toString('base64'),
          },
        ],
      },
      saveToSentItems: true,
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph sendMail (relance) error: ${err}`)
  }

  // sendMail retourne 202 sans body en Phase 1 — on ne peut pas extraire
  // le message_id Graph. Phase 2 envisagera createDraft+send pour avoir
  // le drill-down. Pour l instant on retourne null.
  return { messageId: null }
}
