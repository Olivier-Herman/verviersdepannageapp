// scripts/debug-mobi-auth.ts
// Diagnostique l etat des liens auth pour mobi@verviersdepannage.be
// + tout user dont l email pourrait correspondre a un Apple ID.

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // 1. Le user Mobi
  const { data: mobi } = await sb.from('users')
    .select('id, email, auth_provider, active, role, created_at')
    .ilike('email', 'mobi@verviersdepannage.be')
    .maybeSingle()
  console.log('=== USER MOBI ===')
  console.log(mobi)

  if (mobi) {
    const { data: links } = await sb.from('user_auth_providers')
      .select('id, provider, provider_account_id, provider_email, linked_at')
      .eq('user_id', mobi.id)
      .order('linked_at')
    console.log('\n=== LIENS AUTH DE MOBI ===')
    console.table(links)
  }

  // 2. TOUS les liens Apple (peu importe le user)
  const { data: appleLinks } = await sb.from('user_auth_providers')
    .select('id, user_id, provider, provider_account_id, provider_email, linked_at')
    .eq('provider', 'apple')
    .order('linked_at', { ascending: false })
  console.log('\n=== TOUS LES LIENS APPLE EN DB ===')
  console.table(appleLinks)

  // 3. Users recemment crees (potentiels users fantomes Apple)
  const { data: recentUsers } = await sb.from('users')
    .select('id, email, auth_provider, active, role, created_at')
    .order('created_at', { ascending: false })
    .limit(10)
  console.log('\n=== 10 DERNIERS USERS CREES ===')
  console.table(recentUsers)
}

main().catch(e => { console.error(e); process.exit(1) })
