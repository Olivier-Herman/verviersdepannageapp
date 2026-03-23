import CredentialsProvider from 'next-auth/providers/credentials'
import AzureADProvider from 'next-auth/providers/azure-ad'
import GoogleProvider from 'next-auth/providers/google'
import { createAdminClient } from '@/lib/supabase'
import type { NextAuthOptions } from 'next-auth'
import bcrypt from 'bcryptjs'

async function findOrCreateUser(email: string, name: string, provider: string, providerId: string, avatar?: string) {
  const supabase = createAdminClient()

  // 1. Chercher par email professionnel (M365/tenant)
  if (provider === 'azure-ad') {
    const { data: user } = await supabase.from('users')
      .select('id, role, active, must_change_password')
      .ilike('email', email)
      .maybeSingle()

    if (user) {
      if (!user.active) return null
      await supabase.from('users').update({
        azure_id: providerId, name, avatar_url: avatar, last_login: new Date().toISOString()
      }).eq('id', user.id)
      return user
    }

    // Nouveau user M365 → créer automatiquement
    const { data: newUser } = await supabase.from('users').insert({
      email: email.toLowerCase(), name, azure_id: providerId,
      avatar_url: avatar, role: 'driver', active: true,
      must_change_password: false, last_login: new Date().toISOString()
    }).select('id, role, active, must_change_password').single()
    return newUser
  }

  // 2. Google ou Microsoft personnel → chercher par personal_email
  const { data: user } = await supabase.from('users')
    .select('id, role, active, must_change_password')
    .ilike('personal_email', email)
    .maybeSingle()

  if (!user) {
    console.log(`[Auth] Personal email not registered: ${email}`)
    return null // Email personnel non enregistré par l'admin
  }
  if (!user.active) return null

  await supabase.from('users').update({
    last_login: new Date().toISOString()
  }).eq('id', user.id)

  return user
}

async function loadModules(userId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('user_modules')
    .select('module_id, granted')
    .eq('user_id', userId)
    .eq('granted', true)
  return (data || []).map(m => m.module_id)
}

export const authOptions: NextAuthOptions = {
  providers: [
    // Provider 1 — Email + mot de passe
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
          .select('id, email, name, role, active, password_hash, must_change_password, avatar_url')
          .ilike('email', credentials.email)
          .maybeSingle()

        if (!user || !user.active || !user.password_hash) return null

        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) return null

        await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)

        return {
          id: user.id, email: user.email, name: user.name,
          role: user.role, mustChangePassword: user.must_change_password, image: user.avatar_url,
        }
      }
    }),

    // Provider 2 — Microsoft M365 (tenant VD — pour responsables)
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: 'openid profile email offline_access User.Read' } }
    }),

    // Provider 3 — Microsoft personnel (Hotmail/Outlook)
    AzureADProvider({
      id: 'azure-personal',
      name: 'Microsoft personnel',
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: 'common',
      authorization: { params: { scope: 'openid profile email' } }
    }),

    // Provider 4 — Google
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'credentials') return true // Géré dans authorize()

      const email = user.email
      if (!email) return false

      try {
        const dbUser = await findOrCreateUser(
          email,
          user.name || email,
          account?.provider || '',
          account?.providerAccountId || '',
          user.image || undefined
        )
        if (!dbUser) return false
        ;(user as any).dbId = dbUser.id
        ;(user as any).role = dbUser.role
        ;(user as any).mustChangePassword = dbUser.must_change_password
        return true
      } catch (err: any) {
        console.error('[Auth] signIn error:', err.message)
        return false
      }
    },

    async jwt({ token, user, account }) {
      if (user) {
        // Première connexion
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

  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
}
