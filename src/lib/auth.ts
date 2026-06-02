import CredentialsProvider from 'next-auth/providers/credentials'
import AzureADProvider     from 'next-auth/providers/azure-ad'
import GoogleProvider      from 'next-auth/providers/google'
import AppleProvider       from 'next-auth/providers/apple'
import { createAdminClient }             from '@/lib/supabase'
import { sendAccessRequestNotification } from '@/lib/emails'
import type { NextAuthOptions }          from 'next-auth'
import bcrypt                            from 'bcryptjs'
import jwt                               from 'jsonwebtoken'

/**
 * Apple Sign In : NextAuth Apple provider attend un clientSecret en JWT signe
 * (ES256, valable max 6 mois). On le genere au load du module a partir des
 * env vars APPLE_TEAM_ID + APPLE_KEY_ID + APPLE_PRIVATE_KEY (.p8 content).
 * Si une env var manque, on retourne string vide → le provider sera desactive.
 */
function buildAppleClientSecret(): string {
  const teamId     = process.env.APPLE_TEAM_ID
  const clientId   = process.env.APPLE_ID  // = Service ID (com.verviersdepannage.app.signinwithapple)
  const keyId      = process.env.APPLE_KEY_ID
  let   privateKey = process.env.APPLE_PRIVATE_KEY
  if (!teamId || !clientId || !keyId || !privateKey) return ''
  // Vercel UI peut echapper les sauts de ligne en \n litteraux → on les remet en vrais sauts
  if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n')
  try {
    return jwt.sign({}, privateKey, {
      algorithm: 'ES256',
      keyid:     keyId,
      issuer:    teamId,
      audience:  'https://appleid.apple.com',
      subject:   clientId,
      expiresIn: '180d',  // Apple accepte jusqu a 6 mois
    })
  } catch (e: any) {
    console.error('[Apple Sign In] JWT generation failed:', e.message)
    return ''
  }
}
const APPLE_CLIENT_SECRET = buildAppleClientSecret()

/** Mapping NextAuth account.provider → notre nomenclature DB user_auth_providers.provider */
function normalizeProvider(p: string | undefined): 'apple' | 'google' | 'azure-ad' | 'credentials' | null {
  if (p === 'apple') return 'apple'
  if (p === 'google') return 'google'
  if (p === 'azure-ad') return 'azure-ad'
  if (p === 'credentials') return 'credentials'
  return null
}

/** Enregistre/upsert le lien provider → user dans user_auth_providers (idempotent). */
async function upsertAuthProviderLink(
  userId: string,
  provider: 'apple' | 'google' | 'azure-ad' | 'credentials',
  providerAccountId: string,
  providerEmail: string | null | undefined,
) {
  const sb = createAdminClient()
  const { error } = await sb.from('user_auth_providers').upsert(
    {
      user_id:             userId,
      provider,
      provider_account_id: providerAccountId,
      provider_email:      providerEmail || null,
    },
    { onConflict: 'provider,provider_account_id' }
  )
  if (error) {
    console.error('[upsertAuthProviderLink] FAILED', { userId, provider, providerAccountId, error: error.message })
  }
}

/** Lookup d un user existant via la table user_auth_providers (multi-provider). */
async function findUserByProviderAccount(
  provider: 'apple' | 'google' | 'azure-ad',
  providerAccountId: string,
): Promise<string | null> {
  const sb = createAdminClient()
  const { data } = await sb
    .from('user_auth_providers')
    .select('user_id')
    .eq('provider', provider)
    .eq('provider_account_id', providerAccountId)
    .maybeSingle()
  return data?.user_id || null
}

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
  if (!res.ok) throw new Error(`Token error`)
  return data.access_token
}

async function loadModules(userId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('user_modules').select('module_id').eq('user_id', userId).eq('granted', true)
  return (data || []).map(m => m.module_id)
}

async function loadOdooAccess(userId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users').select('has_odoo_access').eq('id', userId).maybeSingle()
  return !!data?.has_odoo_access
}

