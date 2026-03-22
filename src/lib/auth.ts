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
        params: { scope: 'openid profile email offline_access User.Read Mail.Send' }
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
        .eq('email', user.email?.toLowerCase())
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

    async jwt({ token, account }) {
      // Première connexion — stocker les tokens
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.accessTokenExpires = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000

        const supabase = createAdminClient()
        const { data: dbUser } = await supabase
          .from('users')
          .select(`id, role, active, user_modules!user_modules_user_id_fkey (module_id, granted)`)
          .eq('email', token.email?.toLowerCase())
          .single()

        if (dbUser) {
          token.userId = dbUser.id
          token.role = dbUser.role
          token.modules = (dbUser.user_modules as any[])
            ?.filter(m => m.granted).map(m => m.module_id) || []
        }
        return token
      }

      // Pas encore d'expiration connue → ok
      if (!token.accessTokenExpires) return token

      // Token encore valide → retourner tel quel
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token
      }

      // Token expiré + pas de refresh token → retourner tel quel (session valide, juste pas de Graph)
      if (!token.refreshToken) return token

      // Token expiré → rafraîchir via Azure AD
      try {
        const res = await fetch(
          `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: process.env.AZURE_AD_CLIENT_ID!,
              client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
              grant_type: 'refresh_token',
              refresh_token: token.refreshToken as string,
              scope: 'openid profile email offline_access User.Read Mail.Send',
            })
          }
        )
        const refreshed = await res.json()
        if (!res.ok) throw refreshed
        return {
          ...token,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
          accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
        }
      } catch (err) {
        console.error('[Token refresh error]', err)
        // Ne pas invalider la session — juste retourner le token sans Graph
        return { ...token, accessToken: undefined }
      }
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.userId as string
        session.user.role = token.role as string
        session.user.azureId = token.azureId as string
        session.user.modules = token.modules as string[]
        ;(session as any).accessToken = token.accessToken
      }
      return session
    }
  },

  pages: { signIn: '/login', error: '/login' },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
}
