// ============================================================
// VERVIERS DÉPANNAGE — Service emails centralisé
// ============================================================

const BRAND_RED = '#CC2222'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'
const ADMIN_EMAIL = 'mobi@verviersdepannage.be'
const FROM_EMAIL = 'administration@verviersdepannage.com'

async function getAppToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      })
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

async function sendEmail(to: string, subject: string, html: string, toName?: string) {
  const token = await getAppToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to, name: toName || to } }],
      },
      saveToSentItems: true,
    })
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph sendMail error: ${err}`)
  }
}

// ─── Layout de base ───────────────────────────────────────
function emailLayout(content: string, title: string) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      
      <!-- Header -->
      <tr><td style="background:${BRAND_RED};padding:28px 36px;">
        <table width="100%"><tr>
          <td>
            <p style="margin:0;color:white;font-size:20px;font-weight:700;letter-spacing:-0.3px;">VERVIERS DÉPANNAGE</p>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px;letter-spacing:0.5px;">24H/7J — DÉPANNAGE & ASSISTANCE</p>
          </td>
          <td align="right" style="vertical-align:top">
            <p style="margin:0;color:rgba(255,255,255,0.8);font-size:12px;line-height:1.6;">Lefin 12<br>4860 Pepinster<br>BE0460.759.205</p>
          </td>
        </tr></table>
      </td></tr>

      <!-- Content -->
      <tr><td style="padding:36px;">${content}</td></tr>

      <!-- Footer -->
      <tr><td style="background:#f8f8f8;padding:20px 36px;border-top:1px solid #ebebeb;">
        <p style="margin:0;font-size:11px;color:#999;line-height:1.6;text-align:center;">
          Verviers Dépannage SA · Lefin 12, 4860 Pepinster · TVA BE0460.759.205<br>
          +32 87 60 06 15 · <a href="mailto:administration@verviersdepannage.com" style="color:#999;text-decoration:none;">administration@verviersdepannage.com</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`
}

function badge(color: string, text: string) {
  return `<span style="display:inline-block;background:${color}15;color:${color};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid ${color}30;">${text}</span>`
}

function button(href: string, text: string, color = BRAND_RED) {
  return `<a href="${href}" style="display:inline-block;background:${color};color:white;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;">${text}</a>`
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #ebebeb;margin:24px 0;">`
}

function infoRow(label: string, value: string) {
  return `<tr>
    <td style="padding:8px 0;font-size:13px;color:#888;white-space:nowrap;vertical-align:top;padding-right:20px;">${label}</td>
    <td style="padding:8px 0;font-size:13px;color:#222;font-weight:500;text-align:right;">${value}</td>
  </tr>`
}

// ─── Email 1 : Reçu / Confirmation paiement ───────────────
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Espèces',
  terminal: 'SumUp Terminal',
  qr: 'QR Code SumUp',
  tap: 'Tap to Pay',
  email: 'Lien de paiement',
  sumup_manual: 'SumUp (manuel)',
  bancontact: 'Bancontact Bureau',
  unpaid: 'À facturer',
}

