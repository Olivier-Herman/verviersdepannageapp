import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createCheckout, sendPaymentEmail, getCheckoutStatus } from '@/lib/sumup'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const { amount, reference, description, clientEmail, clientName, mode } = body

  if (!amount || !reference) {
    return NextResponse.json({ error: 'amount et reference requis' }, { status: 400 })
  }

  try {
    const { id, checkoutUrl } = await createCheckout({
      amount: parseFloat(amount),
      reference,
      description: description || `Intervention ${reference}`,
    })

    if (mode === 'email') {
      if (!clientEmail) return NextResponse.json({ error: 'Email client requis' }, { status: 400 })
      await sendPaymentEmail({
        clientEmail,
        clientName: clientName || 'Client',
        checkoutUrl,
        amount: parseFloat(amount),
        reference,
        description: description || `Intervention ${reference}`,
      })
    }

    return NextResponse.json({
      checkoutId: id,
      checkoutUrl,
      qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(checkoutUrl)}`,
      terminalDeepLink: `sumupmerchant://pay?affiliate-key=${process.env.SUMUP_AFFILIATE_KEY}&amount=${amount}&currency=EUR&title=${encodeURIComponent(reference)}`,
    })

  } catch (err: any) {
    console.error('[SumUp]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const checkoutId = req.nextUrl.searchParams.get('checkoutId')
  const interventionId = req.nextUrl.searchParams.get('interventionId')
  if (!checkoutId) return NextResponse.json({ error: 'checkoutId requis' }, { status: 400 })

  try {
    const status = await getCheckoutStatus(checkoutId)
    if (status.status === 'PAID' && interventionId) {
      const supabase = createAdminClient()
      await supabase.from('interventions').update({
        payment_status: 'paid',
        payment_transaction_id: status.transactionId,
      }).eq('id', interventionId)
    }
    return NextResponse.json(status)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
