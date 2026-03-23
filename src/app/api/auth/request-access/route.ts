import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
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

async function notifyAdmin(name: string, email: string, method: string) {
  try {
    const token = await getAppToken()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    await fetch(`https://graph.microsoft.com/v1.0/users/administration@verviersdepannage.com/sendMail`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: `Nouvelle demande d'accès — ${name}`,
          body: {
            contentType: 'HTML',
            content: `
              <p>Une nouvelle demande d'accès a été reçue :</p>
              <table style="border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:4px 12px 4px 0;color:#666">Nom</td><td style="font-weight:bold">${name}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${email}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#666">Méthode</td><td>${method}</td></tr>
              </table>
              <p><a href="${appUrl}/admin/users" style="background:#CC2222;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Gérer les utilisateurs →</a></p>
            `
          },
          toRecipients: [{ emailAddress: { address: 'administration@verviersdepannage.com' } }],
        },
        saveToSentItems: true,
      })
    })
  } catch (err: any) {
    console.error('[RequestAccess] Email error:', err.message)
  }
}

export async function POST(req: NextRequest) {
  const { email, name } = await req.json()
  if (!email || !name) return NextResponse.json({ error: 'Email et nom requis' }, { status: 400 })

  const supabase = createAdminClient()

  // Vérifier si l'email existe déjà
  const { data: existing } = await supabase.from('users')
    .select('id, active').ilike('email', email).maybeSingle()

  if (existing) {
    if (existing.active) return NextResponse.json({ error: 'Un compte existe déjà avec cet email' }, { status: 409 })
    // Compte inactif existant → juste notifier
    await notifyAdmin(name, email, 'Email & mot de passe')
    return NextResponse.json({ success: true })
  }

  // Créer le compte inactif
  const hash = await bcrypt.hash('!Verviers4800', 10)
  const { error } = await supabase.from('users').insert({
    email: email.toLowerCase(),
    name,
    role: 'driver',
    active: false,
    auth_provider: 'email_password',
    password_hash: hash,
    must_change_password: true,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await notifyAdmin(name, email, 'Email & mot de passe')
  return NextResponse.json({ success: true })
}
