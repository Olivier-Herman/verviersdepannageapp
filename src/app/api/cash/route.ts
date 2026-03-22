import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt from 'bcryptjs'

// GET /api/cash — solde caisse du chauffeur connecté
// GET /api/cash?driverId=xxx — solde d'un chauffeur (admin)
// GET /api/cash?all=true — tous les chauffeurs (admin)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes(session.user.role)
  const all = req.nextUrl.searchParams.get('all')
  const driverId = req.nextUrl.searchParams.get('driverId')

  // Récupérer l'ID du chauffeur connecté
  const { data: me } = await supabase
    .from('users').select('id, can_verify').eq('email', session.user.email).single()

  if (all && isAdmin) {
    // Tous les chauffeurs avec leur solde
    const { data: drivers } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('role', 'driver')
      .eq('active', true)

    const results = await Promise.all((drivers || []).map(async (driver) => {
      const { data: entries } = await supabase
        .from('cash_register')
        .select('amount, type')
        .eq('driver_id', driver.id)
        .is('verified_at', null) // seulement les non-remis

      const balance = (entries || []).reduce((sum, e) => {
        return e.type === 'encaissement' ? sum + e.amount : sum - e.amount
      }, 0)

      return { ...driver, balance: Math.round(balance * 100) / 100 }
    }))

    return NextResponse.json(results)
  }

  // Solde d'un chauffeur spécifique
  const targetId = driverId || me?.id
  if (!targetId) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })

  const { data: entries } = await supabase
    .from('cash_register')
    .select('*, intervention:interventions(reference, plate, amount, created_at)')
    .eq('driver_id', targetId)
    .order('created_at', { ascending: false })

  const balance = (entries || [])
    .filter(e => !e.verified_at)
    .reduce((sum, e) => {
      return e.type === 'encaissement' ? sum + e.amount : sum - e.amount
    }, 0)

  return NextResponse.json({
    balance: Math.round(balance * 100) / 100,
    entries: entries || [],
  })
}

// POST /api/cash — ajouter une remise + valider avec PIN
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const { action, amount, driverId, pin, notes } = body
  const supabase = createAdminClient()

  if (action === 'remise') {
    // Vérifier le PIN du responsable
    if (!pin) return NextResponse.json({ error: 'PIN requis' }, { status: 400 })

    // Récupérer les responsables pouvant valider
    const { data: verifiers } = await supabase
      .from('users')
      .select('id, name, verify_pin_hash')
      .eq('can_verify', true)
      .eq('active', true)

    let validatedBy = null
    for (const verifier of verifiers || []) {
      if (verifier.verify_pin_hash) {
        const match = await bcrypt.compare(pin.toString(), verifier.verify_pin_hash)
        if (match) { validatedBy = verifier; break }
      }
    }

    if (!validatedBy) {
      return NextResponse.json({ error: 'PIN incorrect' }, { status: 403 })
    }

    // Enregistrer la remise
    const { data: remise, error } = await supabase
      .from('cash_register')
      .insert({
        driver_id: driverId,
        amount: parseFloat(amount),
        type: 'remise',
        verified_by: validatedBy.id,
        verified_at: new Date().toISOString(),
        notes: notes || `Remise validée par ${validatedBy.name}`,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      remise,
      validatedBy: validatedBy.name,
    })
  }

  if (action === 'set_pin') {
    // Modifier son propre PIN
    const { newPin } = body
    if (!newPin || newPin.toString().length !== 4) {
      return NextResponse.json({ error: 'Le PIN doit être à 4 chiffres' }, { status: 400 })
    }

    const hash = await bcrypt.hash(newPin.toString(), 10)
    const { error } = await supabase
      .from('users')
      .update({ verify_pin_hash: hash })
      .eq('email', session.user.email)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