function getNextWorkingDay(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1)
  return date.toLocaleDateString('fr-BE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export async function sendClientReceipt(data: {
  clientEmail: string
  clientName: string
  reference: string
  amount: number
  paymentMode: string
  plate: string
  vehicleDisplay: string
  motifText: string
  locationAddress?: string
  driverName?: string
  sumupTransactionRef?: string
}) {
  const isPaid = data.paymentMode !== 'unpaid'
  const amountTvac = data.amount.toFixed(2)
  const amountHt = (data.amount / 1.21).toFixed(2)
  const tva = (data.amount - data.amount / 1.21).toFixed(2)
  const paymentLabel = PAYMENT_MODE_LABELS[data.paymentMode] || data.paymentMode
  const nextWorkDay = getNextWorkingDay()

  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">${isPaid ? '✅ Reçu de paiement' : '📋 Confirmation d\'intervention'}</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;">Référence <span style="font-weight:600;color:#444;">${data.reference}</span></p>

    ${!isPaid ? `
    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px 18px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;font-weight:700;color:#856404;">⚠️ Intervention non payée</p>
      <p style="margin:6px 0 0;font-size:12px;color:#9a7206;">Le paiement de cette intervention est en attente. Votre facture vous sera transmise prochainement.</p>
    </div>` : ''}

    <!-- Infos véhicule -->
    <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#aaa;letter-spacing:1px;text-transform:uppercase;">Détails de l'intervention</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Véhicule', `${data.vehicleDisplay || '—'} · ${data.plate}`)}
        ${infoRow('Motif', data.motifText)}
        ${data.locationAddress ? infoRow('Lieu', data.locationAddress) : ''}
        ${data.driverName ? infoRow('Chauffeur', data.driverName) : ''}
      </table>
    </div>

    <!-- Montants -->
    <div style="border:1px solid #ebebeb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr style="background:#f8f8f8;">
          <td style="padding:10px 16px;font-size:13px;color:#888;">Montant HTVA</td>
          <td style="padding:10px 16px;font-size:13px;color:#444;text-align:right;">${amountHt} €</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#888;border-top:1px solid #f0f0f0;">TVA 21%</td>
          <td style="padding:10px 16px;font-size:13px;color:#444;text-align:right;border-top:1px solid #f0f0f0;">${tva} €</td>
        </tr>
        <tr style="background:${BRAND_RED};">
          <td style="padding:14px 16px;font-size:15px;font-weight:700;color:white;">Total TVAC</td>
          <td style="padding:14px 16px;font-size:18px;font-weight:700;color:white;text-align:right;">${amountTvac} €</td>
        </tr>
      </table>
    </div>

    ${isPaid ? `
    <!-- Paiement reçu -->
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
      <table width="100%"><tr>
        <td style="font-size:13px;font-weight:700;color:#2e7d32;">✅ Paiement reçu</td>
        <td style="font-size:13px;color:#388e3c;text-align:right;">${paymentLabel}</td>
      </tr>
      ${data.sumupTransactionRef ? `<tr><td colspan="2" style="font-size:11px;color:#66bb6a;padding-top:4px;">Réf. : ${data.sumupTransactionRef}</td></tr>` : ''}
      </table>
    </div>` : ''}

    <!-- Facture -->
    <div style="background:#e3f2fd;border:1px solid #bbdefb;border-radius:8px;padding:16px 18px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1565c0;">📧 Votre facture arrive bientôt</p>
      <p style="margin:0;font-size:13px;color:#1976d2;line-height:1.5;">
        Votre facture ${isPaid ? 'acquittée ' : ''}vous sera envoyée le prochain jour ouvrable,<br>
        soit le <strong>${nextWorkDay}</strong>.
      </p>
    </div>
  `

  const subject = isPaid
    ? `Reçu — Intervention ${data.reference} · ${amountTvac} €`
    : `Confirmation d'intervention ${data.reference} — NON PAYÉE`

  await sendEmail(data.clientEmail, subject, emailLayout(content, subject), data.clientName)
}

