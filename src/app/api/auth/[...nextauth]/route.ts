// ============================================================
// VERVIERS DÉPANNAGE — NextAuth config (Azure AD)
// ============================================================

import NextAuth, { type NextAuthOptions } from 'next-auth'
import AzureADProvider from 'next-auth/providers/azure-ad'
import { createAdminClient } from '@/lib/supabase'

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: {
        params: {
          scope: 'openid profile email User.Read'
        }
      }
    })
  ],

  callbacks: {
    // Au login : synchroniser l'utilisateur dans Supabase + charger ses modules
    async signIn({ user, account, profile }) {
      if (!user.email) return false

      const supabase = createAdminClient()
      const azureId = profile?.sub || account?.providerAccountId

      // Chercher d'abord par email (évite les doublons)
      const { data: existing } = await supabase
        .from('users')
        .select('id, role, active, azure_id')
        .eq('email', user.email)
        .single()

      if (existing) {
        // Mettre à jour l'azure_id si pas encore renseigné
        await supabase
          .from('users')
          .update({
            azure_id: existing.azure_id || azureId,
            name: user.name,
            avatar_url: user.image,
            last_login: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (!existing.active) return false
        return true
      }

      // Nouveau compte — créer avec rôle driver par défaut
      const { error } = await supabase
        .from('users')
        .insert({
          azure_id: azureId,
          email: user.email,
          name: user.name,
          avatar_url: user.image,
          role: 'driver',
          last_login: new Date().toISOString()
        })

      if (error) {
        console.error('Supabase insert error:', error)
        return false
      }

      return true
    },

    // Enrichir le JWT avec les infos Supabase
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const supabase = createAdminClient()
        const azureId = profile.sub || account.providerAccountId

        const { data: dbUser } = await supabase
          .from('users')
          .select(`id, role, active, azure_id, user_modules (module_id, granted)`)
          .or(`azure_id.eq.${azureId},email.eq.${token.email}`)
          .single()

        if (dbUser) {
          token.userId = dbUser.id
          token.role = dbUser.role
          token.azureId = azureId
          token.modules = (dbUser.user_modules as any[])
            ?.filter(m => m.granted)
            .map(m => m.module_id) || []
        }
      }
      return token
    },

    // Exposer les infos dans la session côté client
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

  pages: {
    signIn: '/login',
    error: '/login'
  },

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60  // 8 heures (journée de travail)
  }
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
