// ============================================================
// VERVIERS DÉPANNAGE — SumUp Integration
// ============================================================

import { formatEur } from '@/lib/format'

const SUMUP_API_KEY      = process.env.SUMUP_API_KEY!
const SUMUP_MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE!
const APP_URL            = process.env.NEXT_PUBLIC_APP_URL!

interface SumUpCheckout {
  id: string
  checkout_reference: string
  amount: number
  currency: string
  pay_to_email: string
  status: string
}

// ============================================================
// Créer un checkout SumUp
// ============================================================
export async function createCheckout(data: {
  amount: number
  reference: string
  description: string
  returnUrl?: string
}): Promise<{ id: string; checkoutUrl: string }> {

  const response = await fetch('https://api.sumup.com/v0.1/checkouts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUMUP_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      checkout_reference: data.reference,
      amount: data.amount,
      currency: 'EUR',
      merchant_code: SUMUP_MERCHANT_CODE,
      description: data.description,
      redirect_url: data.returnUrl || `${APP_URL}/encaissement/payment-callback`,
      hosted_checkout: { enabled: true },
    })
  })

  const checkout = await response.json()
  if (!response.ok) throw new Error(`SumUp checkout error: ${JSON.stringify(checkout)}`)

  console.log('[SumUp] Checkout response:', JSON.stringify(checkout))

  // URL au format SumUp standard : pay.sumup.com/b2c/REFERENCE
  const checkoutUrl = checkout.hosted_checkout_url
    || `https://pay.sumup.com/b2c/${checkout.checkout_reference}`

  console.log('[SumUp] Checkout URL:', checkoutUrl)

  return { id: checkout.id, checkoutUrl }
}

// ============================================================
// Récupérer le statut d'un checkout
// ============================================================
export async function getCheckoutStatus(checkoutId: string): Promise<{
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED'
  transactionId?: string
  paidAt?: string
}> {
  const res = await fetch(`https://api.sumup.com/v0.1/checkouts/${checkoutId}`, {
    headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}` }
  })

  if (!res.ok) throw new Error('SumUp status error')

  const data = await res.json()

  return {
    status: data.status,
    transactionId: data.transactions?.[0]?.transaction_code,
    paidAt: data.transactions?.[0]?.timestamp,
  }
}

// ============================================================
// Statut d'une transaction par notre référence (foreign_transaction_id)
// ------------------------------------------------------------
// Pour Terminal / Tap to Pay : le paiement part dans l'app SumUp (deep link),
// pas sur le checkout en ligne. On tague la transaction avec foreign-tx-id =
// notre référence, puis on interroge l'API Transactions du MÊME marchand pour
// détecter le succès automatiquement (aucun callback natif nécessaire).
// ============================================================
export async function getTransactionByForeignId(foreignId: string): Promise<{
  status: 'PENDING' | 'PAID' | 'FAILED'
  transactionId?: string
  paidAt?: string
}> {
  const res = await fetch(
    `https://api.sumup.com/v0.1/me/transactions?foreign_transaction_id=${encodeURIComponent(foreignId)}`,
    { headers: { 'Authorization': `Bearer ${SUMUP_API_KEY}` } },
  )
  // Pas encore de transaction pour cette référence → paiement pas (encore) fait.
  if (res.status === 404) return { status: 'PENDING' }
  if (!res.ok) throw new Error(`SumUp tx lookup error (${res.status})`)

  const data = await res.json()
  // L'endpoint renvoie soit la transaction, soit une liste selon le filtre.
  const tx = Array.isArray(data?.items) ? data.items[0] : (Array.isArray(data) ? data[0] : data)
  if (!tx || !tx.status) return { status: 'PENDING' }

  const s = String(tx.status).toUpperCase()
  const status: 'PENDING' | 'PAID' | 'FAILED' =
    s === 'SUCCESSFUL' ? 'PAID'
    : (s === 'FAILED' || s === 'CANCELLED') ? 'FAILED'
    : 'PENDING'
  return { status, transactionId: tx.transaction_code || tx.id, paidAt: tx.timestamp }
}

// ============================================================
// Obtenir un token applicatif Azure AD (client credentials)
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

// ============================================================
// Envoyer le lien de paiement depuis administration@verviersdepannage.com
// ============================================================
export async function sendPaymentEmail(data: {
  clientEmail: string
  clientName: string
  checkoutUrl: string
  amount: number
  reference: string
  description: string
}): Promise<void> {
  const FROM_EMAIL = 'administration@verviersdepannage.com'

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #CC2222; padding: 20px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 22px;">Verviers Dépannage</h1>
        <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0;">24h/7j — Dépannage & Assistance</p>
      </div>
      <div style="padding: 30px; background: #f9f9f9;">
        <p>Bonjour ${data.clientName || 'Client'},</p>
        <p>Suite à notre intervention, voici le lien pour procéder au paiement :</p>
        <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; border: 1px solid #eee;">
          <p style="font-size: 13px; color: #888; margin: 0;">Référence</p>
          <p style="font-size: 16px; font-weight: bold; color: #333; margin: 5px 0;">${data.reference}</p>
          <p style="font-size: 13px; color: #888; margin: 10px 0 0;">${data.description}</p>
          <p style="font-size: 36px; font-weight: bold; color: #CC2222; margin: 10px 0;">${formatEur(data.amount)}</p>
          <a href="${data.checkoutUrl}"
             style="display: inline-block; background: #CC2222; color: white; padding: 15px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Payer maintenant
          </a>
        </div>
        <p style="font-size: 12px; color: #999; text-align: center;">
          Paiement sécurisé via SumUp · Carte bancaire, Apple Pay, Google Pay acceptés
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 11px; color: #aaa; text-align: center;">
          Verviers Dépannage SA · Lefin 12, 4860 Pepinster · TVA BE0460.759.205
        </p>
      </div>
    </div>
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
          subject: `Paiement ${data.reference} — ${formatEur(data.amount)}`,
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
