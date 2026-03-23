import CredentialsProvider from 'next-auth/providers/credentials'
import AzureADProvider from 'next-auth/providers/azure-ad'
import GoogleProvider from 'next-auth/providers/google'
import { createAdminClient } from '@/lib/supabase'
import { sendAccessRequestNotification } from '@/lib/emails'
import type { NextAuthOptions } from 'next-auth'
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
  if (!res.ok) throw new Error(`Token error`)
  return data.access_token
}

async function loadModules(userId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('user_modules').select('module_id').eq('user_id', userId).eq('granted', true)
  return (data || []).map(m => m.module_id)
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & mot de passe',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const supabase = createAdminClient()

        const { data: user } = await supabase.from('users')
          .select('id, email, name, role, active, password_hash, must_change_password, avatar_url, auth_provider')
          .ilike('email', credentials.email)
          .maybeSingle()

        if (!user || !user.active) return null

        // Vérifier que la méthode de connexion est correcte
        if (user.auth_provider !== 'email_password') {
          const labels: Record<string, string> = { google: 'Google', microsoft: 'Microsoft professionnel' }
          console.log(`[Auth] Wrong provider for ${user.email}: expected ${user.auth_provider}`)
          throw new Error(`WRONG_PROVIDER:${user.auth_provider}`)
        }

        if (!user.password_hash) return null
        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) return null

        await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)

        return {
          id: user.id, email: user.email, name: user.name,
          role: user.role, mustChangePassword: user.must_change_password, image: user.avatar_url,
        }
      }
    }),

    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: 'openid profile email offline_access User.Read' } }
    }),

    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true

      const email = user.email
      if (!email) return false

      const supabase = createAdminClient()
      const { data: dbUser } = await supabase.from('users')
        .select('id, role, active, must_change_password, auth_provider')
        .ilike('email', email)
        .maybeSingle()

      // User inconnu → créer compte inactif et rediriger vers pending
      if (!dbUser) {
        const provider = account?.provider === 'google' ? 'google' : 'microsoft'
        await supabase.from('users').insert({
          email: email.toLowerCase(),
          name: user.name || email,
          avatar_url: user.image,
          role: 'driver',
          active: false,
          auth_provider: provider,
          must_change_password: false,
        })

        // Notifier l'admin
        try {
          await sendAccessRequestNotification({ name: user.name || email, email, provider })
        } catch (e) { console.error('[Auth] Notify error:', e) }

        // Permettre la connexion mais rediriger vers pending
        ;(user as any).dbId = null
        ;(user as any).role = 'driver'
        ;(user as any).mustChangePassword = false
        ;(user as any).pending = true
        return true
      }

      // User connu mais inactif → rediriger vers pending
      if (!dbUser.active) {
        ;(user as any).dbId = dbUser.id
        ;(user as any).role = dbUser.role
        ;(user as any).pending = true
        return true
      }

      // Vérifier que le provider correspond
      const expectedProvider = dbUser.auth_provider
      const actualProvider = account?.provider
      if (expectedProvider === 'google' && actualProvider !== 'google') return '/login?error=WRONG_PROVIDER_MICROSOFT'
      if (expectedProvider === 'microsoft' && actualProvider !== 'azure-ad') return '/login?error=WRONG_PROVIDER_GOOGLE'
      if (expectedProvider === 'email_password') return '/login?error=WRONG_PROVIDER_EMAIL'

      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', dbUser.id)

      ;(user as any).dbId = dbUser.id
      ;(user as any).role = dbUser.role
      ;(user as any).mustChangePassword = dbUser.must_change_password || false
      return true
    },

    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === 'credentials') {
          token.id = user.id
          token.role = (user as any).role
          token.mustChangePassword = (user as any).mustChangePassword
          token.pending = false
        } else {
          token.id = (user as any).dbId
          token.role = (user as any).role
          token.mustChangePassword = (user as any).mustChangePassword || false
          token.pending = (user as any).pending || false
        }
        if (token.id) token.modules = await loadModules(token.id as string)
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        ;(session.user as any).id = token.id
        ;(session.user as any).role = token.role
        ;(session.user as any).modules = token.modules || []
        ;(session.user as any).mustChangePassword = token.mustChangePassword
        ;(session.user as any).pending = token.pending
      }
      return session
    },
  },

  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
}
