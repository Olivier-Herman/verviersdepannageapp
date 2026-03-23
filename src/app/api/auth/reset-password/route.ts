import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

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

// POST — demander un lien de reset
export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'Email requis' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: user } = await supabase.from('users').select('id, name, personal_email, email, auth_provider').ilike('email', email).maybeSingle()

  // Ne pas révéler si l'email existe ou non
  if (!user) return NextResponse.json({ success: true })
  const resetEmail = user.auth_provider === 'google' && user.personal_email ? user.personal_email : user.email
  if (!resetEmail) return NextResponse.json({ success: true })

  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 3600 * 1000) // 1 heure

  await supabase.from('users').update({
    reset_token: token,
    reset_token_expires_at: expires.toISOString()
  }).eq('id', user.id)

  const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`

  try {
    const appToken = await getAppToken()
    await fetch(`https://graph.microsoft.com/v1.0/users/administration@verviersdepannage.com/sendMail`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${appToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: 'Réinitialisation de votre mot de passe — Verviers Dépannage App',
          body: {
            contentType: 'HTML',
            content: `
              <p>Bonjour ${user.name},</p>
              <p>Une demande de réinitialisation de mot de passe a été effectuée pour votre compte.</p>
              <p><a href="${resetUrl}" style="background:#CC2222;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Réinitialiser mon mot de passe</a></p>
              <p>Ce lien est valable 1 heure. Si vous n'avez pas fait cette demande, ignorez cet email.</p>
              <p>Verviers Dépannage SA</p>
            `
          },
          toRecipients: [{ emailAddress: { address: resetEmail, name: user.name } }],
        },
        saveToSentItems: true,
      })
    })
  } catch (err: any) {
    console.error('[Reset] Email error:', err.message)
  }

  return NextResponse.json({ success: true })
}

// GET — valider le token et changer le mot de passe
export async function PUT(req: NextRequest) {
  const { token, newPassword } = await req.json()
  if (!token || !newPassword) return NextResponse.json({ error: 'Données manquantes' }, { status: 400 })
  if (newPassword.length < 8) return NextResponse.json({ error: 'Mot de passe trop court' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: user } = await supabase.from('users')
    .select('id').eq('reset_token', token)
    .gt('reset_token_expires_at', new Date().toISOString())
    .maybeSingle()

  if (!user) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 400 })

  const hash = await bcrypt.hash(newPassword, 10)
  await supabase.from('users').update({
    password_hash: hash,
    must_change_password: false,
    reset_token: null,
    reset_token_expires_at: null,
  }).eq('id', user.id)

  return NextResponse.json({ success: true })
}
