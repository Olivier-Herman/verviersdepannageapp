import AzureADProvider from 'next-auth/providers/azure-ad'
import { createAdminClient } from '@/lib/supabase'
import type { NextAuthOptions } from 'next-auth'

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: {
        params: { scope: 'openid profile email User.Read' }
      }
    })
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.email) return false
      const supabase = createAdminClient()
      const azureId = profile?.sub || account?.providerAccountId

      const { data: existing } = await supabase
        .from('users')
        .select('id, role, active, azure_id')
        .eq('email', user.email)
        .single()

      if (existing) {
        await supabase.from('users').update({
          azure_id: existing.azure_id || azureId,
          name: user.name,
          avatar_url: user.image,
          last_login: new Date().toISOString()
        }).eq('id', existing.id)
        if (!existing.active) return false
        return true
      }

      const { error } = await supabase.from('users').insert({
        azure_id: azureId,
        email: user.email,
        name: user.name,
        avatar_url: user.image,
        role: 'driver',
        last_login: new Date().toISOString()
      })
      if (error) { console.error('Supabase insert error:', error); return false }
      return true
    },

    async jwt({ token, account, profile }) {
      if (account && profile) {
        const supabase = createAdminClient()
        const { data: dbUser } = await supabase
          .from('users')
          .select(`id, role, active, user_modules!user_modules_user_id_fkey (module_id, granted)`)
          .eq('email', token.email)
          .single()

        if (dbUser) {
          token.userId = dbUser.id
          token.role = dbUser.role
          token.modules = (dbUser.user_modules as any[])
            ?.filter(m => m.granted).map(m => m.module_id) || []
        }
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.userId as string
        session.user.role = token.role as string
        session.user.azureId = token.azureId as string
        session.user.modules = token.modules as string[]
      }
      return session
    }
  },

  pages: { signIn: '/login', error: '/login' },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,    // expire après 7 jours
    updateAge: 24 * 60 * 60,      // renouvelle le token si utilisé dans les 24h
  },

  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60
      }
    }
  }
}
