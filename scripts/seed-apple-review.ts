// scripts/seed-apple-review.ts
//
// Seed Apple Review : compte demo + 5 missions test, executable via :
//   npx tsx scripts/seed-apple-review.ts
//
// Idempotent : peut etre re-execute sans casser.

import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'

// .env.local prioritaire (Next.js convention), puis .env en fallback
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

const EMAIL    = 'applereview@verviersdepannage.com'
const PASSWORD = '!Verviers4800a'

async function main() {
  console.log('🔧 Seed Apple Review...')

  // 1. Récupérer le user
  const { data: user, error: uErr } = await sb
    .from('users')
    .select('id, email, password_hash')
    .ilike('email', EMAIL)
    .maybeSingle()
  if (uErr) throw uErr
  if (!user) {
    console.error(`❌ User ${EMAIL} introuvable. Crée-le d'abord dans /admin/users.`)
    process.exit(1)
  }
  console.log(`✅ User trouvé : ${user.id}`)

  // 2. Hash bcrypt du mot de passe + set role dispatcher + active
  const hash = await bcrypt.hash(PASSWORD, 12)
  const { error: upErr } = await sb
    .from('users')
    .update({
      password_hash:  hash,
      role:           'dispatcher',
      roles:          ['dispatcher'],
      active:         true,
      auth_provider:  user.password_hash ? undefined : 'email_password',
    })
    .eq('id', user.id)
  if (upErr) throw upErr
  console.log('✅ Password + role dispatcher + active appliqués')

  // 3. Lien credentials dans user_auth_providers (idempotent)
  await sb.from('user_auth_providers').upsert(
    {
      user_id:             user.id,
      provider:            'credentials',
      provider_account_id: EMAIL.toLowerCase(),
      provider_email:      EMAIL.toLowerCase(),
    },
    { onConflict: 'provider,provider_account_id' }
  )
  console.log('✅ Lien credentials dans user_auth_providers')

  // 4. Créer 5 missions démo
  const now    = new Date()
  const isoNow = now.toISOString()
  const iso = (offsetMin: number) => new Date(now.getTime() + offsetMin * 60_000).toISOString()

  // Signature démo (1px transparent PNG en base64 pour avoir un placeholder valide)
  const demoSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAUCAYAAAB7wJiVAAAAAXNSR0IArs4c6QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAGNJREFUSEvtl8EJADAIA9X9d3aLU2gpodK87fwQjzPkmCSdMrJjvCWfqU0SmnLT2WTwGBhDQfBwBoIfBfBYwAU8B+E/zP6BHwsAvAY8AaiBwBjsB4D8B8AcAfwHID8DwH8ARkHwAwI+gn8eUEW5JAAAAABJRU5ErkJggg=='

  const missions = [
    {
      external_id: 'DEMO-001', dossier_number: 'DEMO-001',
      source: 'vab', mission_type: 'remorquage',
      client_name: 'Client Démo VAB', client_phone: '+32 471 00 00 01',
      vehicle_plate: '1DEMO01', vehicle_brand: 'TOYOTA', vehicle_model: 'Yaris',
      incident_address: 'Avenue Reine Astrid 5', incident_city: 'Spa', incident_country: 'Belgium',
      incident_lat: 50.4928, incident_lng: 5.8616,
      destination_address: 'Garage Demo SA, Rue de la Paix 12, 4900 Spa',
      destination_name: 'Garage Demo SA',
      amount_to_collect: 0, status: 'new',
      received_at: isoNow, intervention_date: isoNow,
      raw_content: '[Demo data] Mission VAB pour Apple Review',
    },
    {
      external_id: 'DEMO-002', dossier_number: 'DEMO-002',
      source: 'touring', mission_type: 'depannage',
      client_name: 'Client Démo Touring', client_phone: '+32 471 00 00 02',
      vehicle_plate: '2DEMO02', vehicle_brand: 'VOLKSWAGEN', vehicle_model: 'Golf',
      incident_address: 'Rue du Centenaire 23', incident_city: 'Verviers', incident_country: 'Belgium',
      incident_lat: 50.5910, incident_lng: 5.8627,
      amount_to_collect: 50.00, status: 'dispatching',
      received_at: isoNow, intervention_date: isoNow,
      raw_content: '[Demo data] Mission Touring depannage sur place',
    },
    {
      external_id: 'DEMO-003', dossier_number: 'DEMO-003',
      source: 'ima', mission_type: 'remorquage',
      client_name: 'Client Démo IMA', client_phone: '+32 471 00 00 03',
      vehicle_plate: '3DEMO03', vehicle_brand: 'BMW', vehicle_model: 'Serie 3',
      incident_address: 'Boulevard Frère Orban 11', incident_city: 'Liège', incident_country: 'Belgium',
      incident_lat: 50.6296, incident_lng: 5.5797,
      destination_address: 'Garage BMW Liège, Avenue du Pont 5, 4020 Liège',
      amount_to_collect: 0, status: 'assigned',
      received_at: isoNow, intervention_date: isoNow,
      assigned_at: isoNow, assigned_to: user.id,
      raw_content: '[Demo data] Mission IMA assignee au compte review',
    },
    {
      external_id: 'DEMO-004', dossier_number: 'DEMO-004',
      source: 'mondial', mission_type: 'depannage',
      client_name: 'Client Démo Mondial', client_phone: '+32 471 00 00 04',
      vehicle_plate: '4DEMO04', vehicle_brand: 'PEUGEOT', vehicle_model: '208',
      incident_address: 'Place du Marché 1', incident_city: 'Verviers', incident_country: 'Belgium',
      incident_lat: 50.5891, incident_lng: 5.8650,
      amount_to_collect: 75.00, status: 'in_progress',
      received_at: iso(-30), intervention_date: iso(-30),
      assigned_at: iso(-25), assigned_to: user.id,
      accepted_at: iso(-20), on_way_at: iso(-15), on_site_at: iso(-5),
      raw_content: '[Demo data] Mission Mondial en cours, chauffeur sur place',
    },
    {
      external_id: 'DEMO-005', dossier_number: 'DEMO-005',
      source: 'ethias', mission_type: 'depannage',
      client_name: 'Client Démo Ethias', client_phone: '+32 471 00 00 05',
      vehicle_plate: '5DEMO05', vehicle_brand: 'RENAULT', vehicle_model: 'Clio',
      incident_address: 'Rue Xhavée 8', incident_city: 'Verviers', incident_country: 'Belgium',
      incident_lat: 50.5868, incident_lng: 5.8629,
      amount_to_collect: 35.00,
      payment_collected_at: iso(-60), payment_mode: 'cash', payment_amount: 35.00,
      status: 'to_invoice',
      received_at: iso(-180), intervention_date: iso(-180),
      assigned_at: iso(-150), assigned_to: user.id,
      accepted_at: iso(-140), on_way_at: iso(-130), on_site_at: iso(-110),
      completed_at: iso(-60),
      discharge_data: [{
        type_key:   'fin_intervention_sans_degats',
        name:       'Client Démo Ethias',
        sig:        demoSig,
        created_at: iso(-60),
      }],
      raw_content: '[Demo data] Mission Ethias terminee + encaissement cash 35 EUR + decharge signee',
    },
  ]

  let created = 0
  let skipped = 0
  for (const m of missions) {
    // Vérifier si déjà existant via external_id
    const { data: existing } = await sb
      .from('incoming_missions')
      .select('id')
      .eq('external_id', m.external_id)
      .maybeSingle()
    if (existing) {
      console.log(`⏭️  ${m.external_id} déjà existant - skip`)
      skipped++
      continue
    }
    const { error } = await sb.from('incoming_missions').insert(m)
    if (error) {
      console.error(`❌ Erreur INSERT ${m.external_id} :`, error.message)
      continue
    }
    console.log(`✅ ${m.external_id} créé (${m.status})`)
    created++
  }

  console.log('')
  console.log(`✨ Terminé : ${created} mission(s) créée(s), ${skipped} déjà présente(s)`)
  console.log('')
  console.log('   Login Apple Review :')
  console.log(`     Email    : ${EMAIL}`)
  console.log(`     Password : ${PASSWORD}`)
  console.log('     Méthode  : Email & mot de passe (sur /login)')
}

main().catch(e => {
  console.error('💥 Erreur fatale :', e)
  process.exit(1)
})
