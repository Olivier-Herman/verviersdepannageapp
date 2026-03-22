// ============================================================
// VERVIERS DÉPANNAGE — Service d'envoi de reçu client
// ============================================================

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

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Espèces',
  terminal: 'SumUp Terminal',
  qr: 'QR Code SumUp',
  tap: 'Tap to Pay SumUp',
  email: 'Lien de paiement SumUp',
  sumup_manual: 'SumUp (manuel)',
  bancontact: 'Bancontact Bureau',
  unpaid: 'À facturer',
}

function getNextWorkingDay(): string {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  // Passer le week-end
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  return date.toLocaleDateString('fr-BE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
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
}): Promise<void> {
  const FROM_EMAIL = 'administration@verviersdepannage.com'
  const paymentLabel = PAYMENT_MODE_LABELS[data.paymentMode] || data.paymentMode
  const nextWorkDay = getNextWorkingDay()
  const isPaid = data.paymentMode !== 'unpaid'
  const amountTvac = data.amount.toFixed(2)
  const amountHt = (data.amount / 1.21).toFixed(2)
  const tva = (data.amount - data.amount / 1.21).toFixed(2)

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
        
        <!-- Header -->
        <tr><td style="background:#CC2222;padding:25px 30px;">
          <table width="100%"><tr>
            <td><h1 style="color:white;margin:0;font-size:22px;font-weight:bold;">VERVIERS DÉPANNAGE</h1>
            <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">24h/7j — Dépannage & Assistance</p></td>
            <td align="right"><p style="color:rgba(255,255,255,0.9);margin:0;font-size:13px;">Lefin 12<br>4860 Pepinster<br>BE0460.759.205</p></td>
          </tr></table>
        </td></tr>

        <!-- Titre -->
        <tr><td style="padding:25px 30px 15px;">
          <h2 style="margin:0;font-size:18px;color:#333;">${isPaid ? '✅ Reçu de paiement' : '📋 Confirmation d\'intervention'}</h2>
          <p style="color:#666;font-size:13px;margin:5px 0 0;">Référence : <strong>${data.reference}</strong></p>
        </td></tr>

        <!-- Infos intervention -->
        <tr><td style="padding:0 30px 20px;">
          <table width="100%" style="background:#f9f9f9;border-radius:6px;padding:15px;border:1px solid #eee;">
            <tr>
              <td style="font-size:13px;color:#666;padding:4px 0;">Véhicule</td>
              <td style="font-size:13px;color:#333;text-align:right;font-weight:bold;">${data.vehicleDisplay} — ${data.plate}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#666;padding:4px 0;">Motif</td>
              <td style="font-size:13px;color:#333;text-align:right;">${data.motifText}</td>
            </tr>
            ${data.locationAddress ? `<tr>
              <td style="font-size:13px;color:#666;padding:4px 0;">Lieu</td>
              <td style="font-size:13px;color:#333;text-align:right;">${data.locationAddress}</td>
            </tr>` : ''}
            ${data.driverName ? `<tr>
              <td style="font-size:13px;color:#666;padding:4px 0;">Chauffeur</td>
              <td style="font-size:13px;color:#333;text-align:right;">${data.driverName}</td>
            </tr>` : ''}
          </table>
        </td></tr>

        <!-- Montant -->
        <tr><td style="padding:0 30px 20px;">
          <table width="100%" style="border-radius:6px;border:1px solid #eee;overflow:hidden;">
            <tr style="background:#f9f9f9;">
              <td style="font-size:13px;color:#666;padding:8px 15px;">Montant HT</td>
              <td style="font-size:13px;color:#333;text-align:right;padding:8px 15px;">${amountHt} €</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#666;padding:8px 15px;">TVA 21%</td>
              <td style="font-size:13px;color:#333;text-align:right;padding:8px 15px;">${tva} €</td>
            </tr>
            <tr style="background:#CC2222;">
              <td style="font-size:15px;color:white;font-weight:bold;padding:12px 15px;">Total TVAC</td>
              <td style="font-size:18px;color:white;font-weight:bold;text-align:right;padding:12px 15px;">${amountTvac} €</td>
            </tr>
          </table>
        </td></tr>

        <!-- Statut paiement -->
        <tr><td style="padding:0 30px 20px;">
          <table width="100%" style="background:${isPaid ? '#e8f5e9' : '#fff8e1'};border-radius:6px;padding:15px;border:1px solid ${isPaid ? '#c8e6c9' : '#ffecb3'};">
            <tr>
              <td style="font-size:13px;color:${isPaid ? '#2e7d32' : '#f57f17'};font-weight:bold;">
                ${isPaid ? '✅ Paiement reçu' : '⏳ Paiement en attente'}
              </td>
              <td style="font-size:13px;color:${isPaid ? '#2e7d32' : '#f57f17'};text-align:right;">
                ${paymentLabel}
              </td>
            </tr>
            ${data.sumupTransactionRef ? `<tr><td colspan="2" style="font-size:11px;color:#666;padding-top:4px;">Réf. transaction : ${data.sumupTransactionRef}</td></tr>` : ''}
          </table>
        </td></tr>

        <!-- Message facture -->
        <tr><td style="padding:0 30px 25px;">
          <div style="background:#e3f2fd;border-radius:6px;padding:15px;border:1px solid #bbdefb;">
            <p style="margin:0;font-size:13px;color:#1565c0;font-weight:bold;">📧 Votre facture arrive bientôt</p>
            <p style="margin:8px 0 0;font-size:13px;color:#1976d2;">
              Votre facture acquittée vous sera envoyée par email le prochain jour ouvrable, 
              soit le <strong>${nextWorkDay}</strong>.
            </p>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f5f5f5;padding:20px 30px;text-align:center;border-top:1px solid #eee;">
          <p style="margin:0;font-size:11px;color:#999;">
            Verviers Dépannage SA · Lefin 12, 4860 Pepinster · TVA BE0460.759.205<br>
            Tél: +32 87 60 06 15 · administration@verviersdepannage.com
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
  `

  const token = await getAppToken()

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: `${isPaid ? 'Reçu' : 'Confirmation'} intervention ${data.reference} — ${amountTvac} €`,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: data.clientEmail, name: data.clientName || 'Client' } }],
        },
        saveToSentItems: true,
      })
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph sendMail error: ${err}`)
  }
}
