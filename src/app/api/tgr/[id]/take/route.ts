// src/app/api/tgr/[id]/take/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { createAdminClient }         from '@/lib/supabase'
import { sendPushToUser }            from '@/lib/push'

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL!
const FROM_EMAIL = 'administration@verviersdepannage.com'

async function getAppToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type:    'client_credentials',
        scope:         'https://graph.microsoft.com/.default',
      })
    }
  )
  const data = await res.json()
  return data.access_token
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const { token } = await req.json()

  // Vérifier la mission et le token
  const { data: mission } = await supabase
    .from('tgr_missions')
    .select('*, partner:users!partner_id(id, name, email)')
    .eq('id', params.id)
    .eq('take_token', token)
    .single()

  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.status !== 'refused') {
    return NextResponse.json({ error: 'Cette mission a déjà été prise', alreadyTaken: true }, { status: 409 })
  }

  const { data: me } = await supabase
    .from('users').select('id, name, email').eq('email', session.user.email!).single()
  if (!me) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })

  // Marquer comme prise — opération atomique
  const { data: updated, error } = await supabase
    .from('tgr_missions')
    .update({
      status:          'taken',
      taken_by_name:   me.name,
      taken_by_email:  me.email,
      taken_at:        new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('status', 'refused') // condition atomique — évite double prise
    .select().single()

  if (error || !updated) {
    return NextResponse.json({ error: 'Mission déjà prise par un autre partenaire', alreadyTaken: true }, { status: 409 })
  }

  // Push + email au demandeur
  await sendPushToUser(mission.partner.id, {
    title: `🤝 Mission TGR reprise — ${mission.plate}`,
    body:  `${me.name} prend en charge la mission ${mission.reference}. Contactez-le directement.`,
    url:   '/services/tgr',
    tag:   `tgr-taken-${params.id}`,
  }).catch(() => {})

  const token2 = await getAppToken()
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1565c0;padding:20px 30px;border-radius:8px 8px 0 0;">
        <h1 style="color:white;margin:0;font-size:18px;">🤝 Mission reprise par un partenaire</h1>
      </div>
      <div style="background:#1a1a1a;padding:24px 30px;border-radius:0 0 8px 8px;">
        <p style="color:#ccc;font-size:14px;">
          Votre mission <strong style="color:white;">${mission.reference}</strong> a été reprise par
          <strong style="color:white;">${me.name}</strong>.
        </p>
        <p style="color:#ccc;font-size:14px;">
          Veuillez prendre contact directement avec ce partenaire pour coordonner la prise en charge.
        </p>
        <table cellpadding="8" width="100%">
          <tr><td style="color:#888;font-size:13px;">Véhicule</td><td style="color:white;font-size:13px;">${mission.plate} — ${mission.brand} ${mission.model}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Pick-up</td><td style="color:white;font-size:13px;">${mission.pickup_address}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Livraison</td><td style="color:white;font-size:13px;">${mission.delivery_address}</td></tr>
          <tr><td style="color:#888;font-size:13px;">Partenaire</td><td style="color:white;font-size:13px;font-weight:bold;">${me.name}</td></tr>
        </table>
      </div>
    </div>`

  await fetch(`https://graph.microsoft.com/v1.0/users/${FROM_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token2}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: `🤝 Mission TGR reprise — ${mission.reference}`,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: mission.partner.email } }],
        replyTo: [{ emailAddress: { address: me.email } }],
      },
      saveToSentItems: true,
    })
  }).catch(err => console.error('[TGR take email]', err))

  return NextResponse.json({ success: true, takenBy: me.name })
}
