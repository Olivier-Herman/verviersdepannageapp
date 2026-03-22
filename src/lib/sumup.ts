// ============================================================
// VERVIERS DÉPANNAGE — SumUp Integration
// ============================================================

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
  reference: string       // ex: VD-2026-000005
  description: string     // ex: "Intervention Peugeot 1ADK440"
  returnUrl?: string
}): Promise<{ id: string; checkoutUrl: string }> {

  const res = await fetch('https://api.sumup.com/v0.1/checkouts', {
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
      return_url: data.returnUrl || `${APP_URL}/encaissement/payment-callback`,
    })
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(`SumUp checkout error: ${JSON.stringify(err)}`)
  }

  const checkout: SumUpCheckout = await res.json()

  return {
    id: checkout.id,
    checkoutUrl: `https://pay.sumup.com/b2c/pay/${checkout.id}`,
  }
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
// Envoyer le lien de paiement par email via Microsoft Graph
// ============================================================
export async function sendPaymentEmail(data: {
  clientEmail: string
  clientName: string
  checkoutUrl: string
  amount: number
  reference: string
  description: string
  accessToken: string  // token Azure AD de l'utilisateur connecté
}): Promise<void> {

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
          <p style="font-size: 36px; font-weight: bold; color: #CC2222; margin: 10px 0;">${data.amount.toFixed(2)} €</p>
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

  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${data.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: `Paiement ${data.reference} — ${data.amount.toFixed(2)} €`,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: data.clientEmail, name: data.clientName || 'Client' } }],
      },
      saveToSentItems: true,
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Microsoft Graph email error: ${err}`)
  }
}
