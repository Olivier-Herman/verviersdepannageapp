import CredentialsProvider from 'next-auth/providers/credentials'
import AzureADProvider from 'next-auth/providers/azure-ad'
import GoogleProvider from 'next-auth/providers/google'
import { createAdminClient } from '@/lib/supabase'
import type { NextAuthOptions } from 'next-auth'
import bcrypt from 'bcryptjs'

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

      if (!dbUser) {
        console.log(`[Auth] User not found for OAuth: ${email}`)
        return false
      }
      if (!dbUser.active) return false

      // Vérifier que le provider correspond à la méthode configurée
      const expectedProvider = dbUser.auth_provider
      const actualProvider = account?.provider // 'google' ou 'azure-ad'

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
        } else {
          token.id = (user as any).dbId
          token.role = (user as any).role
          token.mustChangePassword = (user as any).mustChangePassword || false
        }
        token.modules = await loadModules(token.id as string)
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        ;(session.user as any).id = token.id
        ;(session.user as any).role = token.role
        ;(session.user as any).modules = token.modules
        ;(session.user as any).mustChangePassword = token.mustChangePassword
      }
      return session
    },
  },

  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
}