async function loadNavOrder(userId: string): Promise<string[] | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('users').select('nav_order').eq('id', userId).maybeSingle()
  return Array.isArray(data?.nav_order) ? data!.nav_order as string[] : null
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id:   'credentials',
      name: 'Email & mot de passe',
      credentials: {
        email:    { label: 'Email',         type: 'email'    },
        password: { label: 'Mot de passe',  type: 'password' },
        // Olivier 2026-06-02 : magic token pour l activation d un compte garage
        // (email de bienvenue). Quand fourni, on bypasse le check mdp et on
        // valide le HMAC du token. Cf [[project-espace-client-garages]].
        magicToken: { label: 'Magic Token', type: 'text'     },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null
        const supabase = createAdminClient()

        const { data: user } = await supabase.from('users')
          .select('id, email, name, role, roles, active, password_hash, must_change_password, avatar_url, auth_provider, has_odoo_access')
          .ilike('email', credentials.email)
          .maybeSingle()

        if (!user || !user.active) return null

        // ── Mode magic token (activation garage) ───────────────────────
        if (credentials.magicToken) {
          try {
            const decoded   = Buffer.from(credentials.magicToken, 'base64url').toString('utf8')
            const [userId, expiresStr, sig] = decoded.split(':')
            const expires   = Number(expiresStr)
            if (!userId || !expires || !sig) return null
            if (userId !== user.id)         return null
            if (Date.now() / 1000 > expires) return null  // expire
            const secret   = process.env.NEXTAUTH_SECRET || 'dev-secret-change-me'
            const expected = require('crypto').createHmac('sha256', secret)
              .update(`${userId}:${expires}`).digest('hex').slice(0, 32)
            if (expected !== sig) return null  // signature invalide

            await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)
            await upsertAuthProviderLink(user.id, 'credentials', user.email.toLowerCase(), user.email.toLowerCase())

            return {
              id:                  user.id,
              email:               user.email,
              name:                user.name,
              role:                user.role,
              roles:               user.roles || [user.role],
              mustChangePassword:  user.must_change_password,
              image:               user.avatar_url,
              hasOdooAccess:       !!user.has_odoo_access,
            }
          } catch {
            return null
          }
        }

        // ── Mode mot de passe standard ─────────────────────────────────
        if (!credentials?.password) return null

        if (user.auth_provider !== 'email_password') {
          throw new Error(`WRONG_PROVIDER:${user.auth_provider}`)
        }

        if (!user.password_hash) return null
        const valid = await bcrypt.compare(credentials.password, user.password_hash)
        if (!valid) return null

        await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id)

        // Persiste le lien credentials dans user_auth_providers (idempotent)
        await upsertAuthProviderLink(user.id, 'credentials', user.email.toLowerCase(), user.email.toLowerCase())

        return {
          id:                  user.id,
          email:               user.email,
          name:                user.name,
          role:                user.role,
          roles:               user.roles || [user.role],
          mustChangePassword:  user.must_change_password,
          image:               user.avatar_url,
          hasOdooAccess:       !!user.has_odoo_access,
        }
      }
    }),

    AzureADProvider({
      clientId:     process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId:     process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: 'openid profile email offline_access User.Read' } }
    }),

    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // Sign in with Apple — clientSecret = JWT ES256 pre-signe (voir buildAppleClientSecret).
    // Apple ne renvoie l email QUE la 1ere connexion, donc on memorise l identite
    // via le subject (sub) stocke dans user_auth_providers.provider_account_id.
    AppleProvider({
      clientId:     process.env.APPLE_ID!,  // Service ID
      clientSecret: APPLE_CLIENT_SECRET,    // JWT signe ES256
      authorization: { params: { scope: 'name email', response_mode: 'form_post' } },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'credentials') return true

      const normProvider = normalizeProvider(account?.provider)
      if (!normProvider || normProvider === 'credentials') return false

      // ID stable du compte cote provider (ex: sub OAuth) - prioritaire sur email
      // car l email peut changer ou etre anonymise (Apple Hide My Email).
      const providerAccountId = (account?.providerAccountId || user.id || user.email || '').toLowerCase()
      const email             = (user.email || '').toLowerCase()
      const supabase          = createAdminClient()

      // ── Mode LINKING : l user est deja connecte et veut lier un provider OAuth ──
      // Le cookie vd_linking_user_id contient l id de l user connecte (pose par
      // /api/profile/auth-providers/start-link). Si present, on ne fait QUE le link.
      try {
        const { cookies } = await import('next/headers')
        const linkingUserId = cookies().get('vd_linking_user_id')?.value
        if (linkingUserId) {
          // Verifier que ce provider_account_id n est pas deja lie a un AUTRE user
          const conflict = await findUserByProviderAccount(normProvider, providerAccountId)
          if (conflict && conflict !== linkingUserId) {
            // Ce provider est deja lie a un autre compte → refus
            cookies().delete('vd_linking_user_id')
            return '/profil?error=PROVIDER_ALREADY_LINKED_OTHER_USER'
          }
          await upsertAuthProviderLink(linkingUserId, normProvider, providerAccountId, email)
          cookies().delete('vd_linking_user_id')
          // IMPORTANT : return d une URL au lieu de `true`.
          // Avec `true`, NextAuth cree une nouvelle session pour l user Apple
          // (different de l user Microsoft connecte) et ecrase la session
          // existante → user deconnecte, redirige sur /login.
          // En retournant une URL, NextAuth redirige sans creer de session :
          // la session Microsoft d origine reste intacte, le lien est persiste.
          return `/profil?linked=${normProvider}`
        }
      } catch (e: any) {
        console.error('[Auth] Linking mode error:', e.message)
      }

      // ── Lookup 1 : par (provider, providerAccountId) ─────────────────────
      // Si l user s est deja connecte avec ce provider, on retrouve son user_id direct.
      let dbUserId = await findUserByProviderAccount(normProvider, providerAccountId)

      // ── Lookup 2 : par email (linking auto si le user existe deja avec un autre provider) ──
      if (!dbUserId && email) {
        const { data: byEmail } = await supabase.from('users')
          .select('id').ilike('email', email).maybeSingle()
        if (byEmail) dbUserId = byEmail.id
      }

      // ── Cas A : nouveau user (aucun lookup n a fonctionne) ─────────────────
      if (!dbUserId) {
        if (!email) return false
        const legacyProvider =
          normProvider === 'google'   ? 'google'    :
          normProvider === 'azure-ad' ? 'microsoft' :
          normProvider === 'apple'    ? 'apple'     : 'unknown'
        const { data: created } = await supabase.from('users').insert({
          email:                email,
          name:                 user.name || email,
          avatar_url:           user.image,
          role:                 'driver',
          roles:                ['driver'],
          active:               false,
          auth_provider:        legacyProvider,
          must_change_password: false,
        }).select('id').single()

        if (!created) return false
        dbUserId = created.id

        await upsertAuthProviderLink(dbUserId!, normProvider, providerAccountId, email)

        try {
          await sendAccessRequestNotification({ name: user.name || email, email, provider: legacyProvider as any })
        } catch (e) { console.error('[Auth] Notify error:', e) }

        ;(user as any).dbId   = null
        ;(user as any).role   = 'driver'
        ;(user as any).roles  = ['driver']
        ;(user as any).mustChangePassword = false
        ;(user as any).pending = true
        return true
      }

      // ── Cas B : user existant - on lie (ou re-lie) le provider courant ────
      // Auto-linking : pas de restriction WRONG_PROVIDER. L user peut se connecter
      // avec n importe lequel des providers lies a son compte (multi-provider).
      await upsertAuthProviderLink(dbUserId!, normProvider, providerAccountId, email)

      const { data: dbUser } = await supabase.from('users')
        .select('id, role, roles, active, must_change_password, has_odoo_access')
        .eq('id', dbUserId)
        .maybeSingle()

      if (!dbUser) return false

      if (!dbUser.active) {
        ;(user as any).dbId    = dbUser.id
        ;(user as any).role    = dbUser.role
        ;(user as any).roles   = dbUser.roles || [dbUser.role]
        ;(user as any).pending = true
        return true
      }

      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', dbUser.id)

      ;(user as any).dbId               = dbUser.id
      ;(user as any).role               = dbUser.role
      ;(user as any).roles              = dbUser.roles || [dbUser.role]
      ;(user as any).mustChangePassword = dbUser.must_change_password || false
      ;(user as any).hasOdooAccess      = !!dbUser.has_odoo_access
      return true
    },

    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === 'credentials') {
          token.id    = user.id
          token.role  = (user as any).role
          token.roles = (user as any).roles || [(user as any).role]
          token.mustChangePassword = (user as any).mustChangePassword
          token.pending = false
          token.hasOdooAccess = !!(user as any).hasOdooAccess
        } else {
          token.id    = (user as any).dbId
          token.role  = (user as any).role
          token.roles = (user as any).roles || [(user as any).role]
          token.mustChangePassword = (user as any).mustChangePassword || false
          token.pending = (user as any).pending || false
          token.hasOdooAccess = !!(user as any).hasOdooAccess
        }
        if (token.id) token.modules = await loadModules(token.id as string)
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        ;(session.user as any).id                = token.id
        ;(session.user as any).role              = token.role
        ;(session.user as any).roles             = token.roles || [token.role]
        ;(session.user as any).mustChangePassword= token.mustChangePassword
        ;(session.user as any).pending           = token.pending

        // Refresh modules + acces Odoo a chaque session check (sinon le JWT
        // garde l'etat du login, et un toggle admin necessiterait une
        // reconnexion). Cout : 2 queries Supabase par render — negligeable.
        if (token.id) {
          try {
            const supabase = createAdminClient()
            // Force name/email/avatar depuis DB (sinon login Apple ecrase avec
            // user.name="Utilisateur" et email="xxx@privaterelay.appleid.com")
            const [fresh, odooAccess, navOrder, dbUser] = await Promise.all([
              loadModules(token.id as string),
              loadOdooAccess(token.id as string),
              loadNavOrder(token.id as string),
              supabase.from('users').select('name, email, avatar_url, audio_mode, language, must_change_password, force_native_app').eq('id', token.id).maybeSingle(),
            ])
            ;(session.user as any).modules        = fresh
            ;(session.user as any).hasOdooAccess  = odooAccess
            ;(session.user as any).navOrder       = navOrder
            if (dbUser.data) {
              session.user.name  = dbUser.data.name || session.user.name
              session.user.email = dbUser.data.email || session.user.email
              session.user.image = dbUser.data.avatar_url || session.user.image
              ;(session.user as any).audioMode = !!dbUser.data.audio_mode
              ;(session.user as any).language  = dbUser.data.language || 'fr'
              // Olivier 2026-06-02 : re-fetch must_change_password depuis BDD
              // (sinon le JWT garde l ancienne valeur et le middleware
              // continue de rediriger vers /set-password apres update).
              ;(session.user as any).mustChangePassword = !!dbUser.data.must_change_password
              token.mustChangePassword = !!dbUser.data.must_change_password
              // Olivier 2026-06-02 : flag PwaNativeGuard
              ;(session.user as any).forceNativeApp = !!(dbUser.data as any).force_native_app
            } else {
              ;(session.user as any).audioMode = false
              ;(session.user as any).language  = 'fr'
            }
          } catch {
            ;(session.user as any).modules        = token.modules || []
            ;(session.user as any).hasOdooAccess  = !!token.hasOdooAccess
            ;(session.user as any).navOrder       = null
            ;(session.user as any).audioMode      = false
            ;(session.user as any).language       = 'fr'
          }
        } else {
          ;(session.user as any).modules        = token.modules || []
          ;(session.user as any).hasOdooAccess  = !!token.hasOdooAccess
          ;(session.user as any).navOrder       = null
          ;(session.user as any).audioMode      = false
          ;(session.user as any).language       = 'fr'
        }
      }
      return session
    },
  },

  pages:   { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },

  // Apple Sign In utilise response_mode=form_post qui POST cross-site sur le
  // callback. Les cookies PKCE et state NextAuth par defaut sont en SameSite=Lax
  // donc NON envoyes sur un POST cross-site → erreur "PKCE code_verifier cookie
  // was missing" cote serveur. On override ces 2 cookies en SameSite=None.
  // (Microsoft / Google utilisent query mode, donc SameSite=Lax suffit pour eux
  // - mais SameSite=None marche aussi, plus permissif sans risque.)
  cookies: {
    pkceCodeVerifier: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.pkce.code_verifier'
        : 'next-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'none',
        path:     '/',
        secure:   true,
      },
    },
    state: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.state'
        : 'next-auth.state',
      options: {
        httpOnly: true,
        sameSite: 'none',
        path:     '/',
        secure:   true,
      },
    },
    nonce: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.nonce'
        : 'next-auth.nonce',
      options: {
        httpOnly: true,
        sameSite: 'none',
        path:     '/',
        secure:   true,
      },
    },
  },
}

// ── Helpers de vérification de rôle ───────────────────────
/** Vérifie si un utilisateur a l'un des rôles donnés (primary ou multi-rôle) */
export function hasRole(user: any, ...checkRoles: string[]): boolean {
  const roles: string[] = user?.roles || (user?.role ? [user.role] : [])
  return checkRoles.some(r => roles.includes(r))
}

export function isAdmin(user: any): boolean {
  return hasRole(user, 'admin', 'superadmin')
}

export function isAdminOrDispatcher(user: any): boolean {
  return hasRole(user, 'admin', 'superadmin', 'dispatcher')
}
