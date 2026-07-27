// ============================================================
// VERVIERS DÉPANNAGE — Supabase clients
// ============================================================

import { createBrowserClient } from '@supabase/ssr'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Client côté navigateur (composants React)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Client côté serveur (Server Components, API routes)
export function createServerSupabaseClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set(name: string, value: string, options: any) {
          try { cookieStore.set({ name, value, ...options }) } catch {}
        },
        remove(name: string, options: any) {
          try { cookieStore.set({ name, value: '', ...options }) } catch {}
        }
      }
    }
  )
}

// Client admin avec service_role (API routes uniquement — jamais exposé au browser)
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      // IMPORTANT : Next.js patche global fetch et MET EN CACHE les GET (Data
      // Cache). Sans `no-store`, les lectures service_role (app_settings,
      // réglages, règles de facturation auto…) restent FIGÉES sur un ancien
      // état → bugs silencieux (ex. cron auto-facturation lisant des règles
      // périmées). On force donc toutes les requêtes admin à ne jamais cacher.
      global: { fetch: (input: any, init?: any) => fetch(input, { ...init, cache: 'no-store' }) },
    }
  )
}