// ─── Email 2 : Notification admin nouvelle demande d'accès ─
export async function sendAccessRequestNotification(data: {
  name: string
  email: string
  provider: string
}) {
  const providerLabel = data.provider === 'google' ? 'Google' : data.provider === 'microsoft' ? 'Microsoft professionnel' : 'Email & mot de passe'

  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;">Nouvelle demande d'accès</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;">Un employé souhaite accéder à l'application.</p>

    <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;margin-bottom:16px;">
        <div style="width:44px;height:44px;border-radius:50%;background:${BRAND_RED};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px;flex-shrink:0;margin-right:14px;">
          ${data.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <p style="margin:0;font-size:15px;font-weight:700;color:#111;">${data.name}</p>
          <p style="margin:2px 0 0;font-size:13px;color:#888;">${data.email}</p>
        </div>
      </div>
      <table width="100%">
        ${infoRow('Méthode de connexion', providerLabel)}
        ${infoRow('Date de demande', new Date().toLocaleString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}
      </table>
    </div>

    <p style="margin:0 0 20px;font-size:13px;color:#666;line-height:1.6;">
      Le compte a été créé en mode <strong>inactif</strong>. Vous devez l'activer, assigner les modules appropriés et éventuellement corriger le nom.
    </p>

    ${button(`${APP_URL}/admin/users`, 'Gérer les utilisateurs →')}
  `

  await sendEmail(ADMIN_EMAIL, `Demande d'accès — ${data.name}`, emailLayout(content, `Demande d'accès — ${data.name}`))
}

// ─── Email 3 : Compte activé → employé ────────────────────
export async function sendAccountActivated(data: {
  toEmail: string
  name: string
  authProvider: string
}) {
  const providerLabel = data.authProvider === 'google' ? 'Google' : data.authProvider === 'microsoft' ? 'Microsoft professionnel' : 'Email & mot de passe'
  const providerHint = data.authProvider === 'email_password'
    ? '<p style="margin:8px 0 0;font-size:12px;color:#1976d2;">Votre mot de passe temporaire est <strong>!Verviers4800</strong> — vous devrez le changer à la première connexion.</p>'
    : `<p style="margin:8px 0 0;font-size:12px;color:#1976d2;">Connectez-vous avec votre compte <strong>${providerLabel}</strong>.</p>`

  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;">Votre accès est activé ! 🎉</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;">Bienvenue sur l'application Verviers Dépannage.</p>

    <div style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#2e7d32;">✅ Compte activé</p>
      <table width="100%">
        ${infoRow('Nom', data.name)}
        ${infoRow('Méthode de connexion', providerLabel)}
      </table>
      ${providerHint}
    </div>

    <p style="margin:0 0 24px;font-size:13px;color:#666;line-height:1.6;">
      Vous pouvez maintenant accéder à l'application depuis votre téléphone ou ordinateur. 
      Installez-la sur votre écran d'accueil pour un accès rapide.
    </p>

    ${button(`${APP_URL}/login`, 'Accéder à l\'application →')}

    ${divider()}

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
      En cas de problème de connexion, contactez l'administration.<br>
      <a href="mailto:mobi@verviersdepannage.be" style="color:#aaa;">mobi@verviersdepannage.be</a>
    </p>
  `

  await sendEmail(data.toEmail, 'Votre accès à l\'application Verviers Dépannage est activé', emailLayout(content, 'Accès activé'), data.name)
}

// ─── Email 4 : Réinitialisation mot de passe ──────────────
export async function sendPasswordReset(data: {
  toEmail: string
  name: string
  resetUrl: string
}) {
  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;">Réinitialisation du mot de passe</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;">Vous avez demandé à réinitialiser votre mot de passe.</p>

    <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:13px;color:#666;line-height:1.6;">
        Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe. 
        Ce lien est valable <strong>1 heure</strong>.
      </p>
      ${button(data.resetUrl, 'Réinitialiser mon mot de passe')}
    </div>

    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
      Si vous n'avez pas fait cette demande, ignorez cet email — votre mot de passe reste inchangé.
    </p>
  `

  await sendEmail(data.toEmail, 'Réinitialisation de votre mot de passe', emailLayout(content, 'Réinitialisation mot de passe'), data.name)
}

// ─── Email : Avance de fonds → boîte achat ────────────────
export async function sendAdvancePurchaseEmail(params: {
  to:            string
  plate:         string
  amountHtva:    number
  paymentMethod: string
  invoiceUrl:    string
  employeeName:  string
  orderName?:    string
}): Promise<void> {
  const { to, plate, amountHtva, paymentMethod, invoiceUrl, employeeName, orderName } = params

  const paymentLabels: Record<string, string> = {
    cash:       'Espèces',
    bancontact: 'Bancontact',
    card:       'Carte',
    virement:   'Virement',
  }

  // Télécharger la pièce jointe
  const imageResponse = await fetch(invoiceUrl)
  if (!imageResponse.ok) throw new Error(`Impossible de récupérer la facture : ${invoiceUrl}`)

  const imageBuffer = await imageResponse.arrayBuffer()
  const contentType = imageResponse.headers.get('content-type') ?? 'image/jpeg'

  // Convertir en PDF via pdf-lib
  let attachmentBase64: string
  let attachmentContentType: string
  let attachmentFilename: string

  if (contentType.includes('pdf')) {
    attachmentBase64      = Buffer.from(imageBuffer).toString('base64')
    attachmentContentType = 'application/pdf'
    attachmentFilename    = `facture-avance-${plate}-${Date.now()}.pdf`
  } else {
    try {
      const { PDFDocument } = await import('pdf-lib')
      const pdfDoc = await PDFDocument.create()
      const image  = contentType.includes('png')
        ? await pdfDoc.embedPng(imageBuffer)
        : await pdfDoc.embedJpg(imageBuffer)

      const A4_W = 595, A4_H = 842
      const ratio  = Math.min(A4_W / image.width, A4_H / image.height, 1)
      const width  = image.width  * ratio
      const height = image.height * ratio
      const page   = pdfDoc.addPage([width, height])
      page.drawImage(image, { x: 0, y: 0, width, height })

      attachmentBase64      = Buffer.from(await pdfDoc.save()).toString('base64')
      attachmentContentType = 'application/pdf'
      attachmentFilename    = `facture-avance-${plate}-${Date.now()}.pdf`
    } catch {
      // Fallback image directe si conversion échoue
      attachmentBase64      = Buffer.from(imageBuffer).toString('base64')
      attachmentContentType = contentType
      attachmentFilename    = `facture-avance-${plate}-${Date.now()}.jpg`
    }
  }

  const subject = `Avance de fonds — ${plate} — ${amountHtva.toFixed(2)} € HTVA`
  const html = emailLayout(`
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111;">Avance de fonds</p>
    <p style="margin:0 0 24px;font-size:14px;color:#888;">
      Effectuée par <strong>${employeeName}</strong> — veuillez encoder et acquitter la facture jointe.
    </p>
    <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Immatriculation',  `<strong>${plate}</strong>`)}
        ${infoRow('Montant HTVA',     `<strong>${amountHtva.toFixed(4)} €</strong>`)}
        ${infoRow('Mode de paiement', paymentLabels[paymentMethod] ?? paymentMethod)}
        ${orderName ? infoRow('Référence devis', `<strong>${orderName}</strong>`) : ''}
      </table>
    </div>
  `, subject)

  const token = await getAppToken()
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        attachments: [{
          '@odata.type': '#microsoft.graph.fileAttachment',
          name:          attachmentFilename,
          contentType:   attachmentContentType,
          contentBytes:  attachmentBase64,
        }],
      },
      saveToSentItems: true,
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph sendMail (advance) error: ${err}`)
  }
}
// ─── Email : Rapport check véhicule non-conforme ──────────
export async function sendCheckVehiculeNonConformeReport(data: {
  vehicleName:   string
  vehiclePlate:  string
  checkedBy:     string
  checkedAt:     string
  results:       Array<{ label: string; category: string; ok: boolean | null; comment?: string; photo_url?: string }>
  notes?:        string
  checkId:       string
}) {
  const TO = 'info@verviersdepannage.com'

  const nonConformes = data.results.filter(r => r.ok === false)
  const okCount      = data.results.filter(r => r.ok === true).length
  const naCount      = data.results.filter(r => r.ok === null).length

  // Grouper les non-conformes par catégorie
  const byCategory: Record<string, typeof nonConformes> = {}
  for (const item of nonConformes) {
    if (!byCategory[item.category]) byCategory[item.category] = []
    byCategory[item.category].push(item)
  }

  const ncRows = Object.entries(byCategory).map(([cat, items]) => `
    <tr>
      <td colspan="2" style="padding:10px 16px 4px;font-size:11px;font-weight:700;color:#CC2222;text-transform:uppercase;letter-spacing:1px;background:#fff5f5;border-top:2px solid #CC2222;">
        ${cat}
      </td>
    </tr>
    ${items.map(item => `
    <tr style="border-top:1px solid #f0f0f0;">
      <td style="padding:10px 16px;font-size:13px;color:#222;font-weight:600;vertical-align:top;width:40%;">
        ❌ ${item.label}
      </td>
      <td style="padding:10px 16px;font-size:13px;color:#555;vertical-align:top;">
        ${item.comment ? `<span style="font-style:italic;">${item.comment}</span>` : '<span style="color:#aaa;">Aucun commentaire</span>'}
        ${item.photo_url ? `<br><a href="${item.photo_url}" style="color:${BRAND_RED};font-size:12px;font-weight:600;">📷 Voir la photo →</a>` : ''}
      </td>
    </tr>`).join('')}
  `).join('')

  const content = `
    <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111;">⚠️ Rapport de contrôle — Non-conformités</p>
    <p style="margin:0 0 28px;font-size:14px;color:#888;">
      Contrôle effectué le <strong>${data.checkedAt}</strong> par <strong>${data.checkedBy}</strong>
    </p>

    <!-- Véhicule -->
    <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#aaa;letter-spacing:1px;text-transform:uppercase;">Véhicule contrôlé</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${infoRow('Véhicule',        `<strong>${data.vehicleName}</strong>`)}
        ${infoRow('Immatriculation', `<strong>${data.vehiclePlate}</strong>`)}
      </table>
    </div>

    <!-- Résumé -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="text-align:center;padding:16px;background:#fff5f5;border:1px solid #ffcccc;border-radius:8px;">
          <p style="margin:0;font-size:28px;font-weight:800;color:#CC2222;">${nonConformes.length}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Non-conforme(s)</p>
        </td>
        <td style="width:12px;"></td>
        <td style="text-align:center;padding:16px;background:#f0faf0;border:1px solid #c8e6c9;border-radius:8px;">
          <p style="margin:0;font-size:28px;font-weight:800;color:#2e7d32;">${okCount}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Conforme(s)</p>
        </td>
        <td style="width:12px;"></td>
        <td style="text-align:center;padding:16px;background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;">
          <p style="margin:0;font-size:28px;font-weight:800;color:#888;">${naCount}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">N/A</p>
        </td>
      </tr>
    </table>

    <!-- Détail non-conformités -->
    <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#111;">Détail des non-conformités</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${ncRows}
    </table>

    ${data.notes ? `
    ${divider()}
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#111;">Notes générales</p>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;background:#f8f8f8;border-radius:8px;padding:14px 16px;">${data.notes}</p>
    ` : ''}

    ${divider()}
    ${button(`${APP_URL}/check-vehicule/${data.checkId}`, 'Voir le rapport complet →')}
  `

  const subject = `⚠️ Check Véhicule — Non-conformités — ${data.vehicleName} (${data.vehiclePlate})`
  await sendEmail(TO, subject, emailLayout(content, subject), 'Verviers Dépannage')
}
